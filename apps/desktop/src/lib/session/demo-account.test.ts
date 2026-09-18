// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import {
  clearDemoSession,
  DEMO_EMAIL,
  loginDemo,
  readDemoSession,
} from "./demo-account.js";

beforeEach(() => {
  window.localStorage.clear();
});

describe("demo-account (browser preview only)", () => {
  it("writes and reads the demo session in non-Tauri", async () => {
    expect(readDemoSession()).toBeNull();
    const s = await loginDemo();
    expect(s).toEqual({ loggedIn: true, email: DEMO_EMAIL });
    expect(readDemoSession()).toEqual({ loggedIn: true, email: DEMO_EMAIL });
  });

  it("clears idempotently", async () => {
    await loginDemo();
    clearDemoSession();
    expect(readDemoSession()).toBeNull();
    expect(() => clearDemoSession()).not.toThrow();
  });
});
