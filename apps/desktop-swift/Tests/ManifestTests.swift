import XCTest
@testable import AlgorithVoiceCore

/// Manifest parsing + validation, mirroring
/// `local_asr/manifest.rs` and `packages/shared-types localModels.ts`.
final class ManifestTests: XCTestCase {
    private func exampleFile(_ name: String) -> ModelFile {
        ModelFile(
            filename: name,
            url: "https://cdn.example.com/models/demo/encoder.onnx",
            sha256: String(repeating: "ab", count: 32),
            sizeBytes: 1_024
        )
    }

    private func exampleModel() -> LocalModel {
        LocalModel(
            id: "demo-model",
            name: "Demo Model",
            version: "1.0.0",
            engine: .sherpaOnnx,
            quantization: "int8",
            files: [exampleFile("encoder.onnx")],
            languages: ["en"],
            minRamGb: 4,
            recommendedRamGb: 8,
            minVramGb: 0,
            recommendedVramGb: 0,
            license: "CC-BY-4.0",
            attribution: "Example attribution",
            supportedOs: [.windows, .macos, .linux],
            supportedArch: [.x64, .arm64]
        )
    }

    private func exampleManifest() -> ModelManifest {
        ModelManifest(manifestVersion: modelManifestVersion, models: [exampleModel()], signature: nil)
    }

    func testValidManifestPasses() throws {
        try ModelManifestValidation.validate(exampleManifest())
    }

    func testRejectsUnsupportedVersionAndEmptyModels() {
        var versioned = exampleManifest()
        versioned.manifestVersion = modelManifestVersion + 1
        XCTAssertThrowsError(try ModelManifestValidation.validate(versioned))
        var empty = exampleManifest()
        empty.models = []
        XCTAssertThrowsError(try ModelManifestValidation.validate(empty))
    }

    func testRejectsDuplicateIdsSlugsVersionsAndRAM() {
        var duplicate = exampleManifest()
        duplicate.models.append(exampleModel())
        XCTAssertThrowsError(try ModelManifestValidation.validate(duplicate))

        var slug = exampleManifest()
        slug.models[0].id = "Bad Slug!"
        XCTAssertThrowsError(try ModelManifestValidation.validate(slug))

        var version = exampleManifest()
        version.models[0].version = "1.0"
        XCTAssertThrowsError(try ModelManifestValidation.validate(version))

        var ram = exampleManifest()
        ram.models[0].recommendedRamGb = 2
        XCTAssertThrowsError(try ModelManifestValidation.validate(ram))
    }

    func testRejectsUnsafeFilenamesAndDuplicates() {
        for bad in ["../evil.onnx", ".hidden", "", "a/b/c/d.onnx"] {
            var manifest = exampleManifest()
            manifest.models[0].files[0].filename = bad
            XCTAssertThrowsError(try ModelManifestValidation.validate(manifest), "must reject \(bad)")
        }
        for good in ["encoder.onnx", "tokenizer/vocab.json", "a/b/c.onnx"] {
            var manifest = exampleManifest()
            manifest.models[0].files[0].filename = good
            XCTAssertNoThrow(try ModelManifestValidation.validate(manifest), "must accept \(good)")
        }
        var duplicate = exampleManifest()
        duplicate.models[0].files.append(exampleFile("encoder.onnx"))
        XCTAssertThrowsError(try ModelManifestValidation.validate(duplicate))
    }

    func testRejectsNonHTTPSURLsAndBadChecksums() {
        var http = exampleManifest()
        http.models[0].files[0].url = "http://cdn.example.com/x"
        XCTAssertThrowsError(try ModelManifestValidation.validate(http))

        var sha = exampleManifest()
        sha.models[0].files[0].sha256 = "not-a-hash"
        XCTAssertThrowsError(try ModelManifestValidation.validate(sha))
    }

    func testConfiguredCheckDetectsPlaceholders() {
        var model = exampleModel()
        model.files[0].sha256 = String(repeating: "0", count: 64)
        XCTAssertFalse(ModelManifestValidation.isConfigured(model))
        model.files[0].sha256 = String(repeating: "ab", count: 32)
        XCTAssertTrue(ModelManifestValidation.isConfigured(model))
        model.files[0].url = "https://REPLACE-WITH-cdn.example.com/x"
        XCTAssertFalse(ModelManifestValidation.isConfigured(model))
    }

    func testKnownTotalBytesSumsKnownFiles() {
        var model = exampleModel()
        let unknown = ModelFile(
            filename: "other.onnx",
            url: model.files[0].url,
            sha256: model.files[0].sha256,
            sizeBytes: 0
        )
        model.files.append(unknown)
        XCTAssertEqual(ModelManifestValidation.knownTotalBytes(model), 1_024)
    }

    func testWireFormatIsCamelCaseLikeSharedTypes() throws {
        let data = try JSONEncoder().encode(exampleManifest())
        let text = String(data: data, encoding: .utf8) ?? ""
        for key in ["manifestVersion", "minRamGb", "supportedOs", "sizeBytes"] {
            XCTAssertTrue(text.range(of: "\"\(key)\"") != nil, "wire JSON must contain \(key)")
        }
        // fallbackUrl is nil here so Codable omits it — encode one with it set.
        var withFallback = exampleManifest()
        withFallback.models[0].files[0].fallbackUrl = "https://cdn.example.com/fallback"
        let fallbackText = String(data: try JSONEncoder().encode(withFallback), encoding: .utf8) ?? ""
        XCTAssertTrue(fallbackText.range(of: "\"fallbackUrl\"") != nil)
        for snake in ["manifest_version", "min_ram_gb", "size_bytes"] {
            XCTAssertFalse(text.range(of: "\"\(snake)\"") != nil, "wire JSON must not contain \(snake)")
        }
    }

    func testStatusLifecycleValues() {
        // Pins every modelStatusSchema raw value; renaming one breaks the UI contract.
        XCTAssertEqual(ModelStatus(rawValue: "not-downloaded"), .notDownloaded)
        XCTAssertEqual(ModelStatus(rawValue: "downloading"), .downloading)
        XCTAssertEqual(ModelStatus(rawValue: "verifying"), .verifying)
        XCTAssertEqual(ModelStatus(rawValue: "ready"), .ready)
        XCTAssertEqual(ModelStatus(rawValue: "error"), .error)
    }
}
