import {
  checkoutRequestSchema,
  subscriptionSchema,
} from "@algorith-voice/shared-types";
import type { FastifyInstance } from "fastify";

const STATUS_MAP: Record<
  string,
  "trialing" | "active" | "past_due" | "canceled" | "incomplete"
> = {
  TRIALING: "trialing",
  ACTIVE: "active",
  PAST_DUE: "past_due",
  CANCELED: "canceled",
  INCOMPLETE: "incomplete",
};

export async function billingRoutes(app: FastifyInstance) {
  app.post(
    "/create-checkout-session",
    {
      onRequest: [app.authenticate],
      schema: { body: checkoutRequestSchema },
      config: { rateLimit: { max: 10, timeWindow: "1 hour" } },
    },
    async (_req, reply) => {
      // Phase 4: Stripe checkout.sessions.create with idempotency userId+priceId+day.
      return reply.code(501).send({ error: "not_implemented" });
    },
  );

  // Public but MUST verify the Stripe signature when implemented (Phase 4):
  // raw body + StripeEvent.id idempotency + 200 fast + BullMQ enqueue.
  app.post("/webhook", async (_req, reply) => {
    return reply.code(501).send({ error: "not_implemented" });
  });

  app.get(
    "/subscription",
    {
      onRequest: [app.authenticate],
      schema: { response: { 200: subscriptionSchema } },
    },
    async (req) => {
      const { sub } = req.user as { sub: string };
      const [user, sub2] = await Promise.all([
        app.prisma.user.findUniqueOrThrow({ where: { id: sub } }),
        app.prisma.subscription.findFirst({
          where: {
            userId: sub,
            status: { in: ["TRIALING", "ACTIVE", "PAST_DUE"] },
          },
          orderBy: { currentPeriodEnd: "desc" },
        }),
      ]);
      if (!sub2) {
        return {
          status: "free" as const,
          planTier: user.planTier,
          currentPeriodEnd: null,
          cancelAtPeriodEnd: false,
        };
      }
      return {
        status: STATUS_MAP[sub2.status] ?? "incomplete",
        planTier: user.planTier,
        currentPeriodEnd: sub2.currentPeriodEnd.toISOString(),
        cancelAtPeriodEnd: sub2.cancelAtPeriodEnd,
      };
    },
  );
}
