import type { PlanTier, SubStatus } from "@prisma/client";
import Stripe from "stripe";
import { getAppEnv } from "../../config/env.js";

let client: Stripe | null | undefined;

/** Lazy Stripe client. Null when STRIPE_SECRET_KEY is not configured. */
export function getStripe(): Stripe | null {
  if (client !== undefined) return client;
  const key = getAppEnv().STRIPE_SECRET_KEY;
  client = key ? new Stripe(key) : null;
  return client;
}

/** For tests: reset the cached client. */
export function resetStripeClient(): void {
  client = undefined;
}

type StripeSubStatus =
  | "trialing"
  | "active"
  | "past_due"
  | "canceled"
  | "unpaid"
  | "incomplete"
  | "incomplete_expired"
  | "paused";

const STATUS_MAP: Record<StripeSubStatus, SubStatus> = {
  trialing: "TRIALING",
  active: "ACTIVE",
  past_due: "PAST_DUE",
  canceled: "CANCELED",
  unpaid: "PAST_DUE",
  incomplete: "INCOMPLETE",
  incomplete_expired: "INCOMPLETE",
  paused: "CANCELED",
};

const PRO_STATUSES: ReadonlySet<SubStatus> = new Set([
  "TRIALING",
  "ACTIVE",
  "PAST_DUE",
]);

/** Grace statuses keep pro until Stripe says canceled. */
export function resolvePlanTier(status: SubStatus): PlanTier {
  return PRO_STATUSES.has(status) ? "pro" : "free";
}

export interface StripeSubscriptionSnapshot {
  id: string;
  customerId: string;
  status: StripeSubStatus;
  priceId: string | null;
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  cancelAtPeriodEnd: boolean;
}

/** Pure mapping from a Stripe subscription to our DB shape. */
export function mapStripeSubscription(
  s: Stripe.Subscription,
): StripeSubscriptionSnapshot {
  const customerId =
    typeof s.customer === "string" ? s.customer : s.customer.id;
  const item = s.items.data[0];
  const priceId = item?.price.id ?? null;
  // Period lives on the subscription item in current Stripe API versions.
  const startSec = item?.current_period_start ?? s.billing_cycle_anchor;
  const endSec = item?.current_period_end ?? startSec + 30 * 24 * 3600;
  return {
    id: s.id,
    customerId,
    status: s.status as StripeSubStatus,
    priceId,
    currentPeriodStart: new Date(startSec * 1000),
    currentPeriodEnd: new Date(endSec * 1000),
    cancelAtPeriodEnd: s.cancel_at_period_end,
  };
}

export function toSubStatus(status: string): SubStatus {
  return STATUS_MAP[status as StripeSubStatus] ?? "INCOMPLETE";
}
