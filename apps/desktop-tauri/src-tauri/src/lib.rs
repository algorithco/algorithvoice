mod db;
mod error;
mod history;
/// Local speech recognition (manifest, downloads, worker, audio).
/// Public so integration tests (and future commands) can drive the real
/// engine and pipeline; the Tauri command surface stays curated in
/// `invoke_handler` below regardless of what is reachable here.
pub mod local_asr;
mod logging;
mod push_to_talk;
mod state;
mod window;

use error::{AppError, AppResult};
use state::{AppState, Db, LicenseStatus, SessionStatus, TrayState};
use std::sync::atomic::Ordering;
use std::sync::Mutex;
use tauri::{
    image::Image,
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager,
};
use tauri_plugin_deep_link::DeepLinkExt;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

const SERVICE: &str = "com.algorithvoice.app";
const ACCOUNT: &str = "algorith-voice-session";
const DEFAULT_HOTKEY: &str = "Ctrl+Space";
const DEEP_LINK_SCHEME: &str = "algorithvoice";

#[tauri::command]
fn get_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

/// Licensing/entitlement probe (currently unimplemented).
///
/// FAIL-CLOSED CONTRACT: this command returns `Err(not-implemented)` until a
/// real entitlement source exists. Any future frontend gate MUST treat `Err`
/// as "not licensed — block the feature", never as "unknown — allow".
/// (Verified 2026-09: zero call sites exist yet, so nothing can fail open
/// today; this comment binds future callers.)
#[tauri::command]
fn license_status() -> AppResult<LicenseStatus> {
    // NEEDS PRODUCT INPUT: no licensing/entitlement backend is defined for
    // this release (no subscription endpoint, no local license file format).
    // Returning a silent fake `{valid:false}` would look like a real check;
    // fail loudly instead so callers and QA cannot mistake it for enforcement.
    // When the product defines the source (e.g. api.algorithvoice.com
    // subscription check or local license JWT + offline grace), implement it
    // here and remove this error. See CHANGELOG (P4.14).
    Err(AppError::not_implemented(
        "licensing is not configured for this release — no entitlement source defined",
    ))
}

// ---- Tray ---------------------------------------------------------------

fn apply_tray_icon(app: &tauri::AppHandle, state: TrayState) -> AppResult<()> {
    let tray = app
        .tray_by_id("main")
        .ok_or_else(|| AppError::tray("tray not found"))?;
    tray.set_icon(Some(
        Image::from_bytes(state.icon_bytes()).map_err(|e| AppError::tray(e.to_string()))?,
    ))
    .map_err(|e| AppError::tray(e.to_string()))?;
    tray.set_tooltip(Some(state.tooltip()))
        .map_err(|e| AppError::tray(e.to_string()))?;
    Ok(())
}

#[tauri::command]
fn set_tray_state(
    app: tauri::AppHandle,
    app_state: tauri::State<'_, AppState>,
    state: TrayState,
) -> AppResult<()> {
    // Cheap dedupe: skip native icon swap when nothing changed.
    let changed = {
        let mut current = app_state
            .tray_state
            .lock()
            .map_err(|_| AppError::tray("state lock"))?;
        if *current == state {
            false
        } else {
            *current = state;
            true
        }
    };
    if changed {
        apply_tray_icon(&app, state)?;
    }
    Ok(())
}

#[tauri::command]
fn get_tray_state(app_state: tauri::State<'_, AppState>) -> AppResult<TrayState> {
    app_state
        .tray_state
        .lock()
        .map(|guard| *guard)
        .map_err(|_| AppError::tray("state lock"))
}

fn show_main_window(app: &tauri::AppHandle) -> AppResult<()> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| AppError::window("main window not found"))?;
    // Unminimize first so a minimized window actually reappears.
    let _ = window.unminimize();
    window.show().map_err(|e| AppError::window(e.to_string()))?;
    window
        .set_focus()
        .map_err(|e| AppError::window(e.to_string()))?;
    Ok(())
}

