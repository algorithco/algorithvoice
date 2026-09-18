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

const PLACEHOLDER = /change-me|example|test|password/i;

// .env files conventionally contain KEY= (empty) for unset secrets —
// treat those as undefined so .optional() behaves.
const optStr = () =>
  z.preprocess((v) => (v === "" ? undefined : v), z.string().min(1).optional());

const envSchema = z
  .object({
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
    PORT: z.coerce.number().default(3001),
    DATABASE_URL: z.string().min(1),
    REDIS_URL: z.string().min(1),
    JWT_ACCESS_SECRET: z.string().min(32),
    JWT_REFRESH_PEPPER: z.string().min(16),
    ENCRYPTION_KEK: z
      .string()
      .min(16)
      .refine(
        (s) => {
          try {
            return Buffer.from(s, "base64").length >= 32;
          } catch {
            return false;
          }
        },
        { message: "ENCRYPTION_KEK must be base64 of >= 32 bytes" },
      ),
    APP_URL: z.string().url().default("http://localhost:3000"),
    API_URL: z.preprocess(
      (v) => (v === "" ? undefined : v),
      z.string().url().optional(),
    ),
    OPENROUTER_API_KEY: optStr(),
    MISTRAL_API_KEY: optStr(),
    STT_PRIMARY: z.string().default("nvidia/parakeet-tdt-0.6b-v3"),
    STT_FALLBACK: z.string().default("openai/whisper-large-v3"),
    STRIPE_SECRET_KEY: optStr(),
    STRIPE_WEBHOOK_SECRET: optStr(),
    STRIPE_PRICE_PRO: optStr(),
    R2_ACCOUNT_ID: optStr(),
    R2_ACCESS_KEY_ID: optStr(),
    R2_SECRET_ACCESS_KEY: optStr(),
    R2_BUCKET: z.string().default("algorith-voice-audio"),
    OAUTH_GOOGLE_CLIENT_ID: optStr(),
    OAUTH_GOOGLE_CLIENT_SECRET: optStr(),
    OAUTH_GITHUB_CLIENT_ID: optStr(),
    OAUTH_GITHUB_CLIENT_SECRET: optStr(),
    LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === "production") {
      for (const key of ["JWT_ACCESS_SECRET", "JWT_REFRESH_PEPPER"] as const) {
        if (PLACEHOLDER.test(env[key])) {
          ctx.addIssue({
            code: "custom",
            message: `${key} must not be a placeholder in production`,
          });
        }
      }
      if (env.APP_URL.includes("localhost")) {
        ctx.addIssue({
          code: "custom",
          message: "APP_URL must not be localhost in production",
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
  });

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const fields = parsed.error.flatten().fieldErrors;
    throw new Error(`Invalid env: ${JSON.stringify(fields)}`);
  }
  const env = parsed.data;
  if (!env.OPENROUTER_API_KEY) {
    console.warn("[env] OPENROUTER_API_KEY missing — cloud STT will 503");
  }
  if (!env.STRIPE_SECRET_KEY) {
    console.warn("[env] STRIPE_* missing — billing will 501");
  }
  return env;
}

// Validated-env singleton: parsed once at boot (app.ts / worker.ts),
// read everywhere else. Never touch process.env directly in routes.
let cached: Env | null = null;

export function setAppEnv(env: Env): Env {
  cached = env;
  return env;
}

export function getAppEnv(): Env {
  if (!cached) throw new Error("env not initialized — call setAppEnv at boot");
  return cached;
}
