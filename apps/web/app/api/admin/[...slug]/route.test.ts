import { describe, expect, it } from "vitest";
import { isAllowedAdminRequest } from "./route.js";

describe("M-WEB-2: admin proxy allowlist", () => {
  it("permits only known path and method pairs", () => {
    expect(isAllowedAdminRequest("GET", ["stats", "overview"])).toBe(true);
    expect(isAllowedAdminRequest("PUT", ["config", "ai-model"])).toBe(true);
    expect(isAllowedAdminRequest("POST", ["users", "u1", "block"])).toBe(true);
    expect(isAllowedAdminRequest("DELETE", ["users", "u1"])).toBe(false);
    expect(isAllowedAdminRequest("GET", ["unknown"])).toBe(false);
  });
});
