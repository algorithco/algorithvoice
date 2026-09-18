import { COLORS, FONT_MONO } from "../theme";
import { BigTitle, Caption, Enter, Sub } from "../ui";

/** 25–35s · Local (offline) vs Cloud (Groq). */
export function ModesScene() {
  return (
    <div style={{ position: "absolute", inset: 0, padding: "190px 96px 0" }}>
      <Enter>
        <Caption>Step 3 · Pick a mode</Caption>
      </Enter>
      <div style={{ height: 20 }} />
      <Enter delay={6}>
        <BigTitle size={92}>Local-first. Cloud optional.</BigTitle>
      </Enter>
      <div style={{ height: 16 }} />
      <Enter delay={12}>
        <Sub>
          Audio never leaves your device in local mode. Cloud is opt-in.
        </Sub>
      </Enter>
      <div style={{ height: 44 }} />
      <div style={{ display: "flex", gap: 32 }}>
        <Enter delay={18}>
          <div
            style={{
              width: 840,
              border: `2px solid ${COLORS.ink}`,
              backgroundColor: COLORS.surface,
              borderRadius: 28,
              padding: 52,
            }}
          >
            <div
              style={{
                display: "inline-block",
                fontFamily: FONT_MONO,
                fontSize: 22,
                letterSpacing: 2,
                textTransform: "uppercase",
                backgroundColor: COLORS.ink,
                color: "#000",
                borderRadius: 999,
                padding: "10px 26px",
                fontWeight: 600,
              }}
            >
              Recommended · offline
            </div>
            <div style={{ fontSize: 52, fontWeight: 700, marginTop: 24 }}>
              Local mode
            </div>
            <div
              style={{
                fontSize: 32,
                color: COLORS.sub,
                marginTop: 16,
                lineHeight: 1.5,
              }}
            >
              sherpa-onnx · int8 · 6 models. Audio re-encoded to 16&nbsp;kHz WAV
              on-device and never uploaded.
            </div>
            <div
              style={{
                fontFamily: FONT_MONO,
                fontSize: 25,
                color: COLORS.faint,
                marginTop: 24,
              }}
            >
              prefs.mode = local + activeModelId
            </div>
          </div>
        </Enter>
        <Enter delay={30}>
          <div
            style={{
              width: 840,
              border: `1px solid ${COLORS.border}`,
              backgroundColor: COLORS.surface,
              borderRadius: 28,
              padding: 52,
            }}
          >
            <div
              style={{
                display: "inline-block",
                fontFamily: FONT_MONO,
                fontSize: 22,
                letterSpacing: 2,
                textTransform: "uppercase",
                border: `1px solid ${COLORS.border}`,
                color: COLORS.sub,
                borderRadius: 999,
                padding: "10px 26px",
              }}
            >
              Opt-in · streamed
            </div>
            <div style={{ fontSize: 52, fontWeight: 700, marginTop: 24 }}>
              Cloud mode
            </div>
            <div
              style={{
                fontSize: 32,
                color: COLORS.sub,
                marginTop: 16,
                lineHeight: 1.5,
              }}
            >
              whisper-large-v3-turbo via Groq — streamed only while you hold the
              hotkey. Key in OS keyring or BYOK.
            </div>
            <div
              style={{
                fontFamily: FONT_MONO,
                fontSize: 25,
                color: COLORS.faint,
                marginTop: 24,
              }}
            >
              prefs.mode = cloud
            </div>
          </div>
        </Enter>
      </div>
    </div>
  );
}
