// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

// Silence React's act() environment warning under jsdom.
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

// jsdom has no IntersectionObserver, but motion's useInView (pulled in via
// animate-ui icons) observes on mount. Stub it so boot tests don't crash.
if (typeof window !== "undefined" && !("IntersectionObserver" in window)) {
  class FakeIntersectionObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords(): IntersectionObserverEntry[] {
      return [];
    }
  }
  const scope = globalThis as unknown as Record<string, unknown>;
  scope.IntersectionObserver = FakeIntersectionObserver;
  (window as unknown as Record<string, unknown>).IntersectionObserver =
    FakeIntersectionObserver;
}

// Full boot of the app bundle in a settings-labelled webview: label
// detection effect -> splash gate -> prefs/session load -> SettingsView.
// There is no Tauri runtime under vitest, so shell APIs are stubbed and
// every invoke falls through to the local fallbacks.
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ label: "settings" }),
}));
vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: () => ({ label: "settings" }),
}));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: async (cmd: string) => {
    if (cmd === "session_status") {
      return { loggedIn: true, email: "pro@example.com" };
    }
    if (cmd === "license_status") {
      return {
        valid: true,
        status: "active",
        planTier: "pro",
        currentPeriodEnd: "2026-10-28T00:00:00.000Z",
        reason: null,
      };
    }
    throw new Error(`unexpected command: ${cmd}`);
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
vi.mock("./lib/session/env.js", () => ({ isTauri: () => true }));

import App from "./App.js";

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = "";
  window.localStorage.clear();
});

describe("settings window boot", () => {
  it("loads the stored desktop session and entitlement before showing settings", async () => {
    vi.useFakeTimers();
    const div = document.createElement("div");
    document.body.appendChild(div);
    const root = createRoot(div);

    await act(async () => {
      root.render(<App />);
    });
    // Secondary windows skip the animated splash but still resolve prefs,
    // session, and entitlement before exposing protected settings.
    await act(async () => {
      vi.advanceTimersByTime(4000);
    });
    await act(async () => {
      await Promise.resolve();
    });

    const text = div.textContent ?? "";
    expect(text).toContain("Settings");
    expect(text).toContain("Dictation");
    expect(text).not.toContain("Welcome back");
    expect(text).not.toContain("Loading");

    await act(async () => {
      root.unmount();
    });
  });
});
