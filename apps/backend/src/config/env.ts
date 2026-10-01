import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";

// Local dev: load .env files via Node's native loader (Node >= 20.12).
// CI / Docker / Fly inject real env vars, which are never overridden
// (loadEnvFile does not overwrite existing vars).
// Backend-local .env wins; repo-root .env fills the gaps.
try {
  process.loadEnvFile();
} catch {
  // No .env in cwd (CI/prod) — env comes from the environment.
}
try {
  process.loadEnvFile("../../.env");
} catch {
  // Optional fallback — root .env may not exist.
}

const EXAMPLE_SECRETS = new Set([
  "change-me-32-chars-minimum-access",
  "change-me-32-chars-minimum-refresh",
  "dev-only-change-me-access-secret-32chars",
  "dev-only-change-me-refresh-pepper-32chars",
]);

function hasReasonableEntropy(value: string): boolean {
  return new Set(value).size >= 12;
}

function isLoopbackUrl(value: string): boolean {
  const hostname = new URL(value).hostname;
  return (
    hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1"
  );
}

// .env files conventionally contain KEY= (empty) for unset secrets —
// treat those as undefined so .optional() behaves.
const optStr = () =>
  z.preprocess((v) => (v === "" ? undefined : v), z.string().min(1).optional());

const envBool = (defaultValue: boolean) =>
  z.preprocess((value) => {
    if (value === undefined || value === "") return defaultValue;
    if (value === "true" || value === true) return true;
    if (value === "false" || value === false) return false;
    return value;
  }, z.boolean());

