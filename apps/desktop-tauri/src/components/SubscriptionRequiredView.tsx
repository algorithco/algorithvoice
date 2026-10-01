import { Logo } from "@algorith-voice/ui";
import { safeOpenUrl } from "../lib/session/url-safety.js";
import type { DesktopEntitlement } from "../lib/subscription.js";
import { APP_URL } from "../lib/subscription.js";

export function SubscriptionRequiredView({
  entitlement,
  email,
  refreshing,
  onRefresh,
  onLogout,
}: {
  entitlement: DesktopEntitlement;
  email?: string | null;
  refreshing: boolean;
  onRefresh: () => void;
  onLogout: () => void;
}) {
  const unavailable = entitlement.status === "unavailable";
  const statusLabel = unavailable
    ? "Verification unavailable"
    : entitlement.status;
  const planLabel = unavailable ? "Unknown" : entitlement.planTier;
  return (
    <main className="grid min-h-screen place-items-center bg-white p-6 text-black dark:bg-black dark:text-white">
      <section className="w-full max-w-md rounded-3xl border border-gray-200 bg-gray-50 p-8 shadow-sm dark:border-white/10 dark:bg-white/5">
        <Logo className="h-6 w-auto" />
        <div className="mt-8 inline-flex rounded-full border border-amber-300 bg-amber-50 px-3 py-1 font-mono text-[11px] font-semibold uppercase tracking-wide text-amber-800 dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-200">
          {unavailable ? "Verification required" : "Pro required"}
        </div>
        <h1 className="mt-4 text-2xl font-semibold tracking-tight">
          {unavailable
            ? "Couldn’t verify your subscription"
            : "Upgrade to use the desktop app"}
        </h1>
        <p className="mt-3 text-sm leading-6 text-gray-600 dark:text-gray-300">
          {unavailable
            ? `We couldn’t verify Algorith Voice Pro for this account. ${entitlement.reason ?? "Please check your connection and try again."}`
            : `Algorith Voice desktop—including local models—requires an active Pro subscription. ${entitlement.reason ?? ""}`}
        </p>
        <dl className="mt-6 grid gap-2 rounded-2xl border border-gray-200 bg-white p-4 text-sm dark:border-white/10 dark:bg-black">
          <div className="flex justify-between gap-4">
            <dt className="text-gray-500">Account</dt>
            <dd className="truncate font-medium">{email ?? "Signed in"}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-gray-500">Subscription</dt>
            <dd className="font-medium capitalize">{statusLabel}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-gray-500">Plan</dt>
            <dd className="font-medium capitalize">{planLabel}</dd>
          </div>
        </dl>
        <div className="mt-6 grid gap-3">
          {!unavailable ? (
            <button
              type="button"
              onClick={() => void safeOpenUrl(`${APP_URL}/pricing#upgrade`)}
              className="h-11 rounded-full bg-black px-5 text-sm font-semibold text-white dark:bg-white dark:text-black"
            >
              View Pro plans
            </button>
          ) : null}
          <button
            type="button"
            disabled={refreshing}
            onClick={onRefresh}
            className="h-11 rounded-full border border-gray-300 px-5 text-sm font-semibold disabled:opacity-50 dark:border-white/20"
          >
            {refreshing
              ? "Checking…"
              : unavailable
                ? "Check subscription again"
                : "I subscribed — check again"}
          </button>
          <button
            type="button"
            onClick={onLogout}
            className="h-10 text-sm text-gray-500 underline-offset-4 hover:underline"
          >
            Sign out
          </button>
        </div>
      </section>
    </main>
  );
}
