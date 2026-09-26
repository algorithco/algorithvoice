"use client";

import Link from "next/link";
import { useState } from "react";

export function BillingActions({ isPro }: { isPro: boolean }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function manage() {
    setLoading(true);
    setError(null);
    try {
      const origin = window.location.origin;
      const res = await fetch("/api/billing/create-portal-session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ returnUrl: `${origin}/dashboard` }),
      });
      if (res.status === 401) {
        window.location.href = "/login?returnTo=/dashboard";
        return;
      }
      const data = (await res.json()) as { url?: string; error?: string };
      if (!res.ok || !data.url) {
        setError(data.error ?? "Billing portal failed.");
        return;
      }
      window.location.href = data.url;
    } catch {
      setError("Billing portal failed.");
    } finally {
      setLoading(false);
    }
  }

  if (!isPro) {
    return (
      <Link
        href="/pricing#upgrade"
        className="inline-flex min-h-[40px] items-center justify-center rounded-full bg-ink px-4 text-sm font-semibold text-canvas hover:bg-white"
      >
        Upgrade to Pro
      </Link>
    );
  }

  return (
    <div className="grid gap-2">
      <button
        type="button"
        onClick={manage}
        disabled={loading}
        className="inline-flex min-h-[40px] items-center justify-center rounded-full bg-ink px-4 text-sm font-semibold text-canvas hover:bg-white disabled:opacity-50"
      >
        {loading ? "Opening Stripe…" : "Manage billing"}
      </button>
      {error ? (
        <p className="text-center font-mono text-xs text-red-400" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
