import type { PrismaClient } from "@prisma/client";
import type pino from "pino";
import type Stripe from "stripe";
import { describe, expect, it, vi } from "vitest";
import { extractSubscriptionId, processStripeEvent } from "./stripe-events.js";

describe("extractSubscriptionId", () => {
  it("reads subscription lifecycle object ids", () => {
    expect(
      extractSubscriptionId("customer.subscription.updated", {
        data: { object: { id: "sub_123" } },
      }),
    ).toBe("sub_123");
  });

  it("reads legacy and expanded invoice subscription references", () => {
    expect(
      extractSubscriptionId("invoice.payment_succeeded", {
        data: { object: { id: "in_1", subscription: "sub_legacy" } },
      }),
    ).toBe("sub_legacy");
    expect(
      extractSubscriptionId("invoice.payment_failed", {
        data: {
          object: {
            id: "in_2",
            subscription: { id: "sub_expanded" },
          },
        },
      }),
    ).toBe("sub_expanded");
  });

  it("supports the current invoice parent subscription shape", () => {
    expect(
      extractSubscriptionId("invoice.payment_succeeded", {
        data: {
          object: {
            id: "in_3",
            parent: {
              subscription_details: { subscription: "sub_parent" },
            },
          },
        },
      }),
    ).toBe("sub_parent");
  });

  it("never treats an invoice id as a subscription id", () => {
    expect(
      extractSubscriptionId("invoice.payment_succeeded", {
        data: { object: { id: "in_not_a_subscription" } },
      }),
    ).toBeNull();
  });

  it("O-OBSERVABILITY: processing failures emit an alert-friendly webhook event", async () => {
    const update = vi.fn().mockResolvedValue({});
    const prisma = {
      stripeEvent: {
        findUnique: vi.fn().mockResolvedValue({
          id: "evt_broken",
          type: "invoice.payment_succeeded",
          status: "pending",
          payload: { data: { object: { id: "in_without_subscription" } } },
        }),
        update,
      },
    } as unknown as PrismaClient;
    const log = {
      error: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
    } as unknown as pino.Logger;

    await expect(
      processStripeEvent(prisma, {} as unknown as Stripe, "evt_broken", log),
    ).rejects.toThrow("event has no subscription id");

    expect(log.error).toHaveBeenCalledWith(
      {
        event: "stripe_webhook_failure",
        eventId: "evt_broken",
        errorType: "Error",
      },
      "Stripe webhook processing failed",
    );
    expect(update).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "failed" }),
      }),
    );
  });
});
