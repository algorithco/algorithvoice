// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import {
  detectDeviceType,
  ensureDeviceLinked,
  getDeviceFingerprint,
  getDeviceIdentity,
  getDeviceName,
} from "./device.js";

function setUserAgent(ua: string, platform = ""): void {
  Object.defineProperty(window.navigator, "userAgent", {
    value: ua,
    configurable: true,
  });
  Object.defineProperty(window.navigator, "platform", {
    value: platform,
    configurable: true,
  });
}

beforeEach(() => {
  window.localStorage.clear();
});

describe("detectDeviceType", () => {
  it("maps Windows / Linux / macOS user agents", () => {
    setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64)", "Win32");
    expect(detectDeviceType()).toBe("desktop-windows");
    setUserAgent("Mozilla/5.0 (X11; Linux x86_64)", "Linux x86_64");
    expect(detectDeviceType()).toBe("desktop-linux");
    setUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", "MacIntel");
    expect(detectDeviceType()).toBe("desktop-macos");
  });
});

describe("device identity", () => {
  it("persists a stable fingerprint and name", () => {
    setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64)", "Win32");
    const first = getDeviceIdentity();
    expect(first.deviceName.length).toBeGreaterThanOrEqual(1);
    expect(first.deviceFingerprint.length).toBeGreaterThanOrEqual(8);
    const second = getDeviceIdentity();
    expect(second).toEqual(first);
    expect(getDeviceFingerprint()).toBe(first.deviceFingerprint);
    expect(getDeviceName()).toBe(first.deviceName);
  });
});

describe("ensureDeviceLinked", () => {
  it("resolves on success and warns (no throw) on network failure", async () => {
    setUserAgent("Mozilla/5.0 (X11; Linux x86_64)", "Linux x86_64");
    globalThis.fetch = (async () =>
      ({ ok: true }) as unknown as Response) as typeof fetch;
    await expect(ensureDeviceLinked("tok")).resolves.toBeUndefined();

    globalThis.fetch = (async () => {
      throw new Error("down");
    }) as unknown as typeof fetch;
    await expect(ensureDeviceLinked("tok")).resolves.toBeUndefined();
  });

  it("throws a friendly error when seats are exhausted", async () => {
    globalThis.fetch = (async () =>
      ({
        ok: false,
        status: 403,
        statusText: "Forbidden",
        json: async () => ({
          error: "seats_exhausted",
          seatsUsed: 3,
          seatsMax: 3,
        }),
      }) as unknown as Response) as typeof fetch;
    await expect(ensureDeviceLinked("tok")).rejects.toThrow(
      "Device limit reached (3/3 seats used)",
    );
  });
});
