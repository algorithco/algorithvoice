export default function DashboardPage() {
  // Server Component: validate session via BFF -> Fastify GET /me (Phase 4 wiring).
  return (
    <main className="mx-auto max-w-5xl p-6">
      <h1 className="text-3xl font-semibold">Dashboard</h1>
      <p className="mt-2 text-sm opacity-60">
        Usage, devices, billing portal, BYOK key, history (opt-in). Full wiring
        in Phase 4.
      </p>
      <div className="mt-6 grid gap-4 md:grid-cols-3">
        {["Usage this period", "Devices (2 max free)", "Subscription"].map(
          (t) => (
            <div key={t} className="border rounded-[6px] p-4">
              <p className="font-medium">{t}</p>
              <p className="mt-1 text-sm opacity-60">—</p>
            </div>
          ),
        )}
      </div>
    </main>
  );
}
