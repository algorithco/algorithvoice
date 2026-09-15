import { SiteFooter } from "../../components/SiteFooter";
import { SiteNav } from "../../components/SiteNav";

const PLANS = [
  {
    name: "Free",
    price: "$0",
    lines: [
      "60 cloud minutes monthly",
      "Unlimited local dictation",
      "2 devices",
      "Community support",
    ],
    cta: null as string | null,
  },
  {
    name: "Pro",
    price: "$12/month",
    lines: [
      "Unlimited cloud transcription",
      "10 devices",
      "Priority processing",
      "Usage history sync",
    ],
    cta: "Checkout opens with billing (Phase 4)",
  },
];

export default function PricingPage() {
  return (
    <div className="min-h-screen bg-white text-black dark:bg-black dark:text-white">
      <SiteNav />
      <main className="mx-auto max-w-[1200px] px-6 py-24 md:px-16 md:py-32">
        <h1 className="av-section-h">Pricing</h1>
        <p className="av-body-lg av-prose mt-4 text-gray-500">
          Start free. Upgrade when dictation becomes the way you work.
        </p>
        <div className="mt-12 grid gap-6 md:grid-cols-2">
          {PLANS.map((p) => (
            <div
              key={p.name}
              className="rounded-card border border-gray-200 p-8 dark:border-gray-800"
            >
              <p className="av-h2">{p.name}</p>
              <p className="av-section-h mt-4">{p.price}</p>
              <ul className="mt-6 flex flex-col gap-3">
                {p.lines.map((l) => (
                  <li
                    key={l}
                    className="av-body-lg border-t border-gray-200 pt-3 text-gray-500 dark:border-gray-800"
                  >
                    {l}
                  </li>
                ))}
              </ul>
              {p.cta ? (
                <p className="av-small mt-6 text-gray-500">{p.cta}</p>
              ) : null}
            </div>
          ))}
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
