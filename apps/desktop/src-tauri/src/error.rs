use serde::Serialize;
use std::fmt;

/// Structured backend error.
///
/// Serialized as `{ code, message }` so the frontend (now or later) can
/// branch on `code` instead of string-matching. Existing callers only
/// `catch`, so this is backward compatible with the previous `String` errors.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case")]
pub struct AppError {
    pub code: &'static str,
    pub message: String,
}

impl AppError {
    pub fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }

    pub fn tray(msg: impl Into<String>) -> Self {
        Self::new("tray", msg)
    }

    pub fn window(msg: impl Into<String>) -> Self {
        Self::new("window", msg)
    }

    pub fn session(msg: impl Into<String>) -> Self {
        Self::new("session", msg)
    }

    pub fn shortcut(msg: impl Into<String>) -> Self {
        Self::new("shortcut", msg)
    }

    pub fn store(msg: impl Into<String>) -> Self {
        Self::new("store", msg)
    }

    pub fn internal(msg: impl Into<String>) -> Self {
        Self::new("internal", msg)
    }

    /// Explicit not-implemented marker. Used instead of silent fake success
    /// for product surfaces that need business input (e.g. licensing).
    /// NEEDS PRODUCT INPUT: replace each `not-implemented` return with real
    /// logic once the backend contract is defined.
    pub fn not_implemented(msg: impl Into<String>) -> Self {
        Self::new("not-implemented", msg)
    }

    // ---- Local speech recognition (model manager + inference) ----
    // Codes are stable API: the frontend branches on them, so never rename.

    /// Unknown model id, or no model with that id in the manifest.
    pub fn model_not_found(msg: impl Into<String>) -> Self {
        Self::new("model-not-found", msg)
    }

    /// The bundled manifest still carries placeholder URLs — the operator
    /// has not configured a model CDN yet, so nothing can be downloaded.
    pub fn model_not_configured(msg: impl Into<String>) -> Self {
        Self::new("model-not-configured", msg)
    }

    /// Download failed (network, timeout, HTTP error, cancelled-by-user
    /// excluded: cancellation is reported as a status, not an error).
    pub fn model_download_failed(msg: impl Into<String>) -> Self {
        Self::new("model-download-failed", msg)
    }

    /// A downloaded file did not match its manifest SHA-256. The file has
    /// already been deleted when this error is returned.
    pub fn model_checksum_mismatch(msg: impl Into<String>) -> Self {
        Self::new("model-checksum-mismatch", msg)
    }

    /// Not enough free disk space for the download.
    pub fn model_insufficient_disk_space(msg: impl Into<String>) -> Self {
        Self::new("model-insufficient-disk-space", msg)
    }

    /// Model does not support this OS or CPU architecture.
    pub fn model_incompatible(msg: impl Into<String>) -> Self {
        Self::new("model-incompatible", msg)
    }

    /// Inference requested but no model is loaded.
    pub fn model_not_loaded(msg: impl Into<String>) -> Self {
        Self::new("model-not-loaded", msg)
    }

    /// The inference engine failed to initialise (missing files, bad
    /// weights, unsupported hardware for the runtime).
    pub fn engine_init_failed(msg: impl Into<String>) -> Self {
        Self::new("engine-init-failed", msg)
    }

    /// Inference exceeded its deadline.
    pub fn inference_timeout(msg: impl Into<String>) -> Self {
        Self::new("inference-timeout", msg)
    }

    /// The engine returned no text. Never silently accepted: callers must
    /// surface this (retry with diagnostics or a clear user error).
    pub fn inference_empty_result(msg: impl Into<String>) -> Self {
        Self::new("inference-empty-result", msg)
    }

    /// Not enough memory to load or run the model.
    pub fn out_of_memory(msg: impl Into<String>) -> Self {
        Self::new("out-of-memory", msg)
    }

    /// Audio input could not be decoded or normalized (corrupt/truncated
    /// WAV, unsupported sample format, pathological size).
    pub fn audio_unsupported_format(msg: impl Into<String>) -> Self {
        Self::new("audio-unsupported-format", msg)
    }
}

impl fmt::Display for AppError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "[{}] {}", self.code, self.message)
    }
}

impl std::error::Error for AppError {}

impl From<String> for AppError {
    fn from(message: String) -> Self {
        Self::internal(message)
    }
}

impl From<&str> for AppError {
    fn from(message: &str) -> Self {
        Self::internal(message.to_owned())
    }
}

pub type AppResult<T> = Result<T, AppError>;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serializes_with_code_and_message() {
        let err = AppError::tray("tray not found");
        let value = serde_json::to_value(&err).expect("serializes");
        assert_eq!(value.get("code").and_then(|c| c.as_str()), Some("tray"));
        assert!(value
            .get("message")
            .and_then(|m| m.as_str())
            .unwrap_or_default()
            .contains("tray not found"));
    }

    #[test]
    fn local_stt_codes_are_stable() {
        // Frontend branches on these strings: changing one is a breaking
        // change that must be coordinated with the UI.
        let cases = [
            (AppError::model_not_found("x"), "model-not-found"),
            (AppError::model_not_configured("x"), "model-not-configured"),
            (
                AppError::model_download_failed("x"),
                "model-download-failed",
            ),
            (
                AppError::model_checksum_mismatch("x"),
                "model-checksum-mismatch",
            ),
            (
                AppError::model_insufficient_disk_space("x"),
                "model-insufficient-disk-space",
            ),
            (AppError::model_incompatible("x"), "model-incompatible"),
            (AppError::model_not_loaded("x"), "model-not-loaded"),
            (AppError::not_implemented("x"), "not-implemented"),
            (AppError::engine_init_failed("x"), "engine-init-failed"),
            (AppError::inference_timeout("x"), "inference-timeout"),
            (
                AppError::inference_empty_result("x"),
                "inference-empty-result",
            ),
            (AppError::out_of_memory("x"), "out-of-memory"),
            (
                AppError::audio_unsupported_format("x"),
                "audio-unsupported-format",
            ),
        ];
        for (err, code) in cases {
            let value = serde_json::to_value(&err).expect("serializes");
            assert_eq!(
                value.get("code").and_then(|c| c.as_str()),
                Some(code),
                "error code changed"
            );
        }
    }
}