#[tauri::command]
async fn open_settings(app: tauri::AppHandle) -> AppResult<()> {
    if let Some(win) = app.get_webview_window("settings") {
        let _ = win.unminimize();
        win.show().map_err(|e| AppError::window(e.to_string()))?;
        win.set_focus()
            .map_err(|e| AppError::window(e.to_string()))?;
        // Hidden window preserves React state — nudge it to reload prefs.
        let _ = win.emit("settings-refresh", ());
        return Ok(());
    }
    // Window creation must happen on the main thread (see window.rs);
    // building from the command worker deadlocks the webview at about:blank.
    let window = crate::window::build_on_main_thread(&app, |handle| {
        tauri::WebviewWindowBuilder::new(
            &handle,
            "settings",
            tauri::WebviewUrl::App("index.html".into()),
        )
        .title("Algorith Voice — Settings")
        .inner_size(440.0, 600.0)
        .min_inner_size(360.0, 480.0)
        .center()
        .focused(true)
        .build()
    })
    .await
    .map_err(|e| AppError::window(format!("create settings window: {e}")))?;
    window
        .set_focus()
        .map_err(|e| AppError::window(e.to_string()))?;
    Ok(())
}

// ---- Device session (refresh/access token lives in OS keyring, never on disk) ----
// Linux headless/minimal-DE fallback: when the Secret Service backend is
// unavailable (no gnome-keyring/kwallet), session persists in an explicitly
// flagged 0600 fallback file instead of crashing. The fallback is
// less-secure by design and labelled as such on disk + in logs.

fn keyring_entry() -> AppResult<keyring::Entry> {
    keyring::Entry::new(SERVICE, ACCOUNT).map_err(|e| AppError::session(keyring_guidance(&e)))
}

fn keyring_guidance(e: &keyring::Error) -> String {
    let base = e.to_string();
    #[cfg(target_os = "linux")]
    {
        format!(
            "{base} — no Secret Service provider found. Install and unlock gnome-keyring or kwallet for secure storage, or set a fallback (see session.fallback.README.txt). Logging out and back in after installing a provider migrates back to the keyring."
        )
    }
    #[cfg(not(target_os = "linux"))]
    {
        base
    }
}

fn is_keyring_unavailable(e: &keyring::Error) -> bool {
    !matches!(e, keyring::Error::NoEntry)
}

fn fallback_session_path(app: &tauri::AppHandle) -> Option<std::path::PathBuf> {
    use tauri::Manager as _;
    app.path()
        .app_data_dir()
        .ok()
        .map(|d| d.join("session.fallback.json"))
}

fn write_fallback_readme(dir: &std::path::Path) {
    let readme = dir.join("session.fallback.README.txt");
    if readme.exists() {
        return;
    }
    let _ = std::fs::write(
        &readme,
        "LESS-SECURE SESSION FALLBACK — Algorith Voice\n\
         This file exists because no OS keyring provider (Secret Service /\n\
         gnome-keyring / kwallet on Linux) was available when you signed in.\n\
         Your session is stored in session.fallback.json with 0600 permissions\n\
         instead of the OS keyring. Install + unlock gnome-keyring or kwallet,\n\
         then log out and back in to migrate to secure storage.\n",
    );
}

fn read_fallback_payload(app: &tauri::AppHandle) -> Option<serde_json::Value> {
    let path = fallback_session_path(app)?;
    let raw = std::fs::read_to_string(&path).ok()?;
    serde_json::from_str(&raw).ok()
}

fn write_fallback_payload(app: &tauri::AppHandle, payload: &serde_json::Value) -> AppResult<()> {
    use tauri::Manager as _;
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| AppError::session(e.to_string()))?;
    std::fs::create_dir_all(&dir).map_err(|e| AppError::session(e.to_string()))?;
    write_fallback_readme(&dir);
    let path = dir.join("session.fallback.json");
    std::fs::write(&path, payload.to_string())
        .map_err(|e| AppError::session(format!("fallback session write failed: {e}")))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt as _;
        let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600));
    }
    logging::log_event(
        app,
        "auth",
        "keyring-fallback-write",
        "session stored in less-secure fallback file (no Secret Service provider)",
    );
    Ok(())
}

fn delete_fallback_payload(app: &tauri::AppHandle) {
    if let Some(path) = fallback_session_path(app) {
        let _ = std::fs::remove_file(&path);
    }
}

