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
use crate::local_asr::worker::TranscriptionWorker;
use serde::Serialize;
use std::sync::Arc;
use tauri::{AppHandle, Manager, State, WebviewUrl};

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
    } else if mime.contains("ogg") {
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
/// Engine routing for transcription commands.
///
/// - `None` (default), `"cloud"` and `"byok"` use Groq with the user's own
///   key (the desktop key has always been user-supplied, so `byok` needs
///   no separate path).
/// - `"local"` uses the on-device worker (never touches the network).
/// - Anything else is a caller-version-skew bug and fails loudly.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum TranscribePath {
    Local,
    Cloud,
}

fn resolve_transcribe_path(mode: Option<&str>) -> Result<TranscribePath, AppError> {
    match mode {
        None | Some("cloud") | Some("byok") => Ok(TranscribePath::Cloud),
        Some("local") => Ok(TranscribePath::Local),
        Some(other) => Err(AppError::internal(format!(
            "unknown transcription mode: {other}"
        ))),
    }
}

/// Local transcription path: base64 WAV bytes → normalized samples → worker
/// (lazy model switch) → transcript. Never touches the network and never
/// falls back to cloud — failures surface as typed errors for the caller
/// to route (the pill shows them, history stays untouched).
pub(crate) async fn transcribe_local(
    worker: &Arc<TranscriptionWorker>,
    app_data: &std::path::Path,
    model: &crate::local_asr::manifest::LocalModel,
    audio_base64: &str,
    language: Option<&str>,
) -> AppResult<TranscribeResult> {
    let audio = decode_audio_payload(audio_base64)?;
    let decoded = crate::local_asr::audio::decode_wav(&audio)?;
    if decoded.samples.is_empty() {
        return Err(AppError::audio_unsupported_format(
            "audio contains no samples",
        ));
    }
    // Lazy model switch: load only when the worker doesn't already hold
    // this exact model ready. Loading blocks for seconds (hundreds of MB
    // of weights), so it runs on a blocking thread, never the executor.
    if !worker.is_ready_for(&model.id) {
        let dir = crate::local_asr::models::model_dir(app_data, &model.id)?;
        let w = Arc::clone(worker);
        let m = model.clone();
        tokio::task::spawn_blocking(move || w.load(&m, &dir, |_| {}))
            .await
            .map_err(|e| AppError::engine_init_failed(format!("local load task failed: {e}")))??;
    }
    let transcript = worker
        .transcribe(&decoded.samples, language.unwrap_or("auto"))
        .await?;
    Ok(TranscribeResult {
        text: transcript.text,
        pasted: false,
    })
}

