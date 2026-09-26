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
  "customer.subscription.resumed",
  "invoice.payment_succeeded",
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
        billingInterval: snap.billingInterval,
        status,
        currentPeriodStart: snap.currentPeriodStart,
        currentPeriodEnd: snap.currentPeriodEnd,
        cancelAtPeriodEnd: snap.cancelAtPeriodEnd,
      },
      update: {
        stripePriceId: snap.priceId,
        billingInterval: snap.billingInterval,
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
        metadata: { status, billingInterval: snap.billingInterval },
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
      stored.type === "customer.subscription.updated" ||
      stored.type === "customer.subscription.resumed" ||
      stored.type === "invoice.payment_succeeded"
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
          // Strict: past_due is NOT entitled — downgrade immediately.
          // The subscription row stays PAST_DUE for UI banner; tier is free.
          await prisma.$transaction([
            prisma.subscription.update({
              where: { stripeSubscriptionId: subscriptionId },
              data: { status: "PAST_DUE" },
            }),
            prisma.user.update({
              where: { id: existing.userId },
              data: { planTier: "free" },
            }),
            prisma.auditLog.create({
              data: {
                actorUserId: existing.userId,
                action: "billing.payment_failed",
                model: "Subscription",
                recordId: subscriptionId,
              },
            }),
          ]);
        }
      }
    }

    await prisma.stripeEvent.update({
      where: { id: eventId },
      data: { status: "done", processedAt: new Date() },
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

/**
 * Hourly reconcile: re-fetch Stripe for subs that look stale
 * (ACTIVE/TRIALING but periodEnd in the past) so a missed webhook
 * can't grant pro forever. Called by the billing-reconcile job.
 */
export async function syncStaleSubscriptions(
  prisma: PrismaClient,
  stripe: Stripe,
  log: pino.Logger,
  limit = 50,
): Promise<{ checked: number; synced: number }> {
  const stale = await prisma.subscription.findMany({
    where: {
      status: { in: ["TRIALING", "ACTIVE", "PAST_DUE"] },
      currentPeriodEnd: { lt: new Date() },
    },
    orderBy: { currentPeriodEnd: "asc" },
    take: limit,
    select: { stripeSubscriptionId: true },
  });
  let synced = 0;
  for (const row of stale) {
    try {
      await syncSubscriptionFromStripe(
        prisma,
        stripe,
        row.stripeSubscriptionId,
        log,
      );
      synced += 1;
    } catch (err) {
      log.warn(
        { err, subscriptionId: row.stripeSubscriptionId },
        "reconcile sync failed",
      );
    }
  }
  return { checked: stale.length, synced };
}
