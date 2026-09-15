import {
  LICENSE_SEATS,
  licenseActivateSchema,
  OFFLINE_GRACE_DAYS,
} from "@algorith-voice/shared-types";
import type { FastifyInstance } from "fastify";

// Phase 3 implements seat counting (LICENSE_SEATS), fingerprint binding,
// and RS256 license JWTs with 7d offline grace. Until then both endpoints
// require authentication and return honest stubs — no bypass paths.
export async function licenseRoutes(app: FastifyInstance) {
  app.post(
    "/activate",
    { onRequest: [app.authenticate], schema: { body: licenseActivateSchema } },
    async (req, reply) => {
      const { sub } = req.user as { sub: string };
      const device = await app.prisma.device.findFirst({
        where: { userId: sub },
        select: {
          id: true,
          name: true,
          type: true,
          lastSeenAt: true,
          createdAt: true,
        },
      });
      if (!device) {
        return reply.code(404).send({ error: "no_device" });
      }
      return {
        licenseJwt: "stub.license.jwt",
        device: {
          id: device.id,
          name: device.name,
          type: device.type.toLowerCase().replace("_", "-"),
          lastSeenAt: device.lastSeenAt?.toISOString() ?? null,
          createdAt: device.createdAt.toISOString(),
        },
        seatsUsed: 1,
        seatsMax: LICENSE_SEATS,
      };
    },
  );

  app.post("/validate", { onRequest: [app.authenticate] }, async () => ({
    valid: false,
    graceDays: OFFLINE_GRACE_DAYS,
  }));
}
