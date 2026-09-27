// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

const oauthMocks = vi.hoisted(() => ({
  callback: null as null | ((event: { payload: string[] }) => void),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));
vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: vi.fn(),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(
    async (
      _event: string,
      callback: (event: { payload: string[] }) => void,
    ) => {
      oauthMocks.callback = callback;
      return vi.fn();
    },
  ),
}));

import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  login,
  logout,
  parseOAuthCodeCallback,
  sessionStatus,
  signInDesktop,
  signup,
} from "./auth.js";

const mockInvoke = invoke as unknown as ReturnType<typeof vi.fn>;
const mockOpenUrl = openUrl as unknown as ReturnType<typeof vi.fn>;
const VALID_CODE = "c".repeat(43);
const VALID_STATE = "s".repeat(43);
const PREFERRED_REDIRECT = "com.algorithvoice.app://oauth-callback";
const OAUTH_METADATA = {
  code_challenge_methods_supported: ["S256"],
  redirect_uris_supported: [
    PREFERRED_REDIRECT,
    "algorithvoice://auth-callback",
  ],
};

beforeEach(() => {
  window.localStorage.clear();
  mockInvoke.mockReset();
  mockOpenUrl.mockReset();
  mockOpenUrl.mockResolvedValue(undefined);
  oauthMocks.callback = null;
  // Default: not in Tauri shell for most tests (no __TAURI__ flag).
  // @ts-expect-error - test cleanup
  delete window.__TAURI__;
  // @ts-expect-error - test cleanup
  delete window.__TAURI_INTERNALS__;
});

describe("parseOAuthCodeCallback (PKCE)", () => {
  it("parses query responses and rejects fragment responses", () => {
    expect(
      parseOAuthCodeCallback(
        `com.algorithvoice.app://oauth-callback?code=${VALID_CODE}&state=${VALID_STATE}`,
      ),
    ).toEqual({
      code: VALID_CODE,
      state: VALID_STATE,
      redirectUri: PREFERRED_REDIRECT,
    });
    expect(
      parseOAuthCodeCallback(
        `algorithvoice://auth-callback?code=${VALID_CODE}&state=${VALID_STATE}`,
      ),
    ).toEqual({
      code: VALID_CODE,
      state: VALID_STATE,
      redirectUri: "algorithvoice://auth-callback",
    });
    expect(
      parseOAuthCodeCallback(
        `com.algorithvoice.app://oauth-callback#code=${VALID_CODE}&state=${VALID_STATE}`,
      ),
    ).toBeNull();
  });

  it("rejects wrong scheme/host, userinfo, missing code, and weak values", () => {
    expect(parseOAuthCodeCallback("https://x/?code=a")).toBeNull();
    expect(
      parseOAuthCodeCallback(
        `com.algorithvoice.app://other?code=${VALID_CODE}&state=${VALID_STATE}`,
      ),
    ).toBeNull();
    expect(
      parseOAuthCodeCallback(
        `com.algorithvoice.app://user:pass@oauth-callback?code=${VALID_CODE}&state=${VALID_STATE}`,
      ),
    ).toBeNull();
    expect(
      parseOAuthCodeCallback("com.algorithvoice.app://oauth-callback"),
    ).toBeNull();
    expect(
      parseOAuthCodeCallback(
        "com.algorithvoice.app://oauth-callback?code=short&state=weak",
      ),
    ).toBeNull();
    expect(parseOAuthCodeCallback("not a url")).toBeNull();
  });

  it("binds backend errors to state and rejects ambiguous parameters", () => {
    expect(
      parseOAuthCodeCallback(
        `com.algorithvoice.app://oauth-callback?error=access_denied&state=${VALID_STATE}`,
      ),
    ).toEqual({
      error: "access_denied",
      state: VALID_STATE,
      redirectUri: PREFERRED_REDIRECT,
    });
    expect(
      parseOAuthCodeCallback(
        `com.algorithvoice.app://oauth-callback?error=access_denied`,
      ),
    ).toBeNull();
    expect(
      parseOAuthCodeCallback(
        `com.algorithvoice.app://oauth-callback?code=${VALID_CODE}&code=${VALID_CODE}&state=${VALID_STATE}`,
      ),
    ).toBeNull();
    expect(
      parseOAuthCodeCallback(
        `com.algorithvoice.app://oauth-callback?code=${VALID_CODE}&error=access_denied&state=${VALID_STATE}`,
      ),
    ).toBeNull();
  });
});

