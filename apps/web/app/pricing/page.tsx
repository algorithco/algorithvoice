import Link from "next/link";
import { PixelSwap } from "../../components/PixelSwap";
import { Reveal } from "../../components/Reveal";
import { SiteFooter } from "../../components/SiteFooter";
import { SiteNav } from "../../components/SiteNav";

const PLANS = [
  {
    name: "Free",
    price: "$0",
    tagline: "60 cloud minutes monthly. Unlimited local dictation.",
    lines: [
      "60 cloud minutes monthly",
      "Unlimited local dictation",
      "2 devices",
      "Community support",
    ],
    featured: false,
  },
  {
    name: "Pro",
    price: "$12/month",
    tagline: "Unlimited cloud. Ten devices. Priority processing.",
    lines: [
      "Unlimited cloud transcription",
      "10 devices",
      "Priority processing",
      "Usage history sync",
    ],
    featured: true,
  },
];

function PlanCard({ plan }: { plan: (typeof PLANS)[number] }) {
  const shell = plan.featured ? "bg-ink text-canvas" : "bg-surface text-ink";
  const line = plan.featured ? "border-canvas/25" : "border-line";
  const faint = plan.featured ? "opacity-70" : "text-sub";

  return (
    <PixelSwap
      trigger="hover"
      pattern="diagonal"
      randomness={0.08}
      pixelSize={56}
      gap={6}
      pixelRadius={10}
      duration={900}
      pixelDuration={280}
      pixelScale={0.2}
      cover={plan.featured ? "var(--v5-t1)" : "var(--v5-surface)"}
      aspectRatio="auto"
      className={`h-full rounded-lg border border-line ${shell}`}
      style={{ minHeight: 440 }}
      firstContent={
        <div className="flex h-full flex-col p-8">
          <p className={`t-cap ${faint}`}>{plan.name}</p>
          <p className="t-h1 mt-4">{plan.price}</p>
          <p className={`t-body mt-4 flex-1 ${faint}`}>{plan.tagline}</p>
          <p className={`t-cap mt-8 ${faint}`}>Hover for specs →</p>
        </div>
      }
      secondContent={
        <div className="flex h-full flex-col p-8">
          <p className={`t-cap ${faint}`}>{plan.name} · Specs</p>
          <ul className="mt-6 flex flex-1 flex-col gap-3">
            {plan.lines.map((l) => (
              <li
                key={l}
                className={`t-body border-t ${line} pt-3 ${plan.featured ? "" : "text-sub"}`}
              >
                {l}
              </li>
            ))}
          </ul>
          <Link
            href="/download"
            className={
              plan.featured
                ? "btn mt-8 bg-canvas text-ink hover:opacity-85"
                : "btn btn-primary mt-8"
            }
          >
            Download free
          </Link>
        </div>
      }
    />
  );
}

export default function PricingPage() {
  return (
    <div className="min-h-screen bg-canvas text-ink">
      <SiteNav />
      <main className="mx-auto max-w-[1200px] px-6 py-24 md:px-16 md:py-32">
        <Reveal>
          <p className="t-cap text-faint">Pricing</p>
          <h1 className="t-h1 mt-4 max-w-[24ch]">
            Start free. Upgrade when dictation becomes the way you work.
          </h1>
        </Reveal>
        <div className="mt-12 grid gap-6 md:grid-cols-2">
          {PLANS.map((p, i) => (
            <Reveal key={p.name} delay={i * 80} className="h-full min-w-0">
              <PlanCard plan={p} />
            </Reveal>
          ))}
        </div>
        <Reveal>
          <p className="t-cap mt-8 text-faint">
            Billing via Stripe · Cancel anytime
          </p>
        </Reveal>
      </main>
      <SiteFooter />
    </div>
  );
}
