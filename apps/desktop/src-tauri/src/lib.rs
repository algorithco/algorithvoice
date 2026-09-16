mod error;
mod history;
mod local_asr;
mod push_to_talk;
mod state;

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

#[tauri::command]
fn license_status() -> LicenseStatus {
    // Phase 1 stub — Phase 3 binds real license JWT + offline grace.
    LicenseStatus {
        valid: false,
        next: "phase-3",
    }
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
fn open_settings(app: tauri::AppHandle) -> AppResult<()> {
    if let Some(win) = app.get_webview_window("settings") {
        let _ = win.unminimize();
        let _ = win.show();
        win.set_focus()
            .map_err(|e| AppError::window(e.to_string()))?;
        return Ok(());
    }
    // Same bundle as main; frontend renders the settings view when label == "settings".
    let window = tauri::WebviewWindowBuilder::new(
        &app,
        "settings",
        tauri::WebviewUrl::App("index.html".into()),
    )
    .title("Algorith Voice — Settings")
    .inner_size(440.0, 600.0)
    .min_inner_size(360.0, 480.0)
    .center()
    .focused(true)
    .build()
    .map_err(|e| AppError::window(e.to_string()))?;
    window
        .set_focus()
        .map_err(|e| AppError::window(e.to_string()))?;
    Ok(())
}

// ---- Device session (refresh/access token lives in OS keyring, never on disk) ----

fn keyring_entry() -> AppResult<keyring::Entry> {
    keyring::Entry::new(SERVICE, ACCOUNT).map_err(|e| AppError::session(e.to_string()))
}

fn read_session_email() -> Option<String> {
    keyring_entry()
        .ok()?
        .get_password()
        .ok()
        .and_then(|raw| serde_json::from_str::<serde_json::Value>(&raw).ok())
        .and_then(|value| {
            value
                .get("email")
                .and_then(|email| email.as_str())
                .map(str::to_owned)
        })
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
        .or(refresh_token)
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty());
    let mut payload = serde_json::json!({ "access_token": token, "email": email });
    if let Some(value) = refresh {
        payload["refresh_token"] = serde_json::Value::String(value);
    }
    keyring_entry()?
        .set_password(&payload.to_string())
        .map_err(|e| AppError::session(e.to_string()))?;
    let _ = app.emit(
        "session-changed",
        serde_json::json!({ "loggedIn": true, "email": email }),
    );
    Ok(())
}

#[tauri::command]
fn session_status() -> SessionStatus {
    match read_session_email() {
        Some(email) => SessionStatus::logged_in(email),
        None => SessionStatus::logged_out(),
    }
}

#[tauri::command]
fn clear_session(app: tauri::AppHandle) -> AppResult<()> {
    let entry = keyring_entry()?;
    // Missing entry == already logged out; don't error.
    match entry.delete_credential() {
        Ok(()) => {}
        Err(keyring::Error::NoEntry) => {}
        Err(e) => return Err(AppError::session(e.to_string())),
    }
    let _ = app.emit("session-changed", serde_json::json!({ "loggedIn": false }));
    Ok(())
}

// ---- Global push-to-talk hotkey (Phase 2 ready, UI untouched) ----

fn normalize_hotkey(raw: &str) -> AppResult<String> {
    let hotkey = raw.trim().to_owned();
    if hotkey.is_empty() {
        return Err(AppError::shortcut("hotkey must not be empty"));
    }
    if hotkey.len() > 48 {
        return Err(AppError::shortcut("hotkey too long"));
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
        shortcuts
            .register(next)
            .map_err(|e| AppError::shortcut(format!("cannot register {next}: {e}")))?;
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
    swap_hotkey(&app, &previous, &next)?;
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
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| AppError::store(e.to_string()))?;
    std::fs::create_dir_all(&data_dir).map_err(|e| AppError::store(e.to_string()))?;
    let db_path = data_dir.join("algorith-voice.db");
    let conn = rusqlite::Connection::open(&db_path).map_err(|e| AppError::store(e.to_string()))?;
    conn.execute_batch(
        "PRAGMA journal_mode = WAL;
         CREATE TABLE IF NOT EXISTS history (
           id TEXT PRIMARY KEY,
           created_at TEXT NOT NULL,
           transcript TEXT NOT NULL
         );
         CREATE TABLE IF NOT EXISTS kv (
           key TEXT PRIMARY KEY,
           value TEXT NOT NULL
         );",
    )
    .map_err(|e| AppError::store(e.to_string()))?;
    Ok(Db(Mutex::new(conn)))
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
                let _ = show_main_window(app);
            }
            "settings" => {
                let _ = open_settings(app.clone());
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
    // Accept `algorithvoice://...` and `algorithvoice:...` (Windows sometimes
    // strips slashes). Case-insensitive scheme, validated before emitting so
    // a fake CLI arg cannot spoof an auth callback.
    let lower = trimmed.to_ascii_lowercase();
    let scheme_slashes = format!("{DEEP_LINK_SCHEME}://");
    let scheme_bare = format!("{DEEP_LINK_SCHEME}:");
    lower.starts_with(&scheme_slashes) || lower.starts_with(&scheme_bare)
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
            let _ = app.emit("single-instance", argv.clone());
        }))
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
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
            // Dictation apps live in the tray: close hides, Quit exits.
            // The floating pill follows the same rule so its close button
            // never kills the process (reopen via Dictate view / tray).
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                // During Quit, let every window close for real so the
                // runtime can finish tearing down and the process ends.
                let exiting = window
                    .app_handle()
                    .try_state::<AppState>()
                    .map(|s| s.exiting.load(Ordering::SeqCst))
                    .unwrap_or(false);
                if exiting {
                    return;
                }
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
            local_asr::commands::verify_model
        ])
        .run(tauri::generate_context!())
        .expect("error while running Algorith Voice");
}
