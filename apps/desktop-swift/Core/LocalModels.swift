import Foundation

/// Local-model catalog — Swift mirror of
/// `packages/shared-types/src/schemas/localModels.ts` (shapes) plus the
/// validation rules from `apps/desktop-tauri/src-tauri/src/local_asr/manifest.rs`.
///
/// The catalog file itself (`local_asr/default_manifest.json`) is consumed
/// as-is in PR4 — never forked. This module only defines the shapes and the
/// shape+security validation; transport trust comes from per-file SHA-256
/// verification (see `SHA256.swift`), never from this validation.

/// Manifest schema version understood by this build (mirrors `MANIFEST_VERSION`).
public let modelManifestVersion: Int = 1

public enum ModelEngine: String, Codable, Equatable, Sendable {
    case sherpaOnnx = "sherpa-onnx"
    case whisperCpp = "whisper-cpp"
}

public enum ModelOs: String, Codable, Equatable, Sendable {
    case windows
    case macos
    case linux
}

public enum ModelArch: String, Codable, Equatable, Sendable {
    case x64
    case arm64
}

public struct ModelFile: Codable, Equatable, Sendable {
    public var filename: String
    public var url: String
    public var fallbackUrl: String?
    public var sha256: String
    public var sizeBytes: UInt64

    public init(filename: String, url: String, fallbackUrl: String? = nil, sha256: String, sizeBytes: UInt64) {
        self.filename = filename
        self.url = url
        self.fallbackUrl = fallbackUrl
        self.sha256 = sha256
        self.sizeBytes = sizeBytes
    }
}

public struct LocalModel: Codable, Equatable, Sendable {
    public var id: String
    public var name: String
    public var version: String
    public var engine: ModelEngine
    public var quantization: String
    public var files: [ModelFile]
    public var languages: [String]
    public var minRamGb: Double
    public var recommendedRamGb: Double
    public var minVramGb: Double
    public var recommendedVramGb: Double
    public var license: String
    public var attribution: String
    public var supportedOs: [ModelOs]
    public var supportedArch: [ModelArch]
}

public struct ModelManifest: Codable, Equatable, Sendable {
    public var manifestVersion: Int
    public var models: [LocalModel]
    /// Hex Ed25519 signature over the canonical models JSON. Fail-closed:
    /// when a signing key is configured, a missing/invalid signature refuses
    /// downloads (PR4 enforces; parsing here stays signature-agnostic).
    public var signature: String?
}

// MARK: - Download lifecycle (modelStatusSchema)

/// Status lifecycle for one model: `not-downloaded → downloading →
/// verifying → ready`, or `error`. Matches `modelStatusSchema` exactly.
public enum ModelStatus: String, Codable, Equatable, Sendable {
    case notDownloaded = "not-downloaded"
    case downloading
    case verifying
    case ready
    case error
}

public struct ModelStatusInfo: Codable, Equatable, Sendable {
    public var id: String
    public var status: ModelStatus
    public var downloadedBytes: Int
    public var totalBytes: Int
    public var errorCode: String?
    public var errorMessage: String?
    public var version: String?
}

public struct DownloadProgress: Codable, Equatable, Sendable {
    public var id: String
    public var downloadedBytes: Int
    public var totalBytes: Int
    public var bytesPerSecond: Double
    public var etaSeconds: Double?
}

// MARK: - Validation (port of manifest.rs validate_*)

public enum ModelManifestValidation {
    /// True when every URL is real (no `REPLACE-WITH-*` placeholders) and no
    /// checksum is the all-zeros placeholder. Downloads are gated on this.
    public static func isConfigured(_ model: LocalModel) -> Bool {
        let placeholderHost = "REPLACE-WITH-"
        let placeholderSha = String(repeating: "0", count: 64)
        return model.files.allSatisfy { file in
            file.url.range(of: placeholderHost) == nil
                && (file.fallbackUrl.map { $0.range(of: placeholderHost) == nil } ?? true)
                && file.sha256 != placeholderSha
        }
    }

    /// Sum of *known* file sizes (`sizeBytes == 0` means unknown until download).
    public static func knownTotalBytes(_ model: LocalModel) -> UInt64 {
        model.files.reduce(0) { $0 + $1.sizeBytes }
    }

    /// Shape + security validation. Transport trust is NOT established here.
    public static func validate(_ manifest: ModelManifest) throws {
        guard manifest.manifestVersion == modelManifestVersion else {
            throw AppError.internal(
                "unsupported model manifest version \(manifest.manifestVersion), this build understands \(modelManifestVersion)"
            )
        }
        guard !manifest.models.isEmpty else {
            throw AppError.internal("model manifest contains no models")
        }
        var ids = Set<String>()
        for model in manifest.models {
            guard ids.insert(model.id).inserted else {
                throw AppError.internal("duplicate model id: \(model.id)")
            }
            try validateModel(model)
        }
    }

