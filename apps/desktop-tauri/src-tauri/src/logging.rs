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
    let path = dir.join(LOG_FILE);
    // Size-cap rotation: keep current + one backup.
    if let Ok(meta) = std::fs::metadata(&path) {
        if meta.len() > MAX_LOG_BYTES {
            let backup = dir.join(format!("{LOG_FILE}.1"));
            let _ = std::fs::remove_file(&backup);
            let _ = std::fs::rename(&path, &backup);
        }
    }
    let ts = chrono::Utc::now().to_rfc3339();
    let line = format!(
        "{{\"ts\":\"{ts}\",\"area\":\"{}\",\"event\":\"{}\",\"detail\":\"{}\"}}\n",
        escape_json(area),
        escape_json(event),
        escape_json(detail.chars().take(2000).collect::<String>().as_str()),
    );
    use std::io::Write as _;
    if let Ok(mut f) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
    {
        let _ = f.write_all(line.as_bytes());
    }
    eprintln!("algorith-voice [{area}/{event}]: {detail}");
}

pub fn read_recent_logs(app: &AppHandle, max_bytes: u64) -> String {
    let path = log_file(app);
    let max = max_bytes.clamp(1024, 1_000_000) as usize;
    match std::fs::read(&path) {
        Ok(bytes) => {
            let start = bytes.len().saturating_sub(max);
            String::from_utf8_lossy(&bytes[start..]).into_owned()
        }
        Err(e) => format!("no logs yet ({e})"),
    }
}
