import Foundation

/// Menu-bar (tray) icon state.
///
/// Mirrors `TrayState` in `apps/desktop-tauri/src-tauri/src/state.rs`:
/// same three states, same lowercase wire strings (`"idle" | "recording" |
/// "processing"`), same tooltip text as `apply_tray_icon` / `set_tray_state`
/// in `lib.rs`. Rendered natively via `NSStatusItem` (PR5).
public enum TrayState: String, Codable, Equatable, Sendable, CaseIterable {
    case idle
    case recording
    case processing

    /// Tooltip shown on the menu-bar icon, exactly as the Rust side sets it.
    public var tooltip: String {
        switch self {
        case .recording:
            return "Algorith Voice — recording"
        case .processing:
            return "Algorith Voice — processing"
        case .idle:
            return "Algorith Voice"
        }
    }

    /// Asset name for the state icon (monochrome template images live in
    /// `Resources/` from PR5; names match the Tauri `tray-*.png` set).
    public var iconAssetName: String {
        switch self {
        case .recording:
            return "tray-recording"
        case .processing:
            return "tray-processing"
        case .idle:
            return "tray-idle"
        }
    }
}