/// `language` is optional (`"uz"`, `"en"` …). `mime_type` should be the
/// probed `MediaRecorder.mimeType` so the multipart filename matches the
/// actual bytes. Key resolution:
/// explicit `api_key` → `GROQ_API_KEY` env → OS keyring (`set_groq_api_key`).
///
/// `mode` selects the engine (see [`resolve_transcribe_path`]); `model_id`
/// picks the local model and is required when mode is local.
#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn transcribe_audio(
    audio_base64: String,
    language: Option<String>,
    api_key: Option<String>,
    mime_type: Option<String>,
    mode: Option<String>,
    model_id: Option<String>,
    app: AppHandle,
    worker: State<'_, Arc<TranscriptionWorker>>,
) -> AppResult<TranscribeResult> {
    match resolve_transcribe_path(mode.as_deref())? {
        TranscribePath::Cloud => {
            let key = resolve_groq_key(api_key)?;
            let audio = decode_audio_payload(&audio_base64)?;
            let text = transcribe_bytes(audio, language, mime_type, key).await?;
            Ok(TranscribeResult {
                text,
                pasted: false,
            })
        }
        TranscribePath::Local => {
            let mid = model_id
                .as_deref()
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .ok_or_else(|| {
                    AppError::model_not_loaded(
                        "no local model selected; download and select one in Settings",
                    )
                })?;
            let manifest = crate::local_asr::manifest::default_manifest()?;
            crate::local_asr::manifest::validate_manifest(&manifest)?;
            let model = crate::local_asr::commands::find_model(&manifest, mid)?;
            let data = app.path().app_data_dir().map_err(|e| {
                AppError::model_not_loaded(format!("cannot resolve app data dir: {e}"))
            })?;
            transcribe_local(&worker, &data, &model, &audio_base64, language.as_deref()).await
        }
    }
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
#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn transcribe_and_paste(
    audio_base64: String,
    language: Option<String>,
    api_key: Option<String>,
    mime_type: Option<String>,
    restore_clipboard: Option<bool>,
    mode: Option<String>,
    model_id: Option<String>,
    app: AppHandle,
    worker: State<'_, Arc<TranscriptionWorker>>,
) -> AppResult<TranscribeResult> {
    let result = transcribe_audio(
        audio_base64,
        language,
        api_key,
        mime_type,
        mode,
        model_id,
        app,
        worker,
    )
    .await?;
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
///
/// NOTE: `.transparent()` on macOS requires the `macos-private-api`
/// Cargo feature on `tauri` (see Cargo.toml) — without it the method
/// does not exist on that target and the release build fails (E0599).
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
    use base64::Engine as _;

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

    #[test]
    fn routing_selects_engine_by_mode() {
        use TranscribePath::*;
        assert_eq!(resolve_transcribe_path(None).unwrap(), Cloud);
        assert_eq!(resolve_transcribe_path(Some("cloud")).unwrap(), Cloud);
        // BYOK rides the user-keyed Groq path; no separate engine.
        assert_eq!(resolve_transcribe_path(Some("byok")).unwrap(), Cloud);
        assert_eq!(resolve_transcribe_path(Some("local")).unwrap(), Local);
        let err = resolve_transcribe_path(Some("quantum")).unwrap_err();
        assert_eq!(err.code, "internal");
    }

    // ---- Local-path tests (stub engine, real audio pipeline) ----

    use crate::local_asr::manifest::{LocalModel, ModelEngine};
    use crate::local_asr::worker::{LocalTranscriber, Transcript, TranscriptionWorker};

    fn fixture_model() -> LocalModel {
        LocalModel {
            id: "test-model".to_string(),
            name: "Test Model".to_string(),
            version: "1.0.0".to_string(),
            engine: ModelEngine::SherpaOnnx,
            quantization: "int8".to_string(),
            files: Vec::new(),
            languages: vec!["en".to_string()],
            min_ram_gb: 0.0,
            recommended_ram_gb: 0.0,
            min_vram_gb: 0.0,
            recommended_vram_gb: 0.0,
            license: "test".to_string(),
            attribution: "test".to_string(),
            supported_os: Vec::new(),
            supported_arch: Vec::new(),
        }
    }

    fn fixture_dir(name: &str) -> std::path::PathBuf {
        static COUNTER: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
        let n = COUNTER.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        std::env::temp_dir().join(format!(
            "algorith-voice-ptttest-{}-{}-{}",
            std::process::id(),
            n,
            name
        ))
    }

    /// Minimal PCM-16 mono 16 kHz WAV: 44-byte header + raw samples.
    fn wav_base64(samples: &[i16]) -> String {
        let mut wav = Vec::new();
        wav.extend_from_slice(b"RIFF");
        wav.extend_from_slice(&((36 + samples.len() * 2) as u32).to_le_bytes());
        wav.extend_from_slice(b"WAVEfmt ");
        wav.extend_from_slice(&16u32.to_le_bytes());
        wav.extend_from_slice(&1u16.to_le_bytes());
        wav.extend_from_slice(&1u16.to_le_bytes());
        wav.extend_from_slice(&16000u32.to_le_bytes());
        wav.extend_from_slice(&32000u32.to_le_bytes());
        wav.extend_from_slice(&2u16.to_le_bytes());
        wav.extend_from_slice(&16u16.to_le_bytes());
        wav.extend_from_slice(b"data");
        wav.extend_from_slice(&(samples.len() as u32 * 2).to_le_bytes());
        for s in samples {
            wav.extend_from_slice(&s.to_le_bytes());
        }
        base64::engine::general_purpose::STANDARD.encode(wav)
    }

    struct StubTranscriber {
        text: Option<String>,
    }

    impl LocalTranscriber for StubTranscriber {
        fn model_id(&self) -> &str {
            "test-model"
        }

        fn transcribe(&self, _samples: &[f32], _language: &str) -> Result<Transcript, AppError> {
            match &self.text {
                Some(text) => Ok(Transcript {
                    text: text.clone(),
                    segments: Vec::new(),
                    language: None,
                }),
                None => Err(AppError::engine_init_failed("stub boom")),
            }
        }
    }

    fn load_stub(worker: &TranscriptionWorker, text: Option<&str>) -> LocalModel {
        // The stub loader ignores model and dir entirely; no filesystem
        // state is needed, so nothing is created (and nothing leaks).
        let model = fixture_model();
        let dir = fixture_dir("load");
        let text = text.map(str::to_owned);
        worker
            .load_with(
                &model,
                &dir,
                |_| {},
                |_, _| {
                    Ok(Box::new(StubTranscriber { text: text.clone() })
                        as Box<dyn LocalTranscriber>)
                },
            )
            .unwrap();
        model
    }

    #[tokio::test]
    async fn local_path_returns_transcript_without_paste() {
        let worker = TranscriptionWorker::new();
        let model = load_stub(&worker, Some("hello local"));
        let worker = Arc::new(worker);
        let dir = fixture_dir("x");
        let audio = wav_base64(&[1000i16; 1600]);
        let result = transcribe_local(&worker, &dir, &model, &audio, Some("en"))
            .await
            .unwrap();
        assert_eq!(result.text, "hello local");
        assert!(!result.pasted);
    }

    #[tokio::test]
    async fn local_path_rejects_garbage_audio() {
        let worker = TranscriptionWorker::new();
        let model = load_stub(&worker, Some("unused"));
        let worker = Arc::new(worker);
        let dir = fixture_dir("x");
        // Valid base64, not a WAV file.
        let err = transcribe_local(&worker, &dir, &model, "bm90LWEtd2F2", None)
            .await
            .unwrap_err();
        assert_eq!(err.code, "audio-unsupported-format");
    }

    #[tokio::test]
    async fn local_path_propagates_engine_errors() {
        let worker = TranscriptionWorker::new();
        let model = load_stub(&worker, None);
        let worker = Arc::new(worker);
        let dir = fixture_dir("x");
        let audio = wav_base64(&[1000i16; 1600]);
        let err = transcribe_local(&worker, &dir, &model, &audio, None)
            .await
            .unwrap_err();
        assert_eq!(err.code, "engine-init-failed");
    }
}
