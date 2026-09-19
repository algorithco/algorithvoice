//! Main-thread window creation.
//!
//! WebView2 controller initialization must happen on the UI thread: building
//! a [`tauri::WebviewWindow`] from a command worker thread deadlocks — the
//! native window appears but its webview never navigates (stuck at
//! `about:blank`, white screen) and the creating invoke never resolves,
//! which wedges every later invoke behind it. Bouncing creation to the main
//! thread via [`tauri::AppHandle::run_on_main_thread`] fixes it. Callers
//! must be `async` (a blocking `recv` here is only safe off the UI thread).
//!
//! Regression cover: `apps/desktop/e2e/tauri.e2e.js` (pill geometry test
//! fails without this — the pill invoke hangs and the window stays blank).

use crate::error::{AppError, AppResult};

/// Build a webview window on the main thread and await the result.
///
/// `build` receives an owned [`tauri::AppHandle`] so the whole construction
/// (including `WebviewWindowBuilder::new`) happens on the UI thread; only
/// `'static` captures cross the thread boundary.
pub(crate) async fn build_on_main_thread(
    app: &tauri::AppHandle,
    build: impl FnOnce(tauri::AppHandle) -> tauri::Result<tauri::WebviewWindow> + Send + 'static,
) -> AppResult<tauri::WebviewWindow> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    let handle = app.clone();
    app.run_on_main_thread(move || {
        let _ = tx.send(build(handle));
    })
    .map_err(|e| AppError::window(e.to_string()))?;
    rx.await
        .map_err(|e| AppError::window(format!("main-thread window build failed: {e}")))?
        .map_err(|e| AppError::window(e.to_string()))
}
