import Link from "next/link";
import { redirect } from "next/navigation";

import { Reveal } from "../../components/Reveal";
import { SiteFooter } from "../../components/SiteFooter";
import { SiteNav } from "../../components/SiteNav";
import { getSession } from "../../lib/dal";
import { LogoutHold } from "./LogoutHold";

// Revalidate insights every 60s — usage is live but not per-second
export const revalidate = 60;

function formatSeconds(s: number) {
  if (s < 60) return `${Math.round(s)}s`;
  const m = Math.floor(s / 60);
  const sec = Math.round(s % 60);
  return sec ? `${m}m ${sec}s` : `${m}m`;
}
function formatDate(d: string | null) {
  if (!d) return "—";
  try {
    return new Date(d).toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  } catch {
    return d;
  }
}
function daysLeft(end: string | null) {
  if (!end) return null;
  const diff = new Date(end).getTime() - Date.now();
  const days = Math.ceil(diff / (1000 * 60 * 60 * 24));
  return days < 0 ? 0 : days;
}

export default async function DashboardPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const API = process.env.API_URL ?? "https://api.trqsh.uz";
  const headers = { Authorization: `Bearer ${session.token}` };

  const [usageRes, subRes, dailyRes, recentRes, devicesRes, providersRes] =
    await Promise.all([
      fetch(`${API}/usage/summary`, { headers, cache: "no-store" })
        .then(async (r) => (r.ok ? ((await r.json()) as unknown) : null))
        .catch(() => null),
      fetch(`${API}/billing/subscription`, { headers, cache: "no-store" })
        .then(async (r) => (r.ok ? ((await r.json()) as unknown) : null))
        .catch(() => null),
      fetch(`${API}/usage/daily?days=7`, { headers, cache: "no-store" })
        .then(async (r) => (r.ok ? ((await r.json()) as unknown) : null))
        .catch(() => null),
      fetch(`${API}/usage/recent?limit=5`, { headers, cache: "no-store" })
        .then(async (r) => (r.ok ? ((await r.json()) as unknown) : null))
        .catch(() => null),
      fetch(`${API}/license/devices`, { headers, cache: "no-store" })
        .then(async (r) => (r.ok ? ((await r.json()) as unknown) : null))
        .catch(() => null),
      fetch(`${API}/auth/providers`, { headers, cache: "no-store" })
        .then(async (r) => (r.ok ? ((await r.json()) as unknown) : null))
        .catch(() => null),
    ]);

  const usage = usageRes as {
    cloudSecondsUsed: number;
    cloudSecondsLimit: number;
    requests: number;
    planTier: string;
  } | null;
  const sub = subRes as {
    status: string;
    planTier: string;
    currentPeriodEnd: string | null;
  } | null;
  const dailyData = dailyRes as {
    days: number;
    daily: { date: string; label: string; seconds: number; requests: number }[];
  } | null;
  const recentData = recentRes as {
    recent: {
      id: string;
      metric: string;
      seconds: number;
      model: string | null;
      latencyMs: number | null;
      recordedAt: string;
    }[];
  } | null;
  const devicesData = devicesRes as {
    devices: {
      id: string;
      name: string;
      type: string;
      lastSeenAt: string | null;
      createdAt: string;
    }[];
    total: number;
    seatsMax: number;
  } | null;
  const providersData = providersRes as {
    providers: { provider: string; email: string; label: string }[];
  } | null;
  const providers = providersData?.providers ?? [];

  const used = usage?.cloudSecondsUsed ?? 0;
  const limit = usage?.cloudSecondsLimit ?? 3600;
  const isUnlimited = limit === -1;
  const pct = isUnlimited
    ? Math.min(100, (used / 3600) * 8)
    : Math.min(100, Math.round((used / Math.max(1, limit)) * 100));
  const remaining = isUnlimited ? null : Math.max(0, limit - used);
  const renewIn = daysLeft(sub?.currentPeriodEnd ?? null);
  const isPro = session.user.planTier === "pro" || sub?.planTier === "pro";
  const planLabel = isPro ? "Pro" : "Free";
  const usageLabel = isUnlimited
    ? `${formatSeconds(used)} used`
    : `${formatSeconds(used)} / ${formatSeconds(limit)}`;

  // Real daily data — last 7 days from API, no mocks
  const daily = dailyData?.daily ?? [];
  const spark = daily.length
    ? daily.map((d) => ({
        d: d.label,
        v: d.seconds,
        requests: d.requests,
        date: d.date,
      }))
    : [];
  const sparkMax = Math.max(1, ...spark.map((s) => s.v), 1);

  function timeAgo(iso: string) {
    const diff = Date.now() - new Date(iso).getTime();
    if (diff < 60_000) return "now";
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
    if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
    if (diff < 172_800_000) return "Yesterday";
    return new Date(iso).toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
    });
  }

  // Real recent activity — from UsageRecord
  const recentReal = (recentData?.recent ?? []).map((r) => ({
    id: r.id,
    time: timeAgo(r.recordedAt),
    dur: formatSeconds(r.seconds),
    mode: `${r.metric === "STT_SECONDS" ? "Cloud" : r.metric} · ${r.model ?? "—"}`,
    metric: r.metric,
    recordedAt: r.recordedAt,
    ok: true,
  }));

  // Real devices — from Device table
  const devicesReal = (devicesData?.devices ?? []).map((d) => ({
    id: d.id,
    name: d.name || "Unnamed device",
    os:
      d.type === "DESKTOP_WINDOWS"
        ? "Windows"
        : d.type === "DESKTOP_LINUX"
          ? "Linux"
          : d.type === "DESKTOP_MACOS"
            ? "macOS"
            : d.type.replace("DESKTOP_", ""),
    active: d.lastSeenAt ? timeAgo(d.lastSeenAt) : "Never",
    createdAt: d.createdAt,
  }));

  return (
    <div className="min-h-screen bg-canvas text-ink">
      <SiteNav signedIn />

      <div className="mx-auto max-w-[1280px] px-4 py-6 sm:px-6 sm:py-8 md:px-8 lg:py-10">
        {/* Breadcrumb + header */}
        <Reveal>
          <div className="flex flex-wrap items-center gap-2 font-mono text-xs text-faint">
            <span className="inline-flex items-center gap-2">
              <span className="size-1.5 bg-ink" aria-hidden /> Dashboard
            </span>
            <span className="text-line">/</span>
            <span className="text-sub">{session.user.email}</span>
            <span
              className={`ml-1 hidden rounded-full border px-2 py-1 text-[11px] font-medium tracking-wide sm:inline-flex ${isPro ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-300" : "border-line bg-surface text-faint"}`}
            >
              {planLabel} · {sub?.status ?? "active"}
            </span>
          </div>

          <div className="mt-4 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="min-w-0">
              <h1 className="t-h1 !text-[28px] tracking-[-0.02em] sm:!text-[34px]">
                Welcome back
                {session.user.name
                  ? `, ${session.user.name.split(" ")[0]}`
                  : ""}
                .
              </h1>
              <p className="mt-2 max-w-[64ch] text-sm leading-6 text-sub sm:text-[15px]">
                Your voice workspace — usage, devices, and billing in one calm
                view.{" "}
                <span className="text-faint">
                  Signed in as {session.user.email} · {isPro ? "Pro" : "Free"}{" "}
                  plan.
                </span>
              </p>
            </div>
            <div className="flex shrink-0 flex-wrap gap-2">
              <Link
                href="/download"
                className="inline-flex min-h-[40px] items-center justify-center rounded-full bg-ink px-5 text-sm font-semibold text-canvas hover:bg-white"
              >
                Download app
              </Link>
              <Link
                href="/docs"
                className="inline-flex min-h-[40px] items-center justify-center rounded-full border border-line bg-surface px-5 text-sm font-medium text-ink hover:bg-raised"
              >
                Docs
              </Link>
              {isPro ? (
                <span className="hidden min-h-[40px] items-center rounded-full border border-emerald-500/20 bg-emerald-500/10 px-4 font-mono text-xs font-medium text-emerald-300 sm:inline-flex">
                  ● Pro active
                </span>
              ) : (
                <Link
                  href="/pricing"
                  className="hidden min-h-[40px] items-center justify-center rounded-full border border-amber-500/20 bg-amber-500/10 px-5 text-sm font-medium text-amber-300 hover:bg-amber-500/15 sm:inline-flex"
                >
                  Upgrade to Pro →
                </Link>
              )}
            </div>
          </div>
        </Reveal>

        {/* KPI strip — 4 cards, responsive: 1 col mobile, 2 col tablet, 4 col desktop */}
        <div className="mt-8 grid gap-4 sm:gap-5 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
          {/* Hero: Usage */}
          <Reveal className="sm:col-span-2 lg:col-span-1">
            <div className="group flex h-full flex-col rounded-2xl border border-line bg-surface p-5 shadow-[0_4px_24px_rgba(0,0,0,0.12)] transition-colors hover:bg-raised">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-mono text-xs font-medium uppercase tracking-wide text-faint">
                    Cloud usage
                  </p>
                  <p className="mt-3 font-mono text-[28px] font-semibold leading-none tracking-[-0.02em] text-ink">
                    {isUnlimited ? formatSeconds(used) : `${pct}%`}
                  </p>
                  <p className="mt-1 font-mono text-xs text-sub">
                    {usageLabel}
                  </p>
                </div>
                <span
                  className={`grid size-9 place-items-center rounded-xl border text-sm ${pct > 80 && !isUnlimited ? "border-amber-500/20 bg-amber-500/10 text-amber-300" : "border-line bg-canvas text-faint"}`}
                >
                  {pct > 80 && !isUnlimited ? "!" : "◐"}
                </span>
              </div>
              <div className="mt-4 h-2 overflow-hidden rounded-full bg-canvas ring-1 ring-line">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${pct > 80 && !isUnlimited ? "bg-amber-400" : pct > 60 ? "bg-ink" : "bg-ink"}`}
                  style={{ width: `${pct}%` }}
                  role="progressbar"
                  aria-valuenow={pct}
                  aria-valuemin={0}
                  aria-valuemax={100}
                />
              </div>
              <div className="mt-2 flex items-center justify-between font-mono text-xs">
                <span className="text-faint">
                  {remaining !== null
                    ? `${formatSeconds(remaining)} left`
                    : "Unlimited on Pro"}
                </span>
                <span className="text-sub">
                  {usage?.requests ?? 0} requests
                </span>
              </div>
              <p className="mt-3 font-mono text-xs leading-4 text-faint">
                {renewIn !== null ? `Renews in ${renewIn}d · ` : ""}
                <Link
                  href="/pricing"
                  className="underline decoration-line underline-offset-4 hover:text-sub"
                >
                  {isPro ? "Manage plan" : "60 min free / month"}
                </Link>
              </p>
            </div>
          </Reveal>

          {/* Requests — real daily requests from API */}
          <Reveal delay={60}>
            <div className="flex h-full flex-col rounded-2xl border border-line bg-surface p-5">
              <p className="font-mono text-xs font-medium uppercase tracking-wide text-faint">
                Requests
              </p>
              <p className="mt-3 font-mono text-[28px] font-semibold leading-none text-ink">
                {usage?.requests ?? 0}
              </p>
              <p className="mt-1 font-mono text-xs text-sub">
                This period · {usage?.planTier ?? session.user.planTier}
              </p>
              {daily.length ? (
                <div className="mt-4 flex items-end gap-1.5">
                  {daily.map((d) => {
                    const maxReq = Math.max(1, ...daily.map((x) => x.requests));
                    return (
                      <span
                        key={d.date}
                        className="flex-1 rounded-full bg-ink/80"
                        style={{
                          height: `${Math.max(6, (d.requests / maxReq) * 28)}px`,
                        }}
                        title={`${d.label}: ${d.requests} req, ${formatSeconds(d.seconds)}`}
                      />
                    );
                  })}
                </div>
              ) : (
                <div className="mt-4 rounded-xl bg-canvas px-3 py-3 text-center ring-1 ring-line">
                  <p className="font-mono text-xs text-faint">
                    No requests this week
                  </p>
                </div>
              )}
              <p className="mt-2 font-mono text-xs text-faint">
                Last 7 days · real
              </p>
            </div>
          </Reveal>

          {/* Subscription */}
          <Reveal delay={120}>
            <div className="flex h-full flex-col rounded-2xl border border-line bg-surface p-5">
              <div className="flex items-center justify-between">
                <p className="font-mono text-xs font-medium uppercase tracking-wide text-faint">
                  Subscription
                </p>
                <span
                  className={`rounded-full px-2.5 py-1 font-mono text-[11px] font-medium ${isPro ? "bg-ink text-canvas" : "border border-line bg-canvas text-faint"}`}
                >
                  {sub?.status ?? "active"} · {planLabel}
                </span>
              </div>
              <p className="mt-3 font-mono text-sm font-medium text-ink">
                {sub?.currentPeriodEnd
                  ? `Renews ${formatDate(sub.currentPeriodEnd)}`
                  : "No renewal date"}
              </p>
              <p className="mt-1 font-mono text-xs text-sub">
                {isPro
                  ? "Pro · Unlimited cloud, 10 devices"
                  : "Free · 60 min cloud, 2 devices"}
              </p>
              <div className="mt-4 grid gap-2">
                <Link
                  href="/pricing"
                  className="inline-flex min-h-[40px] items-center justify-center rounded-full bg-ink px-4 text-sm font-semibold text-canvas hover:bg-white"
                >
                  {isPro ? "Manage billing" : "Upgrade to Pro"}
                </Link>
                <span className="text-center font-mono text-xs text-faint">
                  {renewIn !== null
                    ? `${renewIn} days left`
                    : "Billing via Stripe"}
                </span>
              </div>
            </div>
          </Reveal>

          {/* Account — with real login provider */}
          <Reveal delay={180}>
            <div className="flex h-full flex-col rounded-2xl border border-line bg-surface p-5">
              <p className="font-mono text-xs font-medium uppercase tracking-wide text-faint">
                Account
              </p>
              <p
                className="mt-3 truncate font-mono text-sm font-semibold text-ink"
                title={session.user.email}
              >
                {session.user.email}
              </p>
              <p
                className="mt-1 truncate font-mono text-xs text-sub"
                title={session.user.name ?? ""}
              >
                {session.user.name ?? "No name"} ·{" "}
                {new Date(session.user.createdAt).toLocaleDateString("en-GB")}
              </p>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {providers.length ? (
                  providers.map((p) => (
                    <span
                      key={p.provider}
                      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-xs font-medium ${
                        p.provider === "GITHUB"
                          ? "border-white/10 bg-white text-black"
                          : p.provider === "GOOGLE"
                            ? "border-blue-500/20 bg-blue-500/10 text-blue-300"
                            : "border-line bg-canvas text-faint"
                      }`}
                    >
                      <span
                        className="size-2 rounded-full bg-current"
                        aria-hidden
                      />
                      {p.label} · {p.email ? p.email.split("@")[0] : "linked"}
                    </span>
                  ))
                ) : (
                  <span className="rounded-full border border-line bg-canvas px-2.5 py-1 font-mono text-xs text-faint">
                    Email · {session.user.email.split("@")[0]}
                  </span>
                )}
              </div>
              <div className="mt-4 rounded-xl bg-canvas p-3 ring-1 ring-line">
                <p className="font-mono text-xs font-medium text-ink">
                  Plan {planLabel}
                </p>
                <p className="mt-1 font-mono text-xs leading-4 text-faint">
                  {isPro
                    ? "Priority processing & higher limits."
                    : "60 min cloud free — upgrade when you need more."}
                </p>
              </div>
              <Link
                href="/docs#quickstart"
                className="mt-4 inline-flex min-h-[36px] items-center justify-center rounded-full border border-line bg-canvas px-4 font-mono text-xs font-medium text-ink hover:bg-raised"
              >
                Quickstart →
              </Link>
            </div>
          </Reveal>
        </div>

        {/* AI insight — progressive disclosure banner */}
        <Reveal delay={80}>
          <div className="mt-6 rounded-2xl border border-line bg-gradient-to-br from-surface via-surface to-raised p-5 sm:p-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex gap-3">
                <span className="hidden size-9 shrink-0 place-items-center rounded-xl bg-ink text-canvas sm:grid">
                  ✦
                </span>
                <div className="min-w-0">
                  <p className="font-mono text-xs font-semibold uppercase tracking-wide text-faint">
                    AI insight
                  </p>
                  <p className="mt-1 max-w-[68ch] text-sm leading-5 text-ink">
                    {pct < 30
                      ? `You’re at ${pct}% of your ${isUnlimited ? "usual" : "free"} limit — healthy pace. Try local mode for long dictations to save cloud minutes.`
                      : pct < 80
                        ? `At ${pct}% with ${renewIn ?? "—"} days left — on track. Switch to local (parakeet) for draft work.`
                        : `At ${pct}% — consider Pro for unlimited cloud or finish period on local. Your audio stays on-device in local mode.`}
                  </p>
                </div>
              </div>
              <Link
                href="/docs#modes"
                className="shrink-0 font-mono text-xs font-medium text-sub underline decoration-line underline-offset-4 hover:text-ink"
              >
                Local vs Cloud →
              </Link>
            </div>
          </div>
        </Reveal>

        {/* Main 12-col grid: chart + table left, side stack right */}
        <div className="mt-6 grid gap-4 sm:gap-6 lg:grid-cols-12 lg:gap-6">
          {/* Left: 8 cols — Weekly usage chart + Recent transcripts table */}
          <div className="min-w-0 lg:col-span-8 flex flex-col gap-6">
            <Reveal>
              <section className="rounded-2xl border border-line bg-surface p-5 sm:p-6">
                <div className="flex flex-wrap items-baseline justify-between gap-3">
                  <h2 className="font-mono text-sm font-semibold uppercase tracking-wide text-ink">
                    Weekly usage · real
                  </h2>
                  <span className="font-mono text-xs text-faint">
                    {used ? `${formatSeconds(used)} total` : "No usage yet"} · 7
                    days
                  </span>
                </div>
                {/* Chart — real daily seconds from /usage/daily, no mocks */}
                {spark.length && spark.some((s) => s.v > 0) ? (
                  <div className="mt-6 grid grid-cols-7 items-end gap-2 sm:gap-3">
                    {spark.map((s) => (
                      <div
                        key={s.d}
                        className="flex flex-col items-center gap-2"
                      >
                        <div className="flex h-[96px] w-full items-end justify-center rounded-xl bg-canvas px-1 py-2 ring-1 ring-line sm:h-[112px]">
                          <div
                            className="w-full max-w-[32px] rounded-full bg-ink transition-all"
                            style={{
                              height: `${Math.max(8, (s.v / sparkMax) * 86)}%`,
                            }}
                            title={`${s.d}: ${formatSeconds(s.v)}`}
                          />
                        </div>
                        <span className="font-mono text-xs text-faint">
                          {s.d}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="mt-6 rounded-xl border border-dashed border-line bg-canvas/50 px-4 py-10 text-center">
                    <p className="font-mono text-sm font-medium text-ink">
                      No cloud usage this week
                    </p>
                    <p className="mx-auto mt-1 max-w-[36ch] font-mono text-xs leading-4 text-faint">
                      Real data from UsageRecord ·{" "}
                      {isPro ? "Pro unlimited" : "60s free pool"}. Start
                      dictating to see bars.
                    </p>
                  </div>
                )}
                <div className="mt-4 flex flex-wrap gap-2">
                  <span className="rounded-full border border-line bg-canvas px-3 py-1 font-mono text-xs text-faint">
                    Cloud seconds
                  </span>
                  <span className="rounded-full bg-ink px-3 py-1 font-mono text-xs font-medium text-canvas">
                    {pct}% of {isUnlimited ? "typical" : "limit"}
                  </span>
                  <Link
                    href="/docs#models"
                    className="ml-auto font-mono text-xs text-sub underline decoration-line underline-offset-4 hover:text-ink"
                  >
                    6 local models →
                  </Link>
                </div>
              </section>
            </Reveal>

            <Reveal delay={60}>
              <section className="rounded-2xl border border-line bg-surface overflow-hidden">
                <div className="flex flex-wrap items-center justify-between gap-3 p-5 sm:p-6 pb-0">
                  <h2 className="font-mono text-sm font-semibold uppercase tracking-wide text-ink">
                    Recent activity · real
                  </h2>
                  <span className="rounded-full border border-line bg-canvas px-3 py-1 font-mono text-xs text-faint">
                    {recentReal.length} records
                  </span>
                </div>
                <p className="px-5 sm:px-6 mt-1 font-mono text-xs text-faint">
                  Real UsageRecord from backend · STT_SECONDS only · transcript
                  text stays local for privacy.
                </p>
                {recentReal.length ? (
                  <div className="mt-4 overflow-x-auto">
                    <table className="w-full min-w-[640px] border-collapse">
                      <thead>
                        <tr className="border-y border-line bg-raised/40 text-left">
                          <th className="px-6 py-2.5 font-mono text-xs font-medium uppercase tracking-wide text-faint">
                            When
                          </th>
                          <th className="px-6 py-2.5 font-mono text-xs font-medium uppercase tracking-wide text-faint">
                            Metric
                          </th>
                          <th className="whitespace-nowrap px-6 py-2.5 text-right font-mono text-xs font-medium uppercase tracking-wide text-faint">
                            Seconds
                          </th>
                          <th className="px-6 py-2.5 text-right font-mono text-xs font-medium uppercase tracking-wide text-faint">
                            Model
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-line">
                        {recentReal.map((r) => (
                          <tr key={r.id} className="group hover:bg-raised/50">
                            <td className="whitespace-nowrap px-6 py-3 font-mono text-xs text-sub">
                              {r.time}
                            </td>
                            <td className="px-6 py-3">
                              <span className="rounded-full border border-line bg-canvas px-2.5 py-1 font-mono text-xs text-faint">
                                {r.metric}
                              </span>
                            </td>
                            <td className="whitespace-nowrap px-6 py-3 text-right font-mono text-sm font-medium text-ink">
                              {r.dur}
                            </td>
                            <td className="px-6 py-3 text-right">
                              <span className="rounded-full border border-line bg-canvas px-2.5 py-1 font-mono text-xs text-sub">
                                {r.mode.split("·")[1]?.trim() ?? r.mode}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="mx-4 mt-4 rounded-xl border border-dashed border-line bg-canvas/50 px-6 py-10 text-center">
                    <p className="font-mono text-sm font-medium text-ink">
                      No cloud transcriptions yet
                    </p>
                    <p className="mx-auto mt-1 max-w-[40ch] font-mono text-xs leading-4 text-faint">
                      Real data — your UsageRecord is empty. Dictate via cloud
                      mode to see seconds, model, and latency here. Local mode
                      never uploads.
                    </p>
                  </div>
                )}
                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line bg-raised/30 px-5 py-3 sm:px-6">
                  <span className="font-mono text-xs text-faint">
                    Real backend ·{" "}
                    {recentReal.length
                      ? `${recentReal.length} recent`
                      : "no records yet"}{" "}
                    · local history stays on device.
                  </span>
                  <Link
                    href="/download"
                    className="font-mono text-xs font-medium text-ink underline decoration-line underline-offset-4 hover:text-sub"
                  >
                    Open desktop app →
                  </Link>
                </div>
              </section>
            </Reveal>
          </div>

          {/* Right: 4 cols — stack of utility cards */}
          <div className="min-w-0 lg:col-span-4 flex flex-col gap-6">
            <Reveal>
              <section className="rounded-2xl border border-line bg-surface p-5 sm:p-6">
                <h2 className="font-mono text-sm font-semibold uppercase tracking-wide text-ink">
                  Quick actions
                </h2>
                <div className="mt-4 grid gap-2">
                  <Link
                    href="/download"
                    className="inline-flex min-h-[44px] items-center justify-between rounded-xl bg-ink px-4 text-sm font-semibold text-canvas hover:bg-white"
                  >
                    <span>Download desktop</span> <span aria-hidden>→</span>
                  </Link>
                  <Link
                    href="/docs#quickstart"
                    className="inline-flex min-h-[44px] items-center justify-between rounded-xl border border-line bg-canvas px-4 text-sm font-medium text-ink hover:bg-raised"
                  >
                    <span>Setup in 30s</span>{" "}
                    <span className="text-faint">↗</span>
                  </Link>
                  <div className="grid grid-cols-2 gap-2">
                    <Link
                      href="/pricing"
                      className="inline-flex min-h-[40px] items-center justify-center rounded-xl border border-line bg-surface px-3 text-center font-mono text-xs font-medium text-ink hover:bg-raised"
                    >
                      Pricing
                    </Link>
                    <Link
                      href="/docs#troubleshoot"
                      className="inline-flex min-h-[40px] items-center justify-center rounded-xl border border-line bg-surface px-3 text-center font-mono text-xs font-medium text-ink hover:bg-raised"
                    >
                      Help
                    </Link>
                  </div>
                </div>
                <div className="mt-4 rounded-xl bg-ink p-4 text-canvas">
                  <p className="font-mono text-xs font-semibold uppercase tracking-wide opacity-70">
                    Pro tip
                  </p>
                  <p className="mt-2 text-sm leading-5 opacity-80">
                    On Wayland, enable clipboard mode in Settings after
                    installing{" "}
                    <code className="rounded bg-white/10 px-1 py-0.5">
                      ydotool
                    </code>{" "}
                    — paste feels instant.
                  </p>
                </div>
              </section>
            </Reveal>

            <Reveal delay={60}>
              <section className="rounded-2xl border border-line bg-surface p-5 sm:p-6">
                <div className="flex items-center justify-between gap-2">
                  <h2 className="font-mono text-sm font-semibold uppercase tracking-wide text-ink">
                    Devices · real
                  </h2>
                  <span className="rounded-full border border-line bg-canvas px-2.5 py-1 font-mono text-xs text-faint">
                    {devicesReal.length} linked
                  </span>
                </div>
                <p className="mt-1 font-mono text-xs text-faint">
                  Real Device table ·{" "}
                  {devicesData?.seatsMax ?? (isPro ? 10 : 2)} seats max
                </p>
                {devicesReal.length ? (
                  <div className="mt-4 space-y-3">
                    {devicesReal.slice(0, 3).map((d) => (
                      <div
                        key={d.id}
                        className="flex items-center gap-3 rounded-xl border border-line bg-canvas p-3"
                      >
                        <span className="grid size-9 place-items-center rounded-xl bg-raised font-mono text-xs text-faint">
                          {d.os === "Windows"
                            ? "▣"
                            : d.os === "Linux"
                              ? "⬢"
                              : "◐"}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-mono text-sm font-medium text-ink">
                            {d.name}
                          </p>
                          <p className="truncate font-mono text-xs text-faint">
                            {d.os} ·{" "}
                            {new Date(d.createdAt).toLocaleDateString("en-GB")}
                          </p>
                        </div>
                        <span className="shrink-0 rounded-full bg-ink px-2.5 py-1 font-mono text-xs font-medium text-canvas">
                          {d.active}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="mt-4 rounded-xl border border-dashed border-line bg-canvas/50 px-4 py-8 text-center">
                    <p className="font-mono text-sm font-medium text-ink">
                      No devices linked yet
                    </p>
                    <p className="mx-auto mt-1 max-w-[28ch] font-mono text-xs leading-4 text-faint">
                      Real data — install desktop app and sign in to register
                      your first device.
                    </p>
                    <Link
                      href="/download"
                      className="mt-3 inline-flex min-h-[36px] items-center rounded-full bg-ink px-4 font-mono text-xs font-semibold text-canvas"
                    >
                      Download
                    </Link>
                  </div>
                )}
                <div className="mt-4 flex items-center justify-between rounded-xl bg-raised px-3 py-2.5 ring-1 ring-line">
                  <span className="font-mono text-xs text-faint">
                    {devicesReal.length} /{" "}
                    {devicesData?.seatsMax ?? (isPro ? 10 : 2)} seats used
                  </span>
                  <Link
                    href="/pricing"
                    className="font-mono text-xs font-medium text-ink underline decoration-line underline-offset-4"
                  >
                    {isPro ? "Manage" : "Upgrade"}
                  </Link>
                </div>
              </section>
            </Reveal>

            <Reveal delay={120}>
              <section className="rounded-2xl border border-line bg-surface p-5 sm:p-6">
                <h2 className="font-mono text-sm font-semibold uppercase tracking-wide text-ink">
                  Need help?
                </h2>
                <div className="mt-3 space-y-2">
                  <Link
                    href="/docs"
                    className="flex items-center justify-between rounded-xl border border-line bg-canvas px-4 py-3 hover:bg-raised"
                  >
                    <span className="font-mono text-sm text-ink">
                      Docs & setup
                    </span>
                    <span className="text-faint">→</span>
                  </Link>
                  <Link
                    href="/docs#troubleshoot"
                    className="flex items-center justify-between rounded-xl border border-line bg-canvas px-4 py-3 hover:bg-raised"
                  >
                    <span className="font-mono text-sm text-ink">
                      Troubleshooting
                    </span>
                    <span className="text-faint">→</span>
                  </Link>
                </div>
                <div className="mt-4 rounded-xl border border-red-500/20 bg-red-500/[0.06] p-4">
                  <p className="font-mono text-xs font-semibold uppercase tracking-wide text-red-400">
                    Danger zone
                  </p>
                  <p className="mt-1 font-mono text-xs leading-4 text-red-300/70">
                    Log out clears your httpOnly session. You’ll need to sign in
                    again.
                  </p>
                  <div className="mt-3">
                    <LogoutHold />
                  </div>
                  <p className="mt-2 text-center font-mono text-[11px] leading-4 text-red-300/60">
                    Hold 1.4s to confirm — red means destructive
                  </p>
                </div>
                <p className="mt-3 text-center font-mono text-xs text-faint">
                  Signed in as {session.user.email}
                </p>
              </section>
            </Reveal>
          </div>
        </div>

        {/* Bottom: status bar — hidden on mobile, visible on lg for density */}
        <Reveal className="mt-6 hidden lg:block">
          <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-raised/40 px-5 py-3">
            <span className="inline-flex items-center gap-2 font-mono text-xs text-faint">
              <span
                className="size-2 rounded-full bg-emerald-500"
                aria-hidden
              />{" "}
              API healthy
            </span>
            <span className="hidden h-3 w-px bg-line sm:block" aria-hidden />
            <span className="font-mono text-xs text-faint">
              {new Date().toLocaleDateString("en-GB", {
                weekday: "short",
                day: "numeric",
                month: "short",
              })}{" "}
              · Local models 6 · Offline ready
            </span>
            <span className="ml-auto hidden font-mono text-xs text-faint sm:inline">
              Hold{" "}
              <code className="rounded bg-canvas px-1 py-0.5 ring-1 ring-line">
                Ctrl+Space
              </code>{" "}
              anywhere
            </span>
          </div>
        </Reveal>
      </div>

      <SiteFooter />
    </div>
  );
}
