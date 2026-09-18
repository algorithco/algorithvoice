import Link from "next/link";
import { Aurora } from "../components/Aurora";
import { BlurText } from "../components/BlurText";
import { Counter } from "../components/Counter";
import { Faq } from "../components/Faq";
import { Reveal } from "../components/Reveal";
import { SiteFooter } from "../components/SiteFooter";
import { SiteNav } from "../components/SiteNav";

const BARS = Array.from({ length: 56 }, (_, i) => ({
  id: `bar-${i}`,
  h: 0.22 + 0.78 * Math.abs(Math.sin(i * 1.7) * Math.cos(i * 0.55) + 0.25),
}));

function Waveform({ className = "" }: { className?: string }) {
  return (
    <div aria-hidden className={`flex h-28 items-center gap-1 ${className}`}>
      {BARS.map((b, i) => (
        <span
          key={b.id}
          className="wf-bar w-1 flex-1 rounded-full bg-ink"
          style={{
            height: `${Math.round(b.h * 100)}%`,
            animationDelay: `${(i % 12) * 90}ms`,
          }}
        />
      ))}
    </div>
  );
}

const STATS: {
  to: number;
  decimals?: number;
  suffix?: string;
  label: string;
}[] = [
  { to: 0.6, decimals: 1, suffix: "s", label: "median injection latency" },
  { to: 60, suffix: "", label: "free cloud minutes / month" },
  { to: 3, label: "desktop platforms" },
  { to: 2, label: "transcription modes" },
];

const FEATURES = [
  {
    title: "Push-to-talk, everywhere",
    copy: "Hold Ctrl+Space in any app — terminal, IDE, browser, AI chat — and release. Text lands at the cursor in under a second.",
    demo: "keys",
  },
  {
    title: "Local-first privacy",
    copy: "Local mode runs fully offline. Audio never leaves the device, no account needed, no telemetry by default.",
    demo: "local",
  },
  {
    title: "Built for agents",
    copy: "Dictate prompts, refactors, and release notes straight into the tools you already drive with AI.",
    demo: "agent",
  },
] as const;

const PLATFORMS = [
  { os: "macOS", cmd: "brew install --cask algorith-voice" },
  { os: "Windows", cmd: "winget install Algorith.Voice" },
  { os: "Linux", cmd: "curl -fsSL av.sh | sh" },
];

