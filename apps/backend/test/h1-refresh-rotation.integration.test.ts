import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getAppEnv } from "../src/config/env.js";
import { hashRefreshToken } from "../src/modules/oauth2/oauth2.store.js";
import { createTestApp, truncateTestState } from "./helpers/app.js";

describe("H1: refresh rotation", () => {
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
        email: "refresh@example.invalid",
        password: "correct-horse-battery-staple",
      },
    });
    expect(response.statusCode).toBe(201);
    return response.json<{ refreshToken: string }>().refreshToken;
  }

  it("H1: concurrent refreshes leave exactly one continuing family", async () => {
    const original = await signup();
    const responses = await Promise.all(
      Array.from({ length: 8 }, () =>
        app.inject({
          method: "POST",
          url: "/auth/refresh",
          payload: { refresh_token: original },
        }),
      ),
    );
    const winners = responses.filter((response) => response.statusCode === 200);
    expect(winners).toHaveLength(1);
    expect(
      responses.filter((response) => response.statusCode === 409),
    ).toHaveLength(7);

    const next = winners[0].json<{ refreshToken: string }>().refreshToken;
    const continued = await app.inject({
      method: "POST",
      url: "/auth/refresh",
      payload: { refresh_token: next },
    });
    expect(continued.statusCode).toBe(200);
  });

  it("H1: reuse beyond grace revokes the active family", async () => {
    const original = await signup();
    const first = await app.inject({
      method: "POST",
      url: "/auth/refresh",
      payload: { refresh_token: original },
    });
    expect(first.statusCode).toBe(200);
    const next = first.json<{ refreshToken: string }>().refreshToken;
    await app.prisma.session.update({
      where: {
        refreshHash: hashRefreshToken(original, getAppEnv().JWT_REFRESH_PEPPER),
      },
      data: { revokedAt: new Date(Date.now() - 11_000) },
    });

    const reuse = await app.inject({
      method: "POST",
      url: "/auth/refresh",
      payload: { refresh_token: original },
    });
    expect(reuse.statusCode).toBe(401);
    expect(reuse.json()).toEqual({ error: "invalid_grant" });

    const successor = await app.inject({
      method: "POST",
      url: "/auth/refresh",
      payload: { refresh_token: next },
    });
    expect(successor.statusCode).toBe(401);
  });
});