fn read_session_email(app: &tauri::AppHandle) -> Option<String> {
    match keyring_entry() {
        Ok(entry) => match entry.get_password() {
            Ok(raw) => serde_json::from_str::<serde_json::Value>(&raw)
                .ok()
                .and_then(|value| {
                    value
                        .get("email")
                        .and_then(|email| email.as_str())
                        .map(str::to_owned)
                }),
            Err(keyring::Error::NoEntry) => {
                // No keyring credential — check for a fallback from an
                // earlier headless session before reporting logged-out.
                read_fallback_payload(app).and_then(|v| v.get("email")?.as_str().map(str::to_owned))
            }
            Err(e) if is_keyring_unavailable(&e) => {
                eprintln!(
                    "algorith-voice: keyring read failed, trying fallback: {}",
                    keyring_guidance(&e)
                );
                read_fallback_payload(app).and_then(|v| v.get("email")?.as_str().map(str::to_owned))
            }
            Err(_) => None,
        },
        Err(_) => {
            read_fallback_payload(app).and_then(|v| v.get("email")?.as_str().map(str::to_owned))
        }
    }
}

fn validate_session_input(token: &str, email: &str) -> AppResult<(String, String)> {
    let token = token.trim().to_owned();
    let email = email.trim().to_owned();
    if token.is_empty() {
        return Err(AppError::session("missing access token"));
    }
    if token.len() > 16_384 {
        return Err(AppError::session("access token too long"));
    }
    if email.is_empty() || email.len() > 320 || !email.contains('@') {
        return Err(AppError::session("invalid email"));
    }
    Ok((token, email))
}

#[allow(non_snake_case)]
#[tauri::command]
fn store_session(
    app: tauri::AppHandle,
    email: String,
    accessToken: Option<String>,
    access_token: Option<String>,
    refreshToken: Option<String>,
    refresh_token: Option<String>,
) -> AppResult<()> {
    // Frontend sends `{ accessToken, email }` (camelCase). Accept snake_case
    // too so older/newer callers keep working; never break the UI contract.
    // refreshToken is optional (OAuth flow); never stored raw in logs.
    let token = accessToken
        .or(access_token)
        .ok_or_else(|| AppError::session("missing access token"))?;
    let (token, email) = validate_session_input(&token, &email)?;
    let refresh = refreshToken
        .as_ref()
        .or(refresh_token.as_ref())
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty())
        .filter(|value| value.len() <= 8192);
    if refreshToken
        .as_ref()
        .or(refresh_token.as_ref())
        .is_some_and(|v| v.trim().len() > 8192)
    {
        return Err(AppError::session("refresh token too long"));
    }
    let mut payload = serde_json::json!({ "access_token": token, "email": email });
    if let Some(value) = refresh {
        payload["refresh_token"] = serde_json::Value::String(value);
    }
    match keyring_entry().and_then(|entry| {
        entry
            .set_password(&payload.to_string())
            .map_err(|e| AppError::session(keyring_guidance(&e)))
    }) {
        Ok(()) => {
            delete_fallback_payload(&app);
        }
        Err(e) => {
            // Keyring backend unavailable (Linux headless): fall back to the
            // flagged file instead of failing sign-in. Any other error is real.
            let msg = e.to_string();
            let unavailable = msg.contains("Secret Service")
                || msg.contains("PlatformFailure")
                || msg.contains("NoStorageAccess")
                || cfg!(target_os = "linux");
            if unavailable {
                eprintln!("algorith-voice: keyring unavailable, using fallback: {e}");
                write_fallback_payload(&app, &payload)?;
            } else {
                logging::log_event(&app, "auth", "store-session-failed", &msg);
                return Err(e);
            }
        }
    }
    logging::log_event(&app, "auth", "store-session", "session stored");
    let _ = app.emit(
        "session-changed",
        serde_json::json!({ "loggedIn": true, "email": email }),
    );
    Ok(())
}

#[tauri::command]
fn session_status(app: tauri::AppHandle) -> SessionStatus {
    match read_session_email(&app) {
        Some(email) => SessionStatus::logged_in(email),
        None => SessionStatus::logged_out(),
    }
}

