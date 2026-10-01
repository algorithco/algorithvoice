import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { progressiveLoginDelayMs } from "../src/modules/auth/login-protection.js";
import { redis } from "../src/queues/connection.js";
import { createTestApp } from "./helpers/app.js";

describe("H11: distributed rate limiting", () => {
  let first: FastifyInstance;
  let second: FastifyInstance;

  beforeAll(async () => {
    first = await createTestApp();
    second = await createTestApp();
  });

  beforeEach(async () => {
    await redis.flushdb();
  });

  afterAll(async () => {
    await Promise.all([first.close(), second.close()]);
  });

  function invalidExchange(app: FastifyInstance, forwardedFor?: string) {
    return app.inject({
      method: "POST",
      url: "/auth/oauth/exchange",
      headers: forwardedFor ? { "x-forwarded-for": forwardedFor } : undefined,
      payload: { code: "invalid" },
    });
  }

  it("H11: shares route limits across two API instances", async () => {
    const initial = await Promise.all([
      ...Array.from({ length: 10 }, () => invalidExchange(first)),
      ...Array.from({ length: 10 }, () => invalidExchange(second)),
    ]);
    expect(initial.every((response) => response.statusCode === 400)).toBe(true);
    expect((await invalidExchange(first)).statusCode).toBe(429);
  });

  it("H11: ignores spoofed X-Forwarded-For without a trusted proxy", async () => {
    for (let index = 0; index < 20; index += 1) {
      expect(
        (await invalidExchange(first, `198.51.100.${index + 1}`)).statusCode,
      ).toBe(400);
    }
    expect((await invalidExchange(first, "203.0.113.99")).statusCode).toBe(429);
  });

  it("H11: account protection uses bounded progressive delay, not lockout", () => {
    expect(progressiveLoginDelayMs(0)).toBe(0);
    expect(progressiveLoginDelayMs(3)).toBeGreaterThan(0);
    expect(progressiveLoginDelayMs(10_000)).toBeLessThanOrEqual(2_000);
  });
});
