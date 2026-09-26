// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));
vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";
import {
  login,
  logout,
  parseOAuthCallbackUrl,
  parseOAuthCodeCallback,
  sessionStatus,
  signup,
} from "./auth.js";

const mockInvoke = invoke as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  window.localStorage.clear();
  mockInvoke.mockReset();
  // Default: not in Tauri shell for most tests (no __TAURI__ flag).
  // @ts-expect-error - test cleanup
  delete window.__TAURI__;
  // @ts-expect-error - test cleanup
  delete window.__TAURI_INTERNALS__;
});

describe("parseOAuthCodeCallback (PKCE)", () => {
  it("parses code+state from query and fragment", () => {
    expect(
      parseOAuthCodeCallback(
        "algorithvoice://auth-callback?code=abc&state=xyz",
      ),
    ).toEqual({ code: "abc", state: "xyz" });
    expect(
      parseOAuthCodeCallback("algorithvoice://auth-callback#code=abc&state=s"),
    ).toEqual({ code: "abc", state: "s" });
  });

  it("rejects wrong scheme/host, userinfo, missing code", () => {
    expect(parseOAuthCodeCallback("https://x/?code=a")).toBeNull();
    expect(parseOAuthCodeCallback("algorithvoice://other?code=a")).toBeNull();
    expect(
      parseOAuthCodeCallback("algorithvoice://user:pass@auth-callback?code=a"),
    ).toBeNull();
    expect(parseOAuthCodeCallback("algorithvoice://auth-callback")).toBeNull();
    expect(parseOAuthCodeCallback("not a url")).toBeNull();
  });

  it("surfaces backend errors", () => {
    expect(
      parseOAuthCodeCallback("algorithvoice://auth-callback?error=denied"),
    ).toEqual({ error: "denied" });
  });
});

describe("parseOAuthCallbackUrl (legacy)", () => {
  it("enforces state binding", () => {
    const url =
      "algorithvoice://auth-callback?accessToken=tok&email=a@b.c&state=s1";
    expect(parseOAuthCallbackUrl(url, "s1")).toEqual({
      accessToken: "tok",
      email: "a@b.c",
    });
    expect(parseOAuthCallbackUrl(url, "other")).toBeNull();
  });

  it("validates email/token shape", () => {
    expect(
      parseOAuthCallbackUrl(
        "algorithvoice://auth-callback?accessToken=t&email=nope",
      ),
    ).toBeNull();
    expect(
      parseOAuthCallbackUrl(
        `algorithvoice://auth-callback?accessToken=${"x".repeat(16385)}&email=a@b.c`,
      ),
    ).toBeNull();
  });
});

describe("login/signup/logout", () => {
  it("login stores session via Tauri on success", async () => {
    mockInvoke.mockResolvedValue(undefined);
    // Force Tauri path for store_session
    // @ts-expect-error - test flag
    window.__TAURI__ = {};
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        user: { email: "a@b.c" },
        accessToken: "tok",
      }),
    }) as unknown as typeof fetch;
    const s = await login("a@b.c", "password123456");
    expect(s).toEqual({ loggedIn: true, email: "a@b.c" });
    expect(mockInvoke).toHaveBeenCalledWith("store_session", {
      accessToken: "tok",
      email: "a@b.c",
      refreshToken: null,
    });
  });

  it("login maps 401 to invalid-credentials", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({}),
    }) as unknown as typeof fetch;
    await expect(login("a@b.c", "bad")).rejects.toThrow(
      "Invalid email or password.",
    );
  });

  it("signup maps email_taken", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ error: "email_taken" }),
    }) as unknown as typeof fetch;
    await expect(signup("a@b.c", "password123456", "Desktop")).rejects.toThrow(
      "already registered",
    );
  });

  it("sessionStatus falls back to logged-out in browser", async () => {
    mockInvoke.mockRejectedValue(new Error("not in Tauri shell"));
    const s = await sessionStatus();
    expect(s).toEqual({ loggedIn: false });
  });

  it("logout clears history keys (browser)", async () => {
    window.localStorage.setItem("algorith-voice-history", "[]");
    mockInvoke.mockResolvedValue(undefined);
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
    }) as unknown as typeof fetch;
    await logout();
    expect(window.localStorage.getItem("algorith-voice-history")).toBeNull();
  });
});
