// Single source of truth for subscription tiers + intervals.
// Limits mirror index.ts constants (kept local to avoid circular import).
const FREE_CLOUD_SECONDS_PER_MONTH = 3600;
const FREE_DEVICE_LIMIT = 2;
const PRO_DEVICE_LIMIT = 10;
// Free/Pro only (per locked scope). Pro has monthly + yearly Stripe prices.
// No trials. past_due is strictly NOT pro (see resolvePlanTierStrict).

export const BILLING_INTERVALS = ["monthly", "yearly"] as const;
export type BillingIntervalSlug = (typeof BILLING_INTERVALS)[number];

export const PLAN_TIERS = ["free", "pro"] as const;
export type PlanTierSlug = (typeof PLAN_TIERS)[number];

export interface PlanDefinition {
  tier: PlanTierSlug;
  interval: BillingIntervalSlug | null;
  cloudSecondsLimit: number; // -1 = unlimited
  deviceLimit: number;
}

export const PLAN_CATALOG: Record<string, PlanDefinition> = {
  free: {
    tier: "free",
    interval: null,
    cloudSecondsLimit: FREE_CLOUD_SECONDS_PER_MONTH,
    deviceLimit: FREE_DEVICE_LIMIT,
  },
  pro_monthly: {
    tier: "pro",
    interval: "monthly",
    cloudSecondsLimit: -1,
    deviceLimit: PRO_DEVICE_LIMIT,
  },
  pro_yearly: {
    tier: "pro",
    interval: "yearly",
    cloudSecondsLimit: -1,
    deviceLimit: PRO_DEVICE_LIMIT,
  },
};

export function deviceLimitForTier(tier: PlanTierSlug): number {
  return tier === "pro" ? PRO_DEVICE_LIMIT : FREE_DEVICE_LIMIT;
}

export function cloudLimitForTier(tier: PlanTierSlug): number {
  return tier === "pro" ? -1 : FREE_CLOUD_SECONDS_PER_MONTH;
}
