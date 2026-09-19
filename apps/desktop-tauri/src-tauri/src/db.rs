//! Ordered SQLite schema migrations (rusqlite WAL database).
//!
//! Hand-rolled `Vec<(u32, &str)>` runner — no new dependency. Future schema
//! changes append a new `(version, SQL)` entry; the runner applies missing
//! steps inside a transaction and records them in `schema_version` so
//! existing user history is never dropped or silently recreated.
//!
//! SQLite rule the runner respects: `PRAGMA journal_mode` cannot change from
//! inside a transaction, so WAL mode is set once up-front, outside any tx,
//! and migration bodies must never contain PRAGMAs.

use crate::error::{AppError, AppResult};

/// Current schema version. Bump when appending to [`MIGRATIONS`].
pub const CURRENT_SCHEMA_VERSION: u32 = 1;

const MIGRATIONS: &[(u32, &str)] = &[(
    1,
    "CREATE TABLE IF NOT EXISTS history (
       id TEXT PRIMARY KEY,
       created_at TEXT NOT NULL,
       transcript TEXT NOT NULL
     );
     CREATE TABLE IF NOT EXISTS kv (
       key TEXT PRIMARY KEY,
       value TEXT NOT NULL
     );",
)];

fn current_version(conn: &rusqlite::Connection) -> AppResult<u32> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS schema_version (
           version INTEGER PRIMARY KEY
         );",
    )
    .map_err(|e| AppError::store(e.to_string()))?;
    let v: Option<u32> = conn
        .query_row("SELECT MAX(version) FROM schema_version", [], |r| r.get(0))
        .map_err(|e| AppError::store(e.to_string()))?;
    Ok(v.unwrap_or(0))
}

/// Apply pending migrations in order. Idempotent and safe to run on every startup.
pub fn run_migrations(conn: &mut rusqlite::Connection) -> AppResult<u32> {
    // WAL outside any transaction (SQLite forbids changing journal mode
    // from within one — file-backed DBs error, :memory: silently no-ops,
    // which is why only a file-backed test catches regressions here).
    conn.execute_batch("PRAGMA journal_mode = WAL;")
        .map_err(|e| AppError::store(e.to_string()))?;
    let from = current_version(conn)?;
    for (version, sql) in MIGRATIONS {
        if *version <= from {
            continue;
        }
        let tx = conn
            .transaction()
            .map_err(|e| AppError::store(e.to_string()))?;
        tx.execute_batch(sql)
            .map_err(|e| AppError::store(e.to_string()))?;
        tx.execute(
            "INSERT INTO schema_version (version) VALUES (?1)",
            [*version],
        )
        .map_err(|e| AppError::store(e.to_string()))?;
        tx.commit().map_err(|e| AppError::store(e.to_string()))?;
    }
    Ok(CURRENT_SCHEMA_VERSION)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fresh_db_migrates_to_current() {
        let mut conn = rusqlite::Connection::open_in_memory().expect("mem db");
        let v = run_migrations(&mut conn).expect("migrate");
        assert_eq!(v, CURRENT_SCHEMA_VERSION);
        // Tables exist and are writable.
        conn.execute(
            "INSERT INTO history (id, created_at, transcript) VALUES ('a','t','hi')",
            [],
        )
        .expect("history writable");
        // Re-run is idempotent and preserves rows.
        run_migrations(&mut conn).expect("re-migrate");
        let n: i64 = conn
            .query_row("SELECT COUNT(*) FROM history", [], |r| r.get(0))
            .expect("count");
        assert_eq!(n, 1);
    }

    #[test]
    fn skips_already_applied_versions() {
        let mut conn = rusqlite::Connection::open_in_memory().expect("mem db");
        run_migrations(&mut conn).expect("first");
        let v: u32 = conn
            .query_row("SELECT MAX(version) FROM schema_version", [], |r| r.get(0))
            .expect("version row");
        assert_eq!(v, CURRENT_SCHEMA_VERSION);
    }

    #[test]
    fn file_db_uses_wal_and_survives_reopen() {
        // Regression test: PRAGMA journal_mode=WAL inside a transaction
        // errors on file-backed DBs ("cannot change into wal mode from
        // within a transaction") while :memory: silently passes — so this
        // path must be covered on a real file.
        let dir =
            std::env::temp_dir().join(format!("algorith-voice-dbtest-{}-file", std::process::id()));
        std::fs::create_dir_all(&dir).expect("mkdir");
        let path = dir.join("test.db");
        let _ = std::fs::remove_file(&path);
        let mode = {
            let mut conn = rusqlite::Connection::open(&path).expect("open file db");
            run_migrations(&mut conn).expect("file migrate must succeed");
            conn.execute(
                "INSERT INTO history (id, created_at, transcript) VALUES ('a','t','hi')",
                [],
            )
            .expect("writable");
            conn.query_row("PRAGMA journal_mode", [], |r| r.get::<_, String>(0))
                .expect("journal_mode readable")
        };
        assert_eq!(mode.to_lowercase(), "wal");
        // Reopen: data and version survive.
        let conn2 = rusqlite::Connection::open(&path).expect("reopen");
        let n: i64 = conn2
            .query_row("SELECT COUNT(*) FROM history", [], |r| r.get(0))
            .expect("count");
        assert_eq!(n, 1);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
