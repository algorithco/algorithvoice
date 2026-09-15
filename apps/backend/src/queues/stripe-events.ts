import type { PrismaClient } from "@prisma/client";
import type pino from "pino";
import type Stripe from "stripe";
import {
  mapStripeSubscription,
  resolvePlanTier,
  toSubStatus,
} from "../modules/billing/stripe.js";

const HANDLED = new Set([
  "checkout.session.completed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "invoice.payment_failed",
]);

async function syncSubscriptionFromStripe(
  prisma: PrismaClient,
  stripe: Stripe,
  subscriptionId: string,
  log: pino.Logger,
): Promise<void> {
  const sub = await stripe.subscriptions.retrieve(subscriptionId);
  const snap = mapStripeSubscription(sub);
  const status = toSubStatus(snap.status);
  const planTier = resolvePlanTier(status);

  const user = await prisma.user.findFirst({
    where: { stripeCustomerId: snap.customerId },
  });
  if (!user) {
    log.warn(
      { customerId: snap.customerId, subscriptionId },
      "webhook for unknown customer",
    );
    return;
  }

  await prisma.$transaction([
    prisma.subscription.upsert({
      where: { stripeSubscriptionId: snap.id },
      create: {
        userId: user.id,
        stripeSubscriptionId: snap.id,
        stripePriceId: snap.priceId,
        status,
        currentPeriodStart: snap.currentPeriodStart,
        currentPeriodEnd: snap.currentPeriodEnd,
        cancelAtPeriodEnd: snap.cancelAtPeriodEnd,
      },
      update: {
        stripePriceId: snap.priceId,
        status,
        currentPeriodStart: snap.currentPeriodStart,
        currentPeriodEnd: snap.currentPeriodEnd,
        cancelAtPeriodEnd: snap.cancelAtPeriodEnd,
      },
    }),
    prisma.user.update({ where: { id: user.id }, data: { planTier } }),
    prisma.auditLog.create({
      data: {
        actorUserId: user.id,
        action: "billing.subscription_sync",
        model: "Subscription",
        recordId: snap.id,
        metadata: { status },
      },
    }),
  ]);
}

/** Process one stored StripeEvent idempotently. Throws on failure (job retries). */
export async function processStripeEvent(
  prisma: PrismaClient,
  stripe: Stripe,
  eventId: string,
  log: pino.Logger,
): Promise<{ handled: boolean }> {
  const stored = await prisma.stripeEvent.findUnique({
    where: { id: eventId },
  });
  if (!stored) {
    log.warn({ eventId }, "stripe event not found, skipping");
    return { handled: false };
  }
  if (stored.status === "done") return { handled: true };

  await prisma.stripeEvent.update({
    where: { id: eventId },
    data: { status: "processing", attempts: { increment: 1 } },
  });

  try {
    if (!HANDLED.has(stored.type)) {
      log.info(
        { eventId, type: stored.type },
        "ignoring unhandled stripe event",
      );
    } else if (
      stored.type === "checkout.session.completed" ||
      stored.type === "customer.subscription.created" ||
      stored.type === "customer.subscription.updated"
    ) {
      const payload = stored.payload as {
        data?: { object?: { subscription?: unknown; id?: string } };
      };
      const obj = payload.data?.object ?? {};
      const subscriptionId =
        "subscription" in obj && typeof obj.subscription === "string"
          ? obj.subscription
          : "id" in obj && typeof obj.id === "string"
            ? obj.id
            : null;
      if (!subscriptionId) throw new Error("event has no subscription id");
      await syncSubscriptionFromStripe(prisma, stripe, subscriptionId, log);
    } else if (stored.type === "customer.subscription.deleted") {
      const payload = stored.payload as { data?: { object?: { id?: string } } };
      const subscriptionId = payload.data?.object?.id;
      if (!subscriptionId) throw new Error("event has no subscription id");
      const existing = await prisma.subscription.findUnique({
        where: { stripeSubscriptionId: subscriptionId },
      });
      if (existing) {
        await prisma.$transaction([
          prisma.subscription.update({
            where: { stripeSubscriptionId: subscriptionId },
            data: { status: "CANCELED", cancelAtPeriodEnd: false },
          }),
          prisma.user.update({
            where: { id: existing.userId },
            data: { planTier: "free" },
          }),
          prisma.auditLog.create({
            data: {
              actorUserId: existing.userId,
              action: "billing.subscription_canceled",
              model: "Subscription",
              recordId: subscriptionId,
            },
          }),
        ]);
      }
    } else if (stored.type === "invoice.payment_failed") {
      const payload = stored.payload as {
        data?: { object?: { subscription?: unknown; customer?: unknown } };
      };
      const subscriptionId = payload.data?.object?.subscription;
      if (typeof subscriptionId === "string") {
        const existing = await prisma.subscription.findUnique({
          where: { stripeSubscriptionId: subscriptionId },
        });
        if (existing) {
          await prisma.subscription.update({
            where: { stripeSubscriptionId: subscriptionId },
            data: { status: "PAST_DUE" },
          });
        }
      }
    }

    await prisma.stripeEvent.update({
      where: { id: eventId },
      data: { status: "done" },
    });
    return { handled: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await prisma.stripeEvent.update({
      where: { id: eventId },
      data: { status: "failed", lastError: message.slice(0, 500) },
    });
    throw err;
  }
}
