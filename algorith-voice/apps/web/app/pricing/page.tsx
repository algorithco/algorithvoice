export default function PricingPage() {
  return (
    <main className="mx-auto max-w-5xl p-6">
      <h1 className="text-3xl font-semibold">Pricing</h1>
      <div className="mt-6 grid gap-4 md:grid-cols-2">
        <div className="border rounded-[6px] p-6">
          <p className="font-medium">Free</p>
          <p className="mt-1 text-sm opacity-60">
            60 min/mo cloud · unlimited local · 2 devices
          </p>
          <p className="mt-4 text-3xl">$0</p>
        </div>
        <div className="border rounded-[6px] p-6 border-black dark:border-white">
          <p className="font-medium">Pro</p>
          <p className="mt-1 text-sm opacity-60">
            Unlimited cloud · 10 devices · priority
          </p>
          <p className="mt-4 text-3xl">$12/mo</p>
          <p className="mt-2 text-xs opacity-60">
            Checkout via Stripe (Phase 4).
          </p>
        </div>
      </div>
    </main>
  );
}
