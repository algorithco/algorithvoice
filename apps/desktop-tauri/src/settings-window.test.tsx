import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// The settings window runs this same bundle with the webview label
// "settings". There is no Tauri runtime under vitest, so stub the shell
// APIs and let every invoke fall through the same way a denied capability
// would.
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ label: "settings" }),
}));
vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: () => ({ label: "settings" }),
}));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: async () => {
    throw new Error("tauri unavailable in test");
  },
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: async () => () => {},
  emit: async () => {},
}));
vi.mock("@tauri-apps/plugin-store", () => ({
  load: async () => {
    throw new Error("tauri unavailable in test");
  },
}));
vi.mock("@tauri-apps/plugin-autostart", () => ({
  isEnabled: async () => false,
  enable: async () => {},
  disable: async () => {},
}));
vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: async () => {},
}));

import App from "./App.js";
import { SettingsView } from "./components/SettingsView.js";
import { DEFAULT_PREFS } from "./lib/prefs.js";

describe("settings window (white-screen regression)", () => {
  it("renders the full settings UI without crashing", () => {
    const html = renderToString(
      <SettingsView prefs={DEFAULT_PREFS} onPrefs={() => {}} />,
    );
    expect(html).toContain("Settings");
    expect(html).toContain("Dictation");
    expect(html).toContain("Appearance");
    expect(html).toContain("System");
    expect(html).toContain("Local usage");
  });

  it("boots the app bundle in a settings-labelled webview", () => {
    // Settings must render instantly without splash (no black flash).
    const html = renderToString(<App />);
    expect(html).toContain("Settings");
    expect(html).not.toContain("Loading");
  });
});
