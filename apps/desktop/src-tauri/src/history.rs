use crate::error::{AppError, AppResult};
use crate::state::Db;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HistoryEntry {
    pub id: String,
    pub created_at: String,
    pub transcript: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct HistoryStats {
    pub total: i64,
    pub today: i64,
    pub total_words: i64,
    pub today_words: i64,
}

#[tauri::command]
pub fn history_save(db: tauri::State<'_, Db>, transcript: String) -> AppResult<HistoryEntry> {
    let transcript = transcript.trim().to_owned();
    if transcript.is_empty() {
        return Err(AppError::new("history", "transcript is empty"));
    }
    if transcript.len() > 100_000 {
        return Err(AppError::new("history", "transcript too long"));
    }
    let id = uuid::Uuid::new_v4().to_string();
    let created_at = chrono::Utc::now().to_rfc3339();
    let conn = db.0.lock().map_err(|_| AppError::store("db lock"))?;
    conn.execute(
        "INSERT INTO history (id, created_at, transcript) VALUES (?1, ?2, ?3)",
        rusqlite::params![id, created_at, transcript],
    )
    .map_err(|e| AppError::store(e.to_string()))?;
    Ok(HistoryEntry {
        id,
        created_at,
        transcript,
    })
}

#[tauri::command]
pub fn history_list(db: tauri::State<'_, Db>, limit: Option<i64>) -> AppResult<Vec<HistoryEntry>> {
    let limit = limit.unwrap_or(100).clamp(1, 500);
    let conn = db.0.lock().map_err(|_| AppError::store("db lock"))?;
    let mut stmt = conn
        .prepare("SELECT id, created_at, transcript FROM history ORDER BY created_at DESC LIMIT ?1")
        .map_err(|e| AppError::store(e.to_string()))?;
    let rows = stmt
        .query_map([limit], |row| {
            Ok(HistoryEntry {
                id: row.get(0)?,
                created_at: row.get(1)?,
                transcript: row.get(2)?,
            })
        })
        .map_err(|e| AppError::store(e.to_string()))?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r.map_err(|e| AppError::store(e.to_string()))?);
    }
    Ok(out)
}

#[tauri::command]
pub fn history_stats(db: tauri::State<'_, Db>) -> AppResult<HistoryStats> {
    let conn = db.0.lock().map_err(|_| AppError::store("db lock"))?;
    let total: i64 = conn
        .query_row("SELECT COUNT(*) FROM history", [], |r| r.get(0))
        .map_err(|e| AppError::store(e.to_string()))?;
    // today: from UTC midnight
    let today_start = chrono::Utc::now()
        .date_naive()
        .and_hms_opt(0, 0, 0)
        .unwrap()
        .and_utc()
        .to_rfc3339();
    let today: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM history WHERE created_at >= ?1",
            [&today_start],
            |r| r.get(0),
        )
        .map_err(|e| AppError::store(e.to_string()))?;

    // total words: sum of word counts, bounded to latest 5000 rows to
    // avoid DoS on huge histories (counts stay exact for typical use).
    let mut stmt = conn
        .prepare("SELECT transcript FROM history ORDER BY created_at DESC LIMIT 5000")
        .map_err(|e| AppError::store(e.to_string()))?;
    let rows = stmt
        .query_map([], |r| r.get::<_, String>(0))
        .map_err(|e| AppError::store(e.to_string()))?;
    let mut total_words: i64 = 0;
    let mut today_words: i64 = 0;
    // For today words we need to filter, so do second query for today
    // Instead we compute via separate query with filtering
    let mut today_stmt = conn
        .prepare("SELECT transcript FROM history WHERE created_at >= ?1 ORDER BY created_at DESC LIMIT 5000")
        .map_err(|e| AppError::store(e.to_string()))?;
    let today_rows = today_stmt
        .query_map([today_start], |r| r.get::<_, String>(0))
        .map_err(|e| AppError::store(e.to_string()))?;
    for t in rows.flatten() {
        total_words += t.split_whitespace().count() as i64;
    }
    for t in today_rows.flatten() {
        today_words += t.split_whitespace().count() as i64;
    }

    Ok(HistoryStats {
        total,
        today,
        total_words,
        today_words,
    })
}

#[tauri::command]
pub fn history_delete(db: tauri::State<'_, Db>, id: String) -> AppResult<()> {
    if id.is_empty() || id.len() > 128 {
        return Err(AppError::new("history", "invalid id"));
    }
    let conn = db.0.lock().map_err(|_| AppError::store("db lock"))?;
    let n = conn
        .execute("DELETE FROM history WHERE id = ?1", [&id])
        .map_err(|e| AppError::store(e.to_string()))?;
    if n == 0 {
        return Err(AppError::new("history", "not found"));
    }
    Ok(())
}

#[tauri::command]
pub fn history_clear(db: tauri::State<'_, Db>) -> AppResult<()> {
    let conn = db.0.lock().map_err(|_| AppError::store("db lock"))?;
    conn.execute("DELETE FROM history", [])
        .map_err(|e| AppError::store(e.to_string()))?;
    Ok(())
}
