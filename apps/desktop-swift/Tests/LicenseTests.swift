import XCTest
@testable import AlgorithVoiceCore

/// License grace-period math (DECISIONS.md item 5: 3 seats, 7-day offline grace).
final class LicenseTests: XCTestCase {
    private let day: TimeInterval = 24 * 3_600

    private func license(expiresInDays days: Double, seatsUsed: Int = 1, now: Date) -> CachedLicense {
        CachedLicense(
            licenseJwt: "jwt",
            expiresAt: now.addingTimeInterval(days * day),
            seatsUsed: seatsUsed
        )
    }

    func testValidLicenseUsableOnlineAndOffline() {
        let now = Date()
        XCTAssertTrue(license(expiresInDays: 30, now: now).isUsable(at: now, offline: false))
        XCTAssertTrue(license(expiresInDays: 30, now: now).isUsable(at: now, offline: true))
    }

    func testExpiredLicenseBlockedOnlineButGracedOffline() {
        let now = Date()
        let expired = license(expiresInDays: -3, now: now) // 3 days past expiry
        XCTAssertFalse(expired.isUsable(at: now, offline: false))
        XCTAssertTrue(expired.isUsable(at: now, offline: true))
    }

    func testGraceExpiresAfterSevenDays() {
        let now = Date()
        let justInside = license(expiresInDays: -7, now: now).isUsable(at: now, offline: true)
        XCTAssertTrue(justInside)
        let outside = license(expiresInDays: -8, now: now)
        XCTAssertFalse(outside.isUsable(at: now, offline: true))
        XCTAssertFalse(outside.isUsable(at: now, offline: false))
    }

    func testSeatsOverLimitBlocksEvenWhenValid() {
        let now = Date()
        let over = license(expiresInDays: 30, seatsUsed: 4, now: now)
        XCTAssertFalse(over.isUsable(at: now, offline: false))
        XCTAssertFalse(over.isUsable(at: now, offline: true))
        let atCap = license(expiresInDays: 30, seatsUsed: 3, now: now)
        XCTAssertTrue(atCap.isUsable(at: now, offline: false))
    }

    func testGraceRemainingNilWhileValid() {
        let now = Date()
        XCTAssertNil(license(expiresInDays: 30, now: now).graceRemaining(at: now))
        let remaining = license(expiresInDays: -3, now: now).graceRemaining(at: now)
        XCTAssertNotNil(remaining)
        XCTAssertTrue((remaining ?? 0) > 3 * day)
        XCTAssertTrue((remaining ?? 0) < 5 * day)
    }

    func testBackendConfigResolutionOrder() {
        let explicit = BackendConfig.apiBaseURL(
            environment: ["ALGORITHVOICE_API_URL": "https://api.example.com"],
            development: true
        )
        XCTAssertEqual(explicit.absoluteString, "https://api.example.com")
        let vite = BackendConfig.apiBaseURL(environment: ["VITE_API_URL": "https://vite.example.com"])
        XCTAssertEqual(vite.absoluteString, "https://vite.example.com")
        XCTAssertEqual(
            BackendConfig.apiBaseURL(environment: [:], development: true).absoluteString,
            "http://127.0.0.1:3001"
        )
        XCTAssertEqual(
            BackendConfig.apiBaseURL(environment: [:], development: false).absoluteString,
            "https://api.trqsh.uz"
        )
        // Blank overrides fall through instead of producing an invalid URL.
        XCTAssertEqual(
            BackendConfig.apiBaseURL(environment: ["ALGORITHVOICE_API_URL": "  "]).absoluteString,
            "https://api.trqsh.uz"
        )
    }

    func testTrayStateTooltipsMatchRust() {
        XCTAssertEqual(TrayState.idle.tooltip, "Algorith Voice")
        XCTAssertEqual(TrayState.recording.tooltip, "Algorith Voice — recording")
        XCTAssertEqual(TrayState.processing.tooltip, "Algorith Voice — processing")
        XCTAssertEqual(TrayState(rawValue: "recording"), .recording)
    }
}
