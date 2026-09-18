import { redirect } from "next/navigation";
import { Reveal } from "../../components/Reveal";
import { SiteFooter } from "../../components/SiteFooter";
import { SiteNav } from "../../components/SiteNav";
import { getSession } from "../../lib/dal";

export default async function DashboardPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const API = process.env.API_URL ?? "http://localhost:3001";
  const headers = { Authorization: `Bearer ${session.token}` };

  const [usageRes, subRes] = await Promise.all([
    fetch(`${API}/usage/summary`, { headers, cache: "no-store" })
      .then(async (r) => (r.ok ? ((await r.json()) as unknown) : null))
      .catch(() => null),
    fetch(`${API}/billing/subscription`, { headers, cache: "no-store" })
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

  const widgets = [
    {
      label: "Usage this period",
      value:
        usage != null
          ? `${Math.round(usage.cloudSecondsUsed)}s / ${usage.cloudSecondsLimit === -1 ? "∞" : `${usage.cloudSecondsLimit}s`}`
          : "—",
      hint:
        usage != null
          ? `${usage.requests} requests · ${usage.planTier}`
          : "No data yet.",
    },
    {
      label: "Subscription",
      value: sub != null ? `${sub.status} · ${sub.planTier}` : "—",
      hint: sub?.currentPeriodEnd
        ? `Renews ${new Date(sub.currentPeriodEnd).toLocaleDateString()}`
        : "No data yet.",
    },
    {
      label: "Account",
      value: session.user.email,
      hint: `Plan ${session.user.planTier} · ${session.user.name ?? "no name"}`,
    },
  ];

  return (
    <div className="min-h-screen bg-canvas text-ink">
      <SiteNav />
      <main className="mx-auto max-w-[1200px] px-4 py-12 sm:px-6 sm:py-24 md:px-16 md:py-32">
        <Reveal>
          <p className="t-cap text-faint">Dashboard</p>
          <h1 className="t-h1 mt-4">Control deck.</h1>
          <p className="t-body mt-4 max-w-[68ch] break-words text-sub">
            Signed in as {session.user.email} · {session.user.planTier}
          </p>
        </Reveal>
        <div className="mt-8 grid gap-4 sm:mt-12 sm:gap-6 md:grid-cols-3">
          {widgets.map((w, i) => (
            <Reveal key={w.label} delay={i * 80} className="min-w-0">
              <div className="h-full min-w-0 rounded-lg border border-line bg-surface p-6 sm:p-8">
                <p className="t-cap text-faint">{w.label}</p>
                <p className="t-h2 mt-4 break-words text-sub">{w.value}</p>
                <p className="t-body mt-2 break-words text-faint">{w.hint}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
