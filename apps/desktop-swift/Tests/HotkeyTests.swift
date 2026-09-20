import XCTest
@testable import AlgorithVoiceCore

/// Port of the `normalize_hotkey()` contract in
/// `apps/desktop-tauri/src-tauri/src/lib.rs`. Every rule the Rust side
/// enforces is pinned here so both clients accept/reject the same strings.
final class HotkeyTests: XCTestCase {
    func testAcceptsDefaultHotkey() throws {
        XCTAssertEqual(try HotkeyValidator.normalize("Ctrl+Space"), "Ctrl+Space")
    }

    func testTrimsSurroundingWhitespace() throws {
        XCTAssertEqual(try HotkeyValidator.normalize("  Ctrl+Space  "), "Ctrl+Space")
    }

    func testRejectsEmpty() {
        XCTAssertThrowsError(try HotkeyValidator.normalize(""), "empty hotkey") { error in
            XCTAssertEqual((error as? AppError)?.code, "shortcut")
        }
        XCTAssertThrowsError(try HotkeyValidator.normalize("   "))
    }

    func testRejectsTooLong() {
        let long = "Ctrl+" + String(repeating: "a", count: 28) // 33 chars
        XCTAssertTrue(long.count > 32)
        XCTAssertThrowsError(try HotkeyValidator.normalize(long)) { error in
            XCTAssertEqual((error as? AppError)?.code, "shortcut")
        }
    }

    func testRejectsUnsupportedCharacters() {
        for bad in ["Ctrl+Space!", "Ctrl+é", "Ctrl+Space.", "Ctrl+/"] {
            XCTAssertThrowsError(try HotkeyValidator.normalize(bad), "must reject \(bad)")
        }
    }

    func testAcceptsAllowedPunctuation() throws {
        // `-`, `_`, space are legal characters (e.g. multi-word key names).
        XCTAssertEqual(try HotkeyValidator.normalize("Ctrl+Page_Down"), "Ctrl+Page_Down")
        XCTAssertEqual(try HotkeyValidator.normalize("Shift+F1"), "Shift+F1")
    }

    func testRejectsMissingKey() {
        XCTAssertThrowsError(try HotkeyValidator.normalize("Ctrl+")) { _ in }
    }

    func testRequiresModifierPlusKey() {
        // Single keys and bare words must never hijack typing.
        for bad in ["Space", "a", "F5", "Ctrl", "Shift", "Ctrl Space"] {
            XCTAssertThrowsError(try HotkeyValidator.normalize(bad), "must reject \(bad)")
        }
    }

    func testAcceptsAllModifierSpellings() throws {
        for good in ["Ctrl+A", "Alt+A", "Shift+A", "Super+A", "Meta+A", "Command+A", "Cmd+A"] {
            XCTAssertEqual(try HotkeyValidator.normalize(good), good)
        }
    }

    func testRejectsReservedCombos() {
        let blockedCombos = [
            "Alt+F4", "Ctrl+Alt+Del", "Ctrl+Alt+Delete", "Super+L",
            "Meta+L", "Ctrl+Q", "Alt+Tab", "Super+D",
        ]
        for blocked in blockedCombos {
            XCTAssertThrowsError(try HotkeyValidator.normalize(blocked), "must reject \(blocked)") { error in
                XCTAssertEqual((error as? AppError)?.code, "shortcut")
            }
            // Case-insensitive: the blocklist compares lowercased.
            XCTAssertThrowsError(try HotkeyValidator.normalize(blocked.lowercased()))
        }
    }

    func testRejectsEmptySegments() {
        for bad in ["Ctrl++A", "+Ctrl+A", "Ctrl+A+"] {
            XCTAssertThrowsError(try HotkeyValidator.normalize(bad), "must reject \(bad)")
        }
    }
}
