import Foundation

/// Typed error domains for the macOS app.
///
/// Mirrors the Rust `AppError` categories conceptually
/// (`apps/desktop-tauri/src-tauri/src/error.rs`): a stable machine-readable
/// `code` plus a human message, serialized as `{ code, message }`.
/// Error codes are stable API — never rename one without a coordinated
/// change, exactly like the Rust side's `local_stt_codes_are_stable` test.
public struct AppError: Error, Codable, Equatable, Sendable, CustomStringConvertible {
    public let code: String
    public let message: String

    public init(code: String, message: String) {
        self.code = code
        self.message = message
    }

    public var description: String { "[\(code)] \(message)" }

    // MARK: - Domains (mirror of Rust constructors)

    public static func tray(_ message: String) -> AppError {
        AppError(code: "tray", message: message)
    }

    public static func window(_ message: String) -> AppError {
        AppError(code: "window", message: message)
    }

    public static func session(_ message: String) -> AppError {
        AppError(code: "session", message: message)
    }

    public static func shortcut(_ message: String) -> AppError {
        AppError(code: "shortcut", message: message)
    }

    public static func store(_ message: String) -> AppError {
        AppError(code: "store", message: message)
    }

    public static func auth(_ message: String) -> AppError {
        AppError(code: "auth", message: message)
    }

    public static func network(_ message: String) -> AppError {
        AppError(code: "network", message: message)
    }

    public static func transcribe(_ message: String) -> AppError {
        AppError(code: "transcribe", message: message)
    }

    public static func paste(_ message: String) -> AppError {
        AppError(code: "paste", message: message)
    }

    public static func hotkey(_ message: String) -> AppError {
        AppError(code: "hotkey", message: message)
    }

    public static func spelling(_ message: String) -> AppError {
        AppError(code: "spelling", message: message)
    }

    public static func validation(_ message: String) -> AppError {
        AppError(code: "validation", message: message)
    }

    public static func internal(_ message: String) -> AppError {
        AppError(code: "internal", message: message)
    }

    public static func notImplemented(_ message: String) -> AppError {
        AppError(code: "not-implemented", message: message)
    }

    // MARK: - Local STT (codes must match Rust exactly; the UI branches on them)

    public static func modelNotFound(_ message: String) -> AppError {
        AppError(code: "model-not-found", message: message)
    }

    public static func modelNotConfigured(_ message: String) -> AppError {
        AppError(code: "model-not-configured", message: message)
    }

    public static func modelDownloadFailed(_ message: String) -> AppError {
        AppError(code: "model-download-failed", message: message)
    }

    public static func modelChecksumMismatch(_ message: String) -> AppError {
        AppError(code: "model-checksum-mismatch", message: message)
    }

    public static func modelInsufficientDiskSpace(_ message: String) -> AppError {
        AppError(code: "model-insufficient-disk-space", message: message)
    }

    public static func modelIncompatible(_ message: String) -> AppError {
        AppError(code: "model-incompatible", message: message)
    }

    public static func modelNotLoaded(_ message: String) -> AppError {
        AppError(code: "model-not-loaded", message: message)
    }

    public static func engineInitFailed(_ message: String) -> AppError {
        AppError(code: "engine-init-failed", message: message)
    }

    public static func inferenceTimeout(_ message: String) -> AppError {
        AppError(code: "inference-timeout", message: message)
    }

    public static func inferenceEmptyResult(_ message: String) -> AppError {
        AppError(code: "inference-empty-result", message: message)
    }

    public static func outOfMemory(_ message: String) -> AppError {
        AppError(code: "out-of-memory", message: message)
    }

    public static func audioUnsupportedFormat(_ message: String) -> AppError {
        AppError(code: "audio-unsupported-format", message: message)
    }
}
