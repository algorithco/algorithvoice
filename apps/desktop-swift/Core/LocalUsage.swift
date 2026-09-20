import Foundation

/// Local-AI usage ledger — portable logic (no SQLite, no AppKit).
///
/// Swift mirror of `apps/desktop-tauri/src-tauri/src/local_usage.rs`:
/// numbers only, never audio or transcript text. Units are honest STT units —
/// audio seconds in, words/chars out — because speech models have no LLM
/// tokens. Token slots stay reserved for a future local LLM.
///
/// Persistence lives in `Stores/LocalUsageStore.swift` (raw `sqlite3`, same
/// table as the Tauri app); this module owns the math and aggregation so both
/// stay unit-testable on any platform.
public enum LocalUsagePeriod: String, Sendable, CaseIterable {
    case today
    case sevenDays = "7d"
    case thirtyDays = "30d"
    case all
}

public struct LocalUsageRow: Sendable, Equatable {
    public var recordedAt: Date
    public var modelId: String
    public var engine: String
    public var audioSeconds: Double
    public var textChars: Int
    public var textWords: Int

    public init(
        recordedAt: Date,
        modelId: String,
        engine: String,
        audioSeconds: Double,
        textChars: Int,
        textWords: Int
    ) {
        self.recordedAt = recordedAt
        self.modelId = modelId
        self.engine = engine
        self.audioSeconds = audioSeconds
        self.textChars = textChars
        self.textWords = textWords
    }
}

public struct LocalModelUsage: Sendable, Equatable {
    public var modelId: String
    public var engine: String
    public var sessions: Int
    public var audioSeconds: Double
    public var textWords: Int
}

public struct LocalUsageSummary: Sendable, Equatable {
    public var sessions: Int
    public var audioSeconds: Double
    public var textChars: Int
    public var textWords: Int
    public var byModel: [LocalModelUsage]

    public static let empty = LocalUsageSummary(
        sessions: 0,
        audioSeconds: 0,
        textChars: 0,
        textWords: 0,
        byModel: []
    )
}

public enum LocalUsage {
    /// Unicode-whitespace word split — the same rule as Rust
    /// `split_whitespace` (`White_Space` property on both sides), so both
    /// clients count identically. Punctuation stays attached.
    public static func countWords(_ text: String) -> Int {
        text.split(whereSeparator: \.isWhitespace).count
    }

    /// Unicode scalar count (Rust `chars().count()`), not graphemes or bytes.
    public static func countChars(_ text: String) -> Int {
        text.unicodeScalars.count
    }

    /// UTC-based window start for a period (`nil` = unbounded). Missing maps
    /// to 30 days, matching the Rust default.
    public static func cutoff(
        for period: LocalUsagePeriod,
        now: Date = Date(),
        calendar: Calendar = utcCalendar()
    ) -> Date? {
        switch period {
        case .today:
            return calendar.startOfDay(for: now)
        case .sevenDays:
            return now.addingTimeInterval(-7 * 86_400)
        case .thirtyDays:
            return now.addingTimeInterval(-30 * 86_400)
        case .all:
            return nil
        }
    }

    public static func utcCalendar() -> Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC")
            ?? TimeZone(secondsFromGMT: 0)
            ?? TimeZone.current
        return calendar
    }

    /// Totals + per-model breakdown (most sessions first) over `rows`.
    public static func summarize(
        rows: [LocalUsageRow],
        period: LocalUsagePeriod,
        now: Date = Date()
    ) -> LocalUsageSummary {
        let from = cutoff(for: period, now: now)
        let kept = from.map { start in rows.filter { $0.recordedAt >= start } } ?? rows
        var grouped: [String: LocalModelUsage] = [:]
        for row in kept {
            let key = "\(row.modelId)\n\(row.engine)"
            if var existing = grouped[key] {
                existing.sessions += 1
                existing.audioSeconds += row.audioSeconds
                existing.textWords += row.textWords
                grouped[key] = existing
            } else {
                grouped[key] = LocalModelUsage(
                    modelId: row.modelId,
                    engine: row.engine,
                    sessions: 1,
                    audioSeconds: row.audioSeconds,
                    textWords: row.textWords
                )
            }
        }
        let byModel = grouped.values.sorted { $0.sessions > $1.sessions }
        return LocalUsageSummary(
            sessions: kept.count,
            audioSeconds: kept.reduce(0) { $0 + $1.audioSeconds },
            textChars: kept.reduce(0) { $0 + $1.textChars },
            textWords: kept.reduce(0) { $0 + $1.textWords },
            byModel: byModel
        )
    }

    /// Human duration for audio totals: 45 → "45s", 150 → "2m 30s",
    /// 7500 → "2h 5m". Mirrors `formatAudioDuration` in the Tauri frontend.
    public static func formatAudioDuration(_ totalSeconds: Double) -> String {
        guard totalSeconds.isFinite, totalSeconds > 0 else { return "0s" }
        let total = Int(totalSeconds.rounded(.down))
        let hours = total / 3_600
        let minutes = (total % 3_600) / 60
        let seconds = total % 60
        if hours > 0 { return "\(hours)h \(minutes)m" }
        if minutes > 0 { return "\(minutes)m \(seconds)s" }
        return "\(seconds)s"
    }
}