describe("signInDesktop", () => {
  it("falls back to the installed-client callback when metadata is unavailable", async () => {
    // @ts-expect-error - test flag
    window.__TAURI__ = {};
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({}),
    }) as unknown as typeof fetch;
    const controller = new AbortController();
    const pending = signInDesktop({ signal: controller.signal });
    await vi.waitFor(() => expect(mockOpenUrl).toHaveBeenCalledOnce());
    const authorizeUrl = new URL(String(mockOpenUrl.mock.calls[0]?.[0]));
    expect(authorizeUrl.searchParams.get("redirect_uri")).toBe(
      "algorithvoice://auth-callback",
    );
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });

  it("ignores stale callbacks and exchanges only the state-bound code", async () => {
    // @ts-expect-error - test flag
    window.__TAURI__ = {};
    mockInvoke.mockResolvedValue(undefined);
    globalThis.fetch = vi.fn((input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/oauth2/metadata")) {
        return Promise.resolve({ ok: true, json: async () => OAUTH_METADATA });
      }
      if (url.includes("/oauth2/token")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            access_token: "a".repeat(64),
            refresh_token: "r".repeat(43),
            token_type: "Bearer",
          }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({ email: "safe@example.com" }),
      });
    }) as unknown as typeof fetch;

    const pending = signInDesktop();
    await vi.waitFor(() => expect(mockOpenUrl).toHaveBeenCalledOnce());
    const authorizeUrl = new URL(String(mockOpenUrl.mock.calls[0]?.[0]));
    const state = authorizeUrl.searchParams.get("state");
    expect(state).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(authorizeUrl.searchParams.get("code_challenge")).toMatch(
      /^[A-Za-z0-9_-]{43}$/,
    );

    oauthMocks.callback?.({
      payload: [
        `com.algorithvoice.app://oauth-callback?error=access_denied&state=${"x".repeat(43)}`,
      ],
    });
    oauthMocks.callback?.({
      payload: [
        `com.algorithvoice.app://oauth-callback?code=${VALID_CODE}&state=${state}`,
      ],
    });

    await expect(pending).resolves.toEqual({
      loggedIn: true,
      email: "safe@example.com",
    });
    expect(mockInvoke).toHaveBeenCalledWith("store_session", {
      accessToken: "a".repeat(64),
      email: "safe@example.com",
      refreshToken: "r".repeat(43),
    });
  });

  it("does not store a session when cancellation races the token exchange", async () => {
    // @ts-expect-error - test flag
    window.__TAURI__ = {};
    mockInvoke.mockResolvedValue(undefined);
    let resolveToken!: (value: unknown) => void;
    globalThis.fetch = vi.fn((input: string | URL | Request) => {
      if (String(input).includes("/oauth2/token")) {
        return new Promise((resolve) => {
          resolveToken = resolve;
        });
      }
      if (String(input).includes("/oauth2/metadata")) {
        return Promise.resolve({ ok: true, json: async () => OAUTH_METADATA });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    }) as unknown as typeof fetch;
    const controller = new AbortController();
    const pending = signInDesktop({ signal: controller.signal });
    await vi.waitFor(() => expect(mockOpenUrl).toHaveBeenCalledOnce());
    const authorizeUrl = new URL(String(mockOpenUrl.mock.calls[0]?.[0]));
    const state = authorizeUrl.searchParams.get("state");
    oauthMocks.callback?.({
      payload: [
        `com.algorithvoice.app://oauth-callback?code=${VALID_CODE}&state=${state}`,
      ],
    });
    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    resolveToken({
      ok: true,
      json: async () => ({
        access_token: "a".repeat(64),
        refresh_token: "r".repeat(43),
        token_type: "Bearer",
      }),
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(mockInvoke).not.toHaveBeenCalledWith(
      "store_session",
      expect.anything(),
    );
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
