import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { denyKey } from "../src/modules/oauth2/oauth2.store.js";
import { redis } from "../src/queues/connection.js";
import { authHeader, createTestApp, truncateTestState } from "./helpers/app.js";

describe("H10: session revocation", () => {
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

  async function signup() {
    const response = await app.inject({
      method: "POST",
      url: "/auth/signup",
      payload: {
        email: "revoke@example.invalid",
        password: "correct-horse-battery-staple",
      },
    });
    expect(response.statusCode).toBe(201);
    return response.json<{ accessToken: string; refreshToken: string }>();
  }

  it("H10: password-login access tokens include enforceable jti", async () => {
    const pair = await signup();
    const claims = app.jwt.decode<{ jti?: string }>(pair.accessToken);
    expect(claims?.jti).toEqual(expect.any(String));
    if (!claims?.jti) throw new Error("password access token is missing jti");
    await redis.set(denyKey(claims.jti), "1", "EX", 60);
    const response = await app.inject({
      method: "GET",
      url: "/auth/me",
      headers: authHeader(pair.accessToken),
    });
    expect(response.statusCode).toBe(401);
  });

  it("H10: logout with a refresh token revokes its family", async () => {
    const pair = await signup();
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/auth/logout",
          payload: { refresh_token: pair.refreshToken },
        })
      ).statusCode,
    ).toBe(200);
    const refresh = await app.inject({
      method: "POST",
      url: "/auth/refresh",
      payload: { refresh_token: pair.refreshToken },
    });
    expect(refresh.statusCode).toBe(401);
  });
});
