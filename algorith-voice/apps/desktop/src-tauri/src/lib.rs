use tauri::Manager;

#[tauri::command]
fn get_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

#[tauri::command]
fn license_status() -> serde_json::Value {
    // Phase 1 stub — Phase 3 binds real license JWT + offline grace.
    serde_json::json!({ "valid": false, "next": "phase-3" })
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
        .invoke_handler(tauri::generate_handler![get_version, license_status])
        .run(tauri::generate_context!())
        .expect("error while running Algorith Voice");
}
