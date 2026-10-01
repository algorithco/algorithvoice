import Foundation

// Voice wire protocol — Swift mirror of
// `packages/shared-types/src/schemas/voice.ts`.
//
// The Zod schemas are the normative reference; these `Codable` types must
// accept exactly what the backend sends and emit exactly what it expects.
// Do not add message types or fields here — the Swift app is a client of an
// existing system.
//
// Transport (frozen backend contract, see
// `apps/backend/src/modules/stt/stt.routes.ts`):
// - `POST /stt/token` mints a short-lived JWT; the socket verifies `?token=`
//   (long-lived access tokens are never accepted in the URL).
// - `GET /stt/stream` is the WebSocket endpoint (currently `not_implemented`
//   server-side; the client must still implement all five server messages).
// - Audio travels as binary PCM16 16kHz mono frames.

// MARK: - STT mode (sttModeSchema: "local" | "cloud" | "byok")

public enum SttMode: String, Codable, Equatable, Sendable, CaseIterable {
    case local
    case cloud
    case byok
}

/// Engine routing for transcription, mirroring `resolve_transcribe_path()`
/// in `push_to_talk.rs`: `cloud` and `byok` both ride the user-keyed path
/// (the desktop key has always been user-supplied, so `byok` needs no
/// separate engine); `local` uses the on-device worker and never touches
/// the network. Anything else fails loudly (caller-version-skew bug).
public enum TranscribePath: Equatable, Sendable {
    case local
    case cloud
}

public func resolveTranscribePath(mode: SttMode?) throws -> TranscribePath {
    switch mode {
    case .none, .cloud, .byok:
        return .cloud
    case .local:
        return .local
    }
}

/// Strict variant that rejects unknown raw strings instead of defaulting,
/// so version skew against `sttModeSchema` fails loudly like the Rust side
/// (only a missing mode defaults to cloud; even `""` is rejected).
public func resolveTranscribePath(rawMode: String?) throws -> TranscribePath {
    guard let rawMode else { return .cloud }
    guard let mode = SttMode(rawValue: rawMode) else {
        throw AppError.internalError("unknown transcription mode: \(rawMode)")
    }
    return try resolveTranscribePath(mode: mode)
}

// MARK: - hello (wsHelloSchema)

/// Client → server handshake. `sampleRate: 16000, codec: "pcm16"` are
/// literals in the schema — the audio tap (PR3) must deliver exactly
/// PCM16 16kHz mono; nothing else may be sent.
public struct WsHello: Codable, Equatable, Sendable {
    public var type: String
    public var sampleRate: Int
    public var codec: String
    public var language: String
    public var sessionId: String

    public init(sessionId: String, language: String = "auto") {
        self.type = "hello"
        self.sampleRate = 16_000
        self.codec = "pcm16"
        self.language = language
        self.sessionId = sessionId
    }

    /// Fail-closed validation of the literal fields (mirrors `.strict()` +
    /// `z.literal` on the wire: a non-conformant hello must never be sent).
    public func validated() throws -> WsHello {
        guard type == "hello" else {
            throw AppError.internalError("ws hello must have type 'hello'")
        }
        guard sampleRate == 16_000 else {
            throw AppError.transcribe("ws hello sampleRate must be 16000")
        }
        guard codec == "pcm16" else {
            throw AppError.transcribe("ws hello codec must be pcm16")
        }
        guard !language.isEmpty, language.count <= 12 else {
            throw AppError.transcribe("ws hello language must be 1-12 chars")
        }
        guard !sessionId.isEmpty else {
            throw AppError.transcribe("ws hello requires a sessionId")
        }
        return self
    }
}

// MARK: - server messages (wsServerMessageSchema discriminated union)

/// Server → client. All five variants must be implemented (PR3 streams
/// `partial` into the pill UI; `fallback`/`error` route to diagnostics).
public enum WsServerMessage: Equatable, Sendable {
    case ready(sessionId: String, provider: String)
    case partial(text: String, confidence: Double?)
    case final(text: String, language: String?, durationSec: Double?)
    case fallback(reason: String)
    case error(code: String, retryAfterMs: Double?)

    private enum Keys: String, CodingKey {
        case type
        case sessionId
        case provider
        case text
        case confidence
        case language
        case durationSec
        case reason
        case code
        case retryAfterMs
    }
}

extension WsServerMessage: Codable {
    public init(from decoder: Decoder) throws {
        let box = try decoder.container(keyedBy: Keys.self)
        let type = try box.decode(String.self, forKey: .type)
        switch type {
        case "ready":
            self = .ready(
                sessionId: try box.decode(String.self, forKey: .sessionId),
                provider: try box.decode(String.self, forKey: .provider)
            )
        case "partial":
            self = .partial(
                text: try box.decode(String.self, forKey: .text),
                confidence: try box.decodeIfPresent(Double.self, forKey: .confidence)
            )
        case "final":
            self = .final(
                text: try box.decode(String.self, forKey: .text),
                language: try box.decodeIfPresent(String.self, forKey: .language),
                durationSec: try box.decodeIfPresent(Double.self, forKey: .durationSec)
            )
        case "fallback":
            self = .fallback(reason: try box.decode(String.self, forKey: .reason))
        case "error":
            self = .error(
                code: try box.decode(String.self, forKey: .code),
                retryAfterMs: try box.decodeIfPresent(Double.self, forKey: .retryAfterMs)
            )
        default:
            throw AppError.transcribe("unknown ws server message type: \(type)")
        }
    }

    public func encode(to encoder: Encoder) throws {
        var box = encoder.container(keyedBy: Keys.self)
        switch self {
        case .ready(let sessionId, let provider):
            try box.encode("ready", forKey: .type)
            try box.encode(sessionId, forKey: .sessionId)
            try box.encode(provider, forKey: .provider)
        case .partial(let text, let confidence):
            try box.encode("partial", forKey: .type)
            try box.encode(text, forKey: .text)
            try box.encodeIfPresent(confidence, forKey: .confidence)
        case .final(let text, let language, let durationSec):
            try box.encode("final", forKey: .type)
            try box.encode(text, forKey: .text)
            try box.encodeIfPresent(language, forKey: .language)
            try box.encodeIfPresent(durationSec, forKey: .durationSec)
        case .fallback(let reason):
            try box.encode("fallback", forKey: .type)
            try box.encode(reason, forKey: .reason)
        case .error(let code, let retryAfterMs):
            try box.encode("error", forKey: .type)
            try box.encode(code, forKey: .code)
            try box.encodeIfPresent(retryAfterMs, forKey: .retryAfterMs)
        }
    }
}

// MARK: - transcript (transcriptSchema)

public struct Transcript: Codable, Equatable, Sendable {
    public var text: String
    public var language: String?
    public var durationSec: Double?
    public var model: String?

    public init(text: String, language: String? = nil, durationSec: Double? = nil, model: String? = nil) {
        self.text = text
        self.language = language
        self.durationSec = durationSec
        self.model = model
    }
}
