import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { authHeader, createTestApp, truncateTestState } from "./helpers/app.js";

describe("T0: backend integration harness", () => {
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

  it("T0: health, readiness, signup, and authenticated me work end-to-end", async () => {
    const health = await app.inject({ method: "GET", url: "/health" });
    expect(health.statusCode).toBe(200);
    expect(health.json()).toMatchObject({ ok: true });

    const ready = await app.inject({ method: "GET", url: "/ready" });
    expect(ready.statusCode).toBe(200);
    expect(ready.json()).toEqual({ ok: true });

    const signup = await app.inject({
      method: "POST",
      url: "/auth/signup",
      payload: {
        email: "smoke@example.invalid",
        password: "correct-horse-battery-staple",
        name: "Smoke Test",
      },
    });
    expect(signup.statusCode).toBe(201);
    const body = signup.json<{
      accessToken: string;
      user: { email: string };
    }>();
    expect(body.user.email).toBe("smoke@example.invalid");

    const me = await app.inject({
      method: "GET",
      url: "/auth/me",
      headers: authHeader(body.accessToken),
    });
    expect(me.statusCode).toBe(200);
    expect(me.json()).toMatchObject({ email: "smoke@example.invalid" });
  });
});
