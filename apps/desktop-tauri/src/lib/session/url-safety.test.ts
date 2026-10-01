// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { isAllowedOpenUrl } from "./url-safety.js";

describe("isAllowedOpenUrl", () => {
  it("allows only exact first-party https hosts", () => {
    expect(
      isAllowedOpenUrl("https://api.trqsh.uz/auth/oauth/github/start"),
    ).toBe(true);
    expect(isAllowedOpenUrl("https://app.trqsh.uz/login")).toBe(true);
    expect(isAllowedOpenUrl("https://foo.api.trqsh.uz/bar")).toBe(false);
  });

  it("blocks http, non-allowlisted hosts, and malformed urls", () => {
    expect(isAllowedOpenUrl("http://api.trqsh.uz/x")).toBe(false);
    expect(isAllowedOpenUrl("https://evil.com/https://github.com")).toBe(false);
    expect(isAllowedOpenUrl("https://github.com.evil.com/")).toBe(false);
    expect(isAllowedOpenUrl("https://github.com/a/b")).toBe(false);
    expect(isAllowedOpenUrl("https://huggingface.co/models")).toBe(false);
    expect(isAllowedOpenUrl("https://algorithvoice.com/")).toBe(false);
    expect(isAllowedOpenUrl("https://www.algorithvoice.com/docs")).toBe(false);
    expect(isAllowedOpenUrl("not a url")).toBe(false);
    expect(isAllowedOpenUrl("javascript:alert(1)")).toBe(false);
    expect(isAllowedOpenUrl("data:text/plain,hi")).toBe(false);
  });

  it("blocks loopback hosts in desktop builds", () => {
    expect(isAllowedOpenUrl("http://localhost:3001/oauth2/authorize")).toBe(
      false,
    );
    expect(isAllowedOpenUrl("http://127.0.0.1:3000/login")).toBe(false);
    expect(isAllowedOpenUrl("https://localhost:3001/oauth2/authorize")).toBe(
      false,
    );
  });
});
