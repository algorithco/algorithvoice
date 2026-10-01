// @vitest-environment jsdom
// Minimal boot smoke (jsdom): the app shell renders (auth gate when signed
// out, dashboard when a session exists). A full tauri-driver + WebDriver
// harness is deferred (see CHANGELOG — NEEDS PRODUCT INPUT for CI runner
// with native binary); this proves the critical path boots and composes.
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

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

const shellMocks = vi.hoisted(() => ({ signedIn: false }));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ label: "main" }),
}));
vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: () => ({ label: "main" }),
}));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: async (cmd: string) => {
    if (cmd === "session_status") {
      if (shellMocks.signedIn) {
        return { loggedIn: true, email: "test@example.com" };
      }
      throw new Error("no session");
    }
    if (cmd === "store_session") return undefined;
    if (cmd === "license_status") {
      return {
        valid: true,
        status: "active",
        planTier: "pro",
        currentPeriodEnd: "2026-10-28T00:00:00.000Z",
        reason: null,
      };
    }
    throw new Error(`tauri unavailable in test: ${cmd}`);
  },
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: async () => () => {},
  emit: async () => {},
}));
vi.mock("@tauri-apps/plugin-store", () => ({
  load: async () => ({
    get: async (key: string) => (key === "onboarded" ? true : null),
  }),
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
  shellMocks.signedIn = false;
});

describe("critical-path smoke", () => {
  it("signed-out shell renders the auth view", async () => {
    // No session in a fresh browser preview: the auth gate shows login.
    window.localStorage.setItem(
      "algorith-voice-prefs",
      JSON.stringify({
        hotkey: "Ctrl+Space",
        mode: "cloud",
        theme: "dark",
        activeModelId: null,
      }),
    );
    window.localStorage.setItem("algorith-voice-onboarded", "1");

    vi.useFakeTimers();
    const div = document.createElement("div");
    document.body.appendChild(div);
    const root = createRoot(div);
    await act(async () => {
      root.render(<App />);
    });
    await act(async () => {
      vi.advanceTimersByTime(4500);
    });
    await act(async () => {
      await Promise.resolve();
    });

    const text = div.textContent ?? "";
    // Signed out → auth view with the desktop sign-in card.
    expect(text).toContain("Welcome back");
    await act(async () => {
      root.unmount();
    });
  });

  it("keeps the signed-in app shell vertically scrollable without horizontal overflow", async () => {
    shellMocks.signedIn = true;
    window.localStorage.setItem("algorith-voice-onboarded", "1");

    vi.useFakeTimers();
    const div = document.createElement("div");
    document.body.appendChild(div);
    const root = createRoot(div);
    await act(async () => {
      root.render(<App />);
    });
    await act(async () => {
      vi.advanceTimersByTime(4500);
      await Promise.resolve();
    });

    const shell = div.querySelector('[data-testid="app-shell"]');
    const content = div.querySelector('[data-testid="app-content"]');
    expect(shell?.className).toContain("overflow-hidden");
    expect(content?.className).toContain("overflow-x-hidden");
    expect(content?.className).toContain("overflow-y-auto");

    await act(async () => root.unmount());
  });
});
