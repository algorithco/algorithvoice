import type { FastifyInstance, InjectOptions } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  signOAuthState,
  verifyOAuthState,
} from "../src/modules/auth/oauth-state.js";
import { createTestApp } from "./helpers/app.js";

const secret = "integration-access-secret-at-least-32-characters";

describe("C1: access-token boundary", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  const authenticatedRoutes: InjectOptions[] = [
    { method: "GET", url: "/auth/me" },
    { method: "GET", url: "/auth/providers" },
    { method: "POST", url: "/oauth2/approve" },
    { method: "POST", url: "/license/activate" },
    { method: "POST", url: "/license/validate" },
    { method: "GET", url: "/license/devices" },
    { method: "DELETE", url: "/license/devices/not-found" },
    { method: "GET", url: "/usage/summary" },
    { method: "GET", url: "/usage/daily" },
    { method: "GET", url: "/usage/recent" },
    { method: "POST", url: "/stt/jobs" },
    { method: "GET", url: "/stt/jobs/not-found" },
    { method: "POST", url: "/stt/transcribe" },
    { method: "POST", url: "/billing/create-checkout-session" },
    { method: "POST", url: "/billing/create-portal-session" },
    { method: "GET", url: "/billing/subscription" },
  ];

  it.each(authenticatedRoutes)(
    "C1: OAuth state is rejected by $method $url",
    async (request) => {
      const token = signOAuthState(secret, {
        provider: "github",
        device: "web",
        cb: "http://127.0.0.1:3000/login",
      });
      const response = await app.inject({
        ...request,
        headers: { authorization: `Bearer ${token}` },
      });
      expect(response.statusCode).toBe(401);
    },
  );

  it("C1: token without a non-empty subject is rejected", async () => {
    for (const payload of [{}, { sub: "" }]) {
      const response = await app.inject({
        method: "GET",
        url: "/auth/me",
        headers: { authorization: `Bearer ${app.jwt.sign(payload)}` },
      });
      expect(response.statusCode).toBe(401);
    }
  });

  it("C1: admin routes reject OAuth state and subjectless tokens", async () => {
    const tokens = [
      signOAuthState(secret, {
        provider: "github",
        device: "web",
        cb: "http://127.0.0.1:3000/login",
      }),
      app.jwt.sign({}),
    ];
    for (const token of tokens) {
      const response = await app.inject({
        method: "GET",
        url: "/admin/stats/overview",
        headers: { authorization: `Bearer ${token}` },
      });
      expect(response.statusCode).toBe(401);
    }
  });

  it("C1: access tokens are rejected by OAuth-state verification", () => {
    const accessToken = app.jwt.sign({ sub: "user-id" });
    expect(() => verifyOAuthState(secret, accessToken)).toThrow();
  });
});
