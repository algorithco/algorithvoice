import { COLORS } from "../theme";
import { BigTitle, Caption, Enter } from "../ui";

const TIPS = [
  [
    "Hold < 300ms?",
    "Under 300 ms or 2 KB is discarded as accidental — never billed.",
  ],
  ["Esc cancels", "Changed your mind mid-sentence? Esc drops the recording."],
  [
    "120s max",
    "Hard stop at 120 seconds — the pill says “Max length reached”.",
  ],
  [
    "Paste fails?",
    "Wayland: ydotool + clipboard mode. macOS: grant Accessibility.",
  ],
  [
    "Elevated app?",
    "On Windows, run Algorith Voice elevated to paste into admin apps.",
  ],
  [
    "Pill missing?",
    "Dictate → Show pill, or restart — it auto-shows after onboarding.",
  ],
] as const;

/** 43–52s · Rules + troubleshooting. */
export function TipsScene() {
  return (
    <div style={{ position: "absolute", inset: 0, padding: "190px 96px 0" }}>
      <Enter>
        <Caption>Step 5 · Good habits & fixes</Caption>
      </Enter>
      <div style={{ height: 20 }} />
      <Enter delay={6}>
        <BigTitle size={92}>Three rules. Zero surprises.</BigTitle>
      </Enter>
      <div style={{ height: 40 }} />
      <div
        style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 24 }}
      >
        {TIPS.map(([k, v], i) => (
          <Enter key={k} delay={14 + i * 7}>
            <div
              style={{
                backgroundColor: COLORS.surface,
                border: `1px solid ${COLORS.border}`,
                borderRadius: 22,
                padding: "30px 34px",
                minHeight: 210,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                <div
                  style={{
                    width: 52,
                    height: 52,
                    borderRadius: 999,
                    border: `1px solid ${COLORS.border}`,
                    backgroundColor: COLORS.raised,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 26,
                    fontWeight: 600,
                  }}
                >
                  {i + 1}
                </div>
                <div style={{ fontSize: 31, fontWeight: 600 }}>{k}</div>
              </div>
              <div
                style={{
                  marginTop: 16,
                  fontSize: 27,
                  lineHeight: 1.45,
                  color: COLORS.sub,
                }}
              >
                {v}
              </div>
            </div>
          </Enter>
        ))}
      </div>
    </div>
  );
}
