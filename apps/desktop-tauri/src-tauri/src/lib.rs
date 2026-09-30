mod db;
mod error;
mod history;
/// Local speech recognition (manifest, downloads, worker, audio).
/// Public so integration tests (and future commands) can drive the real
/// engine and pipeline; the Tauri command surface stays curated in
/// `invoke_handler` below regardless of what is reachable here.
pub mod local_asr;
mod local_usage;
mod logging;
mod push_to_talk;
mod state;
mod window;

use error::{AppError, AppResult};
use serde::Deserialize;
use state::{AppState, Db, LicenseStatus, SessionStatus, TrayState};
use std::sync::atomic::Ordering;
use std::sync::Mutex;
use std::time::Duration;
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
const DEEP_LINK_SCHEMES: [&str; 2] = ["algorithvoice", "com.algorithvoice.app"];

#[tauri::command]
fn get_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

const ENTITLEMENT_CACHE_TTL: Duration = Duration::from_secs(60);

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SubscriptionResponse {
    status: String,
    plan_tier: String,
    current_period_end: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RefreshResponse {
    access_token: String,
    refresh_token: String,
}

fn default_api_base() -> &'static str {
    "https://api.trqsh.uz"
}

fn validate_api_base(raw: Option<String>) -> AppResult<String> {
    let raw = raw.unwrap_or_else(|| default_api_base().to_string());
    let parsed =
        url::Url::parse(raw.trim()).map_err(|_| AppError::new("entitlement", "invalid API URL"))?;
    let host = parsed.host_str().unwrap_or_default().to_ascii_lowercase();
    let trusted = parsed.scheme() == "https" && host == "api.trqsh.uz";
    if !trusted {
        return Err(AppError::new("entitlement", "untrusted API URL"));
    }
    Ok(raw.trim_end_matches('/').to_string())
}

fn read_session_payload(app: &tauri::AppHandle) -> Option<serde_json::Value> {
    if let Some(payload) = app
        .try_state::<AppState>()
        .and_then(|state| state.session_payload.lock().ok()?.clone())
    {
        return Some(payload);
    }
    let payload = match keyring_entry() {
        Ok(entry) => match entry.get_password() {
            Ok(raw) => serde_json::from_str(&raw).ok(),
            Err(keyring::Error::NoEntry) => read_fallback_payload(app),
            Err(e) if is_keyring_unavailable(&e) => read_fallback_payload(app),
            Err(_) => None,
        },
        Err(_) => read_fallback_payload(app),
    };
    if let (Some(state), Some(value)) = (app.try_state::<AppState>(), payload.as_ref()) {
        if let Ok(mut cached) = state.session_payload.lock() {
            *cached = Some(value.clone());
        }
    }
    payload
}

