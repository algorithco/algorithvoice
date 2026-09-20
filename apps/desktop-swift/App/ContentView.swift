import SwiftUI
import AlgorithVoiceCore

/// Temporary PR1 landing view: proves the app target builds and links Core.
/// Replaced by the onboarding/main UI in PR5.
struct ContentView: View {
    var body: some View {
        VStack(spacing: 12) {
            Text("Algorith Voice")
                .font(.title)
            Text("Native macOS app — push-to-talk core lands in PR3.")
                .foregroundStyle(.secondary)
            Text("API: \(BackendConfig.apiBaseURL().absoluteString)")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .padding(32)
        .frame(minWidth: 360, minHeight: 200)
    }
}
