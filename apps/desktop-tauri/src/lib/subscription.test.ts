import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("./session/env.js", () => ({ isTauri: () => true }));

import { getDesktopEntitlement } from "./subscription.js";

beforeEach(() => {
  mocks.invoke.mockReset();
});

describe("desktop subscription entitlement", () => {
  it("returns a server-verified active Pro subscription", async () => {
    mocks.invoke.mockResolvedValue({
      valid: true,
      status: "active",
      planTier: "pro",
      currentPeriodEnd: "2026-10-28T00:00:00.000Z",
      reason: null,
    });

    await expect(getDesktopEntitlement()).resolves.toMatchObject({
      valid: true,
      status: "active",
      planTier: "pro",
    });
    expect(mocks.invoke).toHaveBeenCalledWith("license_status", {
      apiUrl: "https://api.trqsh.uz",
      force: false,
    });
  });

  it("fails closed when native verification is unavailable", async () => {
    mocks.invoke.mockResolvedValue({
      valid: false,
      status: "unavailable",
      planTier: "free",
      currentPeriodEnd: null,
      reason: "network down",
    });
    await expect(getDesktopEntitlement()).resolves.toMatchObject({
      valid: false,
      status: "unavailable",
      planTier: "free",
    });
  });

  it("shows native errors instead of hiding the refresh failure", async () => {
    mocks.invoke.mockRejectedValue(
      new Error("Subscription check returned 503 Service Unavailable"),
    );

    const result = await getDesktopEntitlement(true);
    expect(result).toMatchObject({
      valid: false,
      status: "unavailable",
      reason: "Subscription check returned 503 Service Unavailable",
    });
  });
});