async fn request_subscription(app: &tauri::AppHandle, api_base: &str) -> AppResult<LicenseStatus> {
    let payload = read_session_payload(app)
        .ok_or_else(|| AppError::new("subscription-required", "Sign in to verify Pro"))?;
    let mut access_token = payload
        .get("access_token")
        .and_then(|v| v.as_str())
        .map(str::to_owned)
        .ok_or_else(|| AppError::new("subscription-required", "Stored session is incomplete"))?;
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .build()
        .map_err(|e| AppError::new("entitlement", format!("HTTP client: {e}")))?;

    let endpoint = format!("{api_base}/billing/subscription");
    let mut response = client
        .get(&endpoint)
        .bearer_auth(&access_token)
        .send()
        .await;
    if response
        .as_ref()
        .is_ok_and(|r| r.status() == reqwest::StatusCode::UNAUTHORIZED)
    {
        let refresh = payload
            .get("refresh_token")
            .and_then(|v| v.as_str())
            .ok_or_else(|| {
                AppError::new("subscription-required", "Session expired — sign in again")
            })?;
        let refreshed = client
            .post(format!("{api_base}/auth/refresh"))
            .json(&serde_json::json!({ "refresh_token": refresh }))
            .send()
            .await
            .map_err(|e| AppError::new("entitlement", format!("Refresh failed: {e}")))?;
        if !refreshed.status().is_success() {
            return Err(AppError::new(
                "subscription-required",
                "Session expired — sign in again",
            ));
        }
        let tokens: RefreshResponse = refreshed
            .json()
            .await
            .map_err(|e| AppError::new("entitlement", format!("Bad refresh response: {e}")))?;
        access_token = tokens.access_token;
        let email = payload
            .get("email")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string();
        store_session(
            app.clone(),
            email,
            Some(access_token.clone()),
            None,
            Some(tokens.refresh_token),
            None,
        )?;
        response = client
            .get(&endpoint)
            .bearer_auth(&access_token)
            .send()
            .await;
    }

    let response = response
        .map_err(|e| AppError::new("entitlement", format!("Subscription check failed: {e}")))?;
    if !response.status().is_success() {
        return Err(AppError::new(
            "entitlement",
            format!("Subscription check returned {}", response.status()),
        ));
    }
    let subscription: SubscriptionResponse = response
        .json()
        .await
        .map_err(|e| AppError::new("entitlement", format!("Bad subscription response: {e}")))?;
    let valid = subscription.plan_tier == "pro"
        && matches!(subscription.status.as_str(), "active" | "trialing");
    Ok(LicenseStatus {
        valid,
        status: subscription.status,
        plan_tier: subscription.plan_tier,
        current_period_end: subscription.current_period_end,
        reason: (!valid).then(|| "An active Pro subscription is required".to_string()),
    })
}

async fn refresh_entitlement(
    app: &tauri::AppHandle,
    app_state: &AppState,
    api_base: String,
    force: bool,
) -> LicenseStatus {
    let _refresh_guard = app_state.entitlement_refresh.lock().await;
    if !force {
        if let Ok(cache) = app_state.entitlement.lock() {
            let fresh = cache.api_base == api_base
                && cache
                    .checked_at
                    .is_some_and(|checked| checked.elapsed() <= ENTITLEMENT_CACHE_TTL);
            if fresh {
                return cache.status.clone();
            }
        }
    }
    let status = match request_subscription(app, &api_base).await {
        Ok(status) => {
            logging::log_event(
                app,
                "entitlement",
                "verified",
                &format!(
                    "status={} plan={} valid={}",
                    status.status, status.plan_tier, status.valid
                ),
            );
            status
        }
        Err(error) => {
            logging::log_event(app, "entitlement", "verify-failed", &error.message);
            LicenseStatus {
                valid: false,
                status: "unavailable".to_string(),
                plan_tier: "free".to_string(),
                current_period_end: None,
                reason: Some(error.message),
            }
        }
    };
    if let Ok(mut cache) = app_state.entitlement.lock() {
        cache.status = status.clone();
        cache.checked_at = Some(std::time::Instant::now());
        cache.api_base = api_base;
    }
    status
}

#[tauri::command]
async fn license_status(
    app: tauri::AppHandle,
    app_state: tauri::State<'_, AppState>,
    api_url: Option<String>,
    force: Option<bool>,
) -> AppResult<LicenseStatus> {
    // Tauri maps this idiomatic Rust `api_url` argument to the renderer's
    // `apiUrl` key. Defining both spellings creates two command arguments with
    // the same serialized name and makes the IPC request fail before Rust can
    // contact the subscription endpoint.
    let api_base = validate_api_base(api_url)?;
    Ok(refresh_entitlement(&app, &app_state, api_base, force.unwrap_or(false)).await)
}

