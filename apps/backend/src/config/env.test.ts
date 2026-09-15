import { describe, expect, it } from "vitest";
import { loadEnv } from "./env.js";

const BASE = {
  DATABASE_URL: "postgresql://u:p@localhost:5432/db",
  REDIS_URL: "redis://localhost:6379",
  JWT_ACCESS_SECRET: "a".repeat(32),
  JWT_REFRESH_PEPPER: "b".repeat(16),
  ENCRYPTION_KEK: "A".repeat(43) + "=",
};

describe("loadEnv", () => {
  it("accepts a minimal valid env", () => {
    const env = loadEnv({ ...BASE });
    expect(env.PORT).toBe(3001);
    expect(env.STT_PRIMARY).toBe("nvidia/parakeet-tdt-0.6b-v3");
  });
  it("rejects short JWT secrets and missing DATABASE_URL", () => {
    expect(() => loadEnv({ ...BASE, JWT_ACCESS_SECRET: "short" })).toThrow();
    const { DATABASE_URL: _dropped, ...noDb } = BASE;
    expect(() => loadEnv(noDb)).toThrow();
  });
  it("treats empty-string optionals as undefined", () => {
    const env = loadEnv({
      ...BASE,
      OPENROUTER_API_KEY: "",
      STRIPE_SECRET_KEY: "",
    });
    expect(env.OPENROUTER_API_KEY).toBeUndefined();
    expect(env.STRIPE_SECRET_KEY).toBeUndefined();
  });
  it("requires Stripe and R2 keys as complete sets", () => {
    expect(() => loadEnv({ ...BASE, STRIPE_SECRET_KEY: "sk_x" })).toThrow();
    expect(() =>
      loadEnv({
        ...BASE,
        STRIPE_SECRET_KEY: "sk_x",
        STRIPE_WEBHOOK_SECRET: "wh_x",
      }),
    ).not.toThrow();
    expect(() => loadEnv({ ...BASE, R2_ACCOUNT_ID: "abc" })).toThrow();
  });
  it("requires a real KEK and rejects placeholders in production", () => {
    expect(() => loadEnv({ ...BASE, ENCRYPTION_KEK: "short" })).toThrow();
    expect(() =>
      loadEnv({
        ...BASE,
        NODE_ENV: "production",
        APP_URL: "https://api.example.com",
        JWT_ACCESS_SECRET: "change-me-32-chars-minimum-access!!",
        JWT_REFRESH_PEPPER: "change-me-refresh-pepper!!",
      }),
    ).toThrow();
    expect(() =>
      loadEnv({
        ...BASE,
        NODE_ENV: "production",
        APP_URL: "https://api.example.com",
        JWT_ACCESS_SECRET: "c".repeat(32),
        JWT_REFRESH_PEPPER: "d".repeat(16),
      }),
    ).not.toThrow();
  });
  it("rejects localhost APP_URL in production", () => {
    expect(() =>
      loadEnv({
        ...BASE,
        NODE_ENV: "production",
        JWT_ACCESS_SECRET: "c".repeat(32),
        JWT_REFRESH_PEPPER: "d".repeat(16),
      }),
    ).toThrow();
  });
});
