import { checkoutRequestSchema } from "@algorith-voice/shared-types";
import type { FastifyInstance } from "fastify";

export async function billingRoutes(app: FastifyInstance) {
  app.post(
    "/create-checkout-session",
    { schema: { body: checkoutRequestSchema } },
    async (_req, reply) => {
      // TODO Phase 4: Stripe checkout.sessions.create with idempotency userId+priceId+day.
      return reply
        .code(501)
        .send({ error: "not_implemented", next: "phase-4" });
    },
  );

  app.post("/webhook", async (_req, reply) => {
    // TODO Phase 4: raw-body signature verify + enqueue to BullMQ, 200 fast.
    return reply.code(501).send({ error: "not_implemented", next: "phase-4" });
  });

  app.get("/subscription", { onRequest: [app.authenticate] }, async (req) => {
    const { sub } = req.user as { sub: string };
    const user = await app.prisma.user.findUniqueOrThrow({
      where: { id: sub },
    });
    return {
      status: "free" as const,
      planTier: user.planTier,
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
    };
  });
}
