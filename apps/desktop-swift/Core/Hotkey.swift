import Foundation

/// Global push-to-talk hotkey validation.
///
/// Exact port of `normalize_hotkey()` in
/// `apps/desktop-tauri/src-tauri/src/lib.rs`. Every rule below mirrors the
/// Rust implementation 1:1 so both clients accept/reject the same strings:
/// - non-empty, max 32 chars
/// - only ASCII alphanumerics plus `+ - _ space`
/// - must contain at least one alphanumeric key
/// - must include a modifier (Ctrl/Alt/Shift/Super/Meta/Command/Cmd) + `+`
/// - OS-reserved combos are rejected
/// - no empty segments (`Ctrl++A`, leading/trailing `+`)
public enum HotkeyValidator: Sendable {
    /// OS-reserved combos, compared case-insensitively against the whole string.
    private static let blocked: Set<String> = [
        "alt+f4",
        "ctrl+alt+del",
        "ctrl+alt+delete",
        "super+l",
        "meta+l",
        "ctrl+q",
        "alt+tab",
        "super+d"
    ]

    private static let modifiers = ["ctrl", "alt", "shift", "super", "meta", "command", "cmd"]

    /// Validate `raw` and return the trimmed canonical form.
    /// - Throws: `AppError` with code `"shortcut"`, same messages as Rust.
    public static func normalize(_ raw: String) throws -> String {
        let hotkey = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        if hotkey.isEmpty {
            throw AppError.shortcut("hotkey must not be empty")
        }
        if hotkey.count > 32 {
            throw AppError.shortcut("hotkey too long (max 32)")
        }
        let allowed = hotkey.allSatisfy { char in
            char.isASCII && (char.isLetter || char.isNumber || char == "+" || char == "-" || char == "_" || char == " ")
        }
        if !allowed {
            throw AppError.shortcut("hotkey contains unsupported characters")
        }
        if !hotkey.contains(where: { $0.isASCII && ($0.isLetter || $0.isNumber) }) {
            throw AppError.shortcut("hotkey must contain a key")
        }
        let lower = hotkey.lowercased()
        let hasModifier = modifiers.contains(where: { lower.range(of: $0) != nil })
        if !hasModifier || lower.range(of: "+") == nil {
            throw AppError.shortcut(
                "hotkey must include a modifier (Ctrl/Alt/Shift/Super) + key, e.g. Ctrl+Space"
            )
        }
        if blocked.contains(lower) {
            throw AppError.shortcut("hotkey is reserved by the OS")
        }
        if hotkey.range(of: "++") != nil || hotkey.hasPrefix("+") || hotkey.hasSuffix("+") {
            throw AppError.shortcut("hotkey format is invalid")
        }
        return hotkey
    }
}
