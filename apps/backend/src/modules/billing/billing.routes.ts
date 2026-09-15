import { Readable } from "node:stream";
import {
  checkoutRequestSchema,
  checkoutResponseSchema,
  errorSchema,
  portalRequestSchema,
  portalResponseSchema,
  subscriptionSchema,
} from "@algorith-voice/shared-types";
import type { FastifyInstance } from "fastify";
import { getAppEnv } from "../../config/env.js";
import { QUEUES } from "../../queues/connection.js";
import { getStripe } from "./stripe.js";

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

async function bufferBody(
  payload: AsyncIterable<Uint8Array>,
): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of payload) {
    const copy = new Uint8Array(chunk);
    chunks.push(copy);
    total += copy.byteLength;
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return merged;
}

export async function billingRoutes(app: FastifyInstance) {
  app.post(
    "/create-checkout-session",
    {
      onRequest: [app.authenticate],
      schema: {
        body: checkoutRequestSchema,
        response: {
          200: checkoutResponseSchema,
          400: errorSchema,
          502: errorSchema,
          503: errorSchema,
        },
      },
      config: { rateLimit: { max: 10, timeWindow: "1 hour" } },
    },
    async (req, reply) => {
      const stripe = getStripe();
      if (!stripe)
        return reply.code(503).send({ error: "billing_unavailable" });
      const { sub } = req.user as { sub: string };
      const { priceId, successUrl, cancelUrl } = req.body as {
        priceId: string;
        successUrl: string;
        cancelUrl: string;
      };

      const configuredPrice = getAppEnv().STRIPE_PRICE_PRO;
      if (configuredPrice && priceId !== configuredPrice) {
        return reply.code(400).send({ error: "unknown_price" });
      }

      const user = await app.prisma.user.findUniqueOrThrow({
        where: { id: sub },
      });
      let customerId = user.stripeCustomerId;
      if (!customerId) {
        const customer = await stripe.customers.create({
          email: user.email,
          metadata: { userId: sub },
        });
        customerId = customer.id;
        await app.prisma.user.update({
          where: { id: sub },
          data: { stripeCustomerId: customerId },
        });
      }

      const day = new Date().toISOString().slice(0, 10);
      const session = await stripe.checkout.sessions.create(
        {
          customer: customerId,
          mode: "subscription",
          line_items: [{ price: priceId, quantity: 1 }],
          success_url: successUrl,
          cancel_url: cancelUrl,
          metadata: { userId: sub },
        },
        { idempotencyKey: `checkout:${sub}:${priceId}:${day}` },
      );
      if (!session.url) {
        req.log.error({ userId: sub }, "stripe checkout session has no url");
        return reply.code(502).send({ error: "billing_error" });
      }
      return { url: session.url };
    },
  );

  app.post(
    "/create-portal-session",
    {
      onRequest: [app.authenticate],
      schema: {
        body: portalRequestSchema,
        response: {
          200: portalResponseSchema,
          503: errorSchema,
          409: errorSchema,
        },
      },
      config: { rateLimit: { max: 10, timeWindow: "1 hour" } },
    },
    async (req, reply) => {
      const stripe = getStripe();
      if (!stripe)
        return reply.code(503).send({ error: "billing_unavailable" });
      const { sub } = req.user as { sub: string };
      const { returnUrl } = req.body as { returnUrl: string };

      const user = await app.prisma.user.findUniqueOrThrow({
        where: { id: sub },
      });
      if (!user.stripeCustomerId) {
        return reply.code(409).send({ error: "no_customer" });
      }
      const session = await stripe.billingPortal.sessions.create({
        customer: user.stripeCustomerId,
        return_url: returnUrl,
      });
      return { url: session.url };
    },
  );

  // Stripe webhooks: signature-verified, idempotent, 200 fast.
  app.post(
    "/webhook",
    {
      // Capture the raw body for signature verification, then re-emit it
      // so the JSON parser still works downstream.
      preParsing: async (req, _reply, payload) => {
        const raw = await bufferBody(payload as AsyncIterable<Uint8Array>);
        (req as unknown as { rawBody: Uint8Array }).rawBody = raw;
        return Readable.from([raw]);
      },
    },
    async (req, reply) => {
      const stripe = getStripe();
      const webhookSecret = getAppEnv().STRIPE_WEBHOOK_SECRET;
      if (!stripe || !webhookSecret) {
        return reply.code(503).send({ error: "billing_unavailable" });
      }
      const signature = req.headers["stripe-signature"];
      if (typeof signature !== "string") {
        return reply.code(400).send({ error: "missing_signature" });
      }
      const rawBody = (req as unknown as { rawBody?: Uint8Array }).rawBody;
      if (!rawBody) {
        return reply.code(400).send({ error: "missing_body" });
      }

      let event: { id: string; type: string };
      try {
        // Stripe sends UTF-8 JSON, so decoding preserves the signed bytes.
        event = stripe.webhooks.constructEvent(
          new TextDecoder().decode(rawBody),
          signature,
          webhookSecret,
        );
      } catch (err) {
        req.log.warn({ err }, "stripe webhook signature invalid");
        return reply.code(400).send({ error: "invalid_signature" });
      }

      const existing = await app.prisma.stripeEvent.findUnique({
        where: { id: event.id },
      });
      if (existing?.status === "done") return { received: true };

      await app.prisma.stripeEvent.upsert({
        where: { id: event.id },
        create: { id: event.id, type: event.type, payload: event as object },
        update: { attempts: { increment: 1 } },
      });
      await QUEUES.stripeWebhook.add(
        "webhook",
        { eventId: event.id },
        { jobId: `stripe:${event.id}` },
      );
      return { received: true };
    },
  );

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
