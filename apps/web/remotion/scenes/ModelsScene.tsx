import { COLORS, FONT_MONO } from "../theme";
import { BigTitle, Caption, Enter, Sub } from "../ui";

const MODELS: [string, string, string][] = [
  ["parakeet-tdt-0.6b-v3", "~670 MB", "25 langs"],
  ["whisper-small", "~375 MB", "99 langs"],
  ["whisper-large-v3-turbo", "~1.0 GB", "99 langs"],
  ["whisper-large-v3", "~1.7 GB", "99 langs"],
  ["qwen3-asr-1.7b", "~2.4 GB", "5 langs"],
  ["distil-large-v3.5", "~983 MB", "1 lang"],
];

/** 35–43s · 6 on-device models. */
export function ModelsScene() {
  return (
    <div style={{ position: "absolute", inset: 0, padding: "190px 96px 0" }}>
      <Enter>
        <Caption>Step 4 · 6 on-device models</Caption>
      </Enter>
      <div style={{ height: 20 }} />
      <Enter delay={6}>
        <BigTitle size={92}>Download once. Dictate forever.</BigTitle>
      </Enter>
      <div style={{ height: 16 }} />
      <Enter delay={12}>
        <Sub>
          670&nbsp;MB – 2.4&nbsp;GB from huggingface.co/algorithco/* over HTTPS
          with SHA-256. Pick in onboarding or Settings → Local.
        </Sub>
      </Enter>
      <div style={{ height: 40 }} />
      <div
        style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 24 }}
      >
        {MODELS.map(([id, size, langs], i) => (
          <Enter key={id} delay={16 + i * 7}>
            <div
              style={{
                backgroundColor: COLORS.surface,
                border: `1px solid ${i === 0 ? COLORS.ink : COLORS.border}`,
                borderRadius: 22,
                padding: "30px 34px",
              }}
            >
              <div
                style={{ fontFamily: FONT_MONO, fontSize: 27, fontWeight: 500 }}
              >
                {id}
              </div>
              <div style={{ marginTop: 12, fontSize: 26, color: COLORS.sub }}>
                {size} · {langs}
              </div>
              {i === 0 ? (
                <div
                  style={{
                    marginTop: 14,
                    display: "inline-block",
                    fontFamily: FONT_MONO,
                    fontSize: 20,
                    backgroundColor: COLORS.ink,
                    color: "#000",
                    borderRadius: 999,
                    padding: "6px 20px",
                  }}
                >
                  default · parakeet
                </div>
              ) : null}
            </div>
          </Enter>
        ))}
      </div>
    </div>
  );
}
