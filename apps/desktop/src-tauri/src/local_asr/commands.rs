//! Tauri commands for local model management.
//!
//! Every command is async, returns the `{code, message}` error shape, and
//! never touches the network except through the downloader (HTTPS-only,
//! hashed before activation). Cancellation is a status, never an error.

use crate::error::{AppError, AppResult};
use crate::local_asr::downloader::{
    verify_file, DownloadManager, DownloadRequest, ModelFileRequest,
};
use crate::local_asr::events::{
    DownloadProgressEvent, MODEL_DOWNLOAD_PROGRESS, MODEL_STATUS_CHANGED,
};
use crate::local_asr::manifest::{
    default_manifest, is_configured, validate_manifest, LocalModel, ModelManifest,
};
use crate::local_asr::models::{
    self, InstalledFile, InstalledModel, InstalledRecord, ModelStatus, ModelStatusInfo,
};
use std::path::PathBuf;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, State};

/// Per-attempt deadline for a file download (retries get a fresh budget).
pub const DOWNLOAD_TIMEOUT_SECS: u64 = 1800;
/// Bounded retries for transient failures (timeout, reset, 5xx, 429).
pub const DOWNLOAD_MAX_RETRIES: u32 = 3;

fn app_data_dir(app: &AppHandle) -> AppResult<PathBuf> {
    app.path()
        .app_data_dir()
        .map_err(|e| AppError::model_download_failed(format!("cannot resolve app data dir: {e}")))
}

fn load_manifest() -> AppResult<ModelManifest> {
    let manifest = default_manifest()?;
    validate_manifest(&manifest)?;
    Ok(manifest)
}

/// Manifest lookup with an untrusted id: slug-checked first so a hostile id
/// can never become a path, even before the lookup fails.
fn find_model(manifest: &ModelManifest, id: &str) -> AppResult<LocalModel> {
    if !crate::local_asr::manifest::is_safe_slug(id) {
        return Err(AppError::model_not_found(format!("unknown model: {id}")));
    }
    manifest
        .models
        .iter()
        .find(|m| m.id == id)
        .cloned()
        .ok_or_else(|| AppError::model_not_found(format!("unknown model: {id}")))
}

fn emit_status(app: &AppHandle, info: &ModelStatusInfo) {
    let _ = app.emit(MODEL_STATUS_CHANGED, info);
}

#[tauri::command]
pub async fn list_available_models() -> AppResult<Vec<LocalModel>> {
    Ok(load_manifest()?.models)
}

#[tauri::command]
pub async fn get_model_status(
    app: AppHandle,
    downloads: State<'_, DownloadManager>,
    id: String,
) -> AppResult<ModelStatusInfo> {
    let manifest = load_manifest()?;
    let model = find_model(&manifest, &id)?;
    let data = app_data_dir(&app)?;
    models::status_info(&data, &model, downloads.is_running(&model.id))
}

#[tauri::command]
pub async fn get_installed_models(app: AppHandle) -> AppResult<Vec<InstalledModel>> {
    let manifest = load_manifest()?;
    let data = app_data_dir(&app)?;
    Ok(models::installed_models(&data, &manifest))
}

/// Rewrite the install record after a successful download or verify,
/// preserving the original install date across re-verifies.
fn record_install(dir: &std::path::Path, model: &LocalModel) -> AppResult<InstalledRecord> {
    let previous = models::read_installed_record(dir)
        .filter(|r| r.id == model.id && r.version == model.version);
    let installed_at = previous
        .map(|r| r.installed_at)
        .unwrap_or_else(|| chrono::Utc::now().to_rfc3339());
    let mut files = Vec::with_capacity(model.files.len());
    for file in &model.files {
        let path = dir.join(&file.filename);
        let size = std::fs::metadata(&path).map(|m| m.len()).map_err(|e| {
            AppError::model_download_failed(format!(
                "downloaded file went missing before install: {} ({e})",
                file.filename
            ))
        })?;
        files.push(InstalledFile {
            filename: file.filename.clone(),
            size_bytes: size,
            sha256: file.sha256.to_lowercase(),
        });
    }
    let record = InstalledRecord {
        id: model.id.clone(),
        version: model.version.clone(),
        installed_at,
        files,
    };
    models::write_installed_record(dir, &record)?;
    Ok(record)
}