#[tauri::command]
fn clear_session(app: tauri::AppHandle) -> AppResult<()> {
    delete_fallback_payload(&app);
    let entry = keyring_entry()?;
    // Missing entry == already logged out; don't error.
    match entry.delete_credential() {
        Ok(()) => {}
        Err(keyring::Error::NoEntry) => {}
        Err(e) if is_keyring_unavailable(&e) => {
            eprintln!("algorith-voice: keyring delete failed (backend unavailable, fallback already cleared): {}", keyring_guidance(&e));
        }
        Err(e) => return Err(AppError::session(keyring_guidance(&e))),
    }
    logging::log_event(&app, "auth", "clear-session", "session cleared");
    let _ = app.emit("session-changed", serde_json::json!({ "loggedIn": false }));
    Ok(())
}

// ---- Global push-to-talk hotkey (Phase 2 ready, UI untouched) ----

fn normalize_hotkey(raw: &str) -> AppResult<String> {
    let hotkey = raw.trim().to_owned();
    if hotkey.is_empty() {
        return Err(AppError::shortcut("hotkey must not be empty"));
    }
    if hotkey.len() > 32 {
        return Err(AppError::shortcut("hotkey too long (max 32)"));
    }
    if !hotkey
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '+' | '-' | '_' | ' '))
    {
        return Err(AppError::shortcut("hotkey contains unsupported characters"));
    }
    if !hotkey.chars().any(|c| c.is_ascii_alphanumeric()) {
        return Err(AppError::shortcut("hotkey must contain a key"));
    }
    // Require at least one modifier to avoid hijacking single keys
    let lower = hotkey.to_ascii_lowercase();
    let has_modifier = ["ctrl", "alt", "shift", "super", "meta", "command", "cmd"]
        .iter()
        .any(|m| lower.contains(m));
    if !has_modifier || !lower.contains('+') {
        return Err(AppError::shortcut(
            "hotkey must include a modifier (Ctrl/Alt/Shift/Super) + key, e.g. Ctrl+Space",
        ));
    }
    // Blocklist dangerous system combos
    let blocked = [
        "alt+f4",
        "ctrl+alt+del",
        "ctrl+alt+delete",
        "super+l",
        "meta+l",
        "ctrl+q",
        "alt+tab",
        "super+d",
    ];
    if blocked.iter().any(|b| lower == *b) {
        return Err(AppError::shortcut("hotkey is reserved by the OS"));
    }
    // Basic structure: modifiers + final key, no empty segments like "Ctrl++A" or trailing "+"
    if hotkey.contains("++") || hotkey.starts_with('+') || hotkey.ends_with('+') {
        return Err(AppError::shortcut("hotkey format is invalid"));
    }
    Ok(hotkey)
}

fn swap_hotkey(app: &tauri::AppHandle, previous: &str, next: &str) -> AppResult<()> {
    #[cfg(desktop)]
    {
        let shortcuts = app.global_shortcut();
        if !previous.is_empty() && shortcuts.is_registered(previous) {
            // Best effort: old binding may already be gone after restart.
            let _ = shortcuts.unregister(previous);
        }
        shortcuts.register(next).map_err(|e| {
            let msg = format!(
                "cannot register {next} ({e}) — it may be owned by the OS or another app. Pick a different hotkey in Settings."
            );
            logging::log_event(app, "hotkey", "register-failed", &msg);
            AppError::shortcut(msg)
        })?;
    }
    #[cfg(not(desktop))]
    {
        let _ = (app, previous, next);
    }
    Ok(())
}

#[tauri::command]
fn get_hotkey(state: tauri::State<'_, AppState>) -> AppResult<String> {
    state
        .hotkey
        .read()
        .map(|guard| guard.clone())
        .map_err(|_| AppError::shortcut("state lock"))
}

#[tauri::command]
fn register_hotkey(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    shortcut: String,
) -> AppResult<()> {
    let next = normalize_hotkey(&shortcut)?;
    let previous = state
        .hotkey
        .read()
        .map(|guard| guard.clone())
        .map_err(|_| AppError::shortcut("state lock"))?;
    if previous == next {
        return Ok(());
    }
    if let Err(e) = swap_hotkey(&app, &previous, &next) {
        // Surface to the user via notification AND settings-page error text
        // (the frontend shows both). The previous hotkey stays active.
        logging::log_event(&app, "hotkey", "register-failed", &e.to_string());
        return Err(e);
    }
    logging::log_event(
        &app,
        "hotkey",
        "registered",
        &format!("hotkey set to {next}"),
    );
    state
        .hotkey
        .write()
        .map(|mut guard| *guard = next)
        .map_err(|_| AppError::shortcut("state lock"))?;
    Ok(())
}

