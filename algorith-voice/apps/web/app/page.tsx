import Link from "next/link";
import { DownloadButtons } from "../components/DownloadButtons";
import { SiteFooter } from "../components/SiteFooter";
import { SiteNav } from "../components/SiteNav";
import { TerminalDemo } from "../components/TerminalDemo";

const STEPS = [
  {
    verb: "Hold",
    detail: "Press and hold Ctrl+Space — remappable, works in any app.",
  },
  {
    verb: "Speak",
    detail: "Talk naturally. On-device detection finds your speech.",
  },
  { verb: "Release", detail: "Text lands at the cursor in under a second." },
];

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-white text-black dark:bg-black dark:text-white">
      <SiteNav />
      <main>
        {/* Hero: left-aligned, 8-word headline, Inter Tight 64px */}
        <section className="mx-auto max-w-[1200px] px-6 py-24 md:px-16 md:py-32">
          <div className="av-hero-reveal">
            <h1 className="av-hero max-w-[16ch]">
              Hold to talk. Release to type.
            </h1>
            <p className="av-subhead av-prose mt-6 text-gray-500">
              Push-to-talk dictation for macOS, Windows, and Linux. It types
              into your terminal, IDE, browser, and AI chat.
            </p>
            <div className="mt-8">
              <DownloadButtons />
            </div>
          </div>
          <div className="mt-16">
            <TerminalDemo />
          </div>
        </section>

        {/* How it works: mono verbs joined by a 1px line — sequential, earned */}
        <section className="border-t border-gray-200 dark:border-gray-800">
          <div className="mx-auto max-w-[1200px] px-6 py-24 md:px-16 md:py-32">
            <h2 className="av-section-h">Three moves, no learning curve</h2>
            <ol className="mt-12 grid gap-8 md:grid-cols-3 md:gap-6">
              {STEPS.map((s, i) => (
                <li key={s.verb} className="relative pt-6">
                  <span
                    aria-hidden
                    className="absolute inset-x-0 top-0 h-px bg-gray-200 dark:bg-gray-800"
                  />
                  <span
                    aria-hidden
                    className={
                      i === 0
                        ? "absolute left-0 top-0 h-px w-12 bg-black dark:bg-white"
                        : undefined
                    }
                  />
                  <p className="av-mono">{s.verb}</p>
                  <p className="av-body-lg mt-2 text-gray-500">{s.detail}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* Pricing teaser */}
        <section className="border-t border-gray-200 dark:border-gray-800">
          <div className="mx-auto max-w-[1200px] px-6 py-24 md:px-16 md:py-32">
            <h2 className="av-section-h">Free until it earns its keep</h2>
            <div className="mt-12 grid gap-6 md:grid-cols-2">
              <div className="rounded-card border border-gray-200 p-8 dark:border-gray-800">
                <p className="av-h2">Free</p>
                <p className="av-body-lg mt-2 text-gray-500">
                  60 minutes of cloud transcription monthly. Unlimited local
                  dictation. Two devices.
                </p>
                <p className="av-section-h mt-6">$0</p>
              </div>
              <div className="rounded-card border border-gray-200 bg-near-white p-8 dark:border-gray-800 dark:bg-near-black">
                <p className="av-h2">Pro</p>
                <p className="av-body-lg mt-2 text-gray-500">
                  Unlimited cloud transcription. Ten devices. Priority
                  processing.
                </p>
                <p className="av-section-h mt-6">
                  $12<span className="av-body-lg text-gray-500">/month</span>
                </p>
                <Link
                  href="/pricing"
                  className="av-body mt-6 inline-block rounded-control bg-black px-4 py-2.5 text-white transition-opacity duration-150 ease-app hover:opacity-85 dark:bg-white dark:text-black"
                >
                  Compare plans
                </Link>
              </div>
            </div>
          </div>
        </section>

        {/* Privacy note */}
        <section className="border-t border-gray-200 dark:border-gray-800">
          <div className="mx-auto max-w-[1200px] px-6 py-24 md:px-16 md:py-32">
            <h2 className="av-section-h">Local means local</h2>
            <p className="av-body-lg av-prose mt-6 text-gray-500">
              In local mode your audio never leaves the device — no account, no
              network, no telemetry. Cloud transcription and sync are opt-in,
              off by default, and documented in plain language.
            </p>
            <Link
              href="/docs"
              className="av-body mt-6 inline-block rounded-control border border-gray-200 px-4 py-2.5 transition-colors duration-150 ease-app hover:bg-gray-200 dark:border-gray-800 dark:hover:bg-gray-800"
            >
              Read the setup guide
            </Link>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
