import { licenseActivateSchema } from "@algorith-voice/shared-types";
import type { FastifyInstance } from "fastify";

// 3 seats/user, 7d offline grace (grace enforced client-side via exp + server refresh).
export async function licenseRoutes(app: FastifyInstance) {
  app.post(
    "/activate",
    { schema: { body: licenseActivateSchema } },
    async (req) => {
      const { sub } = (req.user ?? {}) as { sub?: string };
      if (!sub) {
        const { code } = req.query as { code?: string };
        if (!code)
          throw Object.assign(
            new Error("auth required (Bearer or device code)"),
            { statusCode: 401 },
          );
      }
      // TODO Phase 3: seat counting (max 3), fingerprint binding, RS256 license JWT.
      return {
        licenseJwt: "stub.license.jwt",
        seatsUsed: 1,
        seatsMax: 3,
        next: "phase-3",
      };
    },
  );

  app.post("/validate", async () => ({ valid: true, graceDays: 7 }));
}
