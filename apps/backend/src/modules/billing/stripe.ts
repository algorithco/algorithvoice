import type { BillingInterval, PlanTier, SubStatus } from "@prisma/client";
import Stripe from "stripe";
import { getAppEnv } from "../../config/env.js";

let client: Stripe | null | undefined;

/** Lazy Stripe client. Null when STRIPE_SECRET_KEY is not configured. */
export function getStripe(): Stripe | null {
  if (client !== undefined) return client;
  const key = getAppEnv().STRIPE_SECRET_KEY;
  // No apiVersion pin: installed stripe@22 types pin the version itself.
  // Upgrades are gated by package.json, not dashboard settings.
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

// Legacy grace set (kept for reference): TRIALING, ACTIVE, PAST_DUE were pro.
// Strict set (locked scope: no trial for new subs, past_due is NOT entitled).
const PRO_STRICT_STATUSES: ReadonlySet<SubStatus> = new Set([
  "TRIALING",
  "ACTIVE",
]);

/** Strict tier resolution: only TRIALING/ACTIVE are pro. PAST_DUE is free. */
export function resolvePlanTier(status: SubStatus): PlanTier {
  return PRO_STRICT_STATUSES.has(status) ? "pro" : "free";
}

export interface StripeSubscriptionSnapshot {
  id: string;
  customerId: string;
  status: StripeSubStatus;
  priceId: string | null;
  billingInterval: BillingInterval | null;
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  cancelAtPeriodEnd: boolean;
}

function intervalFromStripe(
  recurring: { interval?: string } | null | undefined,
  priceId: string | null,
): BillingInterval | null {
  if (recurring?.interval === "year") return "YEARLY";
  if (recurring?.interval === "month") return "MONTHLY";
  // Fallback: match configured price IDs when Stripe omits recurring.
  try {
    const env = getAppEnv();
    const monthly =
      env.STRIPE_PRICE_PRO_MONTHLY ?? env.STRIPE_PRICE_PRO ?? undefined;
    const yearly = env.STRIPE_PRICE_PRO_YEARLY ?? undefined;
    if (priceId && monthly && priceId === monthly) return "MONTHLY";
    if (priceId && yearly && priceId === yearly) return "YEARLY";
  } catch {
    // env not initialized (unit tests): fall through to null.
  }
  return null;
}

/** Pure mapping from a Stripe subscription to our DB shape. */
export function mapStripeSubscription(
  s: Stripe.Subscription,
): StripeSubscriptionSnapshot {
  const customerId =
    typeof s.customer === "string" ? s.customer : s.customer.id;
  const item = s.items.data[0];
  const price = item?.price as
    | { id: string; recurring?: { interval?: string } | null }
    | undefined;
  const priceId = price?.id ?? null;
  // Period lives on the subscription item in current Stripe API versions.
  const startSec = item?.current_period_start ?? s.billing_cycle_anchor;
  const endSec = item?.current_period_end ?? startSec + 30 * 24 * 3600;
  return {
    id: s.id,
    customerId,
    status: s.status as StripeSubStatus,
    priceId,
    billingInterval: intervalFromStripe(price?.recurring ?? null, priceId),
    currentPeriodStart: new Date(startSec * 1000),
    currentPeriodEnd: new Date(endSec * 1000),
    cancelAtPeriodEnd: s.cancel_at_period_end,
  };
}

export function toSubStatus(status: string): SubStatus {
  return STATUS_MAP[status as StripeSubStatus] ?? "INCOMPLETE";
}

// --- Price allowlist (monthly + yearly, legacy fallback) ---

export function getConfiguredPrices(): {
  monthly?: string;
  yearly?: string;
} {
  const env = getAppEnv();
  const monthly = env.STRIPE_PRICE_PRO_MONTHLY ?? env.STRIPE_PRICE_PRO;
  const yearly = env.STRIPE_PRICE_PRO_YEARLY;
  return {
    ...(monthly ? { monthly } : {}),
    ...(yearly ? { yearly } : {}),
  };
}

/** Null = no allowlist configured (accept any price, dev mode). */
export function getPriceAllowlist(): Map<string, BillingInterval> | null {
  const { monthly, yearly } = getConfiguredPrices();
  if (!monthly && !yearly) return null;
  const map = new Map<string, BillingInterval>();
  if (monthly) map.set(monthly, "MONTHLY");
  if (yearly) map.set(yearly, "YEARLY");
  return map;
}

export function isAllowedPrice(priceId: string): boolean {
  const allow = getPriceAllowlist();
  if (!allow) return true;
  return allow.has(priceId);
}

export function billingIntervalForPrice(
  priceId: string | null,
): BillingInterval | null {
  if (!priceId) return null;
  const allow = getPriceAllowlist();
  return allow?.get(priceId) ?? null;
}

// --- Return-URL allowlist (open-redirect hardening) ---

export function isAllowedReturnUrl(raw: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return false;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
  try {
    const env = getAppEnv();
    const allowed = new Set<string>();
    for (const base of [env.APP_URL, env.API_URL]) {
      if (!base) continue;
      try {
        allowed.add(new URL(base).origin);
      } catch {
        // ignore malformed configured base
      }
    }
    // Always allow the configured app origin; in dev allow localhost.
    if (allowed.size === 0) return false;
    return allowed.has(parsed.origin);
  } catch {
    return false;
  }
}
