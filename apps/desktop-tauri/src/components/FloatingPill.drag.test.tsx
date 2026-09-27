// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

const windowMocks = vi.hoisted(() => ({
  startDragging: vi.fn(async () => {}),
}));

vi.mock("@algorith-voice/ui", () => ({
  Logo: ({ className }: { className?: string }) => (
    <span className={className}>AV</span>
  ),
}));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ startDragging: windowMocks.startDragging }),
}));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async () => undefined),
}));
vi.mock("@tauri-apps/api/event", () => ({
  emit: vi.fn(async () => undefined),
  listen: vi.fn(async () => () => {}),
}));
vi.mock("../lib/session/env.js", () => ({ isTauri: () => true }));
vi.mock("../lib/session/tray.js", () => ({
  setTrayState: vi.fn(async () => undefined),
}));

import { FloatingPill } from "./FloatingPill.js";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  document.body.innerHTML = "";
  vi.clearAllMocks();
});

describe("FloatingPill drag handle", () => {
  it("starts a native window drag without using the talk target", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <FloatingPill
          prefs={{
            hotkey: "Ctrl+Space",
            mode: "cloud",
            theme: "dark",
            language: "auto",
            activeModelId: null,
          }}
        />,
      );
    });

    const handle = container.querySelector<HTMLElement>(
      '[data-testid="pill-drag-handle"]',
    );
    const talk = container.querySelector<HTMLElement>(
      '[data-testid="pill-talk"]',
    );
    expect(handle).not.toBeNull();
    expect(talk).not.toBeNull();
    expect(handle).not.toBe(talk);

    const pointerDown = new MouseEvent("pointerdown", {
      bubbles: true,
      button: 0,
    });
    Object.defineProperties(pointerDown, {
      isPrimary: { value: true },
      pointerType: { value: "mouse" },
    });
    await act(async () => {
      handle?.dispatchEvent(pointerDown);
      await Promise.resolve();
    });

    expect(windowMocks.startDragging).toHaveBeenCalledOnce();
    await act(async () => root.unmount());
  });
});
