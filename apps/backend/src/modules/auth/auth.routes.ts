import { loginSchema, signupSchema } from "@algorith-voice/shared-types";
import type { DeviceType } from "@prisma/client";
import * as argon2 from "argon2";
import type { FastifyInstance } from "fastify";

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

// NOTE: Phase 0 skeleton — full refresh-rotation + OAuth + lockout lands in Phase 3.
// This keeps API contracts stable while remaining honest about what's implemented.
export async function authRoutes(app: FastifyInstance) {
  app.post("/signup", { schema: { body: signupSchema } }, async (req) => {
    const { email, name, deviceName, deviceType } = req.body as {
      email: string;
      name?: string;
      deviceName?: string;
      deviceType?: string;
    };
    const passwordHash = await argon2.hash(
      (req.body as { password: string }).password,
      {
        type: argon2.argon2id,
        memoryCost: 65536,
        timeCost: 3,
        parallelism: 4,
      },
    );
    const user = await app.prisma.user.create({
      data: { email, name, passwordHash, planTier: "free" },
    });
    // Phase 1 pairing: register the device that signed up (seat counting in Phase 3).
    if (deviceName) {
      await app.prisma.device.create({
        data: {
          userId: user.id,
          name: deviceName,
          type: toDeviceType(deviceType),
          lastSeenAt: new Date(),
        },
      });
    }
    const accessToken = app.jwt.sign({ sub: user.id, email: user.email });
    return {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        planTier: user.planTier,
        stripeCustomerId: user.stripeCustomerId,
        createdAt: user.createdAt.toISOString(),
      },
      accessToken,
    };
  });

  app.post("/login", { schema: { body: loginSchema } }, async (req, reply) => {
    const { email, password } = req.body as { email: string; password: string };
    const user = await app.prisma.user.findUnique({ where: { email } });
    if (
      !user?.passwordHash ||
      !(await argon2.verify(user.passwordHash, password))
    ) {
      return reply.code(401).send({ error: "invalid_credentials" });
    }
    const accessToken = app.jwt.sign({ sub: user.id, email: user.email });
    return {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        planTier: user.planTier,
        stripeCustomerId: user.stripeCustomerId,
        createdAt: user.createdAt.toISOString(),
      },
      accessToken,
    };
  });

  app.post("/logout", async () => {
    // Phase 1: refresh revocation lands with rotation in Phase 3.
    // Desktop clears its keyring session; web clears httpOnly cookies.
    return { ok: true };
  });

  app.post("/refresh", async (_req, reply) => {
    // TODO Phase 3: rotating opaque refresh via httpOnly cookie + reuse detection.
    return reply.code(501).send({ error: "not_implemented", next: "phase-3" });
  });

  app.post("/oauth/:provider", async (_req, reply) => {
    return reply.code(501).send({ error: "not_implemented", next: "phase-3" });
  });

  app.get("/me", { onRequest: [app.authenticate] }, async (req) => {
    const { sub } = req.user as { sub: string };
    return app.prisma.user.findUniqueOrThrow({ where: { id: sub } });
  });
}
