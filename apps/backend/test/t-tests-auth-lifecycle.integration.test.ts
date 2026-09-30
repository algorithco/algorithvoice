import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestApp, truncateTestState } from "./helpers/app.js";

describe("T-TESTS: password authentication lifecycle", () => {
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

  it("T-TESTS: signup, login, refresh, and logout revoke the session family", async () => {
    const email = `lifecycle-${Date.now()}@example.invalid`;
    const password = "correct-horse-battery-staple";
    const signup = await app.inject({
      method: "POST",
      url: "/auth/signup",
      payload: { email, password, name: "Lifecycle User" },
    });
    expect(signup.statusCode).toBe(201);
    const signupPair = signup.json<{
      accessToken: string;
      refreshToken: string;
    }>();
    expect(signupPair.accessToken).toBeTruthy();
    expect(signupPair.refreshToken).toBeTruthy();

    const login = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email, password },
    });
    expect(login.statusCode).toBe(200);
    const loginPair = login.json<{
      accessToken: string;
      refreshToken: string;
    }>();
    expect(loginPair.accessToken).toBeTruthy();
    expect(loginPair.refreshToken).toBeTruthy();

    const refresh = await app.inject({
      method: "POST",
      url: "/auth/refresh",
      payload: { refresh_token: loginPair.refreshToken },
    });
    expect(refresh.statusCode).toBe(200);
    const refreshed = refresh.json<{
      accessToken: string;
      refreshToken: string;
    }>();
    expect(refreshed.accessToken).toBeTruthy();
    expect(refreshed.refreshToken).toBeTruthy();

    const logout = await app.inject({
      method: "POST",
      url: "/auth/logout",
      payload: { refresh_token: refreshed.refreshToken },
    });
    expect(logout.statusCode).toBe(200);
    expect(logout.json()).toEqual({ ok: true });

    const reused = await app.inject({
      method: "POST",
      url: "/auth/refresh",
      payload: { refresh_token: refreshed.refreshToken },
    });
    expect(reused.statusCode).toBe(401);
    expect(reused.json()).toMatchObject({ error: "invalid_grant" });
  });
});
