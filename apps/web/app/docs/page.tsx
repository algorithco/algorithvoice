import { Reveal } from "../../components/Reveal";
import { SiteFooter } from "../../components/SiteFooter";
import { SiteNav } from "../../components/SiteNav";

const SECTIONS = [
  {
    os: "macOS",
    steps: [
      "Open the .dmg and drag Algorith Voice to Applications.",
      "Grant Microphone access when prompted.",
      "Grant Accessibility access so text can be typed into other apps, then relaunch.",
      "Hold Ctrl+Space and speak.",
    ],
  },
  {
    os: "Windows",
    steps: [
      "Run the .msi installer (WebView2 installs automatically if missing).",
      "Allow microphone access in Privacy settings if dictation stays silent.",
      "Note: text cannot be injected into elevated apps unless Algorith Voice also runs elevated.",
      "Hold Ctrl+Space and speak.",
    ],
  },
  {
    os: "Linux",
    steps: [
      "Make the .AppImage executable, or install the .deb.",
      "On X11 everything works out of the box.",
      "On Wayland: install and enable ydotool, then enable clipboard mode in Settings.",
      "Hold Ctrl+Space and speak.",
    ],
  },
];

export default function DocsPage() {
  return (
    <div className="min-h-screen bg-canvas text-ink">
      <SiteNav />
      <main className="mx-auto max-w-[1200px] px-6 py-24 md:px-16 md:py-32">
        <Reveal>
          <p className="t-cap text-faint">Docs</p>
          <h1 className="t-h1 mt-4">Setup guide.</h1>
          <p className="t-body mt-4 max-w-[68ch] text-sub">
            One panel per operating system. Four steps each.
          </p>
        </Reveal>
        <div className="mt-12 grid gap-6 md:grid-cols-3">
          {SECTIONS.map((s, i) => (
            <Reveal key={s.os} delay={i * 80}>
              <section className="h-full rounded-lg border border-line bg-surface p-8">
                <h2 className="t-h2">{s.os}</h2>
                <ol className="mt-4 flex flex-col gap-3">
                  {s.steps.map((step, j) => (
                    <li
                      key={step}
                      className="t-body border-t border-line pt-3 text-sub first:border-t-0 first:pt-0"
                    >
                      <span className="mr-2 font-mono text-[13px] leading-[18px] font-medium text-ink">
                        {j + 1}.
                      </span>
                      {step}
                    </li>
                  ))}
                </ol>
              </section>
            </Reveal>
          ))}
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