#[tauri::command]
pub async fn download_model(
    app: AppHandle,
    downloads: State<'_, DownloadManager>,
    id: String,
) -> AppResult<ModelStatusInfo> {
    let manifest = load_manifest()?;
    let model = find_model(&manifest, &id)?;
    if !is_configured(&model) {
        return Err(AppError::model_not_configured(
            "this model has no download configured yet (placeholder manifest); \
             configure a model CDN to enable downloads",
        ));
    }
    if !model.supports_current_platform() {
        return Err(AppError::model_incompatible(format!(
            "model {} is not built for this OS/architecture",
            model.id
        )));
    }
    let data = app_data_dir(&app)?;
    let dir = models::model_dir(&data, &model.id)?;
    let known = model.known_total_bytes();
    if known > 0 {
        models::check_free_space(&dir, known)?;
    }
    models::prune_stale_parts(&data, &manifest);

    // Skip files that are already present AND verified. Hashing is async
    // (tokio fs yields per chunk), so the event loop never blocks.
    let mut fetch: Vec<(&crate::local_asr::manifest::ModelFile, u64)> = Vec::new();
    let mut skipped_bytes: u64 = 0;
    let mut offset: u64 = 0;
    for file in &model.files {
        let path = dir.join(&file.filename);
        let present = std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
        let expected_len = if file.size_bytes == 0 {
            None
        } else {
            Some(file.size_bytes)
        };
        let usable = match expected_len {
            Some(len) if present != len => false,
            _ => verify_file(&path, &file.sha256).await.is_ok(),
        };
        if usable {
            skipped_bytes += present;
        } else {
            // Corrupt or missing: remove so the fetch starts clean.
            let _ = std::fs::remove_file(&path);
            fetch.push((file, offset));
        }
        offset += file.size_bytes;
    }
    let total = model.known_total_bytes();
    if fetch.is_empty() {
        // Everything already verified: ensure the record and report Ready
        // without spawning any task.
        record_install(&dir, &model)?;
        let info = models::status_info(&data, &model, false)?;
        emit_status(&app, &info);
        return Ok(info);
    }

    let requests: Vec<ModelFileRequest> = fetch
        .into_iter()
        .map(|(file, off)| ModelFileRequest {
            request: DownloadRequest {
                url: file.url.clone(),
                fallback_url: file.fallback_url.clone(),
                dest_final: dir.join(&file.filename),
                resume_key: models::resume_key_for(&model),
                expected_sha256: file.sha256.clone(),
                expected_size: (file.size_bytes != 0).then_some(file.size_bytes),
                timeout: Duration::from_secs(DOWNLOAD_TIMEOUT_SECS),
                max_retries: DOWNLOAD_MAX_RETRIES,
            },
            completed_offset: off,
            model_total: total,
        })
        .collect();

    // Report already-verified bytes immediately so progress starts honest.
    // (skipped can never exceed a known total: verified files match it.)
    if skipped_bytes > 0 {
        let _ = app.emit(
            MODEL_DOWNLOAD_PROGRESS,
            DownloadProgressEvent {
                id: model.id.clone(),
                downloaded_bytes: skipped_bytes,
                total_bytes: total,
                bytes_per_second: 0.0,
                eta_seconds: None,
            },
        );
    }

    let app_progress = app.clone();
    let progress_id = model.id.clone();
    let app_done = app.clone();
    let done_dir = dir.clone();
    let done_model = model.clone();
    let done_data = data.clone();
    downloads.start_model(
        model.id.clone(),
        requests,
        move |p| {
            let _ = app_progress.emit(
                MODEL_DOWNLOAD_PROGRESS,
                DownloadProgressEvent::from_progress(progress_id.clone(), p),
            );
        },
        move |outcome| {
            // Terminal state: record the install (files were hash-verified
            // by the downloader) or surface the failure. Synchronous by
            // design — only small metadata I/O happens here.
            let info = match outcome {
                Ok(()) => match record_install(&done_dir, &done_model) {
                    Ok(_) => models::status_info(&done_data, &done_model, false)
                        .unwrap_or_else(|e| error_status(&done_model, &e)),
                    Err(e) => error_status(&done_model, &e),
                },
                Err(e) => error_status(&done_model, &e),
            };
            emit_status(&app_done, &info);
        },
    )?;

    models::status_info(&data, &model, true)
}

