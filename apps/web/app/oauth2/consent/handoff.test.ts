import { describe, expect, it } from "vitest";
import { safeDesktopHandoffUrl } from "./handoff.js";

describe("safeDesktopHandoffUrl", () => {
  it.each([
    "algorithvoice://auth-callback?code=abc&state=xyz",
    "com.algorithvoice.app://oauth-callback?code=abc&state=xyz",
  ])("accepts an exact desktop callback: %s", (url) => {
    expect(safeDesktopHandoffUrl(url)).toBe(url);
  });

  it.each([
    "https://app.trqsh.uz/oauth-callback",
    "javascript:alert(1)",
    "algorithvoice://other?code=abc",
    "algorithvoice://user:pass@auth-callback?code=abc",
    "algorithvoice://auth-callback/path?code=abc",
    "algorithvoice://auth-callback?code=abc#fragment",
  ])("rejects an unsafe handoff: %s", (url) => {
    expect(safeDesktopHandoffUrl(url)).toBeNull();
  });
});
