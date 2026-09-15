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
}
