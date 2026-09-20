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
        record_local_usage(&db, "parakeet-tdt-0.6b-v3", ModelEngine::SherpaOnnx, 2.5, "hello world")
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
}
