import type React from "react";
import {
  AbsoluteFill,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import {
  CHAPTERS,
  COLORS,
  chapterAtFrame,
  FONT_MONO,
  FONT_SANS,
} from "./theme";

/* Shared chrome + primitives so every scene keeps the V5 black look. */

export function Bg({ children }: { children: React.ReactNode }) {
  return (
    <AbsoluteFill
      style={{
        backgroundColor: COLORS.bg,
        color: COLORS.ink,
        fontFamily: FONT_SANS,
        // subtle monochrome glow + hairline grid, same language as the site
        backgroundImage:
          "radial-gradient(ellipse 90% 55% at 50% 0%, rgba(255,255,255,0.09), transparent 70%), repeating-linear-gradient(to right, rgba(255,255,255,0.05) 0, rgba(255,255,255,0.05) 1px, transparent 1px, transparent 72px), repeating-linear-gradient(to bottom, rgba(255,255,255,0.05) 0, rgba(255,255,255,0.05) 1px, transparent 1px, transparent 72px)",
      }}
    >
      {children}
    </AbsoluteFill>
  );
}

export function TopBar() {
  return (
    <div
      style={{
        position: "absolute",
        top: 56,
        left: 96,
        right: 96,
        display: "flex",
        alignItems: "center",
        gap: 16,
      }}
    >
      <div
        style={{
          width: 44,
          height: 44,
          borderRadius: 12,
          border: `1px solid ${COLORS.border}`,
          backgroundColor: COLORS.raised,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 22,
          fontWeight: 700,
        }}
      >
        A
      </div>
      <div style={{ fontSize: 30, fontWeight: 600, letterSpacing: -0.5 }}>
        Algorith Voice
      </div>
      <div style={{ fontSize: 24, color: COLORS.sub }}>by Algorithco</div>
      <div
        style={{
          marginLeft: "auto",
          fontFamily: FONT_MONO,
          fontSize: 22,
          letterSpacing: 2,
          textTransform: "uppercase",
          color: COLORS.faint,
          border: `1px solid ${COLORS.border}`,
          borderRadius: 999,
          padding: "10px 24px",
          backgroundColor: COLORS.surface,
        }}
      >
        How to use · 60s
      </div>
    </div>
  );
}

/** Chapter progress bar + current chapter label (global timeline). */
export function Progress() {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const current = chapterAtFrame(frame);
  const pct = (frame / Math.max(1, durationInFrames - 1)) * 100;
  return (
    <div style={{ position: "absolute", left: 96, right: 96, bottom: 64 }}>
      <div style={{ display: "flex", gap: 12, marginBottom: 18 }}>
        {CHAPTERS.map((c) => {
          const active = c.id === current.id;
          const done = frame >= c.from + c.durationInFrames;
          return (
            <div key={c.id} style={{ flex: 1 }}>
              <div
                style={{
                  height: 6,
                  borderRadius: 999,
                  backgroundColor: COLORS.raised,
                  overflow: "hidden",
                  border: `1px solid ${COLORS.border}`,
                }}
              >
                <div
                  style={{
                    height: "100%",
                    width: done
                      ? "100%"
                      : active
                        ? `${Math.min(100, Math.max(0, ((frame - c.from) / c.durationInFrames) * 100))}%`
                        : "0%",
                    backgroundColor: COLORS.ink,
                  }}
                />
              </div>
              <div
                style={{
                  marginTop: 10,
                  fontFamily: FONT_MONO,
                  fontSize: 17,
                  letterSpacing: 1.2,
                  textTransform: "uppercase",
                  color: active ? COLORS.ink : COLORS.faint,
                }}
              >
                {c.label}
              </div>
            </div>
          );
        })}
      </div>
      <div
        style={{
          height: 2,
          backgroundColor: COLORS.border,
          position: "relative",
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: 0,
            width: `${pct}%`,
            backgroundColor: COLORS.ink,
          }}
        />
      </div>
    </div>
  );
}

export function Caption({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontFamily: FONT_MONO,
        fontSize: 26,
        letterSpacing: 3,
        textTransform: "uppercase",
        color: COLORS.sub,
      }}
    >
      {children}
    </div>
  );
}

export function BigTitle({
  children,
  size = 110,
}: {
  children: React.ReactNode;
  size?: number;
}) {
  return (
    <div
      style={{
        fontSize: size,
        lineHeight: 1.05,
        fontWeight: 700,
        letterSpacing: -3,
      }}
    >
      {children}
    </div>
  );
}

export function Sub({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: 36,
        lineHeight: 1.45,
        color: COLORS.sub,
        maxWidth: 1400,
      }}
    >
      {children}
    </div>
  );
}

export function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <span
      style={{
        fontFamily: FONT_MONO,
        fontSize: 34,
        fontWeight: 500,
        border: `2px solid ${COLORS.border}`,
        backgroundColor: COLORS.raised,
        borderRadius: 14,
        padding: "14px 30px",
        display: "inline-block",
      }}
    >
      {children}
    </span>
  );
}

/** Animated waveform bars (pure divs — no assets needed). */
export function WaveBars({
  count = 56,
  barWidth = 10,
  height = 150,
  active = true,
}: {
  count?: number;
  barWidth?: number;
  height?: number;
  active?: boolean;
}) {
  const frame = useCurrentFrame();
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, height }}>
      {Array.from({ length: count }, (_, i) => {
        const base =
          0.25 + 0.75 * Math.abs(Math.sin(i * 1.7) * Math.cos(i * 0.55) + 0.25);
        const wobble = active
          ? 0.35 * Math.abs(Math.sin(frame / 6 + i * 0.7))
          : 0;
        const h = Math.round((base * 0.7 + wobble) * height);
        return (
          <div
            // biome-ignore lint/suspicious/noArrayIndexKey: waveform bars are static-order visuals
            key={`bar-${i}`}
            style={{
              width: barWidth,
              height: Math.max(8, Math.min(height, h)),
              borderRadius: 999,
              backgroundColor: COLORS.ink,
              opacity: 0.9,
            }}
          />
        );
      })}
    </div>
  );
}

/** Fade+rise entrance helper for scenes. */
export function Enter({
  children,
  delay = 0,
  slide = 40,
}: {
  children: React.ReactNode;
  delay?: number;
  slide?: number;
}) {
  const frame = useCurrentFrame();
  const local = Math.max(0, frame - delay);
  const opacity = interpolate(local, [0, 14], [0, 1], {
    extrapolateRight: "clamp",
  });
  const y = interpolate(local, [0, 18], [slide, 0], {
    extrapolateRight: "clamp",
  });
  return (
    <div style={{ opacity, transform: `translateY(${y}px)` }}>{children}</div>
  );
}

export function Card({
  children,
  width,
}: {
  children: React.ReactNode;
  width?: number | string;
}) {
  return (
    <div
      style={{
        width,
        backgroundColor: COLORS.surface,
        border: `1px solid ${COLORS.border}`,
        borderRadius: 28,
        padding: 48,
      }}
    >
      {children}
    </div>
  );
}

export function Code({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontFamily: FONT_MONO,
        fontSize: 27,
        backgroundColor: "#000",
        border: `1px solid ${COLORS.border}`,
        borderRadius: 14,
        padding: "20px 26px",
        marginTop: 24,
        whiteSpace: "pre-wrap",
      }}
    >
      <span style={{ color: COLORS.faint }}>$ </span>
      {children}
    </div>
  );
}
