import { interpolate, useCurrentFrame } from "remotion";
import { COLORS, FONT_MONO } from "../theme";
import { BigTitle, Caption, Enter, Sub, WaveBars } from "../ui";

/** 0–5s · Hook: what Algorith Voice is. */
export function IntroScene() {
  const frame = useCurrentFrame();
  const glow = interpolate(frame, [0, 60], [0.4, 1], {
    extrapolateRight: "clamp",
  });
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        textAlign: "center",
        padding: "0 120px",
        opacity: glow,
      }}
    >
      <Enter>
        <Caption>Push-to-talk dictation · macOS · Windows · Linux</Caption>
      </Enter>
      <div style={{ height: 28 }} />
      <Enter delay={8}>
        <BigTitle size={150}>Talk faster. Type never.</BigTitle>
      </Enter>
      <div style={{ height: 28 }} />
      <Enter delay={16}>
        <Sub>
          Hold the hotkey, speak, and text lands at the cursor — terminal,
          editor, browser, anywhere.
        </Sub>
      </Enter>
      <div style={{ height: 56 }} />
      <Enter delay={24}>
        <WaveBars count={64} height={170} barWidth={11} />
      </Enter>
      <Enter delay={30}>
        <div
          style={{
            marginTop: 44,
            display: "flex",
            gap: 16,
            alignItems: "center",
            fontFamily: FONT_MONO,
            fontSize: 24,
            color: COLORS.sub,
          }}
        >
          <span
            style={{
              backgroundColor: COLORS.ink,
              color: "#000",
              borderRadius: 999,
              padding: "14px 34px",
              fontWeight: 600,
            }}
          >
            0.6s median latency
          </span>
          <span
            style={{
              border: `1px solid ${COLORS.border}`,
              borderRadius: 999,
              padding: "14px 34px",
            }}
          >
            60 free cloud minutes / month
          </span>
        </div>
      </Enter>
    </div>
  );
}
