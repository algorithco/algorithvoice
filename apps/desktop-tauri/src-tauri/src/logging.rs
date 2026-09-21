//! Minimal structured file logging (std-only, no new dependency).
//!
//! Judgment call: the task suggests `tracing` + rolling appender, but the
//! backend already has zero logging deps and startup must stay infallible.
//! This module appends JSONL events to `<app_data>/logs/algorith-voice.log`
//! with a 5 MB size cap (rotates to `.1`). If richer query/filtering is
//! needed later, migrate to `tracing` + `tracing-appender` — the
//! `log_event()` call sites already carry structured fields.
//!
//! Covered at minimum: auth flow, model download/verify failures, hotkey
//! registration failures, DB errors, frontend errors (via command).

use std::path::PathBuf;
use tauri::{AppHandle, Manager};

const LOG_FILE: &str = "algorith-voice.log";
const MAX_LOG_BYTES: u64 = 5 * 1024 * 1024;

pub fn log_dir(app: &AppHandle) -> PathBuf {
    app.path()
        .app_data_dir()
        .map(|d| d.join("logs"))
        .unwrap_or_else(|_| std::env::temp_dir().join("algorith-voice-logs"))
}

fn log_file(app: &AppHandle) -> PathBuf {
    log_dir(app).join(LOG_FILE)
}

fn escape_json(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 2);
    for c in s.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if (c as u32) < 0x20 => {
                out.push_str(&format!("\\u{:04x}", c as u32));
            }
            c => out.push(c),
        }
    }
    out
}

/// Append one JSONL event. Never panics, never blocks the caller on I/O errors.
pub fn log_event(app: &AppHandle, area: &str, event: &str, detail: &str) {
    let dir = log_dir(app);
    let _ = std::fs::create_dir_all(&dir);
    // Ensure log dir is 0700 on unix so logs are not world-readable.
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt as _;
        let _ = std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o700));
    }
    let path = dir.join(LOG_FILE);
    if let Ok(meta) = std::fs::metadata(&path) {
        if meta.len() > MAX_LOG_BYTES {
            let backup = dir.join(format!("{LOG_FILE}.1"));
            let _ = std::fs::remove_file(&backup);
            let _ = std::fs::rename(&path, &backup);
        }
    }
    let ts = chrono::Utc::now().to_rfc3339();
    // Truncate after escaping to avoid post-escape overflow; keep stack last
    // so it is not the first to be cut — area/event are small.
    let escaped_detail = escape_json(detail);
    let truncated_detail: String = escaped_detail.chars().take(2000).collect();
    let line = format!(
        "{{\"ts\":\"{ts}\",\"area\":\"{}\",\"event\":\"{}\",\"detail\":\"{}\"}}\n",
        escape_json(area),
        escape_json(event),
        truncated_detail,
    );
    use std::io::Write as _;
    if let Ok(mut f) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
    {
        let _ = f.write_all(line.as_bytes());
        let _ = f.sync_all();
    }
    eprintln!("algorith-voice [{area}/{event}]: {detail}");
}

pub fn read_recent_logs(app: &AppHandle, max_bytes: u64) -> String {
    let max = max_bytes.clamp(1024, 1_000_000) as usize;
    let dir = log_dir(app);
    let current = dir.join(LOG_FILE);
    let backup = dir.join(format!("{LOG_FILE}.1"));
    let mut combined = Vec::new();
    if let Ok(b) = std::fs::read(&backup) {
        combined.extend_from_slice(&b);
        if !combined.is_empty() && combined[combined.len() - 1] != b'\n' {
            combined.push(b'\n');
        }
    }
    if let Ok(b) = std::fs::read(&current) {
        combined.extend_from_slice(&b);
    }
    if combined.is_empty() {
        return format!(
            "no logs yet ({})",
            std::fs::read(&current).unwrap_err().to_string()
        );
    }
    let start = combined.len().saturating_sub(max);
    String::from_utf8_lossy(&combined[start..]).into_owned()
}
