import { SiteFooter } from "../../components/SiteFooter";
import { SiteNav } from "../../components/SiteNav";

const WIDGETS = ["Usage this period", "Devices", "Subscription"];

export default function DashboardPage() {
  // Server Component: session validated via BFF -> Fastify GET /me (Phase 4 wiring).
  return (
    <div className="min-h-screen bg-white text-black dark:bg-black dark:text-white">
      <SiteNav />
      <main className="mx-auto max-w-[1200px] px-6 py-24 md:px-16 md:py-32">
        <h1 className="av-section-h">Dashboard</h1>
        <p className="av-body-lg mt-4 text-gray-500">
          Usage, devices, billing, and history. Full wiring ships with billing
          in Phase 4.
        </p>
        <div className="mt-12 grid gap-6 md:grid-cols-3">
          {WIDGETS.map((t) => (
            <div
              key={t}
              className="rounded-card border border-gray-200 p-8 dark:border-gray-800"
            >
              <p className="av-h2">{t}</p>
              <p className="av-body-lg mt-2 text-gray-500">No data yet.</p>
            </div>
          ))}
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
