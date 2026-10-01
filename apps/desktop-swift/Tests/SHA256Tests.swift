import XCTest
@testable import AlgorithVoiceCore

/// SHA-256 correctness (NIST vectors) + file verification behavior.
/// The hasher is dependency-free so these run on any runner.
final class SHA256Tests: XCTestCase {
    func testNISTVectors() {
        XCTAssertEqual(
            SHA256.hexDigest(Data()),
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        )
        XCTAssertEqual(
            SHA256.hexDigest(Data("abc".utf8)),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        )
        // 448-bit input: two-block padding path.
        let twoBlock = "abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq"
        XCTAssertEqual(
            SHA256.hexDigest(Data(twoBlock.utf8)),
            "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1"
        )
    }

    func testStreamingMatchesOneShot() {
        var hasher = SHA256Hasher()
        hasher.update(Data("abc".utf8))
        hasher.update(Data("def".utf8))
        let streamed = hasher.finalized().map { String(format: "%02x", $0) }.joined()
        XCTAssertEqual(streamed, SHA256.hexDigest(Data("abcdef".utf8)))
    }

    func testVerifyAcceptsMatchingFile() throws {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try (Data("model-bytes".utf8)).write(to: url)
        defer { try? FileManager.default.removeItem(at: url) }
        try SHA256.verify(fileURL: url, expectedHex: SHA256.hexDigest(Data("model-bytes".utf8)))
    }

    func testVerifyRejectsMismatchWithStableCode() {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try? (Data("real-bytes".utf8)).write(to: url)
        defer { try? FileManager.default.removeItem(at: url) }
        XCTAssertThrowsError(
            try SHA256.verify(fileURL: url, expectedHex: String(repeating: "f", count: 64))
        ) { error in
            XCTAssertEqual((error as? AppError)?.code, "model-checksum-mismatch")
        }
    }

    func testVerifyRejectsMalformedExpectation() throws {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try (Data("x".utf8)).write(to: url)
        defer { try? FileManager.default.removeItem(at: url) }
        XCTAssertThrowsError(try SHA256.verify(fileURL: url, expectedHex: "not-a-hash"))
    }
}
