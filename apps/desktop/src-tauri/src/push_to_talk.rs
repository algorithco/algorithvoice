//! Push-to-talk floating button backend (additive module).
//!
//! Existing windows, commands and state in `lib.rs` / `state.rs` are
//! untouched — this file only *adds* new commands which `lib.rs` wires
//! into `invoke_handler`. Frontend drives the flow:
//!
//! 1. `ensure_floating_pill` creates the 72x72 frameless always-on-top
//!    window (`focus: false` so the previously active app keeps focus).
//! 2. Frontend records with `MediaRecorder` (Variant A — no native audio
//!    dep needed) and sends base64 audio to `transcribe_audio`.
//! 3. `paste_text` (or the `transcribe_and_paste` convenience combo)
//!    injects the transcript into the previously focused app via
//!    clipboard + Ctrl/Cmd+V (`arboard` + `enigo`).
//!
//! Groq key resolution order (never hardcoded):
//! explicit arg → `GROQ_API_KEY` env → OS keyring (`set_groq_api_key`).

use crate::error::{AppError, AppResult};
use serde::Serialize;
use tauri::{AppHandle, Manager, WebviewUrl};

const FLOATING_LABEL: &str = "floating-pill";
const SERVICE: &str = "com.algorithvoice.app";
const GROQ_ACCOUNT: &str = "groq-api-key";
const GROQ_ENDPOINT: &str = "https://api.groq.com/openai/v1/audio/transcriptions";
const GROQ_MODEL: &str = "whisper-large-v3-turbo";
/// Groq `multipart/form-data` upload cap.
const MAX_AUDIO_BYTES: usize = 25 * 1024 * 1024;

#[derive(Debug, Clone, Serialize)]
pub struct TranscribeResult {
    pub text: String,
    /// Whether the transcript was injected into the focused app.
    /// `transcribe_audio` never pastes (`false`); `transcribe_and_paste`
    /// reports `false` when injection failed so the frontend can fall
    /// back to clipboard + manual paste instead of losing the text.
    #[serde(default)]
    pub pasted: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct ForegroundInfo {
    pub platform: &'static str,
    pub wayland: bool,
    pub focus_steal_free: bool,
    pub supported: bool,
    pub note: String,
}

// ---- Groq API key (OS keyring, same pattern as device session) ----

fn groq_entry() -> AppResult<keyring::Entry> {
    keyring::Entry::new(SERVICE, GROQ_ACCOUNT).map_err(|e| AppError::store(e.to_string()))
}

fn resolve_groq_key(explicit: Option<String>) -> AppResult<String> {
    if let Some(key) = explicit {
        let key = key.trim().to_owned();
        if !key.is_empty() {
            return Ok(key);
        }
    }
    if let Ok(key) = std::env::var("GROQ_API_KEY") {
        let key = key.trim().to_owned();
        if !key.is_empty() {
            return Ok(key);
        }
    }
    groq_entry()
        .and_then(|entry| {
            entry
                .get_password()
                .map_err(|e| AppError::store(e.to_string()))
        })
        .and_then(|key| {
            let key = key.trim().to_owned();
            if key.is_empty() {
                Err(AppError::store("Groq API key is empty"))
            } else {
                Ok(key)
            }
        })
        .map_err(|_| {
            AppError::new(
                "transcribe",
                "missing Groq API key — run `set_groq_api_key` or set GROQ_API_KEY",
            )
        })
}

#[tauri::command]
pub fn set_groq_api_key(api_key: String) -> AppResult<()> {
    let key = api_key.trim().to_owned();
    if key.is_empty() {
        return Err(AppError::new(
            "transcribe",
            "Groq API key must not be empty",
        ));
    }
    if key.len() > 4096 {
        return Err(AppError::new("transcribe", "Groq API key too long"));
    }
    groq_entry()?
        .set_password(&key)
        .map_err(|e| AppError::store(e.to_string()))?;
    Ok(())
}

#[tauri::command]
pub fn has_groq_key() -> bool {
    if let Ok(key) = std::env::var("GROQ_API_KEY") {
        if !key.trim().is_empty() {
            return true;
        }
    }
    groq_entry()
        .ok()
        .and_then(|entry| entry.get_password().ok())
        .is_some_and(|key| !key.trim().is_empty())
}

#[tauri::command]
pub fn clear_groq_key() -> AppResult<()> {
    let entry = groq_entry()?;
    match entry.delete_credential() {
        Ok(()) => {}
        Err(keyring::Error::NoEntry) => {}
        Err(e) => return Err(AppError::store(e.to_string())),
    }
    Ok(())
}

// ---- Audio → Groq Whisper (Rust backend, multipart) ----

fn decode_audio_payload(audio_base64: &str) -> AppResult<Vec<u8>> {
    let trimmed = audio_base64.trim();
    if trimmed.is_empty() {
        return Err(AppError::new("transcribe", "empty audio payload"));
    }
    // Accept raw base64 as well as `data:audio/webm;base64,...` URLs.
    let b64 = if trimmed.starts_with("data:") {
        match trimmed.split_once(',') {
            Some((_, payload)) => payload.trim(),
            None => return Err(AppError::new("transcribe", "malformed data URL")),
        }
    } else {
        trimmed
    };
    use base64::Engine as _;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(b64)
        .map_err(|e| AppError::new("transcribe", format!("invalid base64 audio: {e}")))?;
    if bytes.is_empty() {
        return Err(AppError::new("transcribe", "decoded audio is empty"));
    }
    if bytes.len() > MAX_AUDIO_BYTES {
        return Err(AppError::new(
            "transcribe",
            "audio too large (Groq limit is 25 MB)",
        ));
    }
    Ok(bytes)
}

async fn transcribe_bytes(
    audio: Vec<u8>,
    language: Option<String>,
    mime_type: Option<String>,
    api_key: String,
) -> AppResult<String> {
    let (mime, filename) = audio_mime_and_filename(mime_type.as_deref());
    let file_part = reqwest::multipart::Part::bytes(audio)
        .file_name(filename)
        .mime_str(mime)
        .map_err(|e| AppError::new("transcribe", format!("bad audio mime: {e}")))?;
    let mut form = reqwest::multipart::Form::new()
        .text("model", GROQ_MODEL)
        .text("response_format", "json")
        .part("file", file_part);
    if let Some(lang) = language {
        let lang = lang.trim().to_owned();
        if !lang.is_empty() && lang.len() <= 16 {
            form = form.text("language", lang);
        }
    }

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(60))
        .build()
        .map_err(|e| AppError::new("transcribe", format!("http client: {e}")))?;
    let res = client
        .post(GROQ_ENDPOINT)
        .bearer_auth(api_key)
        .multipart(form)
        .send()
        .await
        .map_err(|e| AppError::new("transcribe", format!("Groq request failed: {e}")))?;
    let status = res.status();
    let body = res
        .text()
        .await
        .map_err(|e| AppError::new("transcribe", format!("read Groq response: {e}")))?;
    if !status.is_success() {
        // Truncate provider body so secrets / huge HTML pages never flood logs.
        let snippet: String = body.chars().take(300).collect();
        return Err(AppError::new(
            "transcribe",
            format!("Groq {status}: {snippet}"),
        ));
    }
    let value: serde_json::Value = serde_json::from_str(&body)
        .map_err(|e| AppError::new("transcribe", format!("parse Groq response: {e}")))?;
    value
        .get("text")
        .and_then(|t| t.as_str())
        .map(|t| t.trim().to_owned())
        .filter(|t| !t.is_empty())
        .ok_or_else(|| AppError::new("transcribe", "Groq response had no text"))
}

