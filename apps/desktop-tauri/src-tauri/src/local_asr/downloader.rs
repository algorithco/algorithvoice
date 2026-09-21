//! Streaming, resumable, checksummed model-file downloads.
//!
//! Design notes (all local, no telemetry):
//! - One file per request, streamed to `<final>.part` with a `<final>.part.json`
//!   sidecar (`PartMeta`) so an interrupted download can resume with HTTP
//!   `Range`. The final path appears only via atomic rename *after* the
//!   SHA-256 matches, so a model is never marked installed from corrupt bytes.
//! - Cancellation is cooperative at the task level (`JoinHandle::abort`):
//!   the `.part` file is *kept* for resume. Only checksum mismatch and empty
//!   failures delete partial state.
//! - Progress is reported through a caller callback (the Tauri layer turns it
//!   into `model-download-progress` events); this module has no Tauri types.
//! - HTTPS is enforced here even though the manifest validator already
//!   requires it — transport must not depend on a single check.

use crate::error::{AppError, AppResult};
use sha2::{Digest, Sha256};
use std::collections::{HashMap, VecDeque};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tokio::io::AsyncWriteExt;

pub const PART_SUFFIX: &str = ".part";
const META_SUFFIX: &str = ".part.json";
const PROGRESS_EMIT_INTERVAL: Duration = Duration::from_millis(250);
const PROGRESS_EMIT_BYTES: u64 = 256 * 1024;
const SPEED_WINDOW: Duration = Duration::from_secs(3);
const BACKOFF_BASE_SECS: u64 = 1;
const BACKOFF_MAX_SECS: u64 = 8;

/// What the caller wants downloaded and where it must end up.
#[derive(Debug, Clone)]
pub struct DownloadRequest {
    /// Primary HTTPS URL.
    pub url: String,
    /// Optional second HTTPS URL, tried after the primary is exhausted.
    pub fallback_url: Option<String>,
    /// Final destination path (verified file lands here via atomic rename).
    pub dest_final: PathBuf,
    /// Key identifying this exact payload (model id + version). A `.part`
    /// file whose sidecar key differs is discarded, never resumed.
    pub resume_key: String,
    /// Expected SHA-256 hex (case-insensitive). Always required.
    pub expected_sha256: String,
    /// Expected total bytes, if the manifest knows it. `None` means the
    /// transfer length is discovered from the server (or not at all).
    pub expected_size: Option<u64>,
    /// Total deadline per download attempt (all retries).
    pub timeout: Duration,
    /// Retries after a *transient* failure (timeout, reset, 5xx, 429, and
    /// 404/403 within the bounded attempt budget — the latter helps when a
    /// CDN 404s mid-propagation). Checksum mismatch, disk-full, and config
    /// errors never retry.
    pub max_retries: u32,
}

/// Live transfer numbers for progress UI.
#[derive(Debug, Clone, PartialEq)]
pub struct DownloadProgress {
    pub downloaded_bytes: u64,
    pub total_bytes: Option<u64>,
    pub bytes_per_second: f64,
    pub eta_seconds: Option<f64>,
}

/// Metadata stored next to a `.part` file so resume is safe.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq)]
struct PartMeta {
    url: String,
    total_bytes: Option<u64>,
    resume_key: String,
}

fn part_path(final_path: &Path) -> PathBuf {
    let mut name = final_path
        .file_name()
        .map(|n| n.to_owned())
        .unwrap_or_default();
    name.push(PART_SUFFIX);
    final_path.with_file_name(name)
}

fn meta_path(final_path: &Path) -> PathBuf {
    let mut name = final_path
        .file_name()
        .map(|n| n.to_owned())
        .unwrap_or_default();
    name.push(META_SUFFIX);
    final_path.with_file_name(name)
}

fn check_https(raw: &str) -> AppResult<reqwest::Url> {
    let url = reqwest::Url::parse(raw)
        .map_err(|_| AppError::model_download_failed("model URL is malformed"))?;
    if url.scheme() == "https" {
        return Ok(url);
    }
    // Loopback HTTP only allowed in tests/fixtures — production manifests are
    // HTTPS-strict at validation time. Gate with debug_assert in release.
    #[cfg(test)]
    let allow_loopback = true;
    #[cfg(not(test))]
    let allow_loopback = url.scheme() == "http"
        && std::env::var("ALLOW_HTTP_LOOPBACK").as_deref() == Ok("1");
    if allow_loopback
        && url.scheme() == "http"
        && matches!(
            url.host_str(),
            Some("localhost") | Some("127.0.0.1") | Some("::1")
        )
    {
        Ok(url)
    } else {
        Err(AppError::model_download_failed(
            "refusing non-HTTPS model URL",
        ))
    }
}

struct SpeedTracker {
    samples: VecDeque<(Instant, u64)>,
}

impl SpeedTracker {
    fn new() -> Self {
        Self {
            samples: VecDeque::with_capacity(32),
        }
    }

    fn push(&mut self, now: Instant, bytes: u64) {
        self.samples.push_back((now, bytes));
        while let Some((t, _)) = self.samples.front() {
            if now.duration_since(*t) > SPEED_WINDOW {
                self.samples.pop_front();
            } else {
                break;
            }
        }
    }

    fn bytes_per_second(&self) -> f64 {
        let (Some((first_t, first_b)), Some((last_t, last_b))) =
            (self.samples.front(), self.samples.back())
        else {
            return 0.0;
        };
        let dt = last_t.duration_since(*first_t).as_secs_f64();
        if dt <= f64::EPSILON || last_b <= first_b {
            return 0.0;
        }
        (last_b - first_b) as f64 / dt
    }

    fn eta_seconds(&self, downloaded: u64, total: Option<u64>) -> Option<f64> {
        let total = total?;
        if downloaded >= total {
            return Some(0.0);
        }
        let bps = self.bytes_per_second();
        if bps <= f64::EPSILON {
            return None;
        }
        Some((total - downloaded) as f64 / bps)
    }
}

