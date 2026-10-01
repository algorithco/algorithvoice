import type Stripe from "stripe";
import StripeClient from "stripe";
import { describe, expect, it } from "vitest";
import {
  mapStripeSubscription,
  resolvePlanTier,
  toSubStatus,
} from "./stripe.js";

function fakeSubscription(
  overrides: Record<string, unknown> = {},
): Stripe.Subscription {
  return {
    id: "sub_123",
    customer: "cus_123",
    status: "active",
    billing_cycle_anchor: 1_700_000_000,
    cancel_at_period_end: false,
    items: {
      data: [
        {
          price: { id: "price_pro" },
          current_period_start: 1_700_000_000,
          current_period_end: 1_700_259_200,
        },
      ],
    },
    ...overrides,
  } as unknown as Stripe.Subscription;
}

describe("toSubStatus", () => {
  it("maps stripe statuses to SubStatus", () => {
    expect(toSubStatus("active")).toBe("ACTIVE");
    expect(toSubStatus("trialing")).toBe("TRIALING");
    expect(toSubStatus("past_due")).toBe("PAST_DUE");
    expect(toSubStatus("canceled")).toBe("CANCELED");
    expect(toSubStatus("unpaid")).toBe("PAST_DUE");
    expect(toSubStatus("incomplete")).toBe("INCOMPLETE");
    expect(toSubStatus("incomplete_expired")).toBe("INCOMPLETE");
    expect(toSubStatus("paused")).toBe("CANCELED");
    expect(toSubStatus("whatever")).toBe("INCOMPLETE");
  });
});

describe("resolvePlanTier", () => {
  it("strict: only ACTIVE/TRIALING are pro, PAST_DUE is free", () => {
    expect(resolvePlanTier("ACTIVE")).toBe("pro");
    expect(resolvePlanTier("TRIALING")).toBe("pro");
    expect(resolvePlanTier("PAST_DUE")).toBe("free");
    expect(resolvePlanTier("CANCELED")).toBe("free");
    expect(resolvePlanTier("INCOMPLETE")).toBe("free");
  });
});

describe("mapStripeSubscription", () => {
  it("extracts ids, price, and period dates", () => {
    const snap = mapStripeSubscription(fakeSubscription());
    expect(snap.id).toBe("sub_123");
    expect(snap.customerId).toBe("cus_123");
    expect(snap.priceId).toBe("price_pro");
    expect(snap.currentPeriodStart).toEqual(new Date(1_700_000_000 * 1000));
    expect(snap.currentPeriodEnd).toEqual(new Date(1_700_259_200 * 1000));
    expect(snap.cancelAtPeriodEnd).toBe(false);
  });

  it("handles expanded customer objects and missing items", () => {
    const snap = mapStripeSubscription(
      fakeSubscription({ customer: { id: "cus_9" }, items: { data: [] } }),
    );
    expect(snap.customerId).toBe("cus_9");
    expect(snap.priceId).toBeNull();
    expect(snap.billingInterval).toBeNull();
  });

  it("maps recurring month/year to billingInterval", () => {
    const monthly = mapStripeSubscription(
      fakeSubscription({
        items: {
          data: [
            {
              price: { id: "price_m", recurring: { interval: "month" } },
              current_period_start: 1_700_000_000,
              current_period_end: 1_700_259_200,
            },
          ],
        },
      }),
    );
    expect(monthly.billingInterval).toBe("MONTHLY");
    const yearly = mapStripeSubscription(
      fakeSubscription({
        items: {
          data: [
            {
              price: { id: "price_y", recurring: { interval: "year" } },
              current_period_start: 1_700_000_000,
              current_period_end: 1_731_259_200,
            },
          ],
        },
      }),
    );
    expect(yearly.billingInterval).toBe("YEARLY");
  });
});

describe("webhook signature verification (offline)", () => {
  const stripe = new StripeClient("sk_test_123");
  const secret = "whsec_test_secret";
  const payload = JSON.stringify({
    id: "evt_test",
    object: "event",
    type: "ping",
  });

  it("accepts a correctly signed payload", () => {
    const header = stripe.webhooks.generateTestHeaderString({
      payload,
      secret,
    });
    const event = stripe.webhooks.constructEvent(payload, header, secret);
    expect(event.id).toBe("evt_test");
  });

  it("rejects a tampered payload", () => {
    const header = stripe.webhooks.generateTestHeaderString({
      payload,
      secret,
    });
    expect(() =>
      stripe.webhooks.constructEvent(`${payload}tampered`, header, secret),
    ).toThrow();
  });

  it("rejects a wrong secret", () => {
    const header = stripe.webhooks.generateTestHeaderString({
      payload,
      secret,
    });
    expect(() =>
      stripe.webhooks.constructEvent(payload, header, "whsec_wrong"),
    ).toThrow();
  });
});
