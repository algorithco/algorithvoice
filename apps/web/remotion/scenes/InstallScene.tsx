import { COLORS, FONT_MONO } from "../theme";
import { BigTitle, Caption, Card, Code, Enter, Sub } from "../ui";

const OS = [
  {
    name: "macOS 13+ (Swift, soon)",
    cmd: "Native Swift app — coming soon",
    note: "No download yet; Windows & Linux today",
  },
  {
    name: "Windows 10+",
    cmd: "msiexec /i Algorith.Voice_0.4.0_x64_en-US.msi /quiet",
    note: "WebView2 installs automatically",
  },
  {
    name: "Ubuntu 22.04+",
    cmd: "chmod +x *.AppImage && ./Algorith*.AppImage",
    note: "Wayland: install ydotool",
  },
] as const;

/** 5–15s · One line to install. Mirrors docs OS panels. */
export function InstallScene() {
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        padding: "190px 96px 0",
      }}
    >
      <Enter>
        <Caption>Step 1 · Install — 30 seconds</Caption>
      </Enter>
      <div style={{ height: 20 }} />
      <Enter delay={6}>
        <BigTitle size={96}>One line to install.</BigTitle>
      </Enter>
      <div style={{ height: 16 }} />
      <Enter delay={12}>
        <Sub>Pick your OS. Grant mic access. Done.</Sub>
      </Enter>
      <div style={{ height: 44 }} />
      <div style={{ display: "flex", gap: 32 }}>
        {OS.map((os, i) => (
          <Enter key={os.name} delay={18 + i * 10}>
            <Card width={540}>
              <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                <div
                  style={{
                    width: 56,
                    height: 56,
                    borderRadius: 14,
                    border: `1px solid ${COLORS.border}`,
                    backgroundColor: COLORS.raised,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 26,
                    fontWeight: 700,
                  }}
                >
                  {i + 1}
                </div>
                <div style={{ fontSize: 40, fontWeight: 600 }}>{os.name}</div>
              </div>
              <Code>{os.cmd}</Code>
              <div
                style={{
                  marginTop: 20,
                  fontFamily: FONT_MONO,
                  fontSize: 23,
                  color: COLORS.sub,
                }}
              >
                {os.note}
              </div>
            </Card>
          </Enter>
        ))}
      </div>
    </div>
  );
}