/// Map a `MediaRecorder` mime string to the `(mime, filename)` pair Groq
/// expects. Groq validates the format against the filename extension, so
/// the probed frontend mime must be forwarded — never hardcoded. Unknown
/// or missing mimes fall back to WebM/Opus (the most common encoder).
fn audio_mime_and_filename(mime_type: Option<&str>) -> (&'static str, &'static str) {
    let mime = mime_type.unwrap_or("").trim().to_ascii_lowercase();
    if mime.contains("mp4") || mime.contains("m4a") || mime.contains("aac") {
        ("audio/mp4", "audio.m4a")
    } else if mime.contains("ogg") || mime.contains("opus") && mime.contains("ogg") {
        ("audio/ogg", "audio.ogg")
    } else if mime.contains("wav") || mime.contains("wave") {
        ("audio/wav", "audio.wav")
    } else if mime.contains("flac") {
        ("audio/flac", "audio.flac")
    } else if mime.contains("mpeg") || mime.contains("mp3") {
        ("audio/mpeg", "audio.mp3")
    } else {
        ("audio/webm", "audio.webm")
    }
}

/// Transcribe base64 (or data-URL) audio via Groq Whisper.
///
/// `language` is optional (`"uz"`, `"en"` …). `mime_type` should be the
/// probed `MediaRecorder.mimeType` so the multipart filename matches the
/// actual bytes. Key resolution:
/// explicit `api_key` → `GROQ_API_KEY` env → OS keyring.
#[tauri::command]
pub async fn transcribe_audio(
    audio_base64: String,
    language: Option<String>,
    api_key: Option<String>,
    mime_type: Option<String>,
) -> AppResult<TranscribeResult> {
    let key = resolve_groq_key(api_key)?;
    let audio = decode_audio_payload(&audio_base64)?;
    let text = transcribe_bytes(audio, language, mime_type, key).await?;
    Ok(TranscribeResult {
        text,
        pasted: false,
    })
}

