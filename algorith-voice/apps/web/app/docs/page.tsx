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
    <div className="min-h-screen bg-white text-black dark:bg-black dark:text-white">
      <SiteNav />
      <main className="mx-auto max-w-[1200px] px-6 py-24 md:px-16 md:py-32">
        <h1 className="av-section-h">Setup guide</h1>
        <p className="av-body-lg av-prose mt-4 text-gray-500">
          One page per operating system. Four steps each.
        </p>
        <div className="mt-12 grid gap-6 md:grid-cols-3">
          {SECTIONS.map((s) => (
            <section
              key={s.os}
              className="rounded-card border border-gray-200 p-8 dark:border-gray-800"
            >
              <h2 className="av-h2">{s.os}</h2>
              <ol className="mt-4 flex flex-col gap-3">
                {s.steps.map((step, i) => (
                  <li
                    key={step}
                    className="av-body border-t border-gray-200 pt-3 text-gray-500 first:border-t-0 first:pt-0 dark:border-gray-800"
                  >
                    <span className="av-mono mr-2 text-black dark:text-white">
                      {i + 1}
                    </span>
                    {step}
                  </li>
                ))}
              </ol>
            </section>
          ))}
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
