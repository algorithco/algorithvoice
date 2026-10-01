import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  authHeader,
  createTestApp,
  createUser,
  signAccessToken,
  truncateTestState,
} from "./helpers/app.js";

describe("T-TESTS: admin route authorization matrix", () => {
  let app: FastifyInstance;
  let targetId = "";

  beforeAll(async () => {
    app = await createTestApp();
  });

  beforeEach(async () => {
    await truncateTestState(app);
    const { user } = await createUser(app, {
      email: "admin-route-target@example.invalid",
    });
    targetId = user.id;
  });

  afterAll(async () => {
    await app.close();
  });

  const routes: ReadonlyArray<{
    method: "GET" | "POST" | "PUT";
    url: string;
    payload?: Record<string, never>;
  }> = [
    { method: "GET", url: "/admin/stats/overview" },
    { method: "GET", url: "/admin/stats/models" },
    { method: "GET", url: "/admin/config/ai-model" },
    {
      method: "PUT",
      url: "/admin/config/ai-model",
      payload: {},
    },
    { method: "GET", url: "/admin/logs/errors" },
    { method: "GET", url: "/admin/essays" },
    { method: "GET", url: "/admin/users" },
    { method: "POST", url: `/admin/users/${"TARGET"}/block`, payload: {} },
    { method: "GET", url: "/admin/keys" },
  ];

  for (const route of routes) {
    it(`T-TESTS: ${route.method} ${route.url} rejects unauthenticated callers`, async () => {
      const response = await app.inject({
        method: route.method,
        url: route.url.replace("TARGET", targetId),
        ...(route.payload === undefined ? {} : { payload: route.payload }),
      });
      expect(response.statusCode).toBe(401);
    });

    it(`T-TESTS: ${route.method} ${route.url} rejects non-admin users`, async () => {
      const { user } = await createUser(app, {
        email: "ordinary-admin-route-caller@example.invalid",
      });
      const response = await app.inject({
        method: route.method,
        url: route.url.replace("TARGET", targetId),
        headers: authHeader(signAccessToken(app, user.id)),
        ...(route.payload === undefined ? {} : { payload: route.payload }),
      });
      expect(response.statusCode).toBe(403);
    });
  }
});
