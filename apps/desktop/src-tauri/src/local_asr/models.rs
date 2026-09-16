//! On-disk model store: layout, install records, status derivation.
//!
//! Layout under `<app_data>/models/`:
//! ```text
//! models/
//!   <model-id>/
//!     <model files...>
//!     installed.json            written only after every file verified
//!     <file>.part               in-progress bytes (resumable)
//!     <file>.part.json          resume sidecar (url + key)
//! ```
//! A model counts as installed only when `installed.json` exists AND every
//! recorded file is present with its recorded byte size. Hashes are verified
//! at install time (downloader) and on explicit verify — never on a cheap
//! status read, and never skipped before activation.

use crate::error::{AppError, AppResult};
use crate::local_asr::manifest::{is_safe_slug, LocalModel, ModelManifest};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

pub const MODELS_DIR_NAME: &str = "models";
pub const INSTALLED_FILE: &str = "installed.json";
/// `.part` files older than this (with no live task) are deleted on prune.
pub const STALE_PART_DAYS: u64 = 7;
/// Headroom demanded beyond the download size itself.
pub const DISK_HEADROOM_BYTES: u64 = 64 * 1024 * 1024;

/// Mirrors shared-types `ModelStatus` exactly (kebab-case wire strings).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum ModelStatus {
    NotDownloaded,
    Downloading,
    Verifying,
    Ready,
    Error,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelStatusInfo {
    pub id: String,
    pub status: ModelStatus,
    pub downloaded_bytes: u64,
    pub total_bytes: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_code: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_message: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct InstalledFile {
    pub filename: String,
    pub size_bytes: u64,
    pub sha256: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InstalledRecord {
    pub id: String,
    pub version: String,
    pub installed_at: String,
    pub files: Vec<InstalledFile>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstalledModel {
    pub id: String,
    pub name: String,
    pub version: String,
    pub total_bytes: u64,
    pub installed_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelUpdate {
    pub id: String,
    pub name: String,
    pub installed_version: String,
    pub available_version: String,
}

pub fn models_dir(app_data: &Path) -> PathBuf {
    app_data.join(MODELS_DIR_NAME)
}

/// Model directory for an id. The id is slug-checked so a hostile id can
/// never escape `models/` via `..` or separators.
pub fn model_dir(app_data: &Path, id: &str) -> AppResult<PathBuf> {
    if !is_safe_slug(id) {
        return Err(AppError::model_not_found(format!("unknown model: {id}")));
    }
    Ok(models_dir(app_data).join(id))
}

/// Resume key binding a `.part` file to one exact payload. A version bump
/// always changes the key, so stale bytes are never resumed into new files.
pub fn resume_key_for(model: &LocalModel) -> String {
    format!("{}@{}", model.id, model.version)
}

/// Cheap on-disk state (no hashing): Ready / NotDownloaded / Broken.
pub enum DiskStatus {
    Ready(InstalledRecord),
    NotDownloaded { downloaded_bytes: u64 },
    Broken { message: String },
}

pub fn disk_status(app_data: &Path, model: &LocalModel) -> AppResult<DiskStatus> {
    let dir = model_dir(app_data, &model.id)?;
    let record_path = dir.join(INSTALLED_FILE);
    let raw = match std::fs::read(&record_path) {
        Ok(bytes) => bytes,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            return Ok(DiskStatus::NotDownloaded {
                downloaded_bytes: partial_bytes(&dir),
            })
        }
        Err(e) => {
            return Err(AppError::model_download_failed(format!(
                "cannot read install record: {e}"
            )))
        }
    };
    let record: InstalledRecord = match serde_json::from_slice(&raw) {
        Ok(record) => record,
        Err(_) => {
            return Ok(DiskStatus::Broken {
                message: "install record is unreadable; re-download or verify the model"
                    .to_string(),
            })
        }
    };
    if record.id != model.id {
        return Ok(DiskStatus::Broken {
            message: "install record belongs to a different model; re-download".to_string(),
        });
    }
    for file in &record.files {
        let len = std::fs::metadata(dir.join(&file.filename)).map(|m| m.len());
        if len.ok() != Some(file.size_bytes) {
            return Ok(DiskStatus::Broken {
                message: "installed files changed or are missing; re-download or verify"
                    .to_string(),
            });
        }
    }
    Ok(DiskStatus::Ready(record))
}

/// Full status for UI/API, overlaying the live-download flag.
pub fn status_info(
    app_data: &Path,
    model: &LocalModel,
    downloading: bool,
) -> AppResult<ModelStatusInfo> {
    let total = model.known_total_bytes();
    if downloading {
        let dir = model_dir(app_data, &model.id)?;
        return Ok(ModelStatusInfo {
            id: model.id.clone(),
            status: ModelStatus::Downloading,
            downloaded_bytes: partial_bytes(&dir),
            total_bytes: total,
            error_code: None,
            error_message: None,
            version: Some(model.version.clone()),
        });
    }
    match disk_status(app_data, model)? {
        DiskStatus::Ready(record) => {
            let bytes = record.files.iter().map(|f| f.size_bytes).sum();
            Ok(ModelStatusInfo {
                id: model.id.clone(),
                status: ModelStatus::Ready,
                downloaded_bytes: bytes,
                total_bytes: bytes,
                error_code: None,
                error_message: None,
                version: Some(record.version),
            })
        }
        DiskStatus::NotDownloaded { downloaded_bytes } => Ok(ModelStatusInfo {
            id: model.id.clone(),
            status: ModelStatus::NotDownloaded,
            downloaded_bytes,
            total_bytes: total,
            error_code: None,
            error_message: None,
            version: Some(model.version.clone()),
        }),
        DiskStatus::Broken { message } => Ok(ModelStatusInfo {
            id: model.id.clone(),
            status: ModelStatus::Error,
            downloaded_bytes: 0,
            total_bytes: total,
            error_code: Some("model-checksum-mismatch".to_string()),
            error_message: Some(message),
            version: Some(model.version.clone()),
        }),
    }
}

/// Sum of `.part` byte counts under a model dir (best-effort, no hashing).
/// Recurses into subdirectories (e.g. `tokenizer/`) with a depth cap.
fn partial_bytes(dir: &Path) -> u64 {
    let mut parts = Vec::new();
    collect_parts(dir, &mut parts, 0);
    parts
        .iter()
        .map(|p| std::fs::metadata(p).map(|m| m.len()).unwrap_or(0))
        .sum()
}

fn collect_parts(dir: &Path, out: &mut Vec<PathBuf>, depth: u8) {
    if depth > 4 {
        return;
    }
    let entries = std::fs::read_dir(dir).map(|r| r.collect::<Vec<_>>());
    let Ok(entries) = entries else { return };
    for entry in entries.into_iter().flatten() {
        let path = entry.path();
        if path.is_dir() {
            collect_parts(&path, out, depth + 1);
        } else if path.extension().and_then(|e| e.to_str()) == Some("part") {
            out.push(path);
        }
    }
}

fn collect_metas(dir: &Path, out: &mut Vec<PathBuf>, depth: u8) {
    if depth > 4 {
        return;
    }
    let entries = std::fs::read_dir(dir).map(|r| r.collect::<Vec<_>>());
    let Ok(entries) = entries else { return };
    for entry in entries.into_iter().flatten() {
        let path = entry.path();
        if path.is_dir() {
            collect_metas(&path, out, depth + 1);
        } else if path
            .file_name()
            .and_then(|n| n.to_str())
            .is_some_and(|n| n.ends_with(".part.json"))
        {
            out.push(path);
        }
    }
}

pub fn read_installed_record(dir: &Path) -> Option<InstalledRecord> {
    let bytes = std::fs::read(dir.join(INSTALLED_FILE)).ok()?;
    serde_json::from_slice(&bytes).ok()
}

pub fn write_installed_record(dir: &Path, record: &InstalledRecord) -> AppResult<()> {
    std::fs::create_dir_all(dir)
        .map_err(|e| AppError::model_download_failed(format!("cannot create model dir: {e}")))?;
    let bytes = serde_json::to_vec_pretty(record).map_err(|e| {
        AppError::model_download_failed(format!("cannot encode install record: {e}"))
    })?;
    std::fs::write(dir.join(INSTALLED_FILE), bytes)
        .map_err(|e| AppError::model_download_failed(format!("cannot write install record: {e}")))
}

/// Free bytes on the volume containing `path`, via longest-prefix mount
/// match. `None` when no volume matches (e.g. relative path): callers treat
/// that as "unknown, proceed" because write errors are still mapped.
pub fn free_space_bytes(path: &Path) -> Option<u64> {
    let disks = sysinfo::Disks::new_with_refreshed_list();
    let mut best: Option<(usize, u64)> = None;
    for disk in disks.list() {
        let mount = disk.mount_point();
        if path.starts_with(mount) {
            let len = mount.as_os_str().len();
            if best.is_none_or(|(best_len, _)| len > best_len) {
                best = Some((len, disk.available_space()));
            }
        }
    }
    best.map(|(_, free)| free)
}

/// Fail before downloading when the volume provably cannot fit the payload
/// plus headroom. Unknown volumes pass (writes still fail safe).
pub fn check_free_space(path: &Path, needed_bytes: u64) -> AppResult<()> {
    let required = needed_bytes.saturating_add(DISK_HEADROOM_BYTES);
    match free_space_bytes(path) {
        Some(free) if free < required => Err(AppError::model_insufficient_disk_space(format!(
            "not enough free disk space: need ~{required} bytes, have {free} bytes"
        ))),
        _ => Ok(()),
    }
}

/// Delete stale `.part` state: sidecar missing, resume key from another
/// model version, or older than the TTL. Returns removal count. Live tasks
/// are the caller's responsibility (prune only when idle).
pub fn prune_stale_parts(app_data: &Path, manifest: &ModelManifest) -> usize {
    let mut removed = 0usize;
    let ttl = std::time::Duration::from_secs(STALE_PART_DAYS * 24 * 3600);
    for model in &manifest.models {
        let Ok(dir) = model_dir(app_data, &model.id) else {
            continue;
        };
        let key = resume_key_for(model);
        // URLs currently valid for this model: a sidecar pointing anywhere
        // else (e.g. rotated CDN origin, same version) must not resume.
        let mut urls = std::collections::HashSet::new();
        for file in &model.files {
            urls.insert(file.url.as_str());
            if let Some(fallback) = file.fallback_url.as_deref() {
                urls.insert(fallback);
            }
        }
        // The sidecar decides: missing/unparseable meta, foreign key,
        // foreign URL, or TTL breach all mean the bytes can never resume.
        let mut parts = Vec::new();
        collect_parts(&dir, &mut parts, 0);
        for part in &parts {
            let mut meta_path = part.clone().into_os_string();
            meta_path.push(".json");
            let meta_path = PathBuf::from(meta_path);
            let keep = std::fs::read(&meta_path)
                .ok()
                .and_then(|b| serde_json::from_slice::<PartMeta>(&b).ok())
                .is_some_and(|m| {
                    m.resume_key == key
                        && urls.contains(m.url.as_str())
                        && mtime_within(part, ttl)
                        && mtime_within(&meta_path, ttl)
                });
            if !keep {
                if std::fs::remove_file(part).is_ok() {
                    removed += 1;
                }
                if std::fs::remove_file(&meta_path).is_ok() {
                    removed += 1;
                }
            }
        }
        // Metas whose part file is gone are debris on their own.
        let mut metas = Vec::new();
        collect_metas(&dir, &mut metas, 0);
        for meta in &metas {
            let part_gone = meta
                .to_str()
                .and_then(|s| s.strip_suffix(".json"))
                .map(PathBuf::from)
                .map(|p| !p.exists())
                .unwrap_or(true);
            if part_gone && std::fs::remove_file(meta).is_ok() {
                removed += 1;
            }
        }
    }
    removed
}

fn mtime_within(path: &Path, ttl: std::time::Duration) -> bool {
    std::fs::metadata(path)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| std::time::SystemTime::now().duration_since(t).ok())
        .is_some_and(|age| age <= ttl)
}

/// Minimal resume sidecar mirror (downloader owns the canonical struct;
/// duplicated fields here avoid a cross-module type leak into status code).
#[derive(Debug, serde::Serialize, serde::Deserialize)]
struct PartMeta {
    url: String,
    total_bytes: Option<u64>,
    resume_key: String,
}

/// Installed models with a fully valid record (the only ones the engine may
/// load). Sorted by id for stable UI lists.
pub fn installed_models(app_data: &Path, manifest: &ModelManifest) -> Vec<InstalledModel> {
    let mut out = Vec::new();
    for model in &manifest.models {
        let Ok(dir) = model_dir(app_data, &model.id) else {
            continue;
        };
        let record = match read_installed_record(&dir) {
            Some(r) => r,
            None => continue,
        };
        if record.id != model.id {
            continue;
        }
        let complete = record.files.iter().all(|f| {
            std::fs::metadata(dir.join(&f.filename))
                .map(|m| m.len())
                .ok()
                == Some(f.size_bytes)
        });
        if !complete {
            continue;
        }
        out.push(InstalledModel {
            id: record.id.clone(),
            name: model.name.clone(),
            version: record.version.clone(),
            total_bytes: record.files.iter().map(|f| f.size_bytes).sum(),
            installed_at: record.installed_at.clone(),
        });
    }
    out.sort_by(|a, b| a.id.cmp(&b.id));
    out
}

/// Models whose installed version is older than the manifest's (semver).
/// Unparseable versions never report an update (fail closed, no prompt).
pub fn check_model_updates(app_data: &Path, manifest: &ModelManifest) -> Vec<ModelUpdate> {
    let mut out = Vec::new();
    for model in &manifest.models {
        let Ok(dir) = model_dir(app_data, &model.id) else {
            continue;
        };
        let Some(record) = read_installed_record(&dir) else {
            continue;
        };
        if record.id != model.id {
            continue;
        }
        let (Some(installed), Some(available)) =
            (parse_semver(&record.version), parse_semver(&model.version))
        else {
            continue;
        };
        if available > installed {
            out.push(ModelUpdate {
                id: model.id.clone(),
                name: model.name.clone(),
                installed_version: record.version.clone(),
                available_version: model.version.clone(),
            });
        }
    }
    out.sort_by(|a, b| a.id.cmp(&b.id));
    out
}

fn parse_semver(version: &str) -> Option<(u64, u64, u64)> {
    let parts: Vec<&str> = version.split('.').collect();
    if parts.len() != 3 {
        return None;
    }
    let nums: Vec<u64> = parts
        .iter()
        .map(|p| p.parse::<u64>().ok())
        .collect::<Option<_>>()?;
    Some((nums[0], nums[1], nums[2]))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::local_asr::manifest::{default_manifest, validate_manifest};
    use std::sync::atomic::{AtomicUsize, Ordering};

    fn test_dir(name: &str) -> PathBuf {
        static COUNTER: AtomicUsize = AtomicUsize::new(0);
        let n = COUNTER.fetch_add(1, Ordering::SeqCst);
        std::env::temp_dir().join(format!(
            "algorith-voice-modeltest-{}-{}-{}",
            std::process::id(),
            n,
            name
        ))
    }

    fn manifest() -> ModelManifest {
        let m = default_manifest().expect("bundled manifest parses");
        validate_manifest(&m).expect("bundled manifest shape valid");
        m
    }

    fn parakeet(manifest: &ModelManifest) -> LocalModel {
        manifest
            .models
            .iter()
            .find(|m| m.id == "parakeet-tdt-0.6b-v3")
            .expect("parakeet entry")
            .clone()
    }

    #[test]
    fn fresh_checkout_is_not_downloaded() {
        let base = test_dir("fresh");
        let m = manifest();
        let model = parakeet(&m);
        let info = status_info(&base, &model, false).expect("status");
        assert_eq!(info.status, ModelStatus::NotDownloaded);
        assert_eq!(info.downloaded_bytes, 0);
        assert_eq!(info.id, model.id);
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn partial_bytes_are_counted() {
        let base = test_dir("partial");
        let m = manifest();
        let model = parakeet(&m);
        let dir = model_dir(&base, &model.id).expect("dir");
        std::fs::create_dir_all(&dir).expect("mkdir");
        std::fs::write(dir.join("encoder.int8.onnx.part"), vec![7u8; 1024]).expect("part");
        let info = status_info(&base, &model, false).expect("status");
        assert_eq!(info.status, ModelStatus::NotDownloaded);
        assert_eq!(info.downloaded_bytes, 1024);
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn complete_record_reads_ready() {
        let base = test_dir("ready");
        let m = manifest();
        let model = parakeet(&m);
        let dir = model_dir(&base, &model.id).expect("dir");
        std::fs::create_dir_all(&dir).expect("mkdir");
        std::fs::write(dir.join("encoder.int8.onnx"), vec![1u8; 10]).expect("file");
        let record = InstalledRecord {
            id: model.id.clone(),
            version: "1.0.0".to_string(),
            installed_at: "2026-01-01T00:00:00Z".to_string(),
            files: vec![InstalledFile {
                filename: "encoder.int8.onnx".to_string(),
                size_bytes: 10,
                sha256: "aa".repeat(32),
            }],
        };
        write_installed_record(&dir, &record).expect("write record");
        let info = status_info(&base, &model, false).expect("status");
        assert_eq!(info.status, ModelStatus::Ready);
        assert_eq!(info.version.as_deref(), Some("1.0.0"));
        assert_eq!(info.downloaded_bytes, 10);
        let installed = installed_models(&base, &m);
        assert_eq!(installed.len(), 1);
        assert_eq!(installed[0].id, model.id);
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn missing_file_after_install_is_broken() {
        let base = test_dir("broken");
        let m = manifest();
        let model = parakeet(&m);
        let dir = model_dir(&base, &model.id).expect("dir");
        std::fs::create_dir_all(&dir).expect("mkdir");
        // Record claims a file that is not on disk.
        let record = InstalledRecord {
            id: model.id.clone(),
            version: "1.0.0".to_string(),
            installed_at: "2026-01-01T00:00:00Z".to_string(),
            files: vec![InstalledFile {
                filename: "gone.onnx".to_string(),
                size_bytes: 10,
                sha256: "aa".repeat(32),
            }],
        };
        write_installed_record(&dir, &record).expect("write record");
        let info = status_info(&base, &model, false).expect("status");
        assert_eq!(info.status, ModelStatus::Error);
        assert_eq!(info.error_code.as_deref(), Some("model-checksum-mismatch"));
        // Not listable as installed either.
        assert!(installed_models(&base, &m).is_empty());
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn corrupt_record_is_broken_not_ready() {
        let base = test_dir("corrupt-record");
        let m = manifest();
        let model = parakeet(&m);
        let dir = model_dir(&base, &model.id).expect("dir");
        std::fs::create_dir_all(&dir).expect("mkdir");
        std::fs::write(dir.join(INSTALLED_FILE), b"{oops").expect("corrupt");
        let info = status_info(&base, &model, false).expect("status");
        assert_eq!(info.status, ModelStatus::Error);
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn hostile_ids_never_escape_the_models_dir() {
        let base = test_dir("traversal");
        for bad in ["../x", "a/b", "a\\b", "", ".", "UPPER"] {
            assert!(model_dir(&base, bad).is_err(), "id must be rejected: {bad}");
        }
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn disk_space_checks() {
        let base = test_dir("disk");
        std::fs::create_dir_all(&base).expect("mkdir");
        // A request larger than any real volume must fail deterministically.
        let err = check_free_space(&base, u64::MAX).expect_err("u64::MAX never fits");
        assert_eq!(err.code, "model-insufficient-disk-space");
        // A trivial request passes (or the volume is unknown, also Ok).
        check_free_space(&base, 1).expect("1 byte fits or unknown");
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn prune_removes_only_stale_parts() {
        let base = test_dir("prune");
        let m = manifest();
        let model = parakeet(&m);
        let dir = model_dir(&base, &model.id).expect("dir");
        std::fs::create_dir_all(&dir).expect("mkdir");
        let meta = |key: &str, url: &str| {
            serde_json::to_vec(&serde_json::json!({
                "url": url,
                "total_bytes": 10,
                "resume_key": key,
            }))
            .expect("meta json")
        };
        // A currently-listed manifest URL keeps the part resumable.
        let live_url = model.files[0].url.clone();
        // Fresh part for the CURRENT version + URL: kept.
        std::fs::write(dir.join("a.bin.part"), [1u8; 4]).expect("part");
        std::fs::write(
            dir.join("a.bin.part.json"),
            meta(&format!("{}@1.0.0", model.id), &live_url),
        )
        .expect("meta");
        // Part from an older version (same URL): removed with its sidecar.
        std::fs::write(dir.join("b.bin.part"), [2u8; 4]).expect("part");
        std::fs::write(
            dir.join("b.bin.part.json"),
            meta(&format!("{}@0.9.0", model.id), &live_url),
        )
        .expect("meta");
        // Part pointing at a rotated-away URL: removed even with a fresh key.
        std::fs::write(dir.join("d.bin.part"), [4u8; 4]).expect("part");
        std::fs::write(
            dir.join("d.bin.part.json"),
            meta(
                &format!("{}@1.0.0", model.id),
                "https://cdn.example.com/rotated-away/x.bin",
            ),
        )
        .expect("meta");
        // Orphan part without any sidecar: removed.
        std::fs::write(dir.join("c.bin.part"), [3u8; 4]).expect("part");
        // Nested stale part (tokenizer layout): removed recursively.
        let tok = dir.join("tokenizer");
        std::fs::create_dir_all(&tok).expect("tok dir");
        std::fs::write(tok.join("x.bin.part"), [5u8; 4]).expect("part");
        std::fs::write(
            tok.join("x.bin.part.json"),
            meta(
                &format!("{}@0.9.0", model.id),
                "https://cdn.example.com/rotated-away/x.bin",
            ),
        )
        .expect("meta");

        let removed = prune_stale_parts(&base, &m);
        assert!(removed >= 7, "stale parts + metas removed, got {removed}");
        assert!(dir.join("a.bin.part").exists(), "fresh part kept");
        assert!(!dir.join("b.bin.part").exists(), "old-version part gone");
        assert!(!dir.join("d.bin.part").exists(), "rotated-URL part gone");
        assert!(!dir.join("c.bin.part").exists(), "orphan part gone");
        assert!(!tok.join("x.bin.part").exists(), "nested stale part gone");
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn update_detection_compares_versions() {
        let base = test_dir("updates");
        let m = manifest();
        let model = parakeet(&m);
        let dir = model_dir(&base, &model.id).expect("dir");
        std::fs::create_dir_all(&dir).expect("mkdir");
        let record = InstalledRecord {
            id: model.id.clone(),
            version: "0.9.0".to_string(),
            installed_at: "2026-01-01T00:00:00Z".to_string(),
            files: vec![],
        };
        write_installed_record(&dir, &record).expect("record");
        let updates = check_model_updates(&base, &m);
        assert_eq!(updates.len(), 1);
        assert_eq!(updates[0].installed_version, "0.9.0");
        assert_eq!(updates[0].available_version, "1.0.0");

        // Same version: no update. Newer installed: no update either.
        for v in ["1.0.0", "2.0.0"] {
            let mut r = record.clone();
            r.version = v.to_string();
            write_installed_record(&dir, &r).expect("record");
            assert!(
                check_model_updates(&base, &m).is_empty(),
                "no update for installed {v}"
            );
        }
        let _ = std::fs::remove_dir_all(&base);
    }
}
