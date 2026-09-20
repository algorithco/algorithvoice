import Foundation

/// Backend endpoint resolution — same convention as the Tauri app, no new mechanism.
///
/// The Tauri frontend resolves its API base as (`apps/desktop-tauri/src/lib/session/auth.ts`):
/// `VITE_API_URL` env → dev `http://localhost:3001` → prod `https://api.algorithvoice.com`.
/// The Swift app follows the same order (accepting both `ALGORITHVOICE_API_URL`
/// and `VITE_API_URL` so one exported variable serves both clients), with two
/// macOS-appropriate notes:
/// - production validation rejects `localhost` (cookies/CORS line up with the
///   container `APP_URL`), so loopback is dev-only by construction;
/// - no hardcoded secrets or per-build URLs: override points are the
///   environment and (from PR5) a build-config plist entry, never literals.
///
/// No endpoints are invented here — paths (`/auth/*`, `/stt/token`,
/// `/stt/stream`) come from the existing backend routes.
public enum BackendConfig: Sendable {
    public static let productionBase = "https://api.algorithvoice.com"
    public static let developmentBase = "http://127.0.0.1:3001"

    /// Resolve the API base URL.
    /// - Parameters:
    ///   - environment: injected for tests (defaults to the process environment).
    ///   - development: true for debug builds (mirrors `import.meta.env.DEV`).
    public static func apiBaseURL(
        environment: [String: String] = ProcessInfo.processInfo.environment,
        development: Bool = false
    ) -> URL {
        let override = environment["ALGORITHVOICE_API_URL"].flatMap(trimmedNonEmpty)
            ?? environment["VITE_API_URL"].flatMap(trimmedNonEmpty)
        if let override, let url = URL(string: override), url.scheme != nil {
            return url
        }
        let fallback = development ? developmentBase : productionBase
        // The literals above are known-valid URLs; fall back to production
        // rather than crashing if URL parsing ever surprises us.
        return URL(string: fallback) ?? URL(string: productionBase) ?? URL(fileURLWithPath: "/")
    }

    private static func trimmedNonEmpty(_ value: String) -> String? {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }
}