#[tauri::command]
fn unregister_hotkey(app: tauri::AppHandle, state: tauri::State<'_, AppState>) -> AppResult<()> {
    let previous = state
        .hotkey
        .read()
        .map(|guard| guard.clone())
        .map_err(|_| AppError::shortcut("state lock"))?;
    #[cfg(desktop)]
    {
        if !previous.is_empty() && app.global_shortcut().is_registered(previous.as_str()) {
            app.global_shortcut()
                .unregister(previous.as_str())
                .map_err(|e| AppError::shortcut(e.to_string()))?;
        }
    }
    #[cfg(not(desktop))]
    {
        let _ = &app;
    }
    Ok(())
}

// ---- Local persistence (SQLite ready, no UI dependency) ----

fn init_db(app: &tauri::AppHandle) -> AppResult<Db> {
    let data_dir = app.path().app_data_dir().map_err(|e| {
        logging::log_event(app, "db", "init-failed", &e.to_string());
        AppError::store(e.to_string())
    })?;
    std::fs::create_dir_all(&data_dir).map_err(|e| {
        logging::log_event(app, "db", "init-failed", &e.to_string());
        AppError::store(e.to_string())
    })?;
    let db_path = data_dir.join("algorith-voice.db");
    let mut conn = rusqlite::Connection::open(&db_path).map_err(|e| {
        logging::log_event(app, "db", "open-failed", &e.to_string());
        AppError::store(e.to_string())
    })?;
    // Ordered migrations (current schema is v1) so future changes never drop
    // user history. See src/db.rs.
    if let Err(e) = db::run_migrations(&mut conn) {
        logging::log_event(app, "db", "migration-failed", &e.to_string());
        return Err(e);
    }
    Ok(Db(Mutex::new(conn)))
}

// ---- Diagnostics / logging (P6) ----

#[tauri::command]
fn get_log_dir(app: tauri::AppHandle) -> String {
    logging::log_dir(&app).to_string_lossy().into_owned()
}

#[tauri::command]
fn read_recent_logs(app: tauri::AppHandle, max_bytes: Option<u64>) -> String {
    logging::read_recent_logs(&app, max_bytes.unwrap_or(200_000))
}

#[tauri::command]
fn log_frontend_error(
    app: tauri::AppHandle,
    kind: String,
    message: String,
    stack: Option<String>,
    url: Option<String>,
) -> AppResult<()> {
    let kind = kind.chars().take(64).collect::<String>();
    let message = message.chars().take(2000).collect::<String>();
    let mut detail = format!("kind={kind} message={message}");
    if let Some(url) = url {
        detail.push_str(&format!(
            " url={}",
            url.chars().take(500).collect::<String>()
        ));
    }
    if let Some(stack) = stack {
        detail.push_str(&format!(
            " stack={}",
            stack.chars().take(6000).collect::<String>()
        ));
    }
    logging::log_event(&app, "frontend", &kind, &detail);
    Ok(())
}

// ---- Tray / deep-link / single-instance ----

