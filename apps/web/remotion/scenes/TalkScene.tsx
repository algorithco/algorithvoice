import { interpolate, useCurrentFrame } from "remotion";
import { COLORS, FONT_MONO } from "../theme";
import { BigTitle, Caption, Enter, Kbd, WaveBars } from "../ui";

const TYPED = "refactor the auth module and add tests";

/** 15–25s · The core loop: hold → speak → release → text lands. */
export function TalkScene() {
  const frame = useCurrentFrame();
  // Simulated hold: pressed between f10 and f150, then "typed" text appears.
  const holding = frame >= 10 && frame < 160;
  const releaseAt = 160;
  const chars = Math.max(
    0,
    Math.min(
      TYPED.length,
      Math.floor(((frame - releaseAt) / 90) * TYPED.length),
    ),
  );
  const pillScale = interpolate(frame, [10, 25, 150, 165], [1, 1.12, 1.12, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const ringOpacity = holding ? 0.5 + 0.5 * Math.sin(frame / 4) : 0;

  return (
    <div style={{ position: "absolute", inset: 0, padding: "190px 96px 0" }}>
      <Enter>
        <Caption>Step 2 · The 3-second loop</Caption>
      </Enter>
      <div style={{ height: 20 }} />
      <Enter delay={6}>
        <BigTitle size={92}>Hold. Speak. Release.</BigTitle>
      </Enter>
      <div style={{ height: 40 }} />
      <div style={{ display: "flex", gap: 48, alignItems: "stretch" }}>
        {/* Left: hotkey press simulation */}
        <Enter delay={12}>
          <div
            style={{
              width: 800,
              backgroundColor: COLORS.surface,
              border: `1px solid ${COLORS.border}`,
              borderRadius: 28,
              padding: 56,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
              <Kbd>Ctrl</Kbd>
              <span style={{ fontSize: 44, color: COLORS.faint }}>+</span>
              <Kbd>Space</Kbd>
              <span
                style={{
                  marginLeft: 12,
                  fontFamily: FONT_MONO,
                  fontSize: 24,
                  letterSpacing: 2,
                  textTransform: "uppercase",
                  color: holding ? "#000" : COLORS.sub,
                  backgroundColor: holding ? COLORS.ink : "transparent",
                  border: `1px solid ${holding ? COLORS.ink : COLORS.border}`,
                  borderRadius: 999,
                  padding: "12px 28px",
                }}
              >
                {holding ? "● recording" : "hold to talk"}
              </span>
            </div>
            <div style={{ height: 36 }} />
            <WaveBars count={44} height={130} barWidth={10} active={holding} />
            <div
              style={{
                marginTop: 28,
                fontFamily: FONT_MONO,
                fontSize: 24,
                color: COLORS.faint,
              }}
            >
              {holding
                ? "…listening — release to transcribe"
                : frame < 10
                  ? "press and hold Ctrl+Space"
                  : "released → transcribed in ~0.6s"}
            </div>
          </div>
        </Enter>
        {/* Right: cursor landing + floating pill */}
        <Enter delay={22}>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 32,
              width: 760,
            }}
          >
            <div
              style={{
                backgroundColor: "#000",
                border: `1px solid ${COLORS.border}`,
                borderRadius: 28,
                padding: 48,
              }}
            >
              <div
                style={{
                  fontFamily: FONT_MONO,
                  fontSize: 24,
                  color: COLORS.faint,
                  marginBottom: 16,
                }}
              >
                terminal — cursor
              </div>
              <div
                style={{ fontFamily: FONT_MONO, fontSize: 34, lineHeight: 1.5 }}
              >
                <span style={{ color: COLORS.faint }}>$ </span>
                <span>{TYPED.slice(0, chars)}</span>
                <span
                  style={{
                    display: "inline-block",
                    width: 20,
                    height: 40,
                    backgroundColor: COLORS.ink,
                    verticalAlign: -6,
                    marginLeft: 6,
                    opacity: frame % 20 < 10 ? 1 : 0,
                  }}
                />
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 28 }}>
              <div
                style={{
                  width: 144,
                  height: 144,
                  borderRadius: 999,
                  backgroundColor: holding ? COLORS.ink : COLORS.raised,
                  color: holding ? "#000" : COLORS.ink,
                  border: `3px solid ${COLORS.ink}`,
                  boxShadow: `0 0 ${holding ? 90 : 30}px rgba(255,255,255,${ringOpacity})`,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 56,
                  transform: `scale(${pillScale})`,
                }}
              >
                ◉
              </div>
              <div style={{ fontSize: 30, color: COLORS.sub, lineHeight: 1.4 }}>
                The 72×72 floating pill.
                <br />
                Drag its edge anywhere.
              </div>
            </div>
          </div>
        </Enter>
      </div>
    </div>
  );
}
