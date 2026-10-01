"use client";

import { useState } from "react";

type BillingInterval = "monthly" | "yearly";

const ERROR_MESSAGES: Record<string, string> = {
  billing_unavailable: "Billing is temporarily unavailable.",
  subscription_exists:
    "You already have a subscription. Manage it from the dashboard.",
  bad_return_url: "Billing could not verify this site URL.",
};

export function CheckoutButton({
  interval,
  className,
  children,
}: {
  interval: BillingInterval;
  className: string;
  children: React.ReactNode;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function checkout() {
    if (loading) return;
    setLoading(true);
    setError(null);
    try {
      const origin = window.location.origin;
      const res = await fetch("/api/billing/create-checkout-session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          interval,
          successUrl: `${origin}/dashboard?checkout=success`,
          cancelUrl: `${origin}/pricing?checkout=canceled#upgrade`,
        }),
      });
      if (res.status === 401) {
        window.location.href = `/login?returnTo=${encodeURIComponent(`/pricing#upgrade`)}`;
        return;
      }
      const data = (await res.json().catch(() => null)) as {
        url?: string;
        error?: string;
      } | null;
      if (res.status === 409 && data?.error === "subscription_exists") {
        window.location.href = "/dashboard#billing";
        return;
      }
      if (!res.ok || !data?.url) {
        setError(
          ERROR_MESSAGES[data?.error ?? ""] ??
            "Checkout could not be started. Please try again.",
        );
        return;
      }
      window.location.assign(data.url);
    } catch {
      setError("Checkout could not be started. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="grid gap-2">
      <button
        type="button"
        onClick={checkout}
        disabled={loading}
        className={`${className} disabled:cursor-wait disabled:opacity-60`}
      >
        {loading ? "Opening secure checkout…" : children}
      </button>
      {error ? (
        <p className="font-mono text-xs leading-4 text-red-300" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
