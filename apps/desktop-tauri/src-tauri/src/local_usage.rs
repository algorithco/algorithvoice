//! Local-AI usage ledger (desktop-only, zero network).
//!
//! Every completed on-device transcription appends one row of *numbers only*
//! (model id, engine, audio seconds, transcript chars/words, timestamp) to
//! the local SQLite DB. Audio bytes and transcript text are never stored
//! here — the ledger answers "how much local AI did I use?" without
//! retaining anything the user said. Nothing in this module touches the
//! network; the summary/clear commands built on it (increment 2) stay
//! pure-local too.
//!
//! `prompt_tokens` / `completion_tokens` are reserved (always NULL for STT:
//! speech models have no tokens) so a future local LLM can reuse this table
//! and its UI with no migration.

use crate::error::{AppError, AppResult};
use crate::local_asr::manifest::ModelEngine;
use crate::state::Db;
use serde::Serialize;

pub fn engine_label(engine: ModelEngine) -> &'static str {
    match engine {
        ModelEngine::SherpaOnnx => "sherpa-onnx",
        ModelEngine::WhisperCpp => "whisper-cpp",
    }
}

/// Unicode-whitespace word split — the same rule as `history_stats`
/// (`split_whitespace`), so both UIs count identically. Punctuation stays
/// attached; deterministic across Rust and Swift by construction.
pub fn count_words(text: &str) -> i64 {
    text.split_whitespace().count() as i64
}

/// Character count in Unicode scalar terms (`chars`, not bytes), so CJK and
/// emoji-heavy transcripts are measured honestly.
pub fn count_chars(text: &str) -> i64 {
    text.chars().count() as i64
}

/// Append one usage row. Best-effort by contract: callers log the error and
/// keep the transcript — a ledger write must never fail a transcription.
pub fn record_local_usage(
    db: &Db,
    model_id: &str,
    engine: ModelEngine,
    audio_seconds: f64,
    text: &str,
) -> AppResult<()> {
    let id = uuid::Uuid::new_v4().to_string();
    let recorded_at = chrono::Utc::now().to_rfc3339();
    let conn = db.0.lock().map_err(|_| AppError::store("db lock"))?;
    conn.execute(
        "INSERT INTO local_ai_usage
           (id, recorded_at, model_id, engine, audio_seconds,
            text_chars, text_words, prompt_tokens, completion_tokens)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, NULL, NULL)",
        rusqlite::params![
            id,
            recorded_at,
            model_id,
            engine_label(engine),
            audio_seconds,
            count_chars(text),
            count_words(text),
        ],
    )
    .map_err(|e| AppError::store(e.to_string()))?;
    Ok(())
}