// ---- Transcript → focused app (clipboard + paste keystroke) ----

/// Copy `text` to the clipboard and synthesize the OS paste shortcut
/// (Ctrl+V on Windows/Linux, Cmd+V on macOS).
///
/// When `restore_clipboard` is true (default), the previous clipboard
/// text — if any — is restored ~350 ms after pasting so the user's
/// earlier copy is not lost. The delay is generous on purpose: target
/// apps consume the paste asynchronously on their own message pump, and
/// restoring too early pastes stale text (notably in Office/Electron
/// apps and over RDP). Restore also runs when the keystroke itself
/// fails, so the original clipboard is never left clobbered.
#[tauri::command]
pub fn paste_text(text: String, restore_clipboard: Option<bool>) -> AppResult<()> {
    paste_text_blocking(text, restore_clipboard)
}

fn paste_text_blocking(text: String, restore_clipboard: Option<bool>) -> AppResult<()> {
    let text = text.trim().to_owned();
    if text.is_empty() {
        return Err(AppError::new("paste", "nothing to paste"));
    }
    if text.len() > 32_768 {
        return Err(AppError::new("paste", "text too long to paste"));
    }
    let restore = restore_clipboard.unwrap_or(true);

    let mut clipboard =
        arboard::Clipboard::new().map_err(|e| AppError::new("paste", format!("clipboard: {e}")))?;
    let previous = clipboard.get_text().ok();
    clipboard
        .set_text(text)
        .map_err(|e| AppError::new("paste", format!("clipboard write: {e}")))?;
    // Give the OS a tick to publish the new clipboard owner before the
    // synthetic keystroke lands.
    std::thread::sleep(std::time::Duration::from_millis(120));

    let keystroke = paste_keystroke();
    // Wait for the focused app to consume the paste before restoring.
    std::thread::sleep(std::time::Duration::from_millis(350));

    if restore {
        if let Some(old) = previous {
            // Best effort: restoring must never turn a successful paste
            // into an error.
            let _ = clipboard.set_text(old);
        }
    }
    // Report the keystroke error *after* restoring, so a failed paste
    // never costs the user their original clipboard.
    keystroke?;
    Ok(())
}

fn paste_keystroke() -> AppResult<()> {
    use enigo::{Direction, Enigo, Key, Keyboard, Settings};
    let mut enigo = Enigo::new(&Settings::default())
        .map_err(|e| AppError::new("paste", format!("enigo: {e}")))?;
    #[cfg(target_os = "macos")]
    let modifier = Key::Meta;
    #[cfg(not(target_os = "macos"))]
    let modifier = Key::Control;
    enigo
        .key(modifier, Direction::Press)
        .map_err(|e| AppError::new("paste", format!("paste key press: {e}")))?;
    enigo
        .key(Key::Unicode('v'), Direction::Click)
        .map_err(|e| AppError::new("paste", format!("paste key click: {e}")))?;
    enigo
        .key(modifier, Direction::Release)
        .map_err(|e| AppError::new("paste", format!("paste key release: {e}")))?;
    Ok(())
}

/// Transcribe, then immediately paste into the currently focused app.
///
/// Single round-trip so focus cannot drift between two `invoke` calls.
/// The blocking clipboard/paste section runs on a `spawn_blocking`
/// worker so the Tauri async runtime is never stalled.
/// Returns the transcript for preview / history.
#[tauri::command]
pub async fn transcribe_and_paste(
    audio_base64: String,
    language: Option<String>,
    api_key: Option<String>,
    mime_type: Option<String>,
    restore_clipboard: Option<bool>,
) -> AppResult<TranscribeResult> {
    let result = transcribe_audio(audio_base64, language, api_key, mime_type).await?;
    let text = result.text.clone();
    let paste_outcome =
        tokio::task::spawn_blocking(move || paste_text_blocking(text, restore_clipboard))
            .await
            .map_err(|e| AppError::new("paste", format!("paste worker: {e}")))?;
    match paste_outcome {
        Ok(()) => Ok(TranscribeResult {
            text: result.text,
            pasted: true,
        }),
        Err(e) => {
            // Transcription (the billable part) succeeded — never lose it.
            // Report `pasted: false` so the frontend falls back to
            // clipboard + manual paste (Wayland / macOS permission cases).
            eprintln!("algorith-voice: auto-paste failed: {e}");
            Ok(TranscribeResult {
                text: result.text,
                pasted: false,
            })
        }
    }
}

// ---- Foreground-window honesty probe (no focus stealing) ----

