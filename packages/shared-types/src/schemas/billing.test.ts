import { describe, expect, it } from "vitest";
import { checkoutRequestSchema, subscriptionSchema } from "./billing.js";

describe("billing schemas", () => {
  it("accepts server-resolved checkout intervals", () => {
    expect(
      checkoutRequestSchema.safeParse({
        interval: "yearly",
        successUrl: "https://app.example.com/dashboard?checkout=success",
        cancelUrl: "https://app.example.com/pricing",
      }).success,
    ).toBe(true);
  });

  it("rejects client-controlled Stripe price ids", () => {
    expect(
      checkoutRequestSchema.safeParse({
        priceId: "price_attacker_controlled",
        successUrl: "https://app.example.com/dashboard",
        cancelUrl: "https://app.example.com/pricing",
      }).success,
    ).toBe(false);
  });

  it("keeps free and past-due states explicit", () => {
    expect(
      subscriptionSchema.safeParse({
        status: "past_due",
        planTier: "free",
        priceId: "price_pro",
        billingInterval: "monthly",
        currentPeriodEnd: "2026-10-01T00:00:00.000Z",
        cancelAtPeriodEnd: false,
      }).success,
    ).toBe(true);
  });
});
