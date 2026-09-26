import { randomUUID } from "node:crypto";
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
import {
  billingIntervalForPrice,
  getStripe,
  isAllowedPrice,
  isAllowedReturnUrl,
  resolvePlanTier,
} from "./stripe.js";

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

const MAX_WEBHOOK_BYTES = 1_000_000;

async function bufferBody(
  payload: AsyncIterable<Uint8Array>,
): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of payload) {
    const copy = new Uint8Array(chunk);
    total += copy.byteLength;
    if (total > MAX_WEBHOOK_BYTES) {
      throw Object.assign(new Error("webhook body too large"), {
        statusCode: 413,
      });
    }
    chunks.push(copy);
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return merged;
}

function toApiInterval(
  db: "MONTHLY" | "YEARLY" | null | undefined,
): "monthly" | "yearly" | null {
  if (db === "MONTHLY") return "monthly";
  if (db === "YEARLY") return "yearly";
  return null;
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
          404: errorSchema,
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

      if (!isAllowedPrice(priceId)) {
        return reply.code(400).send({ error: "unknown_price" });
      }
      if (!isAllowedReturnUrl(successUrl) || !isAllowedReturnUrl(cancelUrl)) {
        return reply.code(400).send({ error: "bad_return_url" });
      }

      const user = await app.prisma.user.findUnique({
        where: { id: sub },
      });
      if (!user) return reply.code(404).send({ error: "user_not_found" });

      let customerId = user.stripeCustomerId;
      if (!customerId) {
        try {
          const customer = await stripe.customers.create({
            email: user.email,
            metadata: { userId: sub },
          });
          customerId = customer.id;
          await app.prisma.user.update({
            where: { id: sub },
            data: { stripeCustomerId: customerId },
          });
        } catch (err) {
          // Concurrent checkout race: re-read, another request won.
          const raced = await app.prisma.user.findUnique({
            where: { id: sub },
          });
          if (raced?.stripeCustomerId) {
            customerId = raced.stripeCustomerId;
          } else {
            req.log.error({ err, userId: sub }, "stripe customer create failed");
            return reply.code(502).send({ error: "billing_error" });
          }
        }
      }

      const interval = billingIntervalForPrice(priceId);
      try {
        const session = await stripe.checkout.sessions.create(
          {
            customer: customerId,
            mode: "subscription",
            line_items: [{ price: priceId, quantity: 1 }],
            success_url: successUrl,
            cancel_url: cancelUrl,
            metadata: { userId: sub },
            subscription_data: {
              metadata: {
                userId: sub,
                ...(interval ? { billingInterval: interval } : {}),
              },
            },
            allow_promotion_codes: true,
          },
          // Per-request key: same-day replays must not return an expired URL.
          { idempotencyKey: `checkout:${sub}:${priceId}:${randomUUID()}` },
        );
        if (!session.url) {
          req.log.error({ userId: sub }, "stripe checkout session has no url");
          return reply.code(502).send({ error: "billing_error" });
        }
        await app.prisma.auditLog.create({
          data: {
            actorUserId: sub,
            action: "billing.checkout_created",
            model: "Subscription",
            recordId: priceId,
            metadata: { interval },
          },
        }).catch(() => {});
        return { url: session.url };
      } catch (err) {
        req.log.error({ err, userId: sub }, "stripe checkout create failed");
        return reply.code(502).send({ error: "billing_error" });
      }
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
          400: errorSchema,
          404: errorSchema,
          502: errorSchema,
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

      if (!isAllowedReturnUrl(returnUrl)) {
        return reply.code(400).send({ error: "bad_return_url" });
      }

      const user = await app.prisma.user.findUnique({
        where: { id: sub },
      });
      if (!user) return reply.code(404).send({ error: "user_not_found" });
      if (!user.stripeCustomerId) {
        return reply.code(409).send({ error: "no_customer" });
      }
      try {
        const configuration =
          getAppEnv().STRIPE_PORTAL_CONFIG || undefined;
        const session = await stripe.billingPortal.sessions.create(
          {
            customer: user.stripeCustomerId,
            return_url: returnUrl,
            ...(configuration ? { configuration } : {}),
          },
          { idempotencyKey: `portal:${sub}:${randomUUID()}` },
        );
        await app.prisma.auditLog.create({
          data: {
            actorUserId: sub,
            action: "billing.portal_created",
            model: "Subscription",
            recordId: user.stripeCustomerId,
          },
        }).catch(() => {});
        return { url: session.url };
      } catch (err) {
        req.log.error({ err, userId: sub }, "stripe portal create failed");
        return reply.code(502).send({ error: "billing_error" });
      }
    },
  );

  // Stripe webhooks: signature-verified, idempotent, 200 fast.
  app.post(
    "/webhook",
    {
      // Capture the raw body for signature verification, then re-emit it
      // so the JSON parser still works downstream.
      preParsing: async (req, _reply, payload) => {
        try {
          const raw = await bufferBody(payload as AsyncIterable<Uint8Array>);
          (req as unknown as { rawBody: Uint8Array }).rawBody = raw;
          return Readable.from([raw]);
        } catch (err) {
          // Body too large: stash the error so the handler can 413 fast.
          (req as unknown as { rawBodyError?: unknown }).rawBodyError = err;
          return Readable.from([Buffer.alloc(0)]);
        }
      },
    },
    async (req, reply) => {
      const rawErr = (req as unknown as { rawBodyError?: unknown })
        .rawBodyError;
      if (rawErr) {
        return reply.code(413).send({ error: "webhook_too_large" });
      }
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
      if (!rawBody || rawBody.byteLength === 0) {
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
        update: {
          type: event.type,
          payload: event as object,
          attempts: { increment: 1 },
        },
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
      schema: { response: { 200: subscriptionSchema, 404: errorSchema } },
    },
    async (req, reply) => {
      const { sub } = req.user as { sub: string };
      const user = await app.prisma.user.findUnique({
        where: { id: sub },
      });
      if (!user) return reply.code(404).send({ error: "user_not_found" });
      // Display row: newest billable-ish subscription (for past_due banner).
      // Entitlement itself is strict (see guard.ts) — PAST_DUE maps to free.
      const sub2 = await app.prisma.subscription.findFirst({
        where: {
          userId: sub,
          status: { in: ["TRIALING", "ACTIVE", "PAST_DUE"] },
        },
        orderBy: { currentPeriodEnd: "desc" },
      });
      if (!sub2) {
        return {
          status: "free" as const,
          planTier: user.planTier,
          priceId: null,
          billingInterval: null,
          currentPeriodEnd: null,
          cancelAtPeriodEnd: false,
        };
      }
      const strictTier = resolvePlanTier(sub2.status);
      return {
        status: STATUS_MAP[sub2.status] ?? "incomplete",
        planTier: strictTier,
        priceId: sub2.stripePriceId ?? null,
        billingInterval: toApiInterval(sub2.billingInterval ?? null),
        currentPeriodEnd: sub2.currentPeriodEnd.toISOString(),
        cancelAtPeriodEnd: sub2.cancelAtPeriodEnd,
      };
    },
  );
}
