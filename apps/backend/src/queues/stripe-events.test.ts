import { describe, expect, it } from "vitest";
import { extractSubscriptionId } from "./stripe-events.js";

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
});
