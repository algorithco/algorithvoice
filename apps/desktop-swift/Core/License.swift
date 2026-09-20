import Foundation

/// Device-license cache + offline grace enforcement.
///
/// Product contract (DECISIONS.md item 5; `packages/shared-types` license
/// schemas): 3 seats per user, 7-day offline grace. The app caches the
/// license JWT after `license.routes.ts` activation and enforces client-side:
/// - online + unexpired + seats available → usable
/// - offline + within 7 days past expiry → usable (grace window)
/// - offline + past grace, or seats over limit → blocked
///
/// `deviceFingerprint` (activation input) is a stable macOS hardware
/// identifier (`IOPlatformUUID` via IOKit — wired in PR5); this module only
/// owns the expiry/grace math so it stays unit-testable with injected dates.
public struct CachedLicense: Codable, Equatable, Sendable {
    /// Raw license JWT from activation (stored in Keychain, never UserDefaults).
    public var licenseJwt: String
    /// Expiry decoded from the JWT (`exp`).
    public var expiresAt: Date
    public var seatsUsed: Int
    public var seatsMax: Int

    /// 7-day offline grace period (DECISIONS.md item 5).
    public static let offlineGrace: TimeInterval = 7 * 24 * 3_600
    /// Default seat cap for new activations (`seatsMax: 3`).
    public static let defaultSeatsMax = 3

    public init(licenseJwt: String, expiresAt: Date, seatsUsed: Int, seatsMax: Int = defaultSeatsMax) {
        self.licenseJwt = licenseJwt
        self.expiresAt = expiresAt
        self.seatsUsed = seatsUsed
        self.seatsMax = seatsMax
    }

    public var seatsAvailable: Bool { seatsUsed <= seatsMax }

    /// Whether dictation (cloud path) may proceed right now.
    /// - Parameters:
    ///   - now: injected for tests (defaults to now).
    ///   - offline: true when the backend is unreachable.
    public func isUsable(at now: Date = Date(), offline: Bool) -> Bool {
        guard seatsAvailable else { return false }
        if now <= expiresAt { return true }
        guard offline else { return false }
        return now <= expiresAt.addingTimeInterval(Self.offlineGrace)
    }

    /// Remaining grace when already expired (nil while still valid).
    public func graceRemaining(at now: Date = Date()) -> TimeInterval? {
        guard now > expiresAt else { return nil }
        let remaining = expiresAt.addingTimeInterval(Self.offlineGrace).timeIntervalSince(now)
        return max(remaining, 0)
    }
}