const envSchema = z
  .object({
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
    PORT: z.coerce.number().default(3001),
    DATABASE_URL: z.string().min(1),
    REDIS_URL: z.string().min(1),
    JWT_ACCESS_SECRET: z.string().min(32),
    JWT_REFRESH_PEPPER: z.string().min(32),
    AUDIT_HASH_KEY: z.preprocess(
      (value) => (value === "" ? undefined : value),
      z.string().min(32).optional(),
    ),
    ENCRYPTION_KEK: z.preprocess(
      (value) => (value === "" ? undefined : value),
      z
        .string()
        .min(16)
        .refine((value) => Buffer.from(value, "base64").length >= 32, {
          message: "ENCRYPTION_KEK must be base64 of >= 32 bytes",
        })
        .optional(),
    ),
    APP_URL: z.string().url().default("http://localhost:3000"),
    API_URL: z.preprocess(
      (v) => (v === "" ? undefined : v),
      z.string().url().default("http://localhost:3001"),
    ),
    OPENROUTER_API_KEY: optStr(),
    MISTRAL_API_KEY: optStr(),
    GROQ_API_KEY: optStr(),
    STT_PRIMARY: z.string().default("nvidia/parakeet-tdt-0.6b-v3"),
    STT_FALLBACK: z.string().default("openai/whisper-large-v3"),
    STT_STORAGE_BACKEND: z.enum(["local", "r2"]).default("local"),
    STT_TEMP_DIR: z.string().default(join(tmpdir(), "algorith-voice-stt")),
    STRIPE_SECRET_KEY: optStr(),
    STRIPE_WEBHOOK_SECRET: optStr(),
    STRIPE_PRICE_PRO: optStr(),
    STRIPE_PRICE_PRO_MONTHLY: optStr(),
    STRIPE_PRICE_PRO_YEARLY: optStr(),
    STRIPE_PORTAL_CONFIG: optStr(),
    R2_ACCOUNT_ID: optStr(),
    R2_ACCESS_KEY_ID: optStr(),
    R2_SECRET_ACCESS_KEY: optStr(),
    R2_BUCKET: z.string().default("algorith-voice-audio"),
    OAUTH_GOOGLE_CLIENT_ID: optStr(),
    OAUTH_GOOGLE_CLIENT_SECRET: optStr(),
    OAUTH_GITHUB_CLIENT_ID: optStr(),
    OAUTH_GITHUB_CLIENT_SECRET: optStr(),
    LEGACY_DESKTOP_OAUTH_TOKEN_IN_URL: envBool(true),
    LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
    TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(10).default(0),
    READINESS_TOKEN: optStr(),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === "production") {
      for (const key of ["JWT_ACCESS_SECRET", "JWT_REFRESH_PEPPER"] as const) {
        if (EXAMPLE_SECRETS.has(env[key]) || !hasReasonableEntropy(env[key])) {
          ctx.addIssue({
            code: "custom",
            message: `${key} must not be a placeholder in production`,
          });
        }
      }
      const kek = env.ENCRYPTION_KEK
        ? Buffer.from(env.ENCRYPTION_KEK, "base64")
        : null;
      if (kek && (kek.every((byte) => byte === 0) || new Set(kek).size < 12)) {
        ctx.addIssue({
          code: "custom",
          message: "ENCRYPTION_KEK must have sufficient entropy in production",
        });
      }
      if (isLoopbackUrl(env.APP_URL)) {
        ctx.addIssue({
          code: "custom",
          message: "APP_URL must not be localhost in production",
        });
      }
      if (isLoopbackUrl(env.API_URL)) {
        ctx.addIssue({
          code: "custom",
          message:
            "API_URL is required and must not be localhost in production",
        });
      }
      if (!env.AUDIT_HASH_KEY) {
        ctx.addIssue({
          code: "custom",
          message: "AUDIT_HASH_KEY is required in production",
        });
      }
      if (
        env.STRIPE_SECRET_KEY &&
        (!env.STRIPE_PRICE_PRO_MONTHLY || !env.STRIPE_PRICE_PRO_YEARLY)
      ) {
        ctx.addIssue({
          code: "custom",
          message:
            "Stripe monthly and yearly price IDs are required in production",
        });
      }
    }
    const stripeKeys = ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"] as const;
    const stripeSet = stripeKeys.filter((k) => env[k] !== undefined);
    if (stripeSet.length === 1) {
      ctx.addIssue({
        code: "custom",
        message:
          "STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET must be set together",
      });
    }
    if (
      env.STRIPE_PRICE_PRO_MONTHLY !== undefined &&
      env.STRIPE_PRICE_PRO_YEARLY !== undefined &&
      env.STRIPE_PRICE_PRO_MONTHLY === env.STRIPE_PRICE_PRO_YEARLY
    ) {
      ctx.addIssue({
        code: "custom",
        message:
          "STRIPE_PRICE_PRO_MONTHLY and STRIPE_PRICE_PRO_YEARLY must differ",
      });
    }
    const r2Keys = [
      "R2_ACCOUNT_ID",
      "R2_ACCESS_KEY_ID",
      "R2_SECRET_ACCESS_KEY",
    ] as const;
    const r2Set = r2Keys.filter((k) => env[k] !== undefined);
    if (r2Set.length > 0 && r2Set.length < 3) {
      ctx.addIssue({
        code: "custom",
        message:
          "R2_ACCOUNT_ID, R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY must be set together",
      });
    }
    if (env.STT_STORAGE_BACKEND === "r2" && r2Set.length !== 3) {
      ctx.addIssue({
        code: "custom",
        message: "R2 credentials are required when STT_STORAGE_BACKEND is r2",
      });
    }
  });

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const flattened = parsed.error.flatten();
    throw new Error(
      `Invalid env: ${JSON.stringify({ fieldErrors: flattened.fieldErrors, formErrors: flattened.formErrors })}`,
    );
  }
  const env = parsed.data;
  // loadEnv runs once per importing module (server, app, queues…) — warn
  // only on the first call so boot logs stay readable.
  if (!warnedOnce) {
    warnedOnce = true;
    if (!env.OPENROUTER_API_KEY) {
      console.warn("[env] OPENROUTER_API_KEY missing — cloud STT will 503");
    }
    if (!env.STRIPE_SECRET_KEY) {
      console.warn("[env] STRIPE_* missing — billing will 501");
    }
  }
  return env;
}

// Validated-env singleton: parsed once at boot (app.ts / worker.ts),
// read everywhere else. Never touch process.env directly in routes.
let cached: Env | null = null;
let warnedOnce = false;

export function setAppEnv(env: Env): Env {
  cached = env;
  return env;
}

export function getAppEnv(): Env {
  if (!cached) throw new Error("env not initialized — call setAppEnv at boot");
  return cached;
}