    static func validateModel(_ model: LocalModel) throws {
        guard isSafeSlug(model.id) else {
            throw AppError.internal("model id is not a safe slug: \(model.id)")
        }
        guard !model.name.trimmingCharacters(in: .whitespaces).isEmpty, model.name.count <= 120 else {
            throw AppError.internal("model \(model.id) has an invalid display name")
        }
        guard isSemver(model.version) else {
            throw AppError.internal("model \(model.id) version is not semver x.y.z: \(model.version)")
        }
        guard !model.quantization.trimmingCharacters(in: .whitespaces).isEmpty, model.quantization.count <= 32 else {
            throw AppError.internal("model \(model.id) has an invalid quantization label")
        }
        guard !model.files.isEmpty else {
            throw AppError.internal("model \(model.id) lists no files")
        }
        var names = Set<String>()
        for file in model.files {
            guard names.insert(file.filename).inserted else {
                throw AppError.internal("model \(model.id) has a duplicate filename: \(file.filename)")
            }
            try validateFilename(modelId: model.id, name: file.filename)
            try validateHTTPSURL(modelId: model.id, raw: file.url)
            if let fallback = file.fallbackUrl {
                try validateHTTPSURL(modelId: model.id, raw: fallback)
            }
            guard isSHA256(file.sha256) else {
                throw AppError.internal("model \(model.id) file \(file.filename) has a malformed sha256")
            }
        }
        guard !model.languages.isEmpty, model.languages.allSatisfy(isLanguageCode) else {
            throw AppError.internal("model \(model.id) has invalid languages")
        }
        guard model.recommendedRamGb >= model.minRamGb,
              model.recommendedVramGb >= model.minVramGb,
              model.minRamGb >= 0,
              model.minVramGb >= 0
        else {
            throw AppError.internal("model \(model.id) has inconsistent memory requirements")
        }
        guard !model.supportedOs.isEmpty, !model.supportedArch.isEmpty else {
            throw AppError.internal("model \(model.id) supports no OS/arch")
        }
        guard !model.license.trimmingCharacters(in: .whitespaces).isEmpty,
              !model.attribution.trimmingCharacters(in: .whitespaces).isEmpty
        else {
            throw AppError.internal("model \(model.id) is missing license/attribution")
        }
    }

    static func isSafeSlug(_ id: String) -> Bool {
        guard !id.isEmpty, id.count <= 100 else { return false }
        guard let first = id.first, first.isLowercase || first.isNumber else { return false }
        return id.allSatisfy { $0.isLowercase || $0.isNumber || $0 == "." || $0 == "_" || $0 == "-" }
    }

    static func isSemver(_ version: String) -> Bool {
        let parts = version.split(separator: ".", omittingEmptySubsequences: false)
        guard parts.count == 3 else { return false }
        return parts.allSatisfy { part in
            !part.isEmpty && part.count <= 8 && part.allSatisfy(\.isNumber)
        }
    }

    /// Bare filenames or safe relative subpaths (e.g. `tokenizer/vocab.json`):
    /// max depth 3, no traversal, no absolute paths, no dotfiles.
    static func validateFilename(modelId: String, name: String) throws {
        let segments = name.split(separator: "/", omittingEmptySubsequences: false).map(String.init)
        let bad = name.isEmpty
            || name.count > 255
            || segments.count > 3
            || segments.contains(where: {
                $0.isEmpty || $0 == "." || $0.hasPrefix(".")
                    || $0.range(of: "..") != nil || $0.range(of: "\\") != nil
            })
        if bad {
            throw AppError.internal("model \(modelId) has an unsafe filename: \(name)")
        }
    }

    static func validateHTTPSURL(modelId: String, raw: String) throws {
        guard let url = URL(string: raw), let scheme = url.scheme?.lowercased() else {
            throw AppError.internal("model \(modelId) has a malformed URL")
        }
        guard scheme == "https" else {
            throw AppError.internal("model \(modelId) URL must use HTTPS")
        }
    }

    static func isSHA256(_ value: String) -> Bool {
        value.count == 64 && value.allSatisfy { $0.isHexDigit }
    }

    static func isLanguageCode(_ code: String) -> Bool {
        let base = code.split(separator: "-").first.map(String.init) ?? ""
        return (base.count == 2 || base.count == 3) && base.allSatisfy { $0.isLowercase }
    }
}
