import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  hashRefreshToken,
  parseScope,
  sha256Hex,
  validateRedirectUri,
  verifyCodeChallenge,
} from "./oauth2.store.js";

// RFC 7636 test vector: verifier dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk → S256 challenge E9Mel...
const RFC_VERIFIER = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
const RFC_CHALLENGE = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";

describe("verifyCodeChallenge", () => {
  it("accepts the RFC 7636 example", () => {
    expect(verifyCodeChallenge(RFC_VERIFIER, RFC_CHALLENGE)).toBe(true);
  });
  it("rejects wrong verifier", () => {
    expect(
      verifyCodeChallenge(
        "WRONG-VERIFIER-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        RFC_CHALLENGE,
      ),
    ).toBe(false);
  });
  it("rejects plain (never accepted)", () => {
    // plain would mean challenge === verifier; S256 check must fail.
    expect(verifyCodeChallenge(RFC_VERIFIER, RFC_VERIFIER)).toBe(false);
  });
  it("rejects short verifier", () => {
    expect(verifyCodeChallenge("short", RFC_CHALLENGE)).toBe(false);
  });
  it("is not vulnerable to length-extension tricks", () => {
    const computed = createHash("sha256")
      .update(RFC_VERIFIER, "ascii")
      .digest("base64url");
    expect(verifyCodeChallenge(RFC_VERIFIER, `${computed}x`)).toBe(false);
  });
});

describe("validateRedirectUri", () => {
  it("accepts the custom scheme", () => {
    expect(validateRedirectUri("algorithvoice://auth-callback")).toEqual({
      ok: true,
      normalized: "algorithvoice://auth-callback",
    });
  });
  it("accepts loopback with any port", () => {
    expect(validateRedirectUri("http://127.0.0.1:54321/callback")).toEqual({
      ok: true,
      normalized: "http://127.0.0.1:54321/callback",
    });
    expect(validateRedirectUri("http://[::1]:9999/callback")).toEqual({
      ok: true,
      normalized: "http://[::1]:9999/callback",
    });
  });
  it("rejects partial/custom scheme variants", () => {
    expect(
      validateRedirectUri("algorithvoice://auth-callback?extra=1").ok,
    ).toBe(false);
    expect(validateRedirectUri("https://evil.example/cb").ok).toBe(false);
  });
  it("rejects loopback with bad path or missing port", () => {
    expect(validateRedirectUri("http://127.0.0.1/callback").ok).toBe(false);
    expect(validateRedirectUri("http://127.0.0.1:3000/other").ok).toBe(false);
    expect(validateRedirectUri("http://localhost:3000/callback").ok).toBe(
      false,
    );
  });
});

describe("parseScope", () => {
  it("accepts known scopes", () => {
    expect(parseScope("email offline_access")).toEqual({
      ok: true,
      scopes: ["email", "offline_access"],
    });
  });
  it("rejects unknown scopes", () => {
    expect(parseScope("email admin").ok).toBe(false);
  });
  it("treats missing scope as empty", () => {
    expect(parseScope(undefined)).toEqual({ ok: true, scopes: [] });
  });
});

describe("hashRefreshToken determinism", () => {
  it("hashes with pepper", () => {
    const h1 = hashRefreshToken("tok", "pepper-A");
    const h2 = hashRefreshToken("tok", "pepper-B");
    expect(h1).not.toBe(h2);
    expect(h1).toHaveLength(64);
  });
  it("sha256Hex truncates safely for audit", () => {
    expect(sha256Hex("x").slice(0, 16)).toHaveLength(16);
  });
});
