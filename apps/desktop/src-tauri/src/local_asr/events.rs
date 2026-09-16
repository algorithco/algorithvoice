//! Typed Tauri event payloads for local model downloads.
//!
//! Event names are stable API (the frontend subscribes by string), mirrored
//! in `packages/shared-types` shapes: progress uses
//! `downloadProgressSchema`, status changes carry `modelStatusInfoSchema`.

use serde::Serialize;

/// Emitted roughly 4x/second per active download and once at completion.
pub const MODEL_DOWNLOAD_PROGRESS: &str = "model-download-progress";
/// Emitted when a model's lifecycle state settles: download finished,
/// failed, cancelled, deleted, verified, or installed.
pub const MODEL_STATUS_CHANGED: &str = "model-status-changed";
/// Emitted as a model loads into the worker (staged milestones, not
/// percentages — engine creation is monolithic inside sherpa).
pub const MODEL_LOAD_PROGRESS: &str = "model-load-progress";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadProgressEvent {
    pub id: String,
    pub downloaded_bytes: u64,
    /// 0 when the total is unknown (manifest size 0 and no Content-Length).
    pub total_bytes: u64,
    pub bytes_per_second: f64,
    pub eta_seconds: Option<f64>,
}

impl DownloadProgressEvent {
    pub fn from_progress(id: String, progress: super::downloader::DownloadProgress) -> Self {
        Self {
            id,
            downloaded_bytes: progress.downloaded_bytes,
            total_bytes: progress.total_bytes.unwrap_or(0),
            bytes_per_second: progress.bytes_per_second,
            eta_seconds: progress.eta_seconds,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadProgressEvent {
    pub id: String,
    pub stage: super::worker::LoadStage,
}
