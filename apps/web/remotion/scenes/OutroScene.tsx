import { COLORS, FONT_MONO } from "../theme";
import { BigTitle, Caption, Enter, Sub } from "../ui";

/** 52–60s · CTA: free plan + where to go next. */
export function OutroScene() {
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
      }}
    >
      <Enter>
        <Caption>Pricing · Free until it earns its keep</Caption>
      </Enter>
      <div style={{ height: 24 }} />
      <Enter delay={8}>
        <BigTitle size={130}>Free until it earns its keep.</BigTitle>
      </Enter>
      <div style={{ height: 24 }} />
      <Enter delay={16}>
        <Sub>
          60 cloud minutes monthly · unlimited local dictation · 2 devices. Pro
          is $12/month when dictation becomes the way you work.
        </Sub>
      </Enter>
      <div style={{ height: 52 }} />
      <Enter delay={24}>
        <div style={{ display: "flex", gap: 20, justifyContent: "center" }}>
          <div
            style={{
              backgroundColor: COLORS.ink,
              color: "#000",
              fontSize: 36,
              fontWeight: 600,
              borderRadius: 16,
              padding: "24px 64px",
            }}
          >
            Download free →
          </div>
          <div
            style={{
              border: `1px solid ${COLORS.border}`,
              color: COLORS.ink,
              fontSize: 36,
              fontWeight: 600,
              borderRadius: 16,
              padding: "24px 64px",
            }}
          >
            Setup guide →
          </div>
        </div>
      </Enter>
      <Enter delay={32}>
        <div
          style={{
            marginTop: 48,
            fontFamily: FONT_MONO,
            fontSize: 24,
            letterSpacing: 1.5,
            color: COLORS.faint,
          }}
        >
          algorithvoice.com · /download · /docs · /pricing
        </div>
      </Enter>
    </div>
  );
}
