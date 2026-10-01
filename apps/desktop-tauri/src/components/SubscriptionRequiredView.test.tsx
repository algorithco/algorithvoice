import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("../lib/session/url-safety.js", () => ({
  safeOpenUrl: vi.fn(),
}));

import { SubscriptionRequiredView } from "./SubscriptionRequiredView.js";

const noop = () => {};

describe("SubscriptionRequiredView", () => {
  it("does not present an unavailable verification as a confirmed Free plan", () => {
    const html = renderToString(
      <SubscriptionRequiredView
        entitlement={{
          valid: false,
          status: "unavailable",
          planTier: "free",
          currentPeriodEnd: null,
          reason: "Sign in to verify Pro",
        }}
        email="pro@example.com"
        refreshing={false}
        onRefresh={noop}
        onLogout={noop}
      />,
    );

    expect(html).toContain("Verification unavailable");
    expect(html).toContain("Unknown");
    expect(html).toContain("Check subscription again");
    expect(html).not.toContain("View Pro plans");
    expect(html).not.toMatch(/>Free</);
  });

  it("shows upgrade actions only for a verified non-Pro response", () => {
    const html = renderToString(
      <SubscriptionRequiredView
        entitlement={{
          valid: false,
          status: "free",
          planTier: "free",
          currentPeriodEnd: null,
          reason: "An active Pro subscription is required",
        }}
        email="free@example.com"
        refreshing={false}
        onRefresh={noop}
        onLogout={noop}
      />,
    );

    expect(html).toContain("View Pro plans");
    expect(html).toMatch(/>free<\/dd>/);
    expect(html).toContain("I subscribed — check again");
  });
});
