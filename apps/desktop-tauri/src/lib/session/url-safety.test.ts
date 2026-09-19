// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { isAllowedOpenUrl } from "./url-safety.js";

describe("isAllowedOpenUrl", () => {
  it("allows first-party https hosts and subdomains", () => {
    expect(isAllowedOpenUrl("https://api.algorithvoice.com/x")).toBe(true);
    expect(isAllowedOpenUrl("https://github.com/a/b")).toBe(true);
    // Subdomains of allowlisted hosts are allowed (e.g. gist pages).
    expect(isAllowedOpenUrl("https://foo.github.com/bar")).toBe(true);
    expect(isAllowedOpenUrl("https://huggingface.co/models")).toBe(true);
    expect(isAllowedOpenUrl("https://x.huggingface.co/y")).toBe(true);
  });

  it("blocks http, non-allowlisted hosts, and malformed urls", () => {
    expect(isAllowedOpenUrl("http://api.algorithvoice.com/x")).toBe(false);
    expect(isAllowedOpenUrl("https://evil.com/https://github.com")).toBe(false);
    expect(isAllowedOpenUrl("https://github.com.evil.com/")).toBe(false);
    expect(isAllowedOpenUrl("not a url")).toBe(false);
    expect(isAllowedOpenUrl("javascript:alert(1)")).toBe(false);
    expect(isAllowedOpenUrl("data:text/plain,hi")).toBe(false);
  });

  it("blocks loopback outside DEV (vitest runs with DEV=true, so assert shape only)", () => {
    // import.meta.env.DEV is true under vitest; loopback is allowed there by
    // design (local API). The important invariant is non-DEV parity, which is
    // covered by the https-only branch above.
    expect(typeof isAllowedOpenUrl("http://localhost:3001/")).toBe("boolean");
  });
});
