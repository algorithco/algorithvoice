import XCTest
@testable import AlgorithVoiceCore
@testable import AlgorithVoiceStores

/// Local-usage ledger: math, aggregation, formatting (portable Core) plus the
/// sqlite store round-trip (same table contract as the Tauri app).
final class LocalUsageTests: XCTestCase {
    // MARK: - Counting (must match Rust split_whitespace / chars().count())

    func testWordCount() {
        XCTAssertEqual(LocalUsage.countWords(""), 0)
        XCTAssertEqual(LocalUsage.countWords("   \t\n  "), 0)
        XCTAssertEqual(LocalUsage.countWords("hello"), 1)
        XCTAssertEqual(LocalUsage.countWords("hello world"), 2)
        XCTAssertEqual(LocalUsage.countWords("  hello   world  "), 2)
        XCTAssertEqual(LocalUsage.countWords("héllo, wörld!\nnew\tline"), 4)
        XCTAssertEqual(LocalUsage.countWords("你好 世界"), 2)
    }

    func testCharCountIsUnicodeScalars() {
        XCTAssertEqual(LocalUsage.countChars(""), 0)
        XCTAssertEqual(LocalUsage.countChars("hello"), 5)
        XCTAssertEqual(LocalUsage.countChars("你好"), 2)
        XCTAssertEqual(LocalUsage.countChars("hi 👋"), 4)
    }

    // MARK: - Periods

    func testCutoffWindows() {
        let now = Date()
        XCTAssertNil(LocalUsage.cutoff(for: .all, now: now))
        let today = LocalUsage.cutoff(for: .today, now: now)
        XCTAssertNotNil(today)
        XCTAssertLessThanOrEqual(today ?? now, now)
        let week = LocalUsage.cutoff(for: .sevenDays, now: now) ?? now
        let month = LocalUsage.cutoff(for: .thirtyDays, now: now) ?? now
        XCTAssertEqual(week.timeIntervalSince(now), -7 * 86_400, accuracy: 1)
        XCTAssertEqual(month.timeIntervalSince(now), -30 * 86_400, accuracy: 1)
    }

    // MARK: - Aggregation

    private func row(
        daysAgo: Double,
        model: String = "parakeet-tdt-0.6b-v3",
        seconds: Double = 60,
        chars: Int = 500,
        words: Int = 100
    ) -> LocalUsageRow {
        LocalUsageRow(
            recordedAt: Date(timeIntervalSinceNow: -daysAgo * 86_400),
            modelId: model,
            engine: "sherpa-onnx",
            audioSeconds: seconds,
            textChars: chars,
            textWords: words
        )
    }

    func testSummarizeTotalsAndGroups() {
        let rows = [
            row(daysAgo: 0),
            row(daysAgo: 0, seconds: 30, chars: 250, words: 50),
            row(daysAgo: 0, model: "whisper-small", seconds: 10, chars: 80, words: 20),
        ]
        let summary = LocalUsage.summarize(rows: rows, period: .all)
        XCTAssertEqual(summary.sessions, 3)
        XCTAssertEqual(summary.audioSeconds, 100, accuracy: 0.000_001)
        XCTAssertEqual(summary.textChars, 830)
        XCTAssertEqual(summary.textWords, 170)
        XCTAssertEqual(summary.byModel.count, 2)
        XCTAssertEqual(summary.byModel[0].modelId, "parakeet-tdt-0.6b-v3")
        XCTAssertEqual(summary.byModel[0].sessions, 2)
    }

    func testSummarizeFiltersByPeriod() {
        let rows = [
            row(daysAgo: 0, model: "fresh"),
            row(daysAgo: 6, model: "week"),
            row(daysAgo: 20, model: "month"),
            row(daysAgo: 60, model: "old"),
        ]
        XCTAssertEqual(LocalUsage.summarize(rows: rows, period: .thirtyDays).sessions, 3)
        XCTAssertEqual(LocalUsage.summarize(rows: rows, period: .sevenDays).sessions, 2)
        XCTAssertEqual(LocalUsage.summarize(rows: rows, period: .all).sessions, 4)
        let today = LocalUsage.summarize(rows: rows, period: .today)
        XCTAssertEqual(today.sessions, 1)
        XCTAssertEqual(today.byModel.first?.modelId, "fresh")
    }

    func testEmptySummarizesToZero() {
        XCTAssertEqual(LocalUsage.summarize(rows: [], period: .all), .empty)
    }

    // MARK: - Formatting (mirrors the Tauri formatAudioDuration)

    func testFormatAudioDuration() {
        XCTAssertEqual(LocalUsage.formatAudioDuration(0), "0s")
        XCTAssertEqual(LocalUsage.formatAudioDuration(-5), "0s")
        XCTAssertEqual(LocalUsage.formatAudioDuration(Double.nan), "0s")
        XCTAssertEqual(LocalUsage.formatAudioDuration(45), "45s")
        XCTAssertEqual(LocalUsage.formatAudioDuration(150), "2m 30s")
        XCTAssertEqual(LocalUsage.formatAudioDuration(7500), "2h 5m")
    }

    // MARK: - Store round-trip (macOS sqlite, same table as Tauri)

    private func temporaryStore() throws -> LocalUsageStore {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString)
        return try LocalUsageStore(directory: directory)
    }

    func testStoreRecordsAndSummarizes() throws {
        let store = try temporaryStore()
        XCTAssertEqual(try store.summarize(period: .all), .empty)
        try store.record(
            modelId: "parakeet-tdt-0.6b-v3",
            engine: .sherpaOnnx,
            audioSeconds: 2.5,
            text: "hello world"
        )
        let summary = try store.summarize(period: .all)
        XCTAssertEqual(summary.sessions, 1)
        XCTAssertEqual(summary.audioSeconds, 2.5, accuracy: 0.000_001)
        XCTAssertEqual(summary.textChars, 11)
        XCTAssertEqual(summary.textWords, 2)
        XCTAssertEqual(summary.byModel.first?.engine, "sherpa-onnx")
    }

    func testStoreFiltersPeriodsAndClears() throws {
        let store = try temporaryStore()
        try store.record(modelId: "fresh", engine: .sherpaOnnx, audioSeconds: 10, text: "a b")
        try store.record(
            modelId: "old",
            engine: .sherpaOnnx,
            audioSeconds: 10,
            text: "a b",
            at: Date(timeIntervalSinceNow: -60 * 86_400)
        )
        XCTAssertEqual(try store.summarize(period: .all).sessions, 2)
        XCTAssertEqual(try store.summarize(period: .thirtyDays).sessions, 1)
        XCTAssertEqual(try store.clear(), 2)
        XCTAssertEqual(try store.summarize(period: .all), .empty)
        XCTAssertEqual(try store.clear(), 0)
    }
}
