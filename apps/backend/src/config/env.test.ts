import { describe, expect, it } from "vitest";
import { loadEnv } from "./env.js";

const BASE = {
  DATABASE_URL: "postgresql://u:p@localhost:5432/db",
  REDIS_URL: "redis://localhost:6379",
  JWT_ACCESS_SECRET: "A9!access-secret-with-variety-2026#",
  JWT_REFRESH_PEPPER: "B8!refresh-pepper-with-variety-2026#",
  AUDIT_HASH_KEY: "C7!audit-hash-key-with-variety-2026#",
  ENCRYPTION_KEK: `${"A".repeat(43)}=`,
};

describe("loadEnv", () => {
  it("accepts a minimal valid env", () => {
    const env = loadEnv({ ...BASE });
    expect(env.PORT).toBe(3001);
    expect(env.APP_URL).toBe("http://localhost:3000");
    expect(env.API_URL).toBe("http://localhost:3001");
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
        STRIPE_PRICE_PRO_MONTHLY: "price_month",
        STRIPE_PRICE_PRO_YEARLY: "price_year",
      }),
    ).not.toThrow();
    expect(() =>
      loadEnv({
        ...BASE,
        NODE_ENV: "production",
        APP_URL: "https://app.example.invalid",
        API_URL: "https://api.example.invalid",
        ENCRYPTION_KEK: Buffer.from(
          Array.from({ length: 32 }, (_, index) => index + 1),
        ).toString("base64"),
        STRIPE_SECRET_KEY: "sk_x",
        STRIPE_WEBHOOK_SECRET: "wh_x",
      }),
    ).toThrow(/price IDs/);
    expect(() => loadEnv({ ...BASE, R2_ACCOUNT_ID: "abc" })).toThrow();
    expect(() => loadEnv({ ...BASE, STT_STORAGE_BACKEND: "r2" })).toThrow(
      /R2 credentials/,
    );
    expect(() =>
      loadEnv({
        ...BASE,
        STT_STORAGE_BACKEND: "r2",
        R2_ACCOUNT_ID: "account-id",
        R2_ACCESS_KEY_ID: "access-key",
        R2_SECRET_ACCESS_KEY: "secret-key",
      }),
    ).not.toThrow();
  });
  it("validates a configured KEK and rejects placeholders in production", () => {
    expect(() => loadEnv({ ...BASE, ENCRYPTION_KEK: "short" })).toThrow();
    expect(() =>
      loadEnv({
        ...BASE,
        NODE_ENV: "production",
        APP_URL: "https://app.trqsh.uz",
        API_URL: "https://api.trqsh.uz",
        JWT_ACCESS_SECRET: "change-me-32-chars-minimum-access",
        JWT_REFRESH_PEPPER: "change-me-32-chars-minimum-refresh",
      }),
    ).toThrow();
    expect(() =>
      loadEnv({
        ...BASE,
        NODE_ENV: "production",
        APP_URL: "https://app.trqsh.uz",
        API_URL: "https://api.trqsh.uz",
        JWT_ACCESS_SECRET: "C7!contest-secret-is-valid-and-random-2026",
        JWT_REFRESH_PEPPER: "D6!latest-refresh-is-valid-random-2026",
        ENCRYPTION_KEK: Buffer.from(
          Array.from({ length: 32 }, (_, index) => index + 1),
        ).toString("base64"),
      }),
    ).not.toThrow();
  });
  it("rejects non-production public origins in production", () => {
    expect(() =>
      loadEnv({
        ...BASE,
        NODE_ENV: "production",
        APP_URL: "http://127.0.0.1:3000",
        API_URL: "http://127.0.0.1:3001",
        JWT_ACCESS_SECRET: "C7!production-access-valid-random-2026",
        JWT_REFRESH_PEPPER: "D6!production-refresh-valid-random-2026",
        ENCRYPTION_KEK: Buffer.from(
          Array.from({ length: 32 }, (_, index) => index + 1),
        ).toString("base64"),
      }),
    ).toThrow();
  });

  it("H8: .env.example boots in development", () => {
    const example = parseEnv(
      readFileSync(
        new URL("../../../../.env.example", import.meta.url),
        "utf8",
      ),
    ) as Record<string, string>;
    expect(() => loadEnv(example as NodeJS.ProcessEnv)).not.toThrow();
  });

  it("H8: .env.example service passwords match its native-development URLs", () => {
    const example = parseEnv(
      readFileSync(
        new URL("../../../../.env.example", import.meta.url),
        "utf8",
      ),
    ) as Record<string, string>;
    expect(new URL(example.DATABASE_URL).password).toBe(
      example.POSTGRES_PASSWORD,
    );
    expect(new URL(example.REDIS_URL).password).toBe(example.REDIS_PASSWORD);
  });

  it("H8: rejects a zero KEK and missing API URL in production", () => {
    const production = {
      ...BASE,
      NODE_ENV: "production",
      APP_URL: "https://app.example.invalid",
      JWT_ACCESS_SECRET: "C7!production-access-valid-random-2026",
      JWT_REFRESH_PEPPER: "D6!production-refresh-valid-random-2026",
    };
    expect(() => loadEnv(production)).toThrow(/API_URL/);
    expect(() =>
      loadEnv({
        ...production,
        API_URL: "https://api.example.invalid",
        ENCRYPTION_KEK: Buffer.alloc(32).toString("base64"),
      }),
    ).toThrow(/ENCRYPTION_KEK/);
  });

  it("H8: reports form-level validation errors", () => {
    expect(() =>
      loadEnv({
        ...BASE,
        STRIPE_PRICE_PRO_MONTHLY: "price_same",
        STRIPE_PRICE_PRO_YEARLY: "price_same",
      }),
    ).toThrow(/formErrors/);
  });
});

import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
