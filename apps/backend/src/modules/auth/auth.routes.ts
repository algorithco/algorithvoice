import {
  authPairSchema,
  errorSchema,
  loginSchema,
  signupSchema,
  userSchema,
} from "@algorith-voice/shared-types";
import type { DeviceType } from "@prisma/client";
import * as argon2 from "argon2";
import type { FastifyInstance } from "fastify";

const HASH_OPTS = {
  type: argon2.argon2id,
  memoryCost: 65536,
  timeCost: 3,
  parallelism: 4,
  hashLength: 32,
} as const;

// Precomputed dummy hash: verified on login-miss so valid and invalid
// emails take the same time (no timing oracle for user enumeration).
const DUMMY_HASH =
  "$argon2id$v=19$m=65536,t=3,p=4$xSOEF+zYJxUh2Z6QplEj7g$bmxrOQUSGpzpBURngAcoUZcv+azJynPluSfIYUd0v24";

function toDeviceType(input: unknown): DeviceType {
  switch (input) {
    case "desktop-windows":
      return "DESKTOP_WINDOWS";
    case "desktop-linux":
      return "DESKTOP_LINUX";
    default:
      return "DESKTOP_MACOS";
  }
}

const publicUser = {
  id: true,
  email: true,
  name: true,
  planTier: true,
  stripeCustomerId: true,
  createdAt: true,
} as const;

function toUserSchema(u: {
  id: string;
  email: string;
  name: string | null;
  planTier: string;
  stripeCustomerId: string | null;
  createdAt: Date;
}) {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    planTier: u.planTier,
    stripeCustomerId: u.stripeCustomerId,
    createdAt: u.createdAt.toISOString(),
  };
}

// NOTE: refresh rotation + OAuth land in Phase 3. Contracts are stable;
// stubs return 501 with a fixed envelope (no roadmap leakage on the wire).
export async function authRoutes(app: FastifyInstance) {
  app.post(
    "/signup",
    {
      schema: {
        body: signupSchema,
        response: { 201: authPairSchema, 409: errorSchema },
      },
      config: { rateLimit: { max: 10, timeWindow: "1 hour" } },
    },
    async (req, reply) => {
      const { email, password, name, deviceName, deviceType } = req.body as {
        email: string;
        password: string;
        name?: string;
        deviceName?: string;
        deviceType?: string;
      };
      const passwordHash = await argon2.hash(password, { ...HASH_OPTS });
      try {
        const user = await app.prisma.$transaction(async (tx) => {
          const created = await tx.user.create({
            data: { email, name, passwordHash, planTier: "free" },
            select: publicUser,
          });
          // Phase 1 pairing: register the signup device (seats in Phase 3).
          if (deviceName) {
            await tx.device.create({
              data: {
                userId: created.id,
                name: deviceName,
                type: toDeviceType(deviceType),
                lastSeenAt: new Date(),
              },
            });
            await tx.auditLog.create({
              data: { actorUserId: created.id, action: "device.create" },
            });
          }
          await tx.auditLog.create({
            data: { actorUserId: created.id, action: "auth.signup" },
          });
          return created;
        });
        const accessToken = app.jwt.sign({ sub: user.id });
        return reply.code(201).send({ user: toUserSchema(user), accessToken });
      } catch (e: unknown) {
        if (
          typeof e === "object" &&
          e !== null &&
          "code" in e &&
          e.code === "P2002"
        ) {
          return reply.code(409).send({ error: "email_taken" });
        }
        throw e;
      }
    },
  );

  app.post(
    "/login",
    {
      schema: { body: loginSchema },
      config: { rateLimit: { max: 5, timeWindow: "10 minutes" } },
    },
    async (req, reply) => {
      const { email, password } = req.body as {
        email: string;
        password: string;
      };
      const user = await app.prisma.user.findUnique({
        where: { email },
        select: { ...publicUser, passwordHash: true },
      });
      const ok = user?.passwordHash
        ? await argon2.verify(user.passwordHash, password).catch(() => false)
        : await argon2.verify(DUMMY_HASH, password).catch(() => false);
      if (!user?.passwordHash || !ok) {
        return reply.code(401).send({ error: "invalid_credentials" });
      }
      const accessToken = app.jwt.sign({ sub: user.id });
      return { user: toUserSchema(user), accessToken };
    },
  );

  app.post("/logout", async () => {
    // Phase 3 adds server-side jti blocklist + refresh revocation.
    // Desktop clears its keyring session; web clears httpOnly cookies.
    return { ok: true };
  });

  app.post("/refresh", async (_req, reply) => {
    return reply.code(501).send({ error: "not_implemented" });
  });

  app.post("/oauth/:provider", async (_req, reply) => {
    return reply.code(501).send({ error: "not_implemented" });
  });

  // Desktop deep-link flow: GET /auth/oauth/:provider/start?callback=algorithvoice://auth-callback&device=Desktop
  // Opens system browser; backend must validate and either redirect to provider OAuth
  // or redirect back to the deep-link with an error so the Tauri shell can complete.
  app.get("/oauth/:provider/start", async (req, reply) => {
    const { provider } = req.params as { provider: string };
    const query = req.query as {
      callback?: string;
      device?: string;
      state?: string;
    };
    const callback = query.callback ?? "algorithvoice://auth-callback";
    const state = typeof query.state === "string" ? query.state : undefined;
    const allowedProviders = new Set(["google", "github"]);
    if (!allowedProviders.has(provider)) {
      return reply.code(400).send({ error: "unknown_provider" });
    }
    // Validate callback scheme — must be algorithvoice:// to avoid open redirect.
    const isValidCallback =
      typeof callback === "string" &&
      callback.toLowerCase().startsWith("algorithvoice:");
    if (!isValidCallback) {
      return reply.code(400).send({ error: "invalid_callback" });
    }
    // Validate state format if provided (base64url 16 bytes ~22 chars, allow 16-128)
    if (state !== undefined && !/^[A-Za-z0-9_-]{16,128}$/.test(state)) {
      return reply.code(400).send({ error: "invalid_state" });
    }
    // Phase 3 will redirect to real provider OAuth. Until env is configured,
    // redirect back with error so desktop's auth-callback listener resolves
    // (otherwise openUrl would show a dead 501 page with no deep-link return).
    const { getAppEnv } = await import("../../config/env.js");
    const env = getAppEnv();
    const configured =
      provider === "google"
        ? !!env.OAUTH_GOOGLE_CLIENT_ID && !!env.OAUTH_GOOGLE_CLIENT_SECRET
        : !!env.OAUTH_GITHUB_CLIENT_ID && !!env.OAUTH_GITHUB_CLIENT_SECRET;
    const buildRedirect = (error: string) => {
      const url = new URL(callback);
      url.searchParams.set("error", error);
      url.searchParams.set("provider", provider);
      if (state) url.searchParams.set("state", state);
      return url.toString();
    };
    if (!configured) {
      return reply.redirect(buildRedirect("oauth_not_configured"), 302);
    }
    // Configured but Phase 3 handler not yet wired — return honest stub redirect.
    return reply.redirect(buildRedirect("not_implemented"), 302);
  });

  app.get(
    "/me",
    {
      onRequest: [app.authenticate],
      schema: { response: { 200: userSchema } },
    },
    async (req) => {
      const { sub } = req.user as { sub: string };
      const user = await app.prisma.user.findUniqueOrThrow({
        where: { id: sub },
        select: publicUser,
      });
      return toUserSchema(user);
    },
  );
}
