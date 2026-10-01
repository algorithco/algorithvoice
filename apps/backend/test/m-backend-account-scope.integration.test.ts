import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getAppEnv } from "../src/config/env.js";
import {
  hashRefreshToken,
  newOpaqueToken,
} from "../src/modules/oauth2/oauth2.store.js";
import {
  authHeader,
  createTestApp,
  createUser,
  signAccessToken,
  truncateTestState,
} from "./helpers/app.js";

describe("M-BACKEND-1/4: blocked users and refresh scopes", () => {
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

  it("M-BACKEND-1: blocking a user revokes sessions and rejects access", async () => {
    const { user: admin } = await createUser(app, {
      email: "admin-block@example.invalid",
    });
    await app.prisma.user.update({
      where: { id: admin.id },
      data: { role: "admin" },
    });
    const { user } = await createUser(app, {
      email: "blocked@example.invalid",
    });
    const refresh = newOpaqueToken();
    await app.prisma.session.create({
      data: {
        userId: user.id,
        refreshHash: hashRefreshToken(refresh, getAppEnv().JWT_REFRESH_PEPPER),
        familyId: "blocked-family",
        expiresAt: new Date(Date.now() + 86_400_000),
        absoluteLimitAt: new Date(Date.now() + 172_800_000),
      },
    });
    const blocked = await app.inject({
      method: "POST",
      url: `/admin/users/${user.id}/block`,
      headers: authHeader(signAccessToken(app, admin.id)),
    });
    expect(blocked.statusCode).toBe(200);
    expect(
      (await app.prisma.user.findUnique({ where: { id: user.id } }))?.blockedAt,
    ).toBeTruthy();
    expect(
      await app.prisma.session.count({
        where: { userId: user.id, revokedAt: null },
      }),
    ).toBe(0);
    const me = await app.inject({
      method: "GET",
      url: "/auth/me",
      headers: authHeader(signAccessToken(app, user.id)),
    });
    expect(me.statusCode).toBe(401);
  });

  it("M-BACKEND-4: OAuth refresh preserves granted scopes", async () => {
    const { user } = await createUser(app, {
      email: "scopes@example.invalid",
    });
    const refresh = newOpaqueToken();
    await app.prisma.session.create({
      data: {
        userId: user.id,
        refreshHash: hashRefreshToken(refresh, getAppEnv().JWT_REFRESH_PEPPER),
        familyId: "scope-family",
        scopes: ["email", "offline_access"],
        expiresAt: new Date(Date.now() + 86_400_000),
        absoluteLimitAt: new Date(Date.now() + 172_800_000),
      },
    });
    const response = await app.inject({
      method: "POST",
      url: "/oauth2/token",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      payload: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refresh,
        client_id: "desktop-app",
      }).toString(),
    });
    expect(response.statusCode).toBe(200);
    expect(response.json<{ scope: string }>().scope).toBe(
      "email offline_access",
    );
  });

  it("M-BACKEND-2: invalid admin pagination and dates return 400", async () => {
    const { user: admin } = await createUser(app, {
      email: "admin-validation@example.invalid",
    });
    await app.prisma.user.update({
      where: { id: admin.id },
      data: { role: "admin" },
    });
    const headers = authHeader(signAccessToken(app, admin.id));
    const badPage = await app.inject({
      method: "GET",
      url: "/admin/users?page=zero",
      headers,
    });
    expect(badPage.statusCode).toBe(400);
    const badDate = await app.inject({
      method: "GET",
      url: "/admin/stats/overview?from=not-a-date",
      headers,
    });
    expect(badDate.statusCode).toBe(400);
  });
});