/// Report whether reliable "previous window" tracking is available.
///
/// The pill uses `focused: false` + `focusable: false`, so the target app
/// normally *never loses focus* and no restore dance is needed. Wayland
/// cannot reliably query the active window — this reports that honestly
/// instead of returning a fake handle.
#[tauri::command]
pub fn get_foreground_info() -> AppResult<ForegroundInfo> {
    let platform: &'static str = std::env::consts::OS;
    let wayland = std::env::var("WAYLAND_DISPLAY").is_ok()
        || std::env::var("XDG_SESSION_TYPE").is_ok_and(|v| v == "wayland");
    let (supported, note) = if wayland {
        (
            false,
            "Wayland detected: active-window lookup is compositor-restricted. \
             The pill keeps focus (focused:false), so dictation still pastes \
             into the app that was focused before pressing."
                .to_owned(),
        )
    } else if platform == "windows" || platform == "macos" {
        (
            true,
            "Pill keeps focus (focused:false), so the previously active app \
             stays foreground — no explicit restore needed."
                .to_owned(),
        )
    } else {
        (
            true,
            "X11: active window can be queried via the window manager; pill \
             keeps focus so paste targets the previously focused app."
                .to_owned(),
        )
    };
    Ok(ForegroundInfo {
        platform,
        wayland,
        focus_steal_free: true,
        supported,
        note,
    })
}

// ---- Floating pill window (dynamic second window) ----

/// Create (or reveal) the frameless always-on-top pill.
///
/// Properties per spec: decorations=false, transparent, always_on_top,
/// skip_taskbar, non-resizable 72x72, `focused(false)` + `focusable(false)`
/// so it never steals focus, `visible_on_all_workspaces` where supported.
#[tauri::command]
pub fn ensure_floating_pill(app: AppHandle) -> AppResult<()> {
    if let Some(win) = app.get_webview_window(FLOATING_LABEL) {
        let _ = win.unminimize();
        win.show().map_err(|e| AppError::window(e.to_string()))?;
        return Ok(());
    }
    let win = tauri::WebviewWindowBuilder::new(
        &app,
        FLOATING_LABEL,
        WebviewUrl::App("index.html".into()),
    )
    .title("Algorith Voice — Talk")
    .inner_size(72.0, 72.0)
    .min_inner_size(60.0, 60.0)
    .max_inner_size(160.0, 160.0)
    .resizable(false)
    .decorations(false)
    .transparent(true)
    .shadow(false)
    .always_on_top(true)
    .visible_on_all_workspaces(true)
    .skip_taskbar(true)
    .focused(false)
    .focusable(false)
    .build()
    .map_err(|e| AppError::window(e.to_string()))?;
    let _ = win.show();
    Ok(())
}

#[tauri::command]
pub fn set_floating_pill_visible(app: AppHandle, visible: bool) -> AppResult<()> {
    let Some(win) = app.get_webview_window(FLOATING_LABEL) else {
        if visible {
            return ensure_floating_pill(app);
        }
        return Ok(());
    };
    if visible {
        let _ = win.unminimize();
        win.show().map_err(|e| AppError::window(e.to_string()))?;
    } else {
        win.hide().map_err(|e| AppError::window(e.to_string()))?;
    }
    Ok(())
}

#[tauri::command]
pub fn floating_pill_visible(app: AppHandle) -> bool {
    app.get_webview_window(FLOATING_LABEL)
        .and_then(|win| win.is_visible().ok())
        .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strips_data_url_prefix() {
        let raw = base64::engine::general_purpose::STANDARD.encode(b"hello");
        let url = format!("data:audio/webm;codecs=opus;base64,{raw}");
        assert_eq!(decode_audio_payload(&url).unwrap(), b"hello");
        assert_eq!(decode_audio_payload(&raw).unwrap(), b"hello");
    }

    #[test]
    fn rejects_empty_and_oversize_markers() {
        assert!(decode_audio_payload("").is_err());
        assert!(decode_audio_payload("data:audio/webm;base64,").is_err());
        assert!(decode_audio_payload("!!!not-base64!!!").is_err());
    }

    #[test]
    fn explicit_key_wins_over_env_and_keyring() {
        let key = resolve_groq_key(Some("  sk-test  ".to_owned()));
        assert_eq!(key.unwrap(), "sk-test");
    }

    #[test]
    fn mime_maps_to_matching_groq_filename() {
        assert_eq!(
            audio_mime_and_filename(Some("audio/webm;codecs=opus")),
            ("audio/webm", "audio.webm")
        );
        assert_eq!(
            audio_mime_and_filename(Some("audio/mp4")),
            ("audio/mp4", "audio.m4a")
        );
        assert_eq!(
            audio_mime_and_filename(Some("audio/ogg;codecs=opus")),
            ("audio/ogg", "audio.ogg")
        );
        // Unknown / missing mimes fall back to WebM, never fail.
        assert_eq!(
            audio_mime_and_filename(Some("application/octet-stream")),
            ("audio/webm", "audio.webm")
        );
        assert_eq!(audio_mime_and_filename(None), ("audio/webm", "audio.webm"));
    }
}
