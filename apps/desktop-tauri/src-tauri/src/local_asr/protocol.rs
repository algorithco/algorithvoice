//! Stable JSON worker protocol: transcribe request, transcription result,
//! structured error.
//!
//! Used in-process today; shaped so a future out-of-process sidecar can speak
//! the identical messages over stdin/stdout. Field names are frozen API.
//! Unknown JSON fields are tolerated on input (worker version skew must not
//! break parsing); locally-constructed messages always carry every field.

use crate::error::AppError;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TranscribeRequest {
    /// Always `"transcribe"`.
    #[serde(rename = "type")]
    pub message_type: String,
    pub request_id: String,
    /// Absolute local audio path (WAV). The worker never fetches URLs.
    pub audio_path: String,
    /// BCP-47-ish code or `"auto"`.
    pub language: String,
    pub timestamps: bool,
}

impl TranscribeRequest {
    pub fn new(
        request_id: String,
        audio_path: String,
        language: String,
        timestamps: bool,
    ) -> Result<Self, String> {
        if request_id.trim().is_empty() {
            return Err("request_id must not be empty".to_string());
        }
        if uuid::Uuid::parse_str(&request_id).is_err() {
            return Err("request_id must be a UUID".to_string());
        }
        if audio_path.trim().is_empty() {
            return Err("audio_path must not be empty".to_string());
        }
        if language.trim().is_empty() {
            return Err("language must not be empty".to_string());
        }
        Ok(Self {
            message_type: "transcribe".to_string(),
            request_id,
            audio_path,
            language,
            timestamps,
        })
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TranscriptionSegment {
    pub start: f64,
    pub end: f64,
    pub text: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TranscriptionResult {
    /// Always `"transcription_result"`.
    #[serde(rename = "type")]
    pub message_type: String,
    pub request_id: String,
    pub text: String,
    pub segments: Vec<TranscriptionSegment>,
    pub processing_time_ms: u64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct WorkerError {
    /// Always `"error"`.
    #[serde(rename = "type")]
    pub message_type: String,
    pub request_id: String,
    /// Mirrors [`AppError`] codes so UI branches identically.
    pub code: String,
    pub message: String,
    pub details: Option<String>,
}

impl WorkerError {
    pub fn new(request_id: String, error: &AppError) -> Self {
        Self {
            message_type: "error".to_string(),
            request_id,
            code: error.code.to_string(),
            message: error.message.clone(),
            details: None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request() -> TranscribeRequest {
        TranscribeRequest::new(
            "123e4567-e89b-12d3-a456-426614174000".to_string(),
            "C:\\audio\\chunk.wav".to_string(),
            "auto".to_string(),
            true,
        )
        .expect("valid request")
    }

    #[test]
    fn request_round_trip_uses_spec_field_names() {
        let value = serde_json::to_value(request()).expect("serializes");
        assert_eq!(
            value.get("type").and_then(|t| t.as_str()),
            Some("transcribe")
        );
        assert_eq!(
            value.get("request_id").and_then(|v| v.as_str()),
            Some("123e4567-e89b-12d3-a456-426614174000")
        );
        let back: TranscribeRequest = serde_json::from_value(value).expect("deserializes");
        assert_eq!(back, request());
    }

    #[test]
    fn request_validation_rejects_garbage() {
        assert!(
            TranscribeRequest::new(String::new(), "a.wav".into(), "auto".into(), true).is_err()
        );
        assert!(
            TranscribeRequest::new("not-a-uuid".into(), "a.wav".into(), "auto".into(), true)
                .is_err()
        );
        assert!(TranscribeRequest::new(
            "123e4567-e89b-12d3-a456-426614174000".into(),
            "  ".into(),
            "auto".into(),
            true
        )
        .is_err());
        assert!(TranscribeRequest::new(
            "123e4567-e89b-12d3-a456-426614174000".into(),
            "a.wav".into(),
            String::new(),
            true
        )
        .is_err());
    }

    #[test]
    fn unknown_fields_are_tolerated_for_version_skew() {
        let mut value = serde_json::to_value(request()).expect("serializes");
        value["future_field"] = serde_json::Value::String("v2".to_string());
        let parsed: TranscribeRequest =
            serde_json::from_value(value).expect("tolerates unknown fields");
        assert_eq!(parsed, request());
    }

    #[test]
    fn result_and_error_round_trip() {
        let result = TranscriptionResult {
            message_type: "transcription_result".to_string(),
            request_id: "123e4567-e89b-12d3-a456-426614174000".to_string(),
            text: "hello world".to_string(),
            segments: vec![TranscriptionSegment {
                start: 0.0,
                end: 2.5,
                text: "hello world".to_string(),
            }],
            processing_time_ms: 1234,
        };
        let value = serde_json::to_value(&result).expect("serializes");
        assert_eq!(
            value.get("type").and_then(|t| t.as_str()),
            Some("transcription_result")
        );
        assert_eq!(
            serde_json::from_value::<TranscriptionResult>(value).expect("parses"),
            result
        );

        let app_error = AppError::inference_timeout("too slow");
        let worker_error = WorkerError::new(result.request_id.clone(), &app_error);
        assert_eq!(worker_error.code, "inference-timeout");
        let value = serde_json::to_value(&worker_error).expect("serializes");
        assert_eq!(value.get("type").and_then(|t| t.as_str()), Some("error"));
        assert_eq!(
            serde_json::from_value::<WorkerError>(value).expect("parses"),
            worker_error
        );
    }
}
