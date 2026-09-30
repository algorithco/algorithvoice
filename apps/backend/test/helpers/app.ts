import * as argon2 from "argon2";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../src/app.js";
import { redis } from "../../src/queues/connection.js";

const TABLES = [
  '"AiRequestLog"',
  '"AiModelConfig"',
  '"AuditLog"',
  '"StripeEvent"',
  '"ProviderKey"',
  '"AudioAsset"',
  '"UsageRecord"',
  '"Subscription"',
  '"Device"',
  '"Session"',
  '"Account"',
  '"User"',
];

export async function truncateTestState(app: FastifyInstance): Promise<void> {
  if (!process.env.DATABASE_URL?.includes("algorith_voice_test")) {
    throw new Error("refusing to truncate a non-test database");
  }
  await app.prisma.$executeRawUnsafe(
    `TRUNCATE TABLE ${TABLES.join(", ")} RESTART IDENTITY CASCADE`,
  );
  await redis.flushdb();
}

export async function createTestApp(): Promise<FastifyInstance> {
  const app = buildApp();
  await app.ready();
  await truncateTestState(app);
  return app;
}

export async function createUser(
  app: FastifyInstance,
  overrides: { email?: string; password?: string; name?: string } = {},
) {
  const password = overrides.password ?? "correct-horse-battery-staple";
  const user = await app.prisma.user.create({
    data: {
      email: overrides.email ?? "integration@example.invalid",
      name: overrides.name ?? "Integration User",
      passwordHash: await argon2.hash(password),
    },
  });
  return { user, password };
}

export function signAccessToken(app: FastifyInstance, sub: string): string {
  return app.jwt.sign({ sub });
}

export function authHeader(token: string): { authorization: string } {
  return { authorization: `Bearer ${token}` };
}