fn build_tray(app: &tauri::AppHandle) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, "show", "Show", true, None::<&str>)?;
    let settings = MenuItem::with_id(app, "settings", "Settings", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &settings, &quit])?;

    TrayIconBuilder::with_id("main")
        .icon(Image::from_bytes(include_bytes!("../icons/tray-idle.png"))?)
        .tooltip("Algorith Voice")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => {
                if let Err(e) = show_main_window(app) {
                    eprintln!("algorith-voice: show_main_window failed: {e}");
                }
            }
            "settings" => {
                // open_settings is async (window creation bounces to the
                // main thread); the menu handler itself is sync, so spawn.
                let handle = app.clone();
                tauri::async_runtime::spawn(async move {
                    if let Err(e) = open_settings(handle.clone()).await {
                        eprintln!("algorith-voice: open_settings failed: {e}");
                        let _ = handle.emit("settings-error", e.to_string());
                    }
                });
            }
            "quit" => {
                // 1) Remember the intent so CloseRequested below lets the
                //    windows die instead of hiding them back into the tray.
                if let Some(state) = app.try_state::<AppState>() {
                    state.exiting.store(true, Ordering::SeqCst);
                }
                // 2) Drop the tray icon right away so no ghost lingers in
                //    the notification area while the runtime shuts down.
                if let Some(tray) = app.tray_by_id("main") {
                    let _ = tray.set_visible(false);
                }
                // 3) Graceful runtime shutdown (ExitRequested -> Exit).
                app.exit(0);
                // 4) Guarantee: the process must be gone from Task Manager.
                //    Safe to be unconditional here — the app keeps no unsaved
                //    state, the tray icon is already hidden, and the exit
                //    code stays 0.
                std::process::exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                let app = tray.app_handle();
                if let Some(win) = app.get_webview_window("main") {
                    let _ = win.is_visible().map(|visible| {
                        if visible {
                            let _ = win.hide();
                        } else {
                            let _ = show_main_window(app);
                        }
                    });
                }
            }
        })
        .build(app)?;
    Ok(())
}

fn focus_main_for_external_event(handle: &tauri::AppHandle) {
    if let Some(win) = handle.get_webview_window("main") {
        let _ = win.unminimize();
        let _ = win.show();
        let _ = win.set_focus();
    }
}

fn is_deep_link(raw: &str) -> bool {
    let trimmed = raw.trim();
    // Strict allowlist: only `algorithvoice://auth-callback?...` (with or
    // without trailing slash, optional query/fragment). Reject bare scheme,
    // other hosts, and file paths. Case-insensitive.
    let Ok(url) = url::Url::parse(trimmed) else {
        return false;
    };
    if url.scheme().to_ascii_lowercase() != DEEP_LINK_SCHEME {
        return false;
    }
    // Require host `auth-callback` (covers `algorithvoice://auth-callback`)
    // Tauri on Windows may deliver `algorithvoice://auth-callback?code=...`
    // which url crate parses with host = Some("auth-callback").
    matches!(
        url.host_str(),
        Some(host) if host.eq_ignore_ascii_case("auth-callback")
    )
}