const FAQS: [string, string][] = [
  [
    "How does push-to-talk work?",
    "Hold the hotkey and speak. On release, your speech is transcribed and typed at the cursor in the focused app — terminal, editor, browser, anywhere.",
  ],
  [
    "Does my audio leave my device?",
    "Not in local mode — transcription runs fully offline. Cloud transcription and history sync are opt-in, off by default.",
  ],
  [
    "Which platforms are supported?",
    "macOS, Windows, and Linux. On Linux Wayland sessions, enable clipboard mode in Settings (see the docs).",
  ],
  [
    "What does the free plan include?",
    "60 minutes of cloud transcription every month, unlimited local dictation, and 2 devices. Pro adds unlimited cloud, 10 devices, and priority processing.",
  ],
  [
    "Can I remap the hotkey?",
    "Yes. The default is Ctrl+Space and it is fully remappable per platform in Settings.",
  ],
];

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-canvas text-ink">
      <SiteNav />
      <main>
        {/* Hero — pulled under the sticky nav (-mt-20 = nav height),
            so Aurora fills behind the nav pill instead of black. Inner
            padding compensates +80px, content stays at the same spot. */}
        <section className="relative -mt-20 overflow-hidden">
          <Aurora
            colorStops={["#ffffff", "#81738f", "#9a93b8"]}
            amplitude={1.0}
            blend={0.5}
            speed={1}
            opacity={0.7}
          />
          <div className="relative z-10 mx-auto max-w-[1200px] px-4 pt-44 pb-16 sm:px-6 md:px-16 md:pt-52">
            <div className="mx-auto max-w-[800px] text-center">
              <BlurText
                text="Talk faster. Type never."
                className="t-hero mt-6 text-balance"
                delay={180}
                animateBy="words"
                direction="top"
              />
              <p className="t-lead mx-auto mt-6 max-w-[52ch] text-sub">
                Push-to-talk dictation for macOS, Windows, and Linux. Hold the
                hotkey, speak, and text lands at the cursor — in your terminal,
                your editor, your browser.
              </p>
              <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
                <Link href="/download" className="btn btn-primary">
                  Download free
                </Link>
                <Link href="/docs" className="btn btn-secondary">
                  Setup guide →
                </Link>
              </div>
            </div>

            <Reveal className="mt-16">
              <Waveform className="mx-auto max-w-3xl" />
            </Reveal>
          </div>
        </section>

        {/* Stats */}
        <section className="border-y border-line bg-surface">
          <dl className="mx-auto grid max-w-[1200px] grid-cols-2 gap-6 px-4 py-10 sm:gap-8 sm:px-6 sm:py-12 md:grid-cols-4 md:px-16">
            {STATS.map((s) => (
              <div key={s.label}>
                <dt className="t-h2">
                  <Counter
                    to={s.to}
                    decimals={s.decimals ?? 0}
                    suffix={s.suffix ?? ""}
                  />
                </dt>
                <dd className="t-cap mt-2 text-faint">{s.label}</dd>
              </div>
            ))}
          </dl>
        </section>

        {/* Features */}
        <section className="mx-auto max-w-[1200px] px-4 py-16 sm:px-6 sm:py-24 md:px-16 md:py-32">
          <Reveal>
            <p className="t-cap text-faint">Why Algorith Voice</p>
            <h2 className="t-h1 mt-4 max-w-[20ch]">
              An instrument for talking to machines.
            </h2>
          </Reveal>
          <div className="mt-12 grid gap-6 md:grid-cols-3">
            {FEATURES.map((f, i) => (
              <Reveal key={f.title} delay={i * 80}>
                <article className="flex h-full min-w-0 flex-col rounded-lg border border-line bg-surface p-6 transition-all duration-200 ease-app hover:-translate-y-0.5 hover:bg-raised sm:p-8">
                  <h3 className="t-h2">{f.title}</h3>
                  <p className="t-body mt-4 flex-1 text-sub">{f.copy}</p>
                  {f.demo === "keys" ? (
                    <p className="mt-6 flex flex-wrap items-center gap-2">
                      <kbd className="rounded-md border border-line bg-raised px-3 py-2 font-mono text-[13px] leading-[18px] font-medium">
                        Ctrl
                      </kbd>
                      <span className="text-faint">+</span>
                      <kbd className="rounded-md border border-line bg-raised px-3 py-2 font-mono text-[13px] leading-[18px] font-medium">
                        Space
                      </kbd>
                      <span className="t-cap ml-2 text-faint">
                        hold to talk
                      </span>
                    </p>
                  ) : null}
                  {f.demo === "local" ? (
                    <p className="mt-6">
                      <span className="t-cap inline-flex items-center gap-2 rounded-full border border-line bg-raised px-4 py-2">
                        <span
                          aria-hidden
                          className="h-2 w-2 rounded-full bg-ink"
                        />
                        Local · On
                      </span>
                    </p>
                  ) : null}
                  {f.demo === "agent" ? (
                    <p className="mt-6 rounded-md border border-line bg-raised p-4 font-mono text-[13px] leading-[18px] font-normal">
                      <span className="text-faint">$ </span>agent &quot;refactor
                      auth&quot;
                    </p>
                  ) : null}
                </article>
              </Reveal>
            ))}
          </div>
        </section>

        {/* Platform */}
        <section className="border-y border-line bg-surface">
          <div className="mx-auto max-w-[1200px] px-4 py-16 sm:px-6 sm:py-24 md:px-16 md:py-32">
            <Reveal>
              <p className="t-cap text-faint">Platforms</p>
              <h2 className="t-h1 mt-4">One line to install.</h2>
            </Reveal>
            <div className="mt-12 grid gap-6 md:grid-cols-3">
              {PLATFORMS.map((p, i) => (
                <Reveal key={p.os} delay={i * 80} className="min-w-0">
                  <article className="flex h-full min-w-0 flex-col rounded-lg border border-line bg-canvas p-6 sm:p-8">
                    <h3 className="t-h2">{p.os}</h3>
                    <pre className="mt-6 flex-1 overflow-x-auto rounded-md border border-line bg-surface p-4 font-mono text-[13px] leading-[18px] font-normal">
                      <code>
                        <span className="text-faint">$ </span>
                        {p.cmd}
                      </code>
                    </pre>
                    <Link
                      href="/download"
                      className="btn btn-secondary mt-6 w-full"
                    >
                      Download →
                    </Link>
                  </article>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        {/* Pricing teaser */}
        <section className="mx-auto max-w-[1200px] px-4 py-16 sm:px-6 sm:py-24 md:px-16 md:py-32">
          <Reveal>
            <div className="rounded-2xl bg-ink p-6 text-canvas sm:p-8 md:p-12">
              <p className="t-cap opacity-70">Pricing</p>
              <h2 className="t-h1 mt-4">Free until it earns its keep.</h2>
              <p className="t-lead mt-4 max-w-[52ch] opacity-80">
                60 cloud minutes monthly, unlimited local dictation. Pro is
                $12/month when dictation becomes the way you work.
              </p>
              <Link
                href="/pricing"
                className="btn mt-8 bg-canvas text-ink hover:opacity-85"
              >
                Compare plans →
              </Link>
            </div>
          </Reveal>
        </section>

        {/* FAQ */}
        <section className="mx-auto max-w-[1200px] px-4 pb-16 sm:px-6 sm:pb-24 md:px-16 md:pb-32">
          <Reveal>
            <p className="t-cap text-faint">FAQ</p>
            <h2 className="t-h1 mt-4">Questions, answered.</h2>
          </Reveal>
          <Reveal className="mt-12 max-w-[800px]">
            <Faq items={FAQS} />
          </Reveal>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
