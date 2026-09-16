import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// The settings window runs this same bundle with the webview label
// "settings". There is no Tauri runtime under vitest, so stub the shell
// APIs and let every invoke fall through to the localStorage/demo
// fallbacks the same way a denied capability would.
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ label: "settings" }),
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
    expect(html).toContain("Account");
    expect(html).toContain("Dictation");
    expect(html).toContain("Appearance");
    expect(html).toContain("System");
  });

  it("boots the app bundle in a settings-labelled webview", () => {
    // Effects do not run under renderToString, so this asserts the splash
    // gate — i.e. the whole import chain loads and the app starts up
    // instead of crashing to a blank page.
    const html = renderToString(<App />);
    expect(html).toContain("Loading");
  });
});