fn handle_argv_deep_links(handle: &tauri::AppHandle, argv: &[String]) {
    // Windows/Linux deliver deep links as a new-process CLI arg when the
    // single-instance plugin forwards us here. Validate the scheme before
    // emitting so a fake CLI arg cannot spoof an auth callback.
    let urls: Vec<String> = argv
        .iter()
        .filter(|arg| is_deep_link(arg))
        .cloned()
        .collect();
    if urls.is_empty() {
        return;
    }
    focus_main_for_external_event(handle);
    if let Some(win) = handle.get_webview_window("main") {
        let _ = win.emit("auth-callback", urls);
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Single-instance MUST stay first so second launches forward to us
        // instead of racing other plugins during startup.
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            focus_main_for_external_event(app);
            handle_argv_deep_links(app, &argv);
            // Emit only sanitized deep-links, never raw argv (prevents argv injection).
            let filtered: Vec<String> = argv.into_iter().filter(|a| is_deep_link(a)).collect();
            if !filtered.is_empty() {
                let _ = app.emit("auth-callback", filtered);
            }
        }))
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        // Windows-only desktop: autostart uses Registry/Task Scheduler.
        // MacosLauncher arg is required by the plugin API but ignored on Windows.
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    // Pressed -> start_ptt, Released -> stop_ptt.
                    // Emit stable events; the frontend can subscribe without
                    // any Rust change later. OS key-repeat can deliver
                    // several `Pressed` for one physical hold — dedupe so a
                    // held hotkey never restarts the recording pipeline.
                    static PTT_HELD: std::sync::atomic::AtomicBool =
                        std::sync::atomic::AtomicBool::new(false);
                    match event.state() {
                        ShortcutState::Pressed => {
                            if !PTT_HELD.swap(true, std::sync::atomic::Ordering::SeqCst) {
                                let _ = app.emit("ptt-pressed", ());
                            }
                        }
                        ShortcutState::Released => {
                            PTT_HELD.store(false, std::sync::atomic::Ordering::SeqCst);
                            let _ = app.emit("ptt-released", ());
                        }
                    }
                })
                .build(),
        )
        .manage(AppState::with_hotkey(DEFAULT_HOTKEY))
        // Local transcription worker (shared, lazily loaded; Arc so blocking
        // loaders can own a handle across spawn_blocking).
        .manage(std::sync::Arc::new(
            local_asr::worker::TranscriptionWorker::new(),
        ))
        .manage(local_asr::downloader::DownloadManager::new())
        .setup(|app| {
            match init_db(app.handle()) {
                Ok(db) => {
                    app.manage(db);
                }
                Err(e) => {
                    eprintln!("algorith-voice: sqlite init failed: {e}");
                }
            }
            if let Err(e) = build_tray(app.handle()) {
                // Tray is best-effort on Linux without libappindicator; the
                // main window must still work.
                eprintln!("algorith-voice: tray init failed: {e}");
            }
            // Best-effort default hotkey so PTT works before Settings loads.
            // A later register_hotkey() call swaps it atomically.
            #[cfg(desktop)]
            {
                let handle = app.handle().clone();
                if let Err(e) = swap_hotkey(&handle, "", DEFAULT_HOTKEY) {
                    eprintln!("algorith-voice: default hotkey unavailable: {e}");
                }
            }
            // OAuth deep-link: validate scheme, focus main, forward URLs.
            let handle = app.handle().clone();
            app.deep_link().on_open_url(move |event| {
                let urls: Vec<String> = event
                    .urls()
                    .iter()
                    .map(|url| url.to_string())
                    .filter(|raw| is_deep_link(raw))
                    .collect();
                if urls.is_empty() {
                    return;
                }
                focus_main_for_external_event(&handle);
                if let Some(win) = handle.get_webview_window("main") {
                    let _ = win.emit("auth-callback", urls);
                }
            });
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let exiting = window
                    .app_handle()
                    .try_state::<AppState>()
                    .map(|s| s.exiting.load(Ordering::SeqCst))
                    .unwrap_or(false);
                if exiting {
                    return;
                }
                // Main + pill live in tray: hide on close, Quit exits.
                // Settings also hides but emits refresh on next open (see open_settings)
                // so stale prefs don't persist. Destroy would lose window state,
                // hide keeps it cheap but forces a reload event.
                if window.label() == "main"
                    || window.label() == "settings"
                    || window.label() == "floating-pill"
                {
                    let _ = window.hide();
                    api.prevent_close();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            get_version,
            license_status,
            set_tray_state,
            get_tray_state,
            open_settings,
            store_session,
            session_status,
            clear_session,
            get_hotkey,
            register_hotkey,
            unregister_hotkey,
            // Push-to-talk floating pill (additive; existing commands untouched).
            push_to_talk::transcribe_audio,
            push_to_talk::transcribe_and_paste,
            push_to_talk::paste_text,
            push_to_talk::set_groq_api_key,
            push_to_talk::has_groq_key,
            push_to_talk::clear_groq_key,
            push_to_talk::get_foreground_info,
            push_to_talk::ensure_floating_pill,
            push_to_talk::set_floating_pill_visible,
            push_to_talk::floating_pill_visible,
            history::history_save,
            history::history_list,
            history::history_stats,
            history::history_delete,
            history::history_clear,
            // Local model manager (additive; cloud path untouched).
            local_asr::commands::list_available_models,
            local_asr::commands::get_model_status,
            local_asr::commands::get_installed_models,
            local_asr::commands::download_model,
            local_asr::commands::cancel_download,
            local_asr::commands::delete_model,
            local_asr::commands::verify_model,
            // Local inference worker + hardware (Phase 3; cloud path untouched).
            local_asr::commands::select_active_model,
            local_asr::commands::start_inference_worker,
            local_asr::commands::stop_inference_worker,
            local_asr::commands::get_transcription_status,
            local_asr::commands::get_hardware_info,
            local_asr::commands::get_model_compatibilities,
            // Diagnostics / logging (Settings → Diagnostics).
            get_log_dir,
            read_recent_logs,
            log_frontend_error
        ])
        .run(tauri::generate_context!())
        .expect("error while running Algorith Voice");
}
