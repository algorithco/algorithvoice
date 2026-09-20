import XCTest
@testable import AlgorithVoiceCore

/// Wire-format conformance against
/// `packages/shared-types/src/schemas/voice.ts`.
/// Every message encodes to the exact JSON the Zod schemas accept, and every
/// server message decodes back — round-trips, not just one direction.
final class VoiceProtocolTests: XCTestCase {
    private let encoder: JSONEncoder = {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        return encoder
    }()

    private func roundTrip(_ message: WsServerMessage, file: StaticString = #filePath, line: UInt = #line) throws {
        let data = try encoder.encode(message)
        let decoded = try JSONDecoder().decode(WsServerMessage.self, from: data)
        XCTAssertEqual(decoded, message, file: file, line: line)
    }

    // MARK: - hello

    func testHelloEncodesSchemaLiterals() throws {
        let hello = try WsHello(sessionId: "123e4567-e89b-12d3-a456-426614174000").validated()
        let json = try JSONSerialization.jsonObject(with: encoder.encode(hello)) as? [String: Any]
        XCTAssertEqual(json?["type"] as? String, "hello")
        XCTAssertEqual(json?["sampleRate"] as? Int, 16_000)
        XCTAssertEqual(json?["codec"] as? String, "pcm16")
        XCTAssertEqual(json?["language"] as? String, "auto")
    }

    func testHelloRejectsWrongFormat() {
        var hello = WsHello(sessionId: "x")
        hello.sampleRate = 44_100
        XCTAssertThrowsError(try hello.validated())
        var codec = WsHello(sessionId: "x")
        codec.codec = "opus"
        XCTAssertThrowsError(try codec.validated())
    }

    // MARK: - all five server messages

    func testReadyRoundTrip() throws {
        try roundTrip(.ready(sessionId: "abc", provider: "voxtral"))
    }

    func testPartialRoundTrip() throws {
        try roundTrip(.partial(text: "hello wo", confidence: 0.87))
        try roundTrip(.partial(text: "hello", confidence: nil))
    }

    func testFinalRoundTrip() throws {
        try roundTrip(.final(text: "hello world", language: "en", durationSec: 1.5))
        try roundTrip(.final(text: "hello", language: nil, durationSec: nil))
    }

    func testFallbackRoundTrip() throws {
        try roundTrip(.fallback(reason: "provider-overloaded"))
    }

    func testErrorRoundTrip() throws {
        try roundTrip(.error(code: "rate_limited", retryAfterMs: 2_000))
        try roundTrip(.error(code: "not_implemented", retryAfterMs: nil))
    }

    func testDecodesRawBackendPayloads() throws {
        // Exact shapes the backend emits (incl. the current
        // `not_implemented` stub on GET /stt/stream).
        let stub = #"{"type":"error","code":"not_implemented"}"#.data(using: .utf8) ?? Data()
        XCTAssertEqual(
            try JSONDecoder().decode(WsServerMessage.self, from: stub),
            .error(code: "not_implemented", retryAfterMs: nil)
        )
        let ready = #"{"type":"ready","sessionId":"s1","provider":"voxtral"}"#.data(using: .utf8) ?? Data()
        XCTAssertEqual(
            try JSONDecoder().decode(WsServerMessage.self, from: ready),
            .ready(sessionId: "s1", provider: "voxtral")
        )
    }

    func testRejectsUnknownMessageType() {
        let quantum = #"{"type":"quantum","text":"x"}"#.data(using: .utf8) ?? Data()
        XCTAssertThrowsError(try JSONDecoder().decode(WsServerMessage.self, from: quantum))
    }

    // MARK: - engine routing (resolve_transcribe_path port)

    func testRoutingSelectsEngineByMode() throws {
        XCTAssertEqual(try resolveTranscribePath(mode: nil), .cloud)
        XCTAssertEqual(try resolveTranscribePath(mode: .cloud), .cloud)
        XCTAssertEqual(try resolveTranscribePath(mode: .byok), .cloud)
        XCTAssertEqual(try resolveTranscribePath(mode: .local), .local)
    }

    func testRoutingFailsLoudlyOnUnknownMode() {
        XCTAssertThrowsError(try resolveTranscribePath(rawMode: "quantum")) { error in
            XCTAssertEqual((error as? AppError)?.code, "internal")
        }
    }
}
