use tauri::{
    image::Image,
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager,
};
use tauri_plugin_deep_link::DeepLinkExt;

const SERVICE: &str = "com.algorithvoice.app";
const ACCOUNT: &str = "algorith-voice-session";

#[tauri::command]
fn get_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

#[tauri::command]
fn license_status() -> serde_json::Value {
    // Phase 1 stub — Phase 3 binds real license JWT + offline grace.
    serde_json::json!({ "valid": false, "next": "phase-3" })
}

#[tauri::command]
fn set_tray_state(app: tauri::AppHandle, state: String) -> Result<(), String> {
    let bytes: &[u8] = match state.as_str() {
        "recording" => include_bytes!("../icons/tray-recording.png"),
        "processing" => include_bytes!("../icons/tray-processing.png"),
        _ => include_bytes!("../icons/tray-idle.png"),
    };
    let tray = app.tray_by_id("main").ok_or("tray not found")?;
    tray.set_icon(Some(Image::from_bytes(bytes).map_err(|e| e.to_string())?))
        .map_err(|e| e.to_string())?;
    tray.set_tooltip(Some(match state.as_str() {
        "recording" => "Algorith Voice — recording",
        "processing" => "Algorith Voice — processing",
        _ => "Algorith Voice",
    }))
    .map_err(|e| e.to_string())
}

#[tauri::command]
fn open_settings(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(win) = app.get_webview_window("settings") {
        win.set_focus().map_err(|e| e.to_string())?;
        return Ok(());
    }
    // Same bundle as main; frontend renders the settings view when label == "settings".
    tauri::WebviewWindowBuilder::new(
        &app,
        "settings",
        tauri::WebviewUrl::App("index.html".into()),
    )
    .title("Algorith Voice — Settings")
    .inner_size(440.0, 600.0)
    .build()
    .map_err(|e| e.to_string())?;
    Ok(())
}

// ---- Device session (refresh/access token lives in OS keyring, never on disk) ----

#[tauri::command]
fn store_session(access_token: String, email: String) -> Result<(), String> {
    let entry = keyring::Entry::new(SERVICE, ACCOUNT).map_err(|e| e.to_string())?;
    let payload = serde_json::json!({ "access_token": access_token, "email": email });
    entry
        .set_password(&payload.to_string())
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn session_status() -> serde_json::Value {
    let logged_in = keyring::Entry::new(SERVICE, ACCOUNT)
        .ok()
        .and_then(|e| e.get_password().ok())
        .and_then(|raw| serde_json::from_str::<serde_json::Value>(&raw).ok());
    match logged_in {
        Some(v) => serde_json::json!({ "loggedIn": true, "email": v.get("email") }),
        None => serde_json::json!({ "loggedIn": false }),
    }
}

#[tauri::command]
fn clear_session() -> Result<(), String> {
    let entry = keyring::Entry::new(SERVICE, ACCOUNT).map_err(|e| e.to_string())?;
    // Missing entry == already logged out; don't error.
    match entry.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

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
                if let Some(win) = app.get_webview_window("main") {
                    let _ = win.show().and_then(|_| win.set_focus());
                }
            }
            "settings" => {
                let _ = open_settings(app.clone());
            }
            "quit" => app.exit(0),
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
                            let _ = win.show().and_then(|_| win.set_focus());
                        }
                    });
                }
            }
        })
        .build(app)?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|_app, _args, _cwd| {}))
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
                .with_handler(|_app, _shortcut, event| {
                    // Phase 2: Pressed -> start_ptt, Released -> stop_ptt.
                    let _ = event.state();
                })
                .build(),
        )
        .setup(|app| {
            build_tray(app.handle())?;
            // OAuth deep-link: forward to the main window; Phase 3 completes the exchange.
            let handle = app.handle().clone();
            app.deep_link().on_open_url(move |event| {
                let urls = event.urls();
                if let Some(win) = handle.get_webview_window("main") {
                    let _ = win.emit("auth-callback", urls);
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_version,
            license_status,
            set_tray_state,
            open_settings,
            store_session,
            session_status,
            clear_session
        ])
        .run(tauri::generate_context!())
        .expect("error while running Algorith Voice");
}
