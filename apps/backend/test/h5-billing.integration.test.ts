import type { FastifyInstance } from "fastify";
import pino from "pino";
import type Stripe from "stripe";
import StripeClient from "stripe";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { getActiveSubscription } from "../src/modules/billing/guard.js";
import {
  getStripe,
  resetStripeClient,
  resolvePlanTier,
} from "../src/modules/billing/stripe.js";
import { QUEUES } from "../src/queues/connection.js";
import {
  processStripeEvent,
  syncStaleSubscriptions,
} from "../src/queues/stripe-events.js";
import {
  authHeader,
  createTestApp,
  createUser,
  signAccessToken,
  truncateTestState,
} from "./helpers/app.js";

describe("H5: billing correctness", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_integration_fake";
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_integration_fake";
    process.env.STRIPE_PRICE_PRO_MONTHLY = "price_monthly_integration";
    process.env.STRIPE_PRICE_PRO_YEARLY = "price_yearly_integration";
    resetStripeClient();
    app = await createTestApp();
  });

  beforeEach(async () => {
    await truncateTestState(app);
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    resetStripeClient();
    await app.close();
  });

  it("H5: refuses duplicate checkout for an active subscription", async () => {
    const { user } = await createUser(app);
    await app.prisma.user.update({
      where: { id: user.id },
      data: { stripeCustomerId: "cus_existing" },
    });
    await app.prisma.subscription.create({
      data: {
        userId: user.id,
        stripeSubscriptionId: "sub_existing",
        status: "ACTIVE",
        currentPeriodStart: new Date(Date.now() - 86_400_000),
        currentPeriodEnd: new Date(Date.now() + 86_400_000),
      },
    });
    const stripe = getStripe();
    if (!stripe) {
      throw new Error("Stripe test client was not initialized");
    }
    const checkout = vi.spyOn(stripe.checkout.sessions, "create");

    const response = await app.inject({
      method: "POST",
      url: "/billing/create-checkout-session",
      headers: authHeader(signAccessToken(app, user.id)),
      payload: {
        interval: "monthly",
        successUrl: "http://127.0.0.1:3000/billing/success",
        cancelUrl: "http://127.0.0.1:3000/billing/cancel",
      },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ error: "already_subscribed" });
    expect(checkout).not.toHaveBeenCalled();
  });

  it("H5: exempts signature-verified webhook ingress from the global IP limit", async () => {
    const responses = await Promise.all(
      Array.from({ length: 105 }, () =>
        app.inject({
          method: "POST",
          url: "/billing/webhook",
          headers: { "content-type": "application/json" },
          payload: {},
        }),
      ),
    );
    expect(responses.every((response) => response.statusCode === 400)).toBe(
      true,
    );
  });

  it("H5: entitlement agrees with every subscription status and expiry", async () => {
    const statuses = [
      "TRIALING",
      "ACTIVE",
      "PAST_DUE",
      "CANCELED",
      "INCOMPLETE",
    ] as const;
    for (const status of statuses) {
      for (const isFuture of [true, false]) {
        const { user } = await createUser(app, {
          email: `${status.toLowerCase()}-${isFuture}@example.invalid`,
        });
        await app.prisma.subscription.create({
          data: {
            userId: user.id,
            stripeSubscriptionId: `sub_${status}_${isFuture}`,
            status,
            currentPeriodStart: new Date(Date.now() - 86_400_000),
            currentPeriodEnd: new Date(
              Date.now() + (isFuture ? 86_400_000 : -1),
            ),
          },
        });
        const entitled =
          (await getActiveSubscription(app.prisma, user.id)) !== null;
        expect(entitled).toBe(isFuture && resolvePlanTier(status) === "pro");
      }
    }
  });

  it("H5: reconcile pages through all stale subscriptions", async () => {
    const customerBySubscription = new Map<string, string>();
    for (let index = 0; index < 3; index += 1) {
      const { user } = await createUser(app, {
        email: `stale-${index}@example.invalid`,
      });
      const customerId = `cus_stale_${index}`;
      const subscriptionId = `sub_stale_${index}`;
      customerBySubscription.set(subscriptionId, customerId);
      await app.prisma.user.update({
        where: { id: user.id },
        data: { stripeCustomerId: customerId },
      });
      await app.prisma.subscription.create({
        data: {
          userId: user.id,
          stripeSubscriptionId: subscriptionId,
          status: "ACTIVE",
          currentPeriodStart: new Date(Date.now() - 172_800_000),
          currentPeriodEnd: new Date(Date.now() - 86_400_000),
        },
      });
    }

    const retrieve = vi.fn(async (subscriptionId: string) => ({
      id: subscriptionId,
      customer: customerBySubscription.get(subscriptionId) ?? "cus_missing",
      status: "active",
      items: {
        data: [
          {
            price: {
              id: "price_monthly_integration",
              recurring: { interval: "month" },
            },
            current_period_start: Math.floor(Date.now() / 1000) - 60,
            current_period_end: Math.floor(Date.now() / 1000) + 86_400,
          },
        ],
      },
      billing_cycle_anchor: Math.floor(Date.now() / 1000),
      cancel_at_period_end: false,
    }));
    const stripe = {
      subscriptions: { retrieve },
    } as unknown as Stripe;

    const result = await syncStaleSubscriptions(
      app.prisma,
      stripe,
      pino({ level: "silent" }),
      1,
    );
    expect(result).toEqual({ checked: 3, synced: 3 });
    expect(retrieve).toHaveBeenCalledTimes(3);
  });

  it("T-TESTS: signed webhook fixtures are accepted once and deduplicated", async () => {
    const stripe = new StripeClient("sk_test_integration_fake");
    const payload = JSON.stringify({
      id: "evt_signed_invoice",
      object: "event",
      type: "invoice.payment_succeeded",
      created: Math.floor(Date.now() / 1000),
      data: {
        object: {
          id: "in_signed",
          parent: {
            subscription_details: { subscription: "sub_signed" },
          },
        },
      },
    });
    const signature = stripe.webhooks.generateTestHeaderString({
      payload,
      secret: "whsec_integration_fake",
    });
    const first = await app.inject({
      method: "POST",
      url: "/billing/webhook",
      headers: {
        "content-type": "application/json",
        "stripe-signature": signature,
      },
      payload,
    });
    expect(first.statusCode).toBe(200);
    expect(first.json()).toEqual({ received: true });
    expect(await app.prisma.stripeEvent.count()).toBe(1);

    await app.prisma.stripeEvent.update({
      where: { id: "evt_signed_invoice" },
      data: { status: "done", processedAt: new Date() },
    });
    const duplicate = await app.inject({
      method: "POST",
      url: "/billing/webhook",
      headers: {
        "content-type": "application/json",
        "stripe-signature": signature,
      },
      payload,
    });
    expect(duplicate.statusCode).toBe(200);
    expect(await app.prisma.stripeEvent.count()).toBe(1);
  });

  it("H5: a signed redelivery requeues a terminally failed event", async () => {
    const stripe = new StripeClient("sk_test_integration_fake");
    const payload = JSON.stringify({
      id: "evt_failed_redelivery",
      object: "event",
      type: "invoice.payment_succeeded",
      created: Math.floor(Date.now() / 1000),
      data: {
        object: { id: "in_failed_redelivery", subscription: "sub_retry" },
      },
    });
    const signature = stripe.webhooks.generateTestHeaderString({
      payload,
      secret: "whsec_integration_fake",
    });

    const first = await app.inject({
      method: "POST",
      url: "/billing/webhook",
      headers: {
        "content-type": "application/json",
        "stripe-signature": signature,
      },
      payload,
    });
    expect(first.statusCode).toBe(200);
    await app.prisma.stripeEvent.update({
      where: { id: "evt_failed_redelivery" },
      data: { status: "failed", attempts: 5 },
    });

    const retry = await app.inject({
      method: "POST",
      url: "/billing/webhook",
      headers: {
        "content-type": "application/json",
        "stripe-signature": signature,
      },
      payload,
    });
    expect(retry.statusCode).toBe(200);
    expect(
      await QUEUES.stripeWebhook.getJob("stripe-evt_failed_redelivery-6"),
    ).toBeTruthy();
  });

  it("T-TESTS: both invoice subscription shapes process in event order", async () => {
    const { user } = await createUser(app, {
      email: "invoice-events@example.invalid",
    });
    await app.prisma.user.update({
      where: { id: user.id },
      data: { stripeCustomerId: "cus_invoice_events" },
    });
    let currentStripeStatus = "active";
    const retrieve = vi.fn(async (subscriptionId: string) => ({
      id: subscriptionId,
      customer: "cus_invoice_events",
      status: currentStripeStatus,
      items: {
        data: [
          {
            price: {
              id: "price_monthly_integration",
              recurring: { interval: "month" },
            },
            current_period_start: Math.floor(Date.now() / 1000) - 60,
            current_period_end: Math.floor(Date.now() / 1000) + 86_400,
          },
        ],
      },
      billing_cycle_anchor: Math.floor(Date.now() / 1000),
      cancel_at_period_end: false,
    }));
    const stripe = { subscriptions: { retrieve } } as unknown as Stripe;
    const log = pino({ level: "silent" });
    await app.prisma.stripeEvent.create({
      data: {
        id: "evt_parent_shape",
        type: "invoice.payment_succeeded",
        payload: {
          data: {
            object: {
              id: "in_parent",
              parent: {
                subscription_details: { subscription: "sub_invoice" },
              },
            },
          },
        },
      },
    });
    await processStripeEvent(app.prisma, stripe, "evt_parent_shape", log);
    expect(
      await app.prisma.subscription.findUnique({
        where: { stripeSubscriptionId: "sub_invoice" },
      }),
    ).toMatchObject({ status: "ACTIVE", billingInterval: "MONTHLY" });

    await app.prisma.stripeEvent.create({
      data: {
        id: "evt_legacy_shape",
        type: "invoice.payment_failed",
        payload: {
          data: { object: { id: "in_legacy", subscription: "sub_invoice" } },
        },
      },
    });
    currentStripeStatus = "past_due";
    await processStripeEvent(app.prisma, stripe, "evt_legacy_shape", log);
    expect(
      await app.prisma.subscription.findUnique({
        where: { stripeSubscriptionId: "sub_invoice" },
      }),
    ).toMatchObject({ status: "PAST_DUE" });
    expect(retrieve).toHaveBeenCalledWith("sub_invoice");
  });

  it("T-TESTS: an older payment failure cannot overwrite Stripe's current active state", async () => {
    const { user } = await createUser(app, {
      email: "out-of-order-events@example.invalid",
    });
    await app.prisma.user.update({
      where: { id: user.id },
      data: { stripeCustomerId: "cus_out_of_order" },
    });
    await app.prisma.subscription.create({
      data: {
        userId: user.id,
        stripeSubscriptionId: "sub_out_of_order",
        status: "ACTIVE",
        currentPeriodStart: new Date(Date.now() - 60_000),
        currentPeriodEnd: new Date(Date.now() + 86_400_000),
      },
    });
    await app.prisma.stripeEvent.create({
      data: {
        id: "evt_old_payment_failure",
        type: "invoice.payment_failed",
        payload: {
          created: Math.floor(Date.now() / 1000) - 300,
          data: {
            object: {
              id: "in_old_payment_failure",
              subscription: "sub_out_of_order",
            },
          },
        },
      },
    });
    const retrieve = vi.fn(async () => ({
      id: "sub_out_of_order",
      customer: "cus_out_of_order",
      status: "active",
      items: {
        data: [
          {
            price: {
              id: "price_monthly_integration",
              recurring: { interval: "month" },
            },
            current_period_start: Math.floor(Date.now() / 1000) - 60,
            current_period_end: Math.floor(Date.now() / 1000) + 86_400,
          },
        ],
      },
      billing_cycle_anchor: Math.floor(Date.now() / 1000),
      cancel_at_period_end: false,
    }));
    const stripe = { subscriptions: { retrieve } } as unknown as Stripe;

    await processStripeEvent(
      app.prisma,
      stripe,
      "evt_old_payment_failure",
      pino({ level: "silent" }),
    );

    expect(retrieve).toHaveBeenCalledWith("sub_out_of_order");
    expect(
      await app.prisma.subscription.findUnique({
        where: { stripeSubscriptionId: "sub_out_of_order" },
      }),
    ).toMatchObject({ status: "ACTIVE" });
    expect(
      await app.prisma.user.findUnique({ where: { id: user.id } }),
    ).toMatchObject({ planTier: "pro" });
  });
});
