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

describe("FloatingPill pointer interaction", () => {
  it("uses the entire idle pill for dragging and exposes no pointer recording target", async () => {
    const getUserMedia = vi.fn();
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia },
    });
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
          entitlement={{
            valid: true,
            status: "active",
            planTier: "pro",
            currentPeriodEnd: "2026-10-28T00:00:00.000Z",
            reason: null,
          }}
        />,
      );
    });

    const pill = container.querySelector<HTMLElement>(
      '[data-testid="floating-pill"]',
    );
    const idleBody = container.querySelector<HTMLElement>(
      '[data-testid="pill-idle"]',
    );
    expect(pill).not.toBeNull();
    expect(idleBody).not.toBeNull();
    expect(container.querySelector('[data-testid="pill-talk"]')).toBeNull();
    expect(
      container.querySelector('[data-testid="pill-drag-handle"]'),
    ).toBeNull();

    const pointerDown = new MouseEvent("pointerdown", {
      bubbles: true,
      button: 0,
    });
    Object.defineProperties(pointerDown, {
      isPrimary: { value: true },
      pointerType: { value: "mouse" },
    });
    await act(async () => {
      idleBody?.dispatchEvent(pointerDown);
      await Promise.resolve();
    });

    expect(windowMocks.startDragging).toHaveBeenCalledOnce();
    expect(getUserMedia).not.toHaveBeenCalled();
    await act(async () => root.unmount());
  });

  it("does not show Pro required while entitlement is still loading", async () => {
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
          entitlement={null}
        />,
      );
    });

    const pill = container.querySelector<HTMLElement>(
      '[data-testid="floating-pill"]',
    );
    expect(pill?.dataset.access).toBe("checking");
    expect(pill?.textContent).toContain("Checking Pro");
    expect(pill?.textContent).not.toContain("Pro required");

    await act(async () => root.unmount());
  });

  it("renders a compact, explicit Pro-required state after verification", async () => {
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
          entitlement={{
            valid: false,
            status: "canceled",
            planTier: "free",
            currentPeriodEnd: null,
            reason: "An active Pro subscription is required.",
          }}
        />,
      );
    });

    const pill = container.querySelector<HTMLElement>(
      '[data-testid="floating-pill"]',
    );
    expect(pill?.dataset.access).toBe("required");
    expect(pill?.textContent).toContain("Pro required");
    expect(pill?.className).toContain("border-amber-300");
    expect(pill?.title).toContain("open the desktop app");

    await act(async () => root.unmount());
  });
});
