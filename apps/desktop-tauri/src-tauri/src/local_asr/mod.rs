//! Local speech recognition: model management and inference.
//!
//! - Phase 1 (done): versioned model manifest, resumable checksummed
//!   downloads, on-disk install records, and the Tauri commands/events the
//!   model-manager UI drives.
//! - Phase 2 (this module set): hardware detection + compatibility,
//!   stable worker protocol, format-driven audio pipeline, and the Sherpa
//!   transcription worker behind the [`worker::LocalTranscriber`] trait.
//!   No new Tauri commands yet — mode switching and UI wiring land in
//!   Phase 3 on top of these primitives.

pub mod audio;
pub mod commands;
pub mod compat;
pub mod downloader;
pub mod events;
pub mod hardware;
pub mod manifest;
pub mod models;
pub mod protocol;
pub mod worker;