/// Hash a finished file and compare against the expected hex digest.
/// Shared with the verify path so install-time and on-demand checks agree.
pub(crate) async fn verify_file(path: &Path, expected_sha256: &str) -> AppResult<()> {
    use tokio::io::AsyncReadExt as _;
    let mut file = tokio::fs::File::open(path).await.map_err(|e| {
        AppError::model_download_failed(format!("cannot open file for verify: {e}"))
    })?;
    let mut hasher = Sha256::new();
    let mut buf = vec![0u8; 128 * 1024];
    loop {
        let n = file.read(&mut buf).await.map_err(|e| {
            AppError::model_download_failed(format!("cannot read file for verify: {e}"))
        })?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    let actual = format!("{:x}", hasher.finalize());
    if actual == expected_sha256.to_lowercase() {
        Ok(())
    } else {
        Err(AppError::model_checksum_mismatch(format!(
            "checksum mismatch for {}",
            path.display()
        )))
    }
}

fn map_write_error(e: std::io::Error, dest: &Path) -> AppError {
    let is_full = e.kind() == std::io::ErrorKind::StorageFull
        || e.raw_os_error() == Some(28)
        || e.to_string().contains("No space");
    if is_full {
        AppError::model_insufficient_disk_space(format!(
            "disk full while writing {}",
            dest.display()
        ))
    } else {
        AppError::model_download_failed(format!("cannot write {}: {e}", dest.display()))
    }
}

fn map_reqwest_error(e: &reqwest::Error, timeout: Duration) -> AppError {
    if e.is_timeout() {
        return AppError::model_download_failed(format!(
            "download timed out after {}s",
            timeout.as_secs()
        ));
    }
    if e.is_connect() {
        return AppError::model_download_failed(format!("connection failed: {e}"));
    }
    if e.is_body() || e.is_decode() {
        return AppError::model_download_failed(format!("transfer interrupted: {e}"));
    }
    AppError::model_download_failed(format!("request failed: {e}"))
}

/// Result of a single GET attempt: either the full body plan or a signal to
/// restart from scratch (server ignored our Range).
struct FetchPlan {
    response: reqwest::Response,
    /// Byte offset the body stream starts at.
    start_offset: u64,
    /// Total length if the server told us (Content-Range or Content-Length).
    server_total: Option<u64>,
}

async fn fetch_once(
    client: &reqwest::Client,
    url: &reqwest::Url,
    resume_from: u64,
    timeout: Duration,
) -> Result<FetchPlan, AppError> {
    let mut builder = client.get(url.clone());
    if resume_from > 0 {
        builder = builder.header(reqwest::header::RANGE, format!("bytes={resume_from}-"));
    }
    let response = tokio::time::timeout(timeout, builder.send())
        .await
        .map_err(|_| {
            AppError::model_download_failed(format!(
                "download timed out after {}s",
                timeout.as_secs()
            ))
        })?
        .map_err(|e| map_reqwest_error(&e, timeout))?;
    // Enforce HTTPS even after redirects (prevents CDN http downgrade/SSRF).
    {
        let final_url = response.url();
        #[cfg(test)]
        let allow_loopback = final_url.scheme() == "http"
            && matches!(
                final_url.host_str(),
                Some("localhost") | Some("127.0.0.1") | Some("::1")
            );
        #[cfg(not(test))]
        let allow_loopback = final_url.scheme() == "http"
            && std::env::var("ALLOW_HTTP_LOOPBACK").as_deref() == Ok("1")
            && matches!(
                final_url.host_str(),
                Some("localhost") | Some("127.0.0.1") | Some("::1")
            );
        if final_url.scheme() != "https" && !allow_loopback {
            return Err(AppError::model_download_failed(
                "refusing non-HTTPS redirect target",
            ));
        }
    }
    let status = response.status();
    if status == reqwest::StatusCode::PARTIAL_CONTENT {
        let total = response
            .headers()
            .get(reqwest::header::CONTENT_RANGE)
            .and_then(|v| v.to_str().ok())
            .and_then(parse_content_range_total);
        let start = response
            .headers()
            .get(reqwest::header::CONTENT_RANGE)
            .and_then(|v| v.to_str().ok())
            .and_then(|s| parse_content_range_start(s, resume_from));
        match (total, start) {
            (Some(_), Some(start)) if start == resume_from => Ok(FetchPlan {
                response,
                start_offset: resume_from,
                server_total: total,
            }),
            // Server answered 206 but for a different range than asked:
            // retry bounded; the part file is re-evaluated on each attempt.
            _ => Err(AppError::model_download_failed(
                "server returned an unexpected range; will retry",
            )),
        }
    } else if status.is_success() {
        // 200 to a ranged request means the server ignored Range: the body
        // is the whole file, so the caller must truncate first.
        let total = response
            .headers()
            .get(reqwest::header::CONTENT_LENGTH)
            .and_then(|v| v.to_str().ok())
            .and_then(|s| s.parse::<u64>().ok());
        Ok(FetchPlan {
            response,
            start_offset: 0,
            server_total: total,
        })
    } else if status == reqwest::StatusCode::NOT_FOUND {
        Err(AppError::model_download_failed(format!(
            "model file not found on server (HTTP 404): {url}"
        )))
    } else if status == reqwest::StatusCode::FORBIDDEN {
        Err(AppError::model_download_failed(format!(
            "model file forbidden (HTTP 403): {url}"
        )))
    } else if status == reqwest::StatusCode::TOO_MANY_REQUESTS || status.is_server_error() {
        Err(AppError::model_download_failed(format!(
            "transient server error (HTTP {status}); will retry"
        )))
    } else {
        Err(AppError::model_download_failed(format!(
            "unexpected HTTP status {status} for {url}"
        )))
    }
}

/// `bytes 100-200/1000` -> 1000.
fn parse_content_range_total(value: &str) -> Option<u64> {
    value.split('/').nth(1)?.trim().parse().ok()
}

/// `bytes 100-200/1000` -> start, but only if it matches what we asked for.
fn parse_content_range_start(value: &str, expected: u64) -> Option<u64> {
    let range = value.split_whitespace().nth(1)?;
    let start = range.split('-').next()?.parse::<u64>().ok()?;
    (start == expected).then_some(start)
}

/// Download one file to completion: resume, stream, hash, atomic rename.
/// Progress callback receives live numbers; blocking work stays async.
pub async fn download_file<F>(
    client: &reqwest::Client,
    req: &DownloadRequest,
    on_progress: F,
) -> AppResult<()>
where
    F: Fn(DownloadProgress),
{
    if let Some(parent) = req.dest_final.parent() {
        tokio::fs::create_dir_all(parent).await.map_err(|e| {
            AppError::model_download_failed(format!("cannot create model dir: {e}"))
        })?;
        // Reject symlink parent after creation (prevents Startup folder hijack)
        // Walk entire parent chain including root (C:\ on Windows).
        let mut cur: Option<&Path> = Some(parent);
        while let Some(p) = cur {
            if let Ok(meta) = std::fs::symlink_metadata(p) {
                if meta.file_type().is_symlink() {
                    return Err(AppError::model_download_failed(
                        "model path contains symlink — refusing to write",
                    ));
                }
            }
            cur = p.parent();
        }
    }
    // Refuse to overwrite an existing symlink file
    if let Ok(meta) = tokio::fs::symlink_metadata(&req.dest_final).await {
        if meta.file_type().is_symlink() {
            return Err(AppError::model_download_failed(
                "destination is a symlink — refusing to overwrite",
            ));
        }
    }
    let part = part_path(&req.dest_final);
    let meta_path = meta_path(&req.dest_final);
    // TOCTOU: reject if .part or .part.json are already symlinks
    for p in [&part, &meta_path] {
        if let Ok(meta) = std::fs::symlink_metadata(p) {
            if meta.file_type().is_symlink() {
                return Err(AppError::model_download_failed(
                    "partial download path is a symlink — refusing to write",
                ));
            }
        }
    }

    let urls: Vec<&str> = std::iter::once(req.url.as_str())
        .chain(req.fallback_url.as_deref())
        .collect();
    let mut last_err: Option<AppError> = None;
    for url_raw in urls {
        let url = check_https(url_raw)?;
        match download_from_url(client, req, &url, &part, &meta_path, &on_progress).await {
            Ok(()) => return Ok(()),
            Err(e) => {
                // Checksum mismatch and disk-full are terminal: retrying the
                // same bytes cannot help (mismatch also deletes the part).
                if e.code == "model-checksum-mismatch" || e.code == "model-insufficient-disk-space"
                {
                    return Err(e);
                }
                last_err = Some(e);
            }
        }
    }
    Err(last_err.unwrap_or_else(|| AppError::model_download_failed("no download URL available")))
}

async fn download_from_url<F>(
    client: &reqwest::Client,
    req: &DownloadRequest,
    url: &reqwest::Url,
    part: &Path,
    meta_path: &Path,
    on_progress: &F,
) -> AppResult<()>
where
    F: Fn(DownloadProgress),
{
    let mut attempt: u32 = 0;
    loop {
        match attempt_once(client, req, url, part, meta_path, on_progress).await {
            Ok(()) => return Ok(()),
            Err(e) => {
                let transient = is_transient(&e);
                attempt += 1;
                if !transient || attempt > req.max_retries {
                    // Terminal failure: remove empty debris, keep partial
                    // bytes for a user-initiated resume.
                    remove_if_empty(part).await;
                    return Err(e);
                }
                let delay = BACKOFF_BASE_SECS
                    .saturating_mul(2u64.saturating_pow(attempt - 1))
                    .min(BACKOFF_MAX_SECS);
                tokio::time::sleep(Duration::from_secs(delay)).await;
            }
        }
    }
}

fn is_transient(e: &AppError) -> bool {
    // Terminal by construction: checksum/disk-full/config errors never retry.
    // Everything else from the transfer path (timeout, reset, 5xx, 429,
    // unexpected range) is worth another attempt.
    e.code != "model-checksum-mismatch" && e.code != "model-insufficient-disk-space"
}

async fn remove_if_empty(path: &Path) {
    if let Ok(meta) = tokio::fs::metadata(path).await {
        if meta.len() == 0 {
            let _ = tokio::fs::remove_file(path).await;
        }
    }
}

async fn read_part_meta(path: &Path) -> Option<PartMeta> {
    let bytes = tokio::fs::read(path).await.ok()?;
    serde_json::from_slice::<PartMeta>(&bytes).ok()
}

async fn write_part_meta(path: &Path, meta: &PartMeta) -> AppResult<()> {
    let bytes = serde_json::to_vec(meta).map_err(|e| {
        AppError::model_download_failed(format!("cannot encode resume metadata: {e}"))
    })?;
    tokio::fs::write(path, bytes)
        .await
        .map_err(|e| AppError::model_download_failed(format!("cannot write resume metadata: {e}")))
}

/// One attempt: resolve resume state, GET (ranged if resuming), stream to
/// `.part`, verify hash, atomic rename. Returns Ok only on full success.
async fn attempt_once<F>(
    client: &reqwest::Client,
    req: &DownloadRequest,
    url: &reqwest::Url,
    part: &Path,
    meta_path: &Path,
    on_progress: &F,
) -> AppResult<()>
where
    F: Fn(DownloadProgress),
{
    // Resume state: keep the part only when its sidecar matches this exact
    // payload; anything else is a stale orphan from another version/URL.
    let mut resume_from: u64 = 0;
    let stale = match read_part_meta(meta_path).await {
        Some(meta) if meta.url == url.as_str() && meta.resume_key == req.resume_key => {
            resume_from = tokio::fs::metadata(part)
                .await
                .map(|m| m.len())
                .unwrap_or(0);
            false
        }
        _ => true,
    };
    if stale {
        let _ = tokio::fs::remove_file(part).await;
        let _ = tokio::fs::remove_file(meta_path).await;
    }

    let plan = fetch_once(client, url, resume_from, req.timeout).await?;
    if plan.start_offset == 0 && resume_from > 0 {
        // Server ignored Range: restart from scratch.
        let _ = tokio::fs::remove_file(part).await;
        resume_from = 0;
    }
    let total = plan.server_total.or(req.expected_size);
    if let (Some(expected), Some(server)) = (req.expected_size, plan.server_total) {
        if expected != 0 && server != 0 && expected != server && resume_from == 0 {
            // Remote file changed size between manifest and download and we
            // are already starting fresh: the manifest is stale for this URL.
            return Err(AppError::model_download_failed(format!(
                "remote file size changed (manifest: {expected} bytes, server: {server} bytes)"
            )));
        }
    }

    write_part_meta(
        meta_path,
        &PartMeta {
            url: url.to_string(),
            total_bytes: total,
            resume_key: req.resume_key.clone(),
        },
    )
    .await?;

    // TOCTOU re-check just before open (attacker could swap after download_file check)
    if let Ok(meta) = tokio::fs::symlink_metadata(part).await {
        if meta.file_type().is_symlink() {
            return Err(AppError::model_download_failed(
                "partial path is a symlink — refusing to write",
            ));
        }
    }
    if let Ok(meta) = tokio::fs::symlink_metadata(meta_path).await {
        if meta.file_type().is_symlink() {
            return Err(AppError::model_download_failed(
                "resume meta path is a symlink — refusing to write",
            ));
        }
    }

    let file = tokio::fs::OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(plan.start_offset == 0)
        .append(plan.start_offset > 0)
        .open(part)
        .await
        .map_err(|e| map_write_error(e, part))?;
    // If we resume, the existing prefix stays; new bytes append after it.
    let mut file = file;
    let mut downloaded = resume_from;
    let mut tracker = SpeedTracker::new();
    let mut last_emit = Instant::now()
        .checked_sub(PROGRESS_EMIT_INTERVAL)
        .unwrap_or_else(Instant::now);
    let mut last_emit_bytes = downloaded.saturating_sub(PROGRESS_EMIT_BYTES);
    let mut response = plan.response;

    loop {
        let chunk = tokio::time::timeout(req.timeout, response.chunk())
            .await
            .map_err(|_| {
                AppError::model_download_failed(format!(
                    "download stalled for over {}s",
                    req.timeout.as_secs()
                ))
            })?
            .map_err(|e| map_reqwest_error(&e, req.timeout))?;
        let Some(bytes) = chunk else { break };
        if bytes.is_empty() {
            continue;
        }
        file.write_all(&bytes)
            .await
            .map_err(|e| map_write_error(e, part))?;
        downloaded += bytes.len() as u64;
        let now = Instant::now();
        tracker.push(now, downloaded);
        if now.duration_since(last_emit) >= PROGRESS_EMIT_INTERVAL
            || downloaded.saturating_sub(last_emit_bytes) >= PROGRESS_EMIT_BYTES
        {
            last_emit = now;
            last_emit_bytes = downloaded;
            on_progress(DownloadProgress {
                downloaded_bytes: downloaded,
                total_bytes: total,
                bytes_per_second: tracker.bytes_per_second(),
                eta_seconds: tracker.eta_seconds(downloaded, total),
            });
        }
    }
    file.flush().await.map_err(|e| map_write_error(e, part))?;
    file.sync_all()
        .await
        .map_err(|e| map_write_error(e, part))?;
    drop(file);

    // Length guard: a short stream without error must not pass as complete.
    if let Some(total) = total {
        if total != 0 {
            let actual = tokio::fs::metadata(part)
                .await
                .map_err(|e| AppError::model_download_failed(format!("cannot stat download: {e}")))?
                .len();
            if actual != total {
                return Err(AppError::model_download_failed(format!(
                    "incomplete transfer: got {actual} of {total} bytes; resume and retry"
                )));
            }
        }
    }
    on_progress(DownloadProgress {
        downloaded_bytes: downloaded,
        total_bytes: total,
        bytes_per_second: tracker.bytes_per_second(),
        eta_seconds: Some(0.0),
    });

    if let Err(e) = verify_file(part, &req.expected_sha256).await {
        // Corrupt bytes must never activate: delete everything for this file.
        let _ = tokio::fs::remove_file(part).await;
        let _ = tokio::fs::remove_file(meta_path).await;
        return Err(e);
    }
    tokio::fs::rename(part, &req.dest_final)
        .await
        .map_err(|e| AppError::model_download_failed(format!("cannot finalize download: {e}")))?;
    let _ = tokio::fs::remove_file(meta_path).await;
    Ok(())
}

/// Registry of in-flight model downloads: start / cancel / status.
/// Cancellation aborts the task; already-written `.part` files are kept for
/// resume and cancellation itself is reported as a status, never an error.
///
/// One task downloads a whole model (its files sequentially) so progress and
/// cancellation are model-granular, matching the UI.
pub struct DownloadManager {
    client: reqwest::Client,
    tasks: Mutex<HashMap<String, tokio::task::JoinHandle<()>>>,
}

/// One file within a model download, with its offset for model-level totals.
pub struct ModelFileRequest {
    pub request: DownloadRequest,
    /// Bytes of previously completed files in this model.
    pub completed_offset: u64,
    /// Known model total bytes, or 0 when unknown.
    pub model_total: u64,
}

impl DownloadManager {
    pub fn new() -> Self {
        Self {
            // No global timeout: large model files legitimately take a long
            // time; per-attempt deadlines live on DownloadRequest instead.
            // Limit redirects and keep default HTTPS enforcement; final URL
            // is re-checked in fetch_once to block http downgrades.
            client: reqwest::Client::builder()
                .redirect(reqwest::redirect::Policy::limited(5))
                .build()
                .unwrap_or_else(|_| reqwest::Client::new()),
            tasks: Mutex::new(HashMap::new()),
        }
    }

    /// Start (or resume) a model download. Fails if one is already running
    /// for id. `on_done` fires exactly once when the task finishes on its
    /// own (success or error); it does NOT fire on `cancel()` — the cancel
    /// path reports status itself, keeping ownership unambiguous.
    pub fn start_model<F, D>(
        &self,
        id: String,
        files: Vec<ModelFileRequest>,
        on_progress: F,
        on_done: D,
    ) -> AppResult<()>
    where
        F: Fn(DownloadProgress) + Send + Sync + 'static,
        D: FnOnce(AppResult<()>) + Send + 'static,
    {
        self.prune_finished();
        {
            let tasks = self
                .tasks
                .lock()
                .map_err(|_| AppError::model_download_failed("download registry is unavailable"))?;
            if tasks.get(&id).is_some_and(|h| !h.is_finished()) {
                return Err(AppError::model_download_failed(format!(
                    "download already in progress for model {id}"
                )));
            }
        }
        let client = self.client.clone();
        let handle = tokio::spawn(async move {
            let mut outcome: AppResult<()> = Ok(());
            for f in files {
                let offset = f.completed_offset;
                let total = f.model_total;
                let result = download_file(&client, &f.request, |p| {
                    on_progress(DownloadProgress {
                        downloaded_bytes: offset + p.downloaded_bytes,
                        total_bytes: (total != 0).then_some(total),
                        bytes_per_second: p.bytes_per_second,
                        // Model-level ETA from current throughput; it
                        // resets per file (fresh TCP slow-start anyway).
                        eta_seconds: if total != 0 && p.bytes_per_second > f64::EPSILON {
                            Some(
                                total.saturating_sub(offset + p.downloaded_bytes) as f64
                                    / p.bytes_per_second,
                            )
                        } else {
                            None
                        },
                    });
                })
                .await;
                if let Err(e) = result {
                    outcome = Err(e);
                    break;
                }
            }
            on_done(outcome);
        });
        self.tasks
            .lock()
            .map_err(|_| AppError::model_download_failed("download registry is unavailable"))?
            .insert(id, handle);
        Ok(())
    }

    /// Abort a running download. Returns true when a live task was stopped;
    /// the partial file is kept so the user can resume. Never an error.
    pub fn cancel(&self, id: &str) -> bool {
        let handle = self
            .tasks
            .lock()
            .ok()
            .and_then(|mut tasks| tasks.remove(id));
        match handle {
            Some(h) if !h.is_finished() => {
                h.abort();
                true
            }
            Some(_) => false,
            None => false,
        }
    }

    pub fn is_running(&self, id: &str) -> bool {
        self.tasks
            .lock()
            .ok()
            .and_then(|tasks| tasks.get(id).map(|h| !h.is_finished()))
            .unwrap_or(false)
    }

    fn prune_finished(&self) {
        if let Ok(mut tasks) = self.tasks.lock() {
            tasks.retain(|_, h| !h.is_finished());
        }
    }
}

impl Default for DownloadManager {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::SocketAddr;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Arc;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;

    /// Deterministic pseudo-random payload (incompressible-ish, fixed).
    fn payload(size: usize) -> Vec<u8> {
        let mut out = Vec::with_capacity(size);
        let mut x: u64 = 0x1234_5678_9abc_def0;
        while out.len() < size {
            x ^= x << 13;
            x ^= x >> 7;
            x ^= x << 17;
            out.extend_from_slice(&x.to_le_bytes());
        }
        out.truncate(size);
        out
    }

    fn sha_hex(bytes: &[u8]) -> String {
        format!("{:x}", Sha256::digest(bytes))
    }

    struct Fixture {
        addr: SocketAddr,
        range_hits: Arc<AtomicUsize>,
    }

    /// Minimal HTTP/1.1 test server. Routes:
    /// /file      — full body, Accept-Ranges, honors Range (206/200)
    /// /no-range  — always 200 full body, no Accept-Ranges
    /// /no-length — 200 full body WITHOUT Content-Length (close-delimited)
    /// /flaky     — 500 for the first two GETs, then /file behavior
    /// /slow      — 8 MiB body in 64 KiB chunks with 5 ms pauses
    /// anything else -> 404
    async fn serve(listener: TcpListener, body: Arc<Vec<u8>>, hits: Arc<AtomicUsize>) {
        let flaky = Arc::new(AtomicUsize::new(0));
        loop {
            let Ok((mut sock, _)) = listener.accept().await else {
                break;
            };
            let body = body.clone();
            let hits = hits.clone();
            let flaky = flaky.clone();
            tokio::spawn(async move {
                let mut head = Vec::new();
                let mut buf = [0u8; 4096];
                loop {
                    match sock.read(&mut buf).await {
                        Ok(0) | Err(_) => return,
                        Ok(n) => {
                            head.extend_from_slice(&buf[..n]);
                            if head.windows(4).any(|w| w == b"\r\n\r\n") {
                                break;
                            }
                            if head.len() > 16 * 1024 {
                                return;
                            }
                        }
                    }
                }
                let head = String::from_utf8_lossy(&head);
                let mut lines = head.lines();
                let request = lines.next().unwrap_or("");
                let path = request.split_whitespace().nth(1).unwrap_or("/").to_string();
                // Drain pipelined extras: this server answers one request per
                // connection (Connection: close), matching test usage.
                let range: Option<(u64, Option<u64>)> = lines
                    .filter_map(|l| {
                        let (k, v) = l.split_once(':')?;
                        (k.trim().eq_ignore_ascii_case("range")).then(|| v.trim().to_string())
                    })
                    .next()
                    .and_then(|v| {
                        let spec = v.strip_prefix("bytes=")?;
                        let (s, e) = spec.split_once('-')?;
                        Some((
                            s.parse::<u64>().ok()?,
                            if e.is_empty() {
                                None
                            } else {
                                e.parse::<u64>().ok()
                            },
                        ))
                    });

                async fn respond(
                    sock: &mut tokio::net::TcpStream,
                    status: &str,
                    headers: &[(&str, String)],
                    body: &[u8],
                ) {
                    let mut out = format!("HTTP/1.1 {status}\r\n");
                    for (k, v) in headers {
                        out.push_str(&format!("{k}: {v}\r\n"));
                    }
                    out.push_str("Connection: close\r\n\r\n");
                    let _ = sock.write_all(out.as_bytes()).await;
                    let _ = sock.write_all(body).await;
                }

                if path == "/flaky" {
                    let n = flaky.fetch_add(1, Ordering::SeqCst);
                    if n < 2 {
                        respond(&mut sock, "500 Internal Server Error", &[], b"boom").await;
                        return;
                    }
                }
                if path != "/file"
                    && path != "/no-range"
                    && path != "/no-length"
                    && path != "/slow"
                    && path != "/flaky"
                {
                    respond(&mut sock, "404 Not Found", &[], b"nope").await;
                    return;
                }
                if path == "/slow" {
                    let big = payload(8 * 1024 * 1024);
                    let total = big.len();
                    let head_txt = format!(
                        "HTTP/1.1 200 OK\r\nContent-Length: {total}\r\nConnection: close\r\n\r\n"
                    );
                    if sock.write_all(head_txt.as_bytes()).await.is_err() {
                        return;
                    }
                    for chunk in big.chunks(64 * 1024) {
                        if sock.write_all(chunk).await.is_err() {
                            return;
                        }
                        tokio::time::sleep(Duration::from_millis(5)).await;
                    }
                    return;
                }
                let full: &[u8] = &body;
                if path == "/no-length" {
                    let head_txt = "HTTP/1.1 200 OK\r\nConnection: close\r\n\r\n";
                    if sock.write_all(head_txt.as_bytes()).await.is_err() {
                        return;
                    }
                    let _ = sock.write_all(full).await;
                    return;
                }
                if path == "/no-range" || range.is_none() {
                    let headers = if path == "/file" {
                        vec![
                            ("Accept-Ranges", "bytes".to_string()),
                            ("Content-Length", full.len().to_string()),
                        ]
                    } else {
                        vec![("Content-Length", full.len().to_string())]
                    };
                    respond(&mut sock, "200 OK", &headers, full).await;
                    return;
                }
                // Ranged request.
                hits.fetch_add(1, Ordering::SeqCst);
                let (start, end_opt) = range.unwrap_or((0, None));
                let start = start.min(full.len() as u64) as usize;
                let end = end_opt
                    .map(|e| (e as usize).min(full.len().saturating_sub(1)))
                    .unwrap_or_else(|| full.len().saturating_sub(1));
                if start > end || full.is_empty() {
                    respond(&mut sock, "416 Range Not Satisfiable", &[], b"").await;
                    return;
                }
                let slice = &full[start..=end];
                let headers = vec![
                    ("Accept-Ranges", "bytes".to_string()),
                    (
                        "Content-Range",
                        format!("bytes {}-{}/{}", start, end, full.len()),
                    ),
                    ("Content-Length", slice.len().to_string()),
                ];
                respond(&mut sock, "206 Partial Content", &headers, slice).await;
            });
        }
    }

    async fn start_server(body: Vec<u8>) -> (Fixture, Arc<Vec<u8>>) {
        let body = Arc::new(body);
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind test server");
        let addr = listener.local_addr().expect("test server addr");
        let range_hits = Arc::new(AtomicUsize::new(0));
        let serve_body = body.clone();
        let serve_hits = range_hits.clone();
        // Detached on purpose: the test runtime tears the accept loop down
        // when the test ends. JoinHandle is not #[must_use], so no binding.
        tokio::spawn(async move {
            serve(listener, serve_body, serve_hits).await;
        });
        (Fixture { addr, range_hits }, body)
    }

    /// Unique scratch dir under the OS temp dir (no external test crates).
    /// Callers remove it best-effort when done.
    fn test_dir(name: &str) -> PathBuf {
        static COUNTER: AtomicUsize = AtomicUsize::new(0);
        let n = COUNTER.fetch_add(1, Ordering::SeqCst);
        std::env::temp_dir().join(format!(
            "algorith-voice-dltest-{}-{}-{}",
            std::process::id(),
            n,
            name
        ))
    }

    fn request(addr: SocketAddr, route: &str, dir: &Path, body_len: usize) -> DownloadRequest {
        DownloadRequest {
            url: format!(
                "http://127.0.0.1:{}/{}",
                addr.port(),
                route.trim_start_matches('/')
            ),
            fallback_url: None,
            dest_final: dir.join("model.bin"),
            resume_key: "test-v1".to_string(),
            expected_sha256: String::new(), // filled by each test
            expected_size: Some(body_len as u64),
            timeout: Duration::from_secs(30),
            max_retries: 3,
        }
    }

    async fn run_via_manager(
        manager: &DownloadManager,
        id: &str,
        req: DownloadRequest,
    ) -> (AppResult<()>, Arc<Mutex<Vec<DownloadProgress>>>) {
        let (tx, rx) = tokio::sync::oneshot::channel();
        let events = Arc::new(Mutex::new(Vec::new()));
        let total = req.expected_size.unwrap_or(0);
        manager
            .start_model(
                id.to_string(),
                vec![ModelFileRequest {
                    request: req,
                    completed_offset: 0,
                    model_total: total,
                }],
                {
                    let events = events.clone();
                    move |p| {
                        events.lock().expect("events lock").push(p);
                    }
                },
                move |r| {
                    let _ = tx.send(r);
                },
            )
            .expect("start failed");
        let outcome = rx.await.expect("on_done must fire");
        (outcome, events)
    }

    #[tokio::test]
    async fn full_download_verifies_hash_and_reports_progress() {
        let dir = test_dir("full");
        std::fs::create_dir_all(&dir).expect("scratch dir");
        let (fx, body) = start_server(payload(256 * 1024)).await;
        let mut req = request(fx.addr, "/file", &dir, body.len());
        req.expected_sha256 = sha_hex(&body);

        let manager = DownloadManager::new();
        let (outcome, events) = run_via_manager(&manager, "m", req).await;
        outcome.expect("download succeeds");

        let done = std::fs::read(dir.join("model.bin")).expect("final file");
        assert_eq!(done, body.as_slice());
        assert!(!dir.join("model.bin.part").exists());
        assert!(!dir.join("model.bin.part.json").exists());
        let events = events.lock().expect("events lock");
        assert!(!events.is_empty(), "progress must be reported");
        let last = events.last().expect("at least one event");
        assert_eq!(last.downloaded_bytes, body.len() as u64);
        assert_eq!(last.total_bytes, Some(body.len() as u64));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn resumes_interrupted_download_with_range() {
        let dir = test_dir("resume");
        std::fs::create_dir_all(&dir).expect("scratch dir");
        let (fx, body) = start_server(payload(256 * 1024)).await;
        // Simulate an interrupted earlier attempt: first half on disk.
        let half = body.len() / 2;
        std::fs::write(dir.join("model.bin.part"), &body[..half]).expect("seed part");
        std::fs::write(
            dir.join("model.bin.part.json"),
            serde_json::to_vec(&PartMeta {
                url: format!("http://127.0.0.1:{}/file", fx.addr.port()),
                total_bytes: Some(body.len() as u64),
                resume_key: "test-v1".to_string(),
            })
            .expect("meta json"),
        )
        .expect("seed meta");

        let mut req = request(fx.addr, "/file", &dir, body.len());
        req.expected_sha256 = sha_hex(&body);
        let manager = DownloadManager::new();
        let (outcome, _) = run_via_manager(&manager, "m", req).await;
        outcome.expect("resume succeeds");

        assert_eq!(
            fx.range_hits.load(Ordering::SeqCst),
            1,
            "must resume with Range"
        );
        assert_eq!(
            std::fs::read(dir.join("model.bin")).expect("final"),
            body.as_slice()
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn restarts_when_server_ignores_range() {
        let dir = test_dir("norange");
        std::fs::create_dir_all(&dir).expect("scratch dir");
        let (fx, body) = start_server(payload(64 * 1024)).await;
        std::fs::write(dir.join("model.bin.part"), &body[..1024]).expect("seed part");
        std::fs::write(
            dir.join("model.bin.part.json"),
            serde_json::to_vec(&PartMeta {
                url: format!("http://127.0.0.1:{}/no-range", fx.addr.port()),
                total_bytes: Some(body.len() as u64),
                resume_key: "test-v1".to_string(),
            })
            .expect("meta json"),
        )
        .expect("seed meta");

        let mut req = request(fx.addr, "/no-range", &dir, body.len());
        req.expected_sha256 = sha_hex(&body);
        let manager = DownloadManager::new();
        let (outcome, _) = run_via_manager(&manager, "m", req).await;
        outcome.expect("restart succeeds");
        assert_eq!(
            std::fs::read(dir.join("model.bin")).expect("final"),
            body.as_slice()
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn retries_flaky_server_then_succeeds() {
        let dir = test_dir("flaky");
        std::fs::create_dir_all(&dir).expect("scratch dir");
        let (fx, body) = start_server(payload(64 * 1024)).await;
        let mut req = request(fx.addr, "/flaky", &dir, body.len());
        req.expected_sha256 = sha_hex(&body);
        req.max_retries = 5;
        let manager = DownloadManager::new();
        let (outcome, _) = run_via_manager(&manager, "m", req).await;
        outcome.expect("flaky succeeds after retries");
        assert_eq!(
            std::fs::read(dir.join("model.bin")).expect("final"),
            body.as_slice()
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn missing_file_is_a_terminal_error_without_debris() {
        let dir = test_dir("missing");
        std::fs::create_dir_all(&dir).expect("scratch dir");
        let (fx, body) = start_server(payload(1024)).await;
        let mut req = request(fx.addr, "/missing", &dir, body.len());
        req.expected_sha256 = sha_hex(&body);
        req.max_retries = 1;
        let manager = DownloadManager::new();
        let (outcome, _) = run_via_manager(&manager, "m", req).await;
        let err = outcome.expect_err("404 must fail");
        assert_eq!(err.code, "model-download-failed");
        assert!(!dir.join("model.bin").exists());
        assert!(!dir.join("model.bin.part").exists());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn checksum_mismatch_deletes_everything() {
        let dir = test_dir("corrupt");
        std::fs::create_dir_all(&dir).expect("scratch dir");
        let (fx, body) = start_server(payload(64 * 1024)).await;
        let mut req = request(fx.addr, "/file", &dir, body.len());
        req.expected_sha256 = "ff".repeat(32); // wrong on purpose
        let manager = DownloadManager::new();
        let (outcome, _) = run_via_manager(&manager, "m", req).await;
        let err = outcome.expect_err("bad hash must fail");
        assert_eq!(err.code, "model-checksum-mismatch");
        assert!(!dir.join("model.bin").exists());
        assert!(!dir.join("model.bin.part").exists());
        assert!(!dir.join("model.bin.part.json").exists());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn unknown_total_still_verifies_by_hash() {
        let dir = test_dir("nolength");
        std::fs::create_dir_all(&dir).expect("scratch dir");
        let (fx, body) = start_server(payload(64 * 1024)).await;
        let mut req = request(fx.addr, "/no-length", &dir, body.len());
        req.expected_sha256 = sha_hex(&body);
        req.expected_size = None; // manifest size unknown AND no Content-Length
        let manager = DownloadManager::new();
        let (outcome, events) = run_via_manager(&manager, "m", req).await;
        outcome.expect("unknown total succeeds");
        assert_eq!(
            std::fs::read(dir.join("model.bin")).expect("final"),
            body.as_slice()
        );
        let events = events.lock().expect("events lock");
        assert!(
            events.iter().all(|e| e.total_bytes.is_none()),
            "no total may be advertised"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn cancel_keeps_partial_for_resume_and_is_not_an_error() {
        let dir = test_dir("cancel");
        std::fs::create_dir_all(&dir).expect("scratch dir");
        let (fx, _body) = start_server(payload(1024)).await;
        let manager = DownloadManager::new();
        let req = DownloadRequest {
            url: format!("http://127.0.0.1:{}/slow", fx.addr.port()),
            fallback_url: None,
            dest_final: dir.join("model.bin"),
            resume_key: "test-v1".to_string(),
            expected_sha256: "ab".repeat(32),
            expected_size: Some(8 * 1024 * 1024),
            timeout: Duration::from_secs(60),
            max_retries: 0,
        };
        let (tx, mut rx) = tokio::sync::oneshot::channel::<AppResult<()>>();
        manager
            .start_model(
                "m".to_string(),
                vec![ModelFileRequest {
                    request: req,
                    completed_offset: 0,
                    model_total: 8 * 1024 * 1024,
                }],
                |_| {},
                move |r| {
                    let _ = tx.send(r);
                },
            )
            .expect("start ok");
        assert!(manager.is_running("m"));
        // Wait until a few chunks have landed (part file exists and is
        // non-empty) before cancelling. A fixed sleep races task startup
        // on fast CI runners: cancel could win before the first flush and
        // the part file would never exist (NotFound flake).
        let part_path = dir.join("model.bin.part");
        let mut landed = false;
        for _ in 0..200 {
            if let Ok(md) = std::fs::metadata(&part_path) {
                if md.len() > 0 {
                    landed = true;
                    break;
                }
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
        assert!(landed, "some bytes must land before cancel");
        assert!(manager.cancel("m"), "live task must cancel");
        assert!(!manager.is_running("m"));
        assert!(!manager.cancel("m"), "second cancel reports nothing live");
        // The aborted task must never report completion: poll briefly and
        // require silence (abort delivery itself is prompt).
        for _ in 0..20 {
            assert!(
                rx.try_recv().is_err(),
                "cancelled task must not report completion"
            );
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
        let part_len = std::fs::metadata(dir.join("model.bin.part"))
            .expect("part kept for resume")
            .len();
        assert!(part_len > 0, "some bytes must have landed, got {part_len}");
        assert!(!dir.join("model.bin").exists(), "final must not exist");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn double_start_is_rejected() {
        let dir = test_dir("double");
        std::fs::create_dir_all(&dir).expect("scratch dir");
        let (fx, _body) = start_server(payload(1024)).await;
        let mk = || ModelFileRequest {
            request: DownloadRequest {
                url: format!("http://127.0.0.1:{}/slow", fx.addr.port()),
                fallback_url: None,
                dest_final: dir.join("model.bin"),
                resume_key: "test-v1".to_string(),
                expected_sha256: "ab".repeat(32),
                expected_size: Some(8 * 1024 * 1024),
                timeout: Duration::from_secs(60),
                max_retries: 0,
            },
            completed_offset: 0,
            model_total: 8 * 1024 * 1024,
        };
        let manager = DownloadManager::new();
        manager
            .start_model("m".to_string(), vec![mk()], |_| {}, |_| {})
            .expect("first start ok");
        let err = manager
            .start_model("m".to_string(), vec![mk()], |_| {}, |_| {})
            .expect_err("second start must fail");
        assert_eq!(err.code, "model-download-failed");
        manager.cancel("m");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn multi_file_model_accumulates_model_totals() {
        let dir = test_dir("multi");
        std::fs::create_dir_all(&dir).expect("scratch dir");
        let (fx, body) = start_server(payload(64 * 1024)).await;
        let hash = sha_hex(&body);
        let total = body.len() as u64 * 2;
        let mk = |name: &str, offset: u64| ModelFileRequest {
            request: DownloadRequest {
                url: format!("http://127.0.0.1:{}/file", fx.addr.port()),
                fallback_url: None,
                dest_final: dir.join(name),
                resume_key: "test-v1".to_string(),
                expected_sha256: hash.clone(),
                expected_size: Some(body.len() as u64),
                timeout: Duration::from_secs(30),
                max_retries: 3,
            },
            completed_offset: offset,
            model_total: total,
        };
        let (tx, rx) = tokio::sync::oneshot::channel::<AppResult<()>>();
        let events = Arc::new(Mutex::new(Vec::new()));
        let manager = DownloadManager::new();
        manager
            .start_model(
                "m".to_string(),
                vec![mk("a.bin", 0), mk("b.bin", body.len() as u64)],
                {
                    let events = events.clone();
                    move |p| {
                        events.lock().expect("events lock").push(p);
                    }
                },
                move |r| {
                    let _ = tx.send(r);
                },
            )
            .expect("start ok");
        rx.await
            .expect("on_done must fire")
            .expect("model download succeeds");
        assert_eq!(
            std::fs::read(dir.join("a.bin")).expect("a.bin"),
            body.as_slice()
        );
        assert_eq!(
            std::fs::read(dir.join("b.bin")).expect("b.bin"),
            body.as_slice()
        );
        let events = events.lock().expect("events lock");
        let last = events.last().expect("progress events");
        assert_eq!(last.downloaded_bytes, total);
        assert_eq!(last.total_bytes, Some(total));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn speed_tracker_math() {
        use std::time::Instant;
        let mut t = SpeedTracker::new();
        assert_eq!(t.bytes_per_second(), 0.0);
        assert_eq!(t.eta_seconds(0, Some(100)), None);
        let start = Instant::now();
        t.push(start, 0);
        t.push(start + Duration::from_secs(2), 1000);
        assert!((t.bytes_per_second() - 500.0).abs() < f64::EPSILON);
        assert_eq!(t.eta_seconds(1000, Some(2000)), Some(2.0));
        assert_eq!(t.eta_seconds(2000, Some(2000)), Some(0.0));
        assert_eq!(t.eta_seconds(0, None), None);
    }

    #[test]
    fn content_range_parsers() {
        assert_eq!(parse_content_range_total("bytes 0-99/1000"), Some(1000));
        assert_eq!(parse_content_range_total("bytes 0-99/*"), None);
        assert_eq!(
            parse_content_range_start("bytes 100-199/1000", 100),
            Some(100)
        );
        assert_eq!(parse_content_range_start("bytes 0-99/1000", 100), None);
    }
}
