#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

/// Forward a `--user-data-dir=<dir>` CLI arg to the WebView2 data-folder
/// override before anything initializes a WebView.
///
/// Why: WebDriver (msedgedriver) launches the app binary with its own
/// `--user-data-dir=<scoped-temp>` and then polls THAT folder for the
/// `DevToolsActivePort` file. Tauri does not forward unknown CLI args to
/// WebView2, so the app would write the port file into its own app-data dir
/// and the driver would wait forever (`DevToolsActivePort file doesn't
/// exist` / `chrome not reachable`). Bridging the flag via
/// `WEBVIEW2_USER_DATA_FOLDER` — honored by wry at environment creation,
/// before any WebView exists — aligns both sides.
///
/// Only active when the flag is present, which happens solely under test
/// automation; real launches are unaffected.
#[cfg(target_os = "windows")]
fn forward_webdriver_user_data_dir() {
    let mut args = std::env::args().skip(1);
    while let Some(arg) = args.next() {
        if let Some(dir) = arg.strip_prefix("--user-data-dir=") {
            if !dir.trim().is_empty() {
                std::env::set_var("WEBVIEW2_USER_DATA_FOLDER", dir);
            }
            return;
        }
        if arg == "--user-data-dir" {
            if let Some(dir) = args.next() {
                if !dir.trim().is_empty() {
                    std::env::set_var("WEBVIEW2_USER_DATA_FOLDER", dir);
                }
            }
            return;
        }
    }
}

fn main() {
    #[cfg(target_os = "windows")]
    forward_webdriver_user_data_dir();
    algorith_voice_desktop_lib::run()
}