/// Native enforcement boundary for every transcription engine. The renderer
/// cannot bypass this by invoking a command directly. Network failure and
/// unknown state both fail closed; a verified result is cached for at most 60s.
pub(crate) async fn require_pro_entitlement(
    app: &tauri::AppHandle,
    app_state: &AppState,
) -> AppResult<()> {
    let cached = app_state
        .entitlement
        .lock()
        .map_err(|_| AppError::new("entitlement", "Entitlement lock unavailable"))?
        .clone();
    let fresh = cached
        .checked_at
        .is_some_and(|checked| checked.elapsed() <= ENTITLEMENT_CACHE_TTL);
    let status = if fresh {
        cached.status
    } else {
        let api_base = if cached.api_base.is_empty() {
            default_api_base().to_string()
        } else {
            cached.api_base
        };
        refresh_entitlement(app, app_state, api_base, false).await
    };
    if status.valid {
        Ok(())
    } else {
        Err(AppError::new(
            "subscription-required",
            status
                .reason
                .unwrap_or_else(|| "An active Pro subscription is required".to_string()),
        ))
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
    if let Ok(meta) = std::fs::symlink_metadata(&path) {
        if meta.is_symlink() {
            eprintln!("algorith-voice: fallback path is a symlink — refusing to read");
            return None;
        }
    }
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
    if let Ok(meta) = std::fs::symlink_metadata(&path) {
        if meta.is_symlink() {
            return Err(AppError::session(
                "fallback path is a symlink — refusing to write",
            ));
        }
    }
    #[cfg(unix)]
    {
        use std::io::Write as _;
        use std::os::unix::fs::OpenOptionsExt as _;
        let mut file = std::fs::OpenOptions::new()
            .write(true)
            .create(true)
            .truncate(true)
            .mode(0o600)
            .open(&path)
            .map_err(|e| AppError::session(format!("fallback session write failed: {e}")))?;
        file.write_all(payload.to_string().as_bytes())
            .map_err(|e| AppError::session(format!("fallback session write failed: {e}")))?;
        let _ = file.sync_all();
    }
    #[cfg(not(unix))]
    {
        std::fs::write(&path, payload.to_string())
            .map_err(|e| AppError::session(format!("fallback session write failed: {e}")))?;
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
    read_session_payload(app).and_then(|value| {
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
                || msg.contains("No storage access")
                || msg.contains("service not available");
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
    if let Some(state) = app.try_state::<AppState>() {
        if let Ok(mut cached) = state.session_payload.lock() {
            *cached = Some(payload);
        }
        if let Ok(mut entitlement) = state.entitlement.lock() {
            *entitlement = state::EntitlementCache::default();
        }
    }
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

#[allow(non_snake_case)]
#[tauri::command]
async fn revoke_and_clear_session(app: tauri::AppHandle, apiBase: Option<String>) -> AppResult<()> {
    let payload = read_session_payload(&app);
    if let (Some(payload), Ok(api_base)) = (payload, validate_api_base(apiBase)) {
        if let Ok(client) = reqwest::Client::builder()
            .timeout(Duration::from_secs(5))
            .build()
        {
            let access = payload.get("access_token").and_then(|v| v.as_str());
            let refresh = payload.get("refresh_token").and_then(|v| v.as_str());
            if let Some(token) = access {
                let _ = client
                    .post(format!("{api_base}/oauth2/revoke"))
                    .form(&[("token", token), ("token_type_hint", "access_token")])
                    .send()
                    .await;
            }
            if let Some(token) = refresh {
                let _ = client
                    .post(format!("{api_base}/oauth2/revoke"))
                    .form(&[("token", token), ("token_type_hint", "refresh_token")])
                    .send()
                    .await;
                let _ = client
                    .post(format!("{api_base}/auth/logout"))
                    .json(&serde_json::json!({ "refresh_token": token }))
                    .send()
                    .await;
            }
        }
    }
    // Offline/network/provider failures never prevent local logout.
    clear_session(app)
}

#[tauri::command]
fn clear_session(app: tauri::AppHandle) -> AppResult<()> {
    let entry_res = keyring_entry();
    delete_fallback_payload(&app);
    match entry_res {
        Ok(entry) => match entry.delete_credential() {
            Ok(()) => {}
            Err(keyring::Error::NoEntry) => {}
            Err(e) if is_keyring_unavailable(&e) => {
                eprintln!("algorith-voice: keyring delete failed (backend unavailable, fallback already cleared): {}", keyring_guidance(&e));
            }
            Err(e) => return Err(AppError::session(keyring_guidance(&e))),
        },
        Err(e) => {
            // keyring::Entry::new can fail on Linux without DBUS — fallback
            // already cleared, treat as logged out rather than error.
            eprintln!("algorith-voice: keyring entry unavailable on clear: {}", e);
        }
    }
    logging::log_event(&app, "auth", "clear-session", "session cleared");
    if let Some(state) = app.try_state::<AppState>() {
        if let Ok(mut cached) = state.session_payload.lock() {
            *cached = None;
        }
        if let Ok(mut entitlement) = state.entitlement.lock() {
            *entitlement = state::EntitlementCache::default();
        }
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
    let show = MenuItem::with_id(app, "show", "Dashboard", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &quit])?;

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
            "quit" => {
                if let Some(state) = app.try_state::<AppState>() {
                    state.exiting.store(true, Ordering::SeqCst);
                }
                if let Some(tray) = app.tray_by_id("main") {
                    let _ = tray.set_visible(false);
                }
                app.exit(0);
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
    let Ok(url) = url::Url::parse(trimmed) else {
        return false;
    };
    if !DEEP_LINK_SCHEMES
        .iter()
        .any(|scheme| url.scheme().eq_ignore_ascii_case(scheme))
    {
        return false;
    }
    if url.port().is_some()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.fragment().is_some()
        || (url.path() != "" && url.path() != "/")
    {
        return false;
    }
    matches!(
        (url.scheme(), url.host_str()),
        ("com.algorithvoice.app", Some(host)) if host.eq_ignore_ascii_case("oauth-callback")
    ) || matches!(
        (url.scheme(), url.host_str()),
        ("algorithvoice", Some(host)) if host.eq_ignore_ascii_case("auth-callback")
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
    // App-wide emit: the flow may have started in any window (main or the
    // standalone settings webview), matching the single-instance branch.
    let _ = handle.emit("auth-callback", urls);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Single-instance MUST stay first so second launches forward to us
        // instead of racing other plugins during startup.
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            focus_main_for_external_event(app);
            handle_argv_deep_links(app, &argv);
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
                    logging::log_event(
                        app.handle(),
                        "db",
                        "init-failed-fatal",
                        &format!("sqlite init failed: {e} — history and usage will be unavailable"),
                    );
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
                // App-wide emit: the OAuth flow may have started in any
                // window (main or standalone settings), not just "main".
                let _ = handle.emit("auth-callback", urls);
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
            revoke_and_clear_session,
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
            push_to_talk::set_floating_pill_expanded,
            history::history_save,
            history::history_list,
            history::history_stats,
            history::history_delete,
            history::history_clear,
            // Local-AI usage ledger (pure-local; numbers only, zero network).
            local_usage::local_usage_summary,
            local_usage::local_usage_clear,
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

#[cfg(test)]
mod oauth_deep_link_tests {
    use super::{is_deep_link, validate_api_base};

    #[test]
    fn accepts_only_exact_oauth_callback_routes() {
        assert!(is_deep_link(
            "com.algorithvoice.app://oauth-callback?code=abc&state=xyz"
        ));
        assert!(is_deep_link(
            "algorithvoice://auth-callback?code=abc&state=xyz"
        ));
        assert!(!is_deep_link(
            "com.algorithvoice.app://oauth-callback/evil?code=abc"
        ));
        assert!(!is_deep_link(
            "com.algorithvoice.app://user:pass@oauth-callback?code=abc"
        ));
        assert!(!is_deep_link(
            "com.algorithvoice.app://oauth-callback#code=abc"
        ));
        assert!(!is_deep_link("https://api.trqsh.uz/oauth-callback"));
    }

    #[test]
    fn entitlement_api_rejects_untrusted_origins() {
        assert_eq!(
            validate_api_base(Some("https://api.trqsh.uz/".to_string())).unwrap(),
            "https://api.trqsh.uz"
        );
        assert!(validate_api_base(Some("https://evil.example".to_string())).is_err());
        assert!(validate_api_base(Some("http://localhost:3001".to_string())).is_err());
        assert!(validate_api_base(Some("file:///tmp/fake-api".to_string())).is_err());
    }
}
