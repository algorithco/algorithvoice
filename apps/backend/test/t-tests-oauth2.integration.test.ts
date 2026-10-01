import { createHash, randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  authHeader,
  createTestApp,
  createUser,
  signAccessToken,
  truncateTestState,
} from "./helpers/app.js";

const CLIENT_ID = "desktop-app";
const REDIRECT_URI = "algorithvoice://auth-callback";

function pkce() {
  const verifier = randomBytes(48).toString("base64url");
  const challenge = createHash("sha256")
    .update(verifier, "ascii")
    .digest("base64url");
  return { verifier, challenge };
}

describe("T-TESTS: OAuth2 authorization-code lifecycle", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await createTestApp();
  });

  beforeEach(async () => {
    await truncateTestState(app);
  });

  afterAll(async () => {
    await app.close();
  });

  async function issueCode(options?: {
    verifier?: string;
    redirectUri?: string;
    scopes?: string;
  }) {
    const { user } = await createUser(app, {
      email: `oauth2-${randomBytes(8).toString("hex")}@example.invalid`,
    });
    const generated = pkce();
    const verifier = options?.verifier ?? generated.verifier;
    const challenge = createHash("sha256")
      .update(verifier, "ascii")
      .digest("base64url");
    const redirectUri = options?.redirectUri ?? REDIRECT_URI;
    const state = randomBytes(24).toString("base64url");
    const query = new URLSearchParams({
      response_type: "code",
      client_id: CLIENT_ID,
      redirect_uri: redirectUri,
      code_challenge: challenge,
      code_challenge_method: "S256",
      state,
      scope: options?.scopes ?? "openid profile email offline_access",
    });
    const authorize = await app.inject({
      method: "GET",
      url: `/oauth2/authorize?${query.toString()}`,
    });
    expect(authorize.statusCode).toBe(302);
    const consent = new URL(authorize.headers.location as string);
    const requestId = consent.searchParams.get("request");
    expect(requestId).toBeTruthy();

    const approve = await app.inject({
      method: "POST",
      url: "/oauth2/approve",
      headers: authHeader(signAccessToken(app, user.id)),
      payload: { request_id: requestId, approved: true },
    });
    expect(approve.statusCode).toBe(200);
    const callback = new URL(
      approve.json<{ redirect_to: string }>().redirect_to,
    );
    const code = callback.searchParams.get("code");
    expect(code).toBeTruthy();
    expect(callback.searchParams.get("state")).toBe(state);
    return { code: code as string, redirectUri, user, verifier };
  }

  async function exchange(
    code: string,
    verifier: string,
    redirectUri = REDIRECT_URI,
  ) {
    return app.inject({
      method: "POST",
      url: "/oauth2/token",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      payload: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: CLIENT_ID,
        redirect_uri: redirectUri,
        code,
        code_verifier: verifier,
      }).toString(),
    });
  }

  it("T-TESTS: authorize, approve, exchange, refresh, and revoke work end-to-end", async () => {
    const issued = await issueCode();
    const token = await exchange(issued.code, issued.verifier);
    expect(token.statusCode).toBe(200);
    const pair = token.json<{
      access_token: string;
      refresh_token: string;
      scope: string;
    }>();
    expect(pair.scope).toBe("openid profile email offline_access");

    const refreshed = await app.inject({
      method: "POST",
      url: "/oauth2/token",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      payload: new URLSearchParams({
        grant_type: "refresh_token",
        client_id: CLIENT_ID,
        refresh_token: pair.refresh_token,
      }).toString(),
    });
    expect(refreshed.statusCode).toBe(200);
    const successor = refreshed.json<{
      access_token: string;
      refresh_token: string;
    }>();

    expect(
      (
        await app.inject({
          method: "POST",
          url: "/oauth2/revoke",
          payload: {
            token: successor.refresh_token,
            token_type_hint: "refresh_token",
          },
        })
      ).statusCode,
    ).toBe(200);
    const afterRefreshRevoke = await app.inject({
      method: "POST",
      url: "/oauth2/token",
      payload: {
        grant_type: "refresh_token",
        client_id: CLIENT_ID,
        refresh_token: successor.refresh_token,
      },
    });
    expect(afterRefreshRevoke.statusCode).toBe(400);
    expect(afterRefreshRevoke.json()).toMatchObject({ error: "invalid_grant" });

    expect(
      (
        await app.inject({
          method: "POST",
          url: "/oauth2/revoke",
          payload: {
            token: successor.access_token,
            token_type_hint: "access_token",
          },
        })
      ).statusCode,
    ).toBe(200);
    const denied = await app.inject({
      method: "GET",
      url: "/auth/me",
      headers: authHeader(successor.access_token),
    });
    expect(denied.statusCode).toBe(401);
  });

  it("T-TESTS: PKCE mismatch invalidates the authorization code", async () => {
    const issued = await issueCode();
    const wrongVerifier = randomBytes(48).toString("base64url");
    const mismatch = await exchange(issued.code, wrongVerifier);
    expect(mismatch.statusCode).toBe(400);
    expect(mismatch.json()).toMatchObject({ error: "invalid_grant" });
    const retry = await exchange(issued.code, issued.verifier);
    expect(retry.statusCode).toBe(400);
    expect(retry.json()).toMatchObject({ error: "invalid_grant" });
  });

  it("T-TESTS: redirect_uri mismatch invalidates the authorization code", async () => {
    const issued = await issueCode();
    const mismatch = await exchange(
      issued.code,
      issued.verifier,
      "com.algorithvoice.app://oauth-callback",
    );
    expect(mismatch.statusCode).toBe(400);
    expect(mismatch.json()).toMatchObject({ error: "invalid_grant" });
    expect((await exchange(issued.code, issued.verifier)).statusCode).toBe(400);
  });

  it("T-TESTS: a successfully exchanged authorization code cannot be reused", async () => {
    const issued = await issueCode();
    expect((await exchange(issued.code, issued.verifier)).statusCode).toBe(200);
    const reused = await exchange(issued.code, issued.verifier);
    expect(reused.statusCode).toBe(400);
    expect(reused.json()).toMatchObject({ error: "invalid_grant" });
  });
});
