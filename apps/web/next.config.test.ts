import { describe, expect, it } from "vitest";
import config from "./next.config.js";

describe("M-WEB-1: security headers", () => {
  it("sets CSP, anti-framing, HSTS, referrer, MIME, and permissions headers", async () => {
    const rules = await config.headers?.();
    const headers = new Map(
      (rules?.[0]?.headers ?? []).map((header) => [header.key, header.value]),
    );
    expect(headers.get("Content-Security-Policy-Report-Only")).toContain(
      "frame-ancestors 'none'",
    );
    expect(headers.get("X-Frame-Options")).toBe("DENY");
    expect(headers.has("Strict-Transport-Security")).toBe(true);
    expect(headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(headers.has("Permissions-Policy")).toBe(true);
  });
});
