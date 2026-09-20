import AlgorithVoiceCore
import Foundation
import SQLite3

/// SQLite-backed local-AI usage store — the same `local_ai_usage` table (same
/// columns, same meaning) as the Tauri app, so both clients could read one
/// profile identically in the future.
///
/// Privacy: rows hold numbers only (model id, engine, audio seconds,
/// chars/words, RFC3339 UTC timestamp). This file never sees audio bytes or
/// transcript text — callers pass pre-computed counts — and it performs zero
/// network I/O by construction (no URLSession, no sockets).
///
/// Confinement: deliberately not `Sendable`. The raw `sqlite3*` handle must
/// be used from a single isolation domain; the app holds the store on
/// `@MainActor` (the target default). All methods are synchronous and cheap
/// (local file, millisecond writes) — no background offload needed.
public final class LocalUsageStore {
    private var handle: OpaquePointer?

    private static let schema = """
        CREATE TABLE IF NOT EXISTS local_ai_usage (
            id TEXT PRIMARY KEY,
            recorded_at TEXT NOT NULL,
            model_id TEXT NOT NULL,
            engine TEXT NOT NULL,
            audio_seconds REAL NOT NULL,
            text_chars INTEGER NOT NULL,
            text_words INTEGER NOT NULL,
            prompt_tokens INTEGER,
            completion_tokens INTEGER
        );
        CREATE INDEX IF NOT EXISTS idx_local_ai_usage_recorded_at
            ON local_ai_usage (recorded_at);
        CREATE INDEX IF NOT EXISTS idx_local_ai_usage_model
            ON local_ai_usage (model_id);
        """