fn error_status(model: &LocalModel, e: &AppError) -> ModelStatusInfo {
    ModelStatusInfo {
        id: model.id.clone(),
        status: ModelStatus::Error,
        downloaded_bytes: 0,
        total_bytes: model.known_total_bytes(),
        error_code: Some(e.code.to_string()),
        error_message: Some(e.message.clone()),
        version: Some(model.version.clone()),
    }
}

#[tauri::command]
pub async fn cancel_download(
    app: AppHandle,
    downloads: State<'_, DownloadManager>,
    id: String,
) -> AppResult<ModelStatusInfo> {
    let manifest = load_manifest()?;
    let model = find_model(&manifest, &id)?;
    // Cancelling an idle download is a successful no-op; partial bytes stay
    // on disk for resume either way.
    downloads.cancel(&model.id);
    let data = app_data_dir(&app)?;
    let info = models::status_info(&data, &model, false)?;
    emit_status(&app, &info);
    Ok(info)
}

#[tauri::command]
pub async fn delete_model(
    app: AppHandle,
    downloads: State<'_, DownloadManager>,
    id: String,
) -> AppResult<ModelStatusInfo> {
    let manifest = load_manifest()?;
    let model = find_model(&manifest, &id)?;
    downloads.cancel(&model.id);
    let data = app_data_dir(&app)?;
    let dir = models::model_dir(&data, &model.id)?;
    match std::fs::remove_dir_all(&dir) {
        Ok(()) => {}
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
        Err(e) => {
            return Err(AppError::model_download_failed(format!(
                "cannot delete model files: {e}"
            )))
        }
    }
    let info = models::status_info(&data, &model, false)?;
    emit_status(&app, &info);
    Ok(info)
}

#[tauri::command]
pub async fn verify_model(app: AppHandle, id: String) -> AppResult<ModelStatusInfo> {
    let manifest = load_manifest()?;
    let model = find_model(&manifest, &id)?;
    let data = app_data_dir(&app)?;
    let dir = models::model_dir(&data, &model.id)?;
    emit_status(
        &app,
        &ModelStatusInfo {
            id: model.id.clone(),
            status: ModelStatus::Verifying,
            downloaded_bytes: 0,
            total_bytes: model.known_total_bytes(),
            error_code: None,
            error_message: None,
            version: Some(model.version.clone()),
        },
    );
    // Hash source: the install record when it matches this model, else the
    // manifest itself (self-healing path for a lost/corrupt record).
    let record_files: Option<Vec<InstalledFile>> = match &models::read_installed_record(&dir) {
        Some(record) if record.id == model.id => Some(record.files.clone()),
        _ => None,
    };
    let mut failed: Option<String> = None;
    if let Some(files) = &record_files {
        for file in files {
            if let Err(e) = verify_file(&dir.join(&file.filename), &file.sha256).await {
                failed = Some(format!("{}: {}", file.filename, e.message));
                break;
            }
        }
    } else {
        for file in &model.files {
            if let Err(e) = verify_file(&dir.join(&file.filename), &file.sha256).await {
                failed = Some(format!("{}: {}", file.filename, e.message));
                break;
            }
        }
    }
    let info = match failed {
        None => {
            // Healthy: ensure a record exists (self-heal when it didn't).
            if record_files.is_none() {
                let _ = record_install(&dir, &model);
            }
            models::status_info(&data, &model, false)?
        }
        Some(message) => ModelStatusInfo {
            id: model.id.clone(),
            status: ModelStatus::Error,
            downloaded_bytes: 0,
            total_bytes: model.known_total_bytes(),
            error_code: Some("model-checksum-mismatch".to_string()),
            error_message: Some(message),
            version: Some(model.version.clone()),
        },
    };
    emit_status(&app, &info);
    Ok(info)
}
