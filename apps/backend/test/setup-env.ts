// Integration tests use an isolated database and Redis DB. Never point these
// values at the development database because the harness truncates tables.
process.env.NODE_ENV = "test";
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  "postgresql://algorith:algorith@127.0.0.1:5432/algorith_voice_test?schema=public";
process.env.REDIS_URL =
  process.env.TEST_REDIS_URL ?? "redis://127.0.0.1:6379/15";
process.env.JWT_ACCESS_SECRET =
  "integration-access-secret-at-least-32-characters";
process.env.JWT_REFRESH_PEPPER = "integration-refresh-pepper-32-characters";
process.env.ENCRYPTION_KEK = Buffer.alloc(32, 7).toString("base64");
process.env.APP_URL = "http://127.0.0.1:3000";
process.env.API_URL = "http://127.0.0.1:3001";
process.env.LOG_LEVEL = "error";

for (const key of [
  "MISTRAL_API_KEY",
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "STRIPE_PRICE_PRO",
  "STRIPE_PRICE_PRO_MONTHLY",
  "STRIPE_PRICE_PRO_YEARLY",
  "OAUTH_GOOGLE_CLIENT_ID",
  "OAUTH_GOOGLE_CLIENT_SECRET",
  "OAUTH_GITHUB_CLIENT_ID",
  "OAUTH_GITHUB_CLIENT_SECRET",
]) {
  process.env[key] = "";
}
process.env.OPENROUTER_API_KEY = "integration-openrouter-key";