    private static let iso: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        formatter.timeZone = TimeZone(secondsFromGMT: 0)
        return formatter
    }()

    /// Open (creating) `algorith-voice.db` under `directory` and migrate.
    public init(directory: URL) throws {
        try FileManager.default.createDirectory(
            at: directory,
            withIntermediateDirectories: true
        )
        let path = directory.appendingPathComponent("algorith-voice.db").path
        var database: OpaquePointer?
        let flags = SQLITE_OPEN_CREATE | SQLITE_OPEN_READWRITE | SQLITE_OPEN_FULLMUTEX
        guard sqlite3_open_v2(path, &database, flags, nil) == SQLITE_OK,
              let opened = database
        else {
            let message = database.flatMap(errorMessage(for:)) ?? "cannot open database"
            if let database {
                sqlite3_close(database)
            }
            throw AppError.store(message)
        }
        handle = opened
        try execute(Self.schema)
    }

    deinit {
        if let handle {
            sqlite3_close(handle)
        }
    }

    /// Append one usage row. Token columns stay NULL (STT has no tokens).
    public func record(
        modelId: String,
        engine: ModelEngine,
        audioSeconds: Double,
        text: String,
        at date: Date = Date()
    ) throws {
        let sql = """
            INSERT INTO local_ai_usage
                (id, recorded_at, model_id, engine, audio_seconds,
                 text_chars, text_words, prompt_tokens, completion_tokens)
                VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, NULL, NULL)
            """
        let statement = try prepared(sql)
        defer { sqlite3_finalize(statement) }
        try bindText(statement, index: 1, value: UUID().uuidString)
        try bindText(statement, index: 2, value: Self.iso.string(from: date))
        try bindText(statement, index: 3, value: modelId)
        try bindText(statement, index: 4, value: engine.rawValue)
        guard sqlite3_bind_double(statement, 5, audioSeconds) == SQLITE_OK,
              sqlite3_bind_int64(statement, 6, Int64(LocalUsage.countChars(text))) == SQLITE_OK,
              sqlite3_bind_int64(statement, 7, Int64(LocalUsage.countWords(text))) == SQLITE_OK
        else {
            throw AppError.store("cannot bind usage row")
        }
        guard sqlite3_step(statement) == SQLITE_DONE else {
            throw AppError.store(errorMessage(for: statement))
        }
    }

    /// Totals + per-model breakdown for `period` (aggregation in Core).
    public func summarize(
        period: LocalUsagePeriod,
        now: Date = Date()
    ) throws -> LocalUsageSummary {
        let rows = try loadRows(since: LocalUsage.cutoff(for: period, now: now))
        return LocalUsage.summarize(rows: rows, period: .all, now: now)
    }

    /// Delete every row, returning the deleted count.
    @discardableResult
    public func clear() throws -> Int {
        try execute("DELETE FROM local_ai_usage;")
        guard let handle else { throw AppError.store("database is closed") }
        return Int(sqlite3_changes(handle))
    }

    // MARK: - Internals

    private func withHandle() throws -> OpaquePointer {
        guard let handle else { throw AppError.store("database is closed") }
        return handle
    }

    private func errorMessage(for database: OpaquePointer) -> String {
        guard let raw = sqlite3_errmsg(database) else { return "database error" }
        let text = UnsafeRawPointer(raw).assumingMemoryBound(to: CChar.self)
        let count = strlen(text)
        let bytes = UnsafeRawPointer(raw).assumingMemoryBound(to: UInt8.self)
        return String(decoding: UnsafeBufferPointer(start: bytes, count: count), as: UTF8.self)
    }

    private func execute(_ sql: String) throws {
        let handle = try withHandle()
        var errorMessage: UnsafeMutablePointer<CChar>?
        defer { sqlite3_free(errorMessage) }
        guard sqlite3_exec(handle, sql, nil, nil, &errorMessage) == SQLITE_OK else {
            let message = errorMessage.map { String(cString: $0) } ?? "statement failed"
            throw AppError.store(message)
        }
    }

    private func prepared(_ sql: String) throws -> OpaquePointer {
        let handle = try withHandle()
        var statement: OpaquePointer?
        guard sqlite3_prepare_v2(handle, sql, -1, &statement, nil) == SQLITE_OK,
              let statement
        else {
            throw AppError.store(errorMessage(for: handle))
        }
        return statement
    }

    private func bindText(_ statement: OpaquePointer, index: Int32, value: String) throws {
        let transient = unsafeBitCast(-1, to: sqlite3_destructor_type.self)
        let result = value.withCString { pointer in
            sqlite3_bind_text(statement, index, pointer, -1, transient)
        }
        guard result == SQLITE_OK else {
            throw AppError.store("cannot bind parameter \(index)")
        }
    }

    private func loadRows(since: Date?) throws -> [LocalUsageRow] {
        let filter = since == nil ? "" : "WHERE recorded_at >= ?1 "
        let sql = """
            SELECT recorded_at, model_id, engine, audio_seconds, text_chars, text_words
                FROM local_ai_usage \(filter)ORDER BY recorded_at DESC
            """
        let statement = try prepared(sql)
        defer { sqlite3_finalize(statement) }
        if let since {
            try bindText(statement, index: 1, value: Self.iso.string(from: since))
        }
        var rows: [LocalUsageRow] = []
        while true {
            let step = sqlite3_step(statement)
            if step == SQLITE_ROW {
                rows.append(try decodeRow(statement))
            } else if step == SQLITE_DONE {
                break
            } else {
                throw AppError.store(errorMessage(for: statement))
            }
        }
        return rows
    }

    private func decodeRow(_ statement: OpaquePointer) throws -> LocalUsageRow {
        func text(at column: Int32) throws -> String {
            guard let raw = sqlite3_column_text(statement, column) else {
                throw AppError.store("corrupt usage row")
            }
            let count = Int(sqlite3_column_bytes(statement, column))
            return String(decoding: UnsafeBufferPointer(start: raw, count: count), as: UTF8.self)
        }
        let recordedAtString = try text(at: 0)
        guard let recordedAt = Self.iso.date(from: recordedAtString) else {
            throw AppError.store("bad usage timestamp")
        }
        return LocalUsageRow(
            recordedAt: recordedAt,
            modelId: try text(at: 1),
            engine: try text(at: 2),
            audioSeconds: sqlite3_column_double(statement, 3),
            textChars: Int(sqlite3_column_int64(statement, 4)),
            textWords: Int(sqlite3_column_int64(statement, 5))
        )
    }
}