// ---- Query (pure-local; no network by construction) ----

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct LocalModelUsage {
    pub model_id: String,
    pub engine: String,
    pub sessions: i64,
    pub audio_seconds: f64,
    pub text_words: i64,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct LocalUsageSummary {
    pub sessions: i64,
    pub audio_seconds: f64,
    pub text_chars: i64,
    pub text_words: i64,
    pub by_model: Vec<LocalModelUsage>,
}

/// Period filter: `"today" | "7d" | "30d" | "all"` (missing/blank = 30d).
/// Unknown values fail loudly — a caller typo must never silently show the
/// wrong window.
fn period_cutoff(period: Option<&str>) -> AppResult<Option<String>> {
    let now = chrono::Utc::now();
    match period.map(str::trim) {
        None | Some("") | Some("30d") => Ok(Some((now - chrono::Duration::days(30)).to_rfc3339())),
        Some("today") => Ok(Some(today_start(now))),
        Some("7d") => Ok(Some((now - chrono::Duration::days(7)).to_rfc3339())),
        Some("all") => Ok(None),
        Some(other) => Err(AppError::new(
            "usage",
            format!("unknown usage period: {other}"),
        )),
    }
}

/// UTC midnight, same convention (and infallible fallback) as `history_stats`.
fn today_start(now: chrono::DateTime<chrono::Utc>) -> String {
    now.date_naive()
        .and_hms_opt(0, 0, 0)
        .map(|t| t.and_utc().to_rfc3339())
        .unwrap_or_else(|| now.to_rfc3339())
}

pub fn summarize_usage(db: &Db, period: Option<&str>) -> AppResult<LocalUsageSummary> {
    let cutoff = period_cutoff(period)?;
    let conn = db.0.lock().map_err(|_| AppError::store("db lock"))?;
    // Cutoff timestamps are RFC3339 UTC, same as recorded_at, so lexicographic
    // comparison is chronological. COALESCE keeps empty tables at exact zero.
    let (sessions, audio_seconds, text_chars, text_words): (i64, f64, i64, i64) =
        match cutoff.as_deref() {
            Some(since) => conn.query_row(
                "SELECT COUNT(*), COALESCE(SUM(audio_seconds), 0),
                        COALESCE(SUM(text_chars), 0), COALESCE(SUM(text_words), 0)
                 FROM local_ai_usage WHERE recorded_at >= ?1",
                [since],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
            ),
            None => conn.query_row(
                "SELECT COUNT(*), COALESCE(SUM(audio_seconds), 0),
                        COALESCE(SUM(text_chars), 0), COALESCE(SUM(text_words), 0)
                 FROM local_ai_usage",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
            ),
        }
        .map_err(|e| AppError::store(e.to_string()))?;
    let mut stmt = match cutoff.as_deref() {
        Some(_) => conn
            .prepare(
                "SELECT model_id, engine, COUNT(*),
                        COALESCE(SUM(audio_seconds), 0), COALESCE(SUM(text_words), 0)
                 FROM local_ai_usage WHERE recorded_at >= ?1
                 GROUP BY model_id, engine ORDER BY COUNT(*) DESC",
            )
            .map_err(|e| AppError::store(e.to_string()))?,
        None => conn
            .prepare(
                "SELECT model_id, engine, COUNT(*),
                        COALESCE(SUM(audio_seconds), 0), COALESCE(SUM(text_words), 0)
                 FROM local_ai_usage
                 GROUP BY model_id, engine ORDER BY COUNT(*) DESC",
            )
            .map_err(|e| AppError::store(e.to_string()))?,
    };
    let rows = match cutoff.as_deref() {
        Some(since) => stmt
            .query_map([since], |r| {
                Ok(LocalModelUsage {
                    model_id: r.get(0)?,
                    engine: r.get(1)?,
                    sessions: r.get(2)?,
                    audio_seconds: r.get(3)?,
                    text_words: r.get(4)?,
                })
            })
            .map_err(|e| AppError::store(e.to_string()))?,
        None => stmt
            .query_map([], |r| {
                Ok(LocalModelUsage {
                    model_id: r.get(0)?,
                    engine: r.get(1)?,
                    sessions: r.get(2)?,
                    audio_seconds: r.get(3)?,
                    text_words: r.get(4)?,
                })
            })
            .map_err(|e| AppError::store(e.to_string()))?,
    };
    let mut by_model = Vec::new();
    for row in rows {
        by_model.push(row.map_err(|e| AppError::store(e.to_string()))?);
    }
    Ok(LocalUsageSummary {
        sessions,
        audio_seconds,
        text_chars,
        text_words,
        by_model,
    })
}

pub fn clear_usage(db: &Db) -> AppResult<i64> {
    let conn = db.0.lock().map_err(|_| AppError::store("db lock"))?;
    let deleted = conn
        .execute("DELETE FROM local_ai_usage", [])
        .map_err(|e| AppError::store(e.to_string()))?;
    Ok(deleted as i64)
}

// ---- Tauri command surface (thin wrappers; logic stays unit-testable) ----

#[tauri::command]
pub fn local_usage_summary(
    db: tauri::State<'_, Db>,
    period: Option<String>,
) -> AppResult<LocalUsageSummary> {
    summarize_usage(&db, period.as_deref())
}

#[tauri::command]
pub fn local_usage_clear(db: tauri::State<'_, Db>) -> AppResult<i64> {
    clear_usage(&db)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    fn mem_db() -> Db {
        let mut conn = rusqlite::Connection::open_in_memory().expect("mem db");
        crate::db::run_migrations(&mut conn).expect("migrate");
        Db(Mutex::new(conn))
    }

    fn row_count(db: &Db) -> i64 {
        let conn = db.0.lock().expect("lock");
        conn.query_row("SELECT COUNT(*) FROM local_ai_usage", [], |r| r.get(0))
            .expect("count")
    }

    #[test]
    fn word_count_matches_history_convention() {
        assert_eq!(count_words(""), 0);
        assert_eq!(count_words("   \t\n  "), 0);
        assert_eq!(count_words("hello"), 1);
        assert_eq!(count_words("hello world"), 2);
        assert_eq!(count_words("  hello   world  "), 2);
        // Unicode whitespace splits; punctuation stays attached (no stripping).
        assert_eq!(count_words("héllo, wörld!\nnew\tline"), 4);
        assert_eq!(count_words("你好 世界"), 2);
    }

    #[test]
    fn char_count_is_unicode_scalars_not_bytes() {
        assert_eq!(count_chars(""), 0);
        assert_eq!(count_chars("hello"), 5);
        // 2 CJK chars = 6 bytes in UTF-8, but 2 characters.
        assert_eq!(count_chars("你好"), 2);
        assert_eq!(count_chars("hi 👋"), 4);
    }

    #[test]
    fn record_inserts_numbers_only_row() {
        let db = mem_db();
        record_local_usage(
            &db,
            "parakeet-tdt-0.6b-v3",
            ModelEngine::SherpaOnnx,
            2.5,
            "hello world",
        )
        .expect("record");
        assert_eq!(row_count(&db), 1);
        let conn = db.0.lock().expect("lock");
        let (model_id, engine, audio_seconds, text_chars, text_words, prompt, completion): (
            String,
            String,
            f64,
            i64,
            i64,
            Option<i64>,
            Option<i64>,
        ) = conn
            .query_row(
                "SELECT model_id, engine, audio_seconds, text_chars, text_words,
                        prompt_tokens, completion_tokens
                 FROM local_ai_usage",
                [],
                |r| {
                    Ok((
                        r.get(0)?,
                        r.get(1)?,
                        r.get(2)?,
                        r.get(3)?,
                        r.get(4)?,
                        r.get(5)?,
                        r.get(6)?,
                    ))
                },
            )
            .expect("read row");
        assert_eq!(model_id, "parakeet-tdt-0.6b-v3");
        assert_eq!(engine, "sherpa-onnx");
        assert!((audio_seconds - 2.5).abs() < f64::EPSILON);
        assert_eq!(text_chars, 11);
        assert_eq!(text_words, 2);
        // Token columns reserved for a future local LLM: always NULL for STT.
        assert_eq!(prompt, None);
        assert_eq!(completion, None);
        // No transcript text column exists anywhere in this table.
        let cols: Vec<String> = conn
            .prepare("PRAGMA table_info(local_ai_usage)")
            .expect("pragma")
            .query_map([], |r| r.get(1))
            .expect("cols")
            .flatten()
            .collect();
        assert!(!cols.iter().any(|c| c == "transcript" || c == "text"));
    }

    #[test]
    fn record_never_blocks_on_locked_db() {
        // Poison the mutex: record must surface a typed store error (the
        // caller logs it and keeps the transcript) rather than panicking.
        let db = mem_db();
        let poisoned = std::sync::Arc::new(db);
        let clone = poisoned.clone();
        let _ = std::thread::spawn(move || {
            let _guard = clone.0.lock().unwrap();
            panic!("poison");
        })
        .join();
        let err = record_local_usage(&poisoned, "m", ModelEngine::SherpaOnnx, 1.0, "hi")
            .expect_err("poisoned lock must error");
        assert_eq!(err.code, "store");
    }

    // ---- Summary / clear ----

    fn seed_row(
        db: &Db,
        recorded_at: &str,
        model_id: &str,
        engine: &str,
        audio_seconds: f64,
        chars: i64,
        words: i64,
    ) {
        let conn = db.0.lock().expect("lock");
        conn.execute(
            "INSERT INTO local_ai_usage
               (id, recorded_at, model_id, engine, audio_seconds,
                text_chars, text_words, prompt_tokens, completion_tokens)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, NULL, NULL)",
            rusqlite::params![
                uuid::Uuid::new_v4().to_string(),
                recorded_at,
                model_id,
                engine,
                audio_seconds,
                chars,
                words,
            ],
        )
        .expect("seed");
    }

    fn rfc3339_days_ago(days: i64) -> String {
        (chrono::Utc::now() - chrono::Duration::days(days)).to_rfc3339()
    }

    #[test]
    fn empty_table_summarizes_to_exact_zero() {
        let db = mem_db();
        let summary = summarize_usage(&db, None).expect("summarize");
        assert_eq!(
            summary,
            LocalUsageSummary {
                sessions: 0,
                audio_seconds: 0.0,
                text_chars: 0,
                text_words: 0,
                by_model: Vec::new(),
            }
        );
    }

    #[test]
    fn summary_totals_and_groups_by_model() {
        let db = mem_db();
        let now = rfc3339_days_ago(0);
        seed_row(
            &db,
            &now,
            "parakeet-tdt-0.6b-v3",
            "sherpa-onnx",
            60.0,
            500,
            100,
        );
        seed_row(
            &db,
            &now,
            "parakeet-tdt-0.6b-v3",
            "sherpa-onnx",
            30.0,
            250,
            50,
        );
        seed_row(&db, &now, "whisper-small", "sherpa-onnx", 10.0, 80, 20);
        let summary = summarize_usage(&db, Some("all")).expect("summarize");
        assert_eq!(summary.sessions, 3);
        assert!((summary.audio_seconds - 100.0).abs() < 1e-9);
        assert_eq!(summary.text_chars, 830);
        assert_eq!(summary.text_words, 170);
        assert_eq!(summary.by_model.len(), 2);
        // Most sessions first.
        assert_eq!(summary.by_model[0].model_id, "parakeet-tdt-0.6b-v3");
        assert_eq!(summary.by_model[0].sessions, 2);
        assert!((summary.by_model[0].audio_seconds - 90.0).abs() < 1e-9);
        assert_eq!(summary.by_model[1].model_id, "whisper-small");
    }

    #[test]
    fn period_filtering_matches_windows() {
        let db = mem_db();
        seed_row(
            &db,
            &rfc3339_days_ago(0),
            "fresh",
            "sherpa-onnx",
            10.0,
            10,
            2,
        );
        seed_row(
            &db,
            &rfc3339_days_ago(6),
            "week",
            "sherpa-onnx",
            10.0,
            10,
            2,
        );
        seed_row(
            &db,
            &rfc3339_days_ago(20),
            "month",
            "sherpa-onnx",
            10.0,
            10,
            2,
        );
        seed_row(
            &db,
            &rfc3339_days_ago(60),
            "old",
            "sherpa-onnx",
            10.0,
            10,
            2,
        );
        // Default (None) and blank behave as 30d.
        for period in [None, Some(""), Some("30d")] {
            let s = summarize_usage(&db, period).expect("30d");
            assert_eq!(s.sessions, 3, "period {period:?}");
        }
        let week = summarize_usage(&db, Some("7d")).expect("7d");
        assert_eq!(week.sessions, 2);
        let all = summarize_usage(&db, Some("all")).expect("all");
        assert_eq!(all.sessions, 4);
        // Today: only the fresh row (seeded now, after UTC midnight).
        let today = summarize_usage(&db, Some("today")).expect("today");
        assert_eq!(today.sessions, 1);
        assert_eq!(today.by_model[0].model_id, "fresh");
    }

    #[test]
    fn unknown_period_fails_loudly() {
        let db = mem_db();
        let err = summarize_usage(&db, Some("fortnight")).expect_err("unknown period");
        assert_eq!(err.code, "usage");
    }

    #[test]
    fn clear_deletes_everything_and_reports_count() {
        let db = mem_db();
        let now = rfc3339_days_ago(0);
        seed_row(&db, &now, "a", "sherpa-onnx", 1.0, 1, 1);
        seed_row(&db, &now, "b", "sherpa-onnx", 1.0, 1, 1);
        assert_eq!(clear_usage(&db).expect("clear"), 2);
        assert_eq!(
            summarize_usage(&db, Some("all")).expect("after").sessions,
            0
        );
        // Clearing an empty ledger reports zero, never errors.
        assert_eq!(clear_usage(&db).expect("clear again"), 0);
    }
}
