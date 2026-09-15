import { Reveal } from "../../components/Reveal";
import { SiteFooter } from "../../components/SiteFooter";
import { SiteNav } from "../../components/SiteNav";

const WIDGETS = ["Usage this period", "Devices", "Subscription"];

export default function DashboardPage() {
  // Server Component: session validated via BFF -> Fastify GET /me (Phase 4 wiring).
  return (
    <div className="min-h-screen bg-canvas text-ink">
      <SiteNav />
      <main className="mx-auto max-w-[1200px] px-6 py-24 md:px-16 md:py-32">
        <Reveal>
          <p className="t-cap text-faint">Dashboard</p>
          <h1 className="t-h1 mt-4">Control deck.</h1>
          <p className="t-body mt-4 max-w-[68ch] text-sub">
            Usage, devices, billing, and history. Full wiring ships with billing
            in Phase 4.
          </p>
        </Reveal>
        <div className="mt-12 grid gap-6 md:grid-cols-3">
          {WIDGETS.map((t, i) => (
            <Reveal key={t} delay={i * 80}>
              <div className="h-full rounded-lg border border-line bg-surface p-8">
                <p className="t-cap text-faint">{t}</p>
                <p className="t-h2 mt-4 text-sub">—</p>
                <p className="t-body mt-2 text-faint">No data yet.</p>
              </div>
            </Reveal>
          ))}
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
