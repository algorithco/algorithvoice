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

type StripeEventPayload = {
  data?: {
    object?: {
      id?: unknown;
      subscription?: unknown;
      parent?: {
        subscription_details?: { subscription?: unknown };
      };
    };
  };
};

function stripeId(value: unknown, prefix: string): string | null {
  if (typeof value === "string" && value.startsWith(prefix)) return value;
  if (
    typeof value === "object" &&
    value !== null &&
    "id" in value &&
    typeof value.id === "string" &&
    value.id.startsWith(prefix)
  ) {
    return value.id;
  }
  return null;
}

/** Extract a subscription id without ever confusing an invoice id for one. */
export function extractSubscriptionId(
  eventType: string,
  payload: StripeEventPayload,
): string | null {
  const object = payload.data?.object;
  if (!object) return null;
  if (eventType.startsWith("customer.subscription.")) {
    return stripeId(object.id, "sub_");
  }
  return (
    stripeId(object.subscription, "sub_") ??
    stripeId(object.parent?.subscription_details?.subscription, "sub_")
  );
}

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
        lastSyncAttemptAt: new Date(),
        syncFailureCount: 0,
      },
      update: {
        stripePriceId: snap.priceId,
        billingInterval: snap.billingInterval,
        status,
        currentPeriodStart: snap.currentPeriodStart,
        currentPeriodEnd: snap.currentPeriodEnd,
        cancelAtPeriodEnd: snap.cancelAtPeriodEnd,
        lastSyncAttemptAt: new Date(),
        syncFailureCount: 0,
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
      const payload = stored.payload as StripeEventPayload;
      const subscriptionId = extractSubscriptionId(stored.type, payload);
      if (!subscriptionId) throw new Error("event has no subscription id");
      await syncSubscriptionFromStripe(prisma, stripe, subscriptionId, log);
    } else if (stored.type === "customer.subscription.deleted") {
      const payload = stored.payload as StripeEventPayload;
      const subscriptionId = extractSubscriptionId(stored.type, payload);
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
      const payload = stored.payload as StripeEventPayload;
      const subscriptionId = extractSubscriptionId(stored.type, payload);
      if (!subscriptionId) throw new Error("event has no subscription id");
      // Webhooks are not ordered. Reconcile from Stripe instead of applying
      // this event's historical state, so an old payment failure delivered
      // after a successful retry cannot downgrade an active subscription.
      await syncSubscriptionFromStripe(prisma, stripe, subscriptionId, log);
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
    log.error(
      {
        event: "stripe_webhook_failure",
        eventId,
        errorType: err instanceof Error ? err.name : "UnknownError",
      },
      "Stripe webhook processing failed",
    );
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
  const cutoff = new Date();
  const batchSize = Math.max(1, limit);
  let cursor: string | undefined;
  let checked = 0;
  let synced = 0;
  for (;;) {
    const stale = await prisma.subscription.findMany({
      where: {
        status: { in: ["TRIALING", "ACTIVE", "PAST_DUE"] },
        currentPeriodEnd: { lt: cutoff },
        ...(cursor ? { id: { gt: cursor } } : {}),
      },
      orderBy: { id: "asc" },
      take: batchSize,
      select: { id: true, stripeSubscriptionId: true },
    });
    if (stale.length === 0) break;
    for (const row of stale) {
      checked += 1;
      cursor = row.id;
      await prisma.subscription.update({
        where: { id: row.id },
        data: { lastSyncAttemptAt: new Date() },
      });
      try {
        await syncSubscriptionFromStripe(
          prisma,
          stripe,
          row.stripeSubscriptionId,
          log,
        );
        synced += 1;
      } catch (err) {
        await prisma.subscription.update({
          where: { id: row.id },
          data: { syncFailureCount: { increment: 1 } },
        });
        log.warn(
          { err, subscriptionId: row.stripeSubscriptionId },
          "reconcile sync failed",
        );
      }
    }
    if (stale.length < batchSize) break;
  }
  return { checked, synced };
}
