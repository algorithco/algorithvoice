import SwiftUI

/// Algorith Voice — native macOS entry point (PR1: shell only).
///
/// Concurrency: this target sets `.defaultIsolation(MainActor.self)`
/// (SE-0466), so this type and all UI code below are implicitly
/// `@MainActor` — no annotation needed, single-threaded by default.
/// Anything CPU-heavy (audio tap, hashing, inference) will be an explicit
/// `nonisolated` type or `@concurrent` function in PR3/PR4, never an
/// accidental background hop.
///
/// PR roadmap for this target:
/// - PR3: global hotkey (CGEventTap) + floating pill (`NSPanel`
///   `.nonactivatingPanel`) + `AVAudioEngine` PCM16/16kHz/mono tap + cloud STT.
/// - PR4: local STT (sherpa-onnx XCFramework via official SPM support) +
///   resumable model downloader.
/// - PR5: `NSStatusItem` tray, Settings window, license/billing UI.
/// - PR6: Sparkle auto-update (stable channel) + signed/notarized `.dmg`.
@main
struct AlgorithVoiceApp: App {
    var body: some Scene {
        WindowGroup {
            ContentView()
        }
        .windowResizability(.contentSize)
    }
}
