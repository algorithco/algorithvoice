import { Reveal } from "../../components/Reveal";
import { SiteFooter } from "../../components/SiteFooter";
import { SiteNav } from "../../components/SiteNav";

const SECTIONS = [
  {
    id: "quickstart",
    title: "Quickstart",
    items: [
      { id: "qs-1", label: "Install (30s)", href: "#quickstart" },
      { id: "qs-2", label: "Hold Ctrl+Space", href: "#quickstart" },
    ],
  },
  {
    id: "os",
    title: "Per-OS setup",
    items: [
      { id: "macos", label: "macOS", href: "#macos" },
      { id: "windows", label: "Windows", href: "#windows" },
      { id: "linux", label: "Linux", href: "#linux" },
    ],
  },
  {
    id: "usage",
    title: "Usage",
    items: [
      { id: "modes", label: "Local vs Cloud", href: "#modes" },
      { id: "models", label: "6 on-device models", href: "#models" },
      { id: "hotkey", label: "Hotkey & pill", href: "#hotkey" },
    ],
  },
  {
    id: "troubleshoot",
    title: "Troubleshooting",
    items: [
      { id: "mic", label: "Microphone", href: "#troubleshoot" },
      { id: "access", label: "Accessibility / Wayland", href: "#troubleshoot" },
      { id: "paste", label: "Paste fallback", href: "#troubleshoot" },
    ],
  },
];

const OS_DETAILS = [
  {
    id: "macos",
    os: "macOS 13+ — native Swift app, coming soon",
    icon: "◐",
    steps: [
      "macOS ships as a separate native Swift app (not the Tauri bundle) — it is in development and has no download yet.",
      "Windows & Linux are available today via the Tauri desktop app (see below).",
      "Planned macOS UX matches the other platforms: hold the hotkey, speak, release → text at cursor.",
    ],
    code: "# macOS Swift app — coming soon (no download yet)",
  },
  {
    id: "windows",
    os: "Windows 10 1809+",
    icon: "▣",
    steps: [
      "Run the .exe installer — WebView2 is installed automatically if missing. Silent: .\\Algorith.Voice_0.5.10_x64-setup.exe /S",
      "Settings → Privacy → Microphone → allow desktop apps if dictation stays silent.",
      "Elevated apps (Run as admin) require Algorith Voice also elevated to paste.",
      "Hold Ctrl+Space and speak.",
    ],
    code: "curl -LO https://github.com/algorithco/algorithvoice-app/releases/download/v0.5.10/Algorith.Voice_0.5.10_x64-setup.exe\n# Double-click to install\n# Or silent:\n.\\Algorith.Voice_0.5.10_x64-setup.exe /S\n# Or winget (if published):\nwinget install Algorith.Voice",
  },
  {
    id: "linux",
    os: "Ubuntu 22.04+",
    icon: "⬢",
    steps: [
      "AppImage: chmod +x *.AppImage && ./Algorith*.AppImage  —or—  sudo dpkg -i *.deb",
      "X11: everything works out of the box.",
      "Wayland: sudo apt install ydotool && systemctl --user enable ydotool && enable clipboard mode in Settings.",
      "Hold Ctrl+Space and speak.",
    ],
    code: "curl -LO https://github.com/algorithco/algorithvoice-app/releases/download/v0.5.10/Algorith.Voice_0.5.10_amd64.AppImage\nchmod +x Algorith.Voice_0.5.10_amd64.AppImage && ./Algorith.Voice_0.5.10_amd64.AppImage\n# Or deb:\nsudo dpkg -i Algorith.Voice_0.5.10_amd64.deb  # or sudo apt install ./Algorith.Voice_0.5.10_amd64.deb",
  },
];

export default function DocsPage() {
  return (
    <div className="min-h-screen bg-canvas text-ink">
      <SiteNav />
      <div className="mx-auto flex w-full max-w-[1400px] gap-8 px-4 py-3 sm:px-6 md:px-8">
        {/* Left sidebar — sticky, grouped, pageviews +41% pattern */}
        <aside className="hidden w-[220px] shrink-0 lg:block">
          <div className="sticky top-16 max-h-[calc(100vh-64px)] overflow-auto py-8 pr-2">
            <p className="t-cap text-faint">On this page</p>
            <nav
              className="mt-4 flex flex-col gap-6"
              aria-label="Docs sections"
            >
              {SECTIONS.map((sec) => (
                <div key={sec.id}>
                  <p className="text-xs font-semibold uppercase tracking-wide text-ink">
                    {sec.title}
                  </p>
                  <ul className="mt-2 flex flex-col gap-1.5 border-l border-line pl-3">
                    {sec.items.map((it) => (
                      <li key={it.id}>
                        <a
                          href={it.href}
                          className="block py-1.5 text-sm leading-5 text-sub hover:text-ink"
                        >
                          {it.label}
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
              <div className="rounded-md border border-line bg-surface p-3">
                <p className="text-xs font-medium text-ink">Need help?</p>
                <p className="mt-1 text-xs leading-4 text-sub">
                  Settings → Local shows hardware check and license per model.
                </p>
              </div>
            </nav>
          </div>
        </aside>

        {/* Main content */}
        <main className="min-w-0 flex-1 py-10 md:py-12">
          <Reveal>
            <p className="t-cap text-faint">Docs • v0.5.10 • 6 models</p>
            <h1 className="t-h1 mt-3">Setup guide.</h1>
            <p className="t-body mt-4 max-w-[68ch] text-sub">
              One panel per operating system. Four steps each. Local mode
              downloads 670MB–2.4GB once from{" "}
              <code className="rounded bg-surface px-1 py-0.5 font-mono text-xs">
                huggingface.co/algorithco/*
              </code>{" "}
              over HTTPS with SHA-256 verification — audio never leaves the
              device.
            </p>
            <div className="mt-6 flex flex-wrap gap-2">
              <a
                href="#macos"
                className="inline-flex min-h-[44px] items-center rounded-full border border-black bg-black px-4 text-xs font-medium text-white dark:border-white dark:bg-white dark:text-black"
              >
                Jump to macOS
              </a>
              <a
                href="#windows"
                className="inline-flex min-h-[44px] items-center rounded-full border border-line bg-white px-4 text-xs font-medium text-black hover:bg-gray-50 dark:border-gray-700 dark:bg-black dark:text-white dark:hover:bg-white dark:hover:text-black"
              >
                Windows
              </a>
              <a
                href="#linux"
                className="inline-flex min-h-[44px] items-center rounded-full border border-line bg-white px-4 text-xs font-medium text-black hover:bg-gray-50 dark:border-gray-700 dark:bg-black dark:text-white dark:hover:bg-white dark:hover:text-black"
              >
                Linux
              </a>
            </div>
          </Reveal>

          {/* Section nav for mobile/tablet — sidebars are lg+ / xl+ only */}
          <nav aria-label="Docs sections" className="mt-6 lg:hidden">
            <div className="overflow-x-auto pb-1">
              <ul className="flex w-max gap-2">
                {[
                  ["#quickstart", "Quickstart"],
                  ["#macos", "macOS"],
                  ["#windows", "Windows"],
                  ["#linux", "Linux"],
                  ["#modes", "Local vs Cloud"],
                  ["#models", "Models"],
                  ["#hotkey", "Hotkey"],
                  ["#troubleshoot", "Troubleshooting"],
                ].map(([href, label]) => (
                  <li key={href}>
                    <a
                      href={href}
                      className="inline-flex min-h-[44px] items-center rounded-full border border-line bg-surface px-4 text-sm font-medium whitespace-nowrap text-sub"
                    >
                      {label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          </nav>

          {/* Quickstart callout */}
          <Reveal delay={80}>
            <div
              id="quickstart"
              className="mt-10 scroll-mt-28 rounded-lg border border-black bg-black px-6 py-5 text-white dark:border-white dark:bg-white dark:text-black"
            >
              <p className="text-xs font-semibold uppercase tracking-wide text-white/60 dark:text-black/60">
                Quickstart — 30 seconds
              </p>
              <ol className="mt-3 grid gap-2 text-sm leading-6 sm:grid-cols-3">
                <li>
                  <span className="mr-2 rounded bg-white px-1.5 py-0.5 font-mono text-xs text-black dark:bg-black dark:text-white">
                    1
                  </span>
                  Install for your OS →
                </li>
                <li>
                  <span className="mr-2 rounded bg-white px-1.5 py-0.5 font-mono text-xs text-black dark:bg-black dark:text-white">
                    2
                  </span>
                  Hold Ctrl+Space
                </li>
                <li>
                  <span className="mr-2 rounded bg-white px-1.5 py-0.5 font-mono text-xs text-black dark:bg-black dark:text-white">
                    3
                  </span>
                  Release → text lands at cursor
                </li>
              </ol>
            </div>
          </Reveal>

          {/* OS panels — improved with code + copy, numbering, icon */}
          <div className="mt-10 grid gap-4 sm:gap-6">
            {OS_DETAILS.map((s, i) => (
              <Reveal key={s.os} delay={i * 60}>
                <section
                  id={s.id}
                  className="scroll-mt-28 rounded-lg border border-line bg-surface p-4 sm:p-6 md:p-8"
                >
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="grid size-8 shrink-0 place-items-center rounded-md border border-line bg-white text-sm">
                      {s.icon}
                    </span>
                    <h2 className="t-h2 min-w-0 flex-1">{s.os}</h2>
                    <span className="ml-auto hidden rounded-full bg-black px-2.5 py-1 text-xs font-medium text-white md:inline dark:bg-white dark:text-black">
                      {s.steps.length} steps
                    </span>
                  </div>
                  <ol className="mt-6 flex flex-col gap-3">
                    {s.steps.map((step, j) => (
                      <li
                        key={step}
                        className="flex gap-3 border-t border-line pt-3 first:border-t-0 first:pt-0"
                      >
                        <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full border border-line bg-white font-mono text-xs font-medium text-ink">
                          {j + 1}
                        </span>
                        <span className="t-body pt-0.5 text-sub">{step}</span>
                      </li>
                    ))}
                  </ol>
                  <div className="mt-6 overflow-hidden rounded-md border border-line bg-black">
                    <div className="flex items-center justify-between border-b border-white/10 px-3 py-2">
                      <span className="font-mono text-xs text-white/50">
                        Terminal
                      </span>
                      <span className="font-mono text-xs text-white/30">
                        copy
                      </span>
                    </div>
                    <pre className="overflow-x-auto p-3 font-mono text-xs leading-5 text-white">
                      <code>{s.code}</code>
                    </pre>
                  </div>
                </section>
              </Reveal>
            ))}
          </div>

          {/* Local vs Cloud */}
          <Reveal>
            <section
              id="modes"
              className="mt-12 scroll-mt-28 rounded-lg border border-line bg-white p-4 sm:p-6 md:p-8"
            >
              <h2 className="t-h2">Local vs Cloud</h2>
              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <div className="rounded-md border border-line bg-surface p-4">
                  <p className="text-sm font-semibold text-ink">
                    Local (offline) — Recommended
                  </p>
                  <p className="t-body mt-2 text-sub">
                    sherpa-onnx, int8, all 6 models. Audio re-encoded to 16kHz
                    WAV locally, never uploaded. Settings → Local shows Tavsiya
                    per RAM (whisper-small &lt;4GB, parakeet default, qwen
                    ≥16GB).
                  </p>
                  <p className="mt-3 font-mono text-xs text-faint">
                    prefs.mode = local + activeModelId
                  </p>
                </div>
                <div className="rounded-md border border-line bg-surface p-4">
                  <p className="text-sm font-semibold text-ink">
                    Cloud (Groq Whisper)
                  </p>
                  <p className="t-body mt-2 text-sub">
                    whisper-large-v3-turbo via Groq, streamed only while you
                    hold the hotkey. Groq key in OS keyring or BYOK.
                  </p>
                  <p className="mt-3 font-mono text-xs text-faint">
                    prefs.mode = cloud
                  </p>
                </div>
              </div>
            </section>
          </Reveal>

          {/* 6 models — overview + link to dedicated languages page */}
          <Reveal>
            <section
              id="models"
              className="mt-12 scroll-mt-28 rounded-lg border border-line bg-surface p-4 sm:p-6"
            >
              <h2 className="t-h2">6 on-device models</h2>
              <p className="t-body mt-2 max-w-[68ch] text-sub">
                All from huggingface.co/algorithco/*, int8, HTTPS + SHA-256.
                Pick in onboarding or Settings → Local.
              </p>
              <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {[
                  ["parakeet-tdt-0.6b-v3", "~670 MB", "25 langs"],
                  ["whisper-small", "~375 MB", "99 langs"],
                  ["whisper-large-v3-turbo", "~1.0 GB", "99 langs"],
                  ["whisper-large-v3", "~1.7 GB", "99 langs"],
                  ["qwen3-asr-1.7b", "~2.4 GB", "5 langs"],
                  ["distil-large-v3.5", "~983 MB", "1 lang"],
                ].map(([id, size, langs]) => (
                  <div
                    key={id}
                    className="rounded-md border border-line bg-white p-3 dark:bg-black"
                  >
                    <p className="font-mono text-xs font-medium text-ink">
                      {id}
                    </p>
                    <p className="mt-1 text-xs text-sub">
                      {size} • {langs}
                    </p>
                  </div>
                ))}
              </div>
              <a
                href="/languages"
                className="mt-4 inline-flex min-h-[44px] items-center rounded-full bg-black px-5 text-sm font-medium text-white hover:opacity-90 dark:bg-white dark:text-black"
              >
                View all languages with flags and full names →
              </a>
            </section>
          </Reveal>

          {/* Hotkey & pill */}
          <Reveal>
            <section
              id="hotkey"
              className="mt-12 scroll-mt-28 rounded-lg border border-line bg-surface p-4 sm:p-6"
            >
              <h2 className="t-h2">Hotkey & floating pill</h2>
              <p className="t-body mt-3 text-sub">
                Default Ctrl+Space (change in Onboarding or Settings). The pill
                is a 160×40 (idle) / 260×40 (recording) frameless
                always-on-top pill — drag the pill (or the logo while
                recording), hold to talk; recording shows a live waveform
                with cancel / stop &amp; send. Global hotkey (Rust dedupes OS
                repeat) drives the same state machine.
              </p>
              <ul className="mt-4 list-disc space-y-2 pl-5 text-sm text-sub">
                <li>
                  Hold &lt;300ms or &lt;2KB is discarded as accidental (no
                  billing).
                </li>
                <li>Max 120s hard stop — pill shows “Max length reached”.</li>
                <li>
                  Esc cancels recording; Wayland/macOS permission failure shows
                  “Copied — Ctrl+V”.
                </li>
              </ul>
            </section>
          </Reveal>

          {/* Troubleshoot */}
          <Reveal>
            <section id="troubleshoot" className="mt-12 scroll-mt-28">
              <h2 className="t-h2">Troubleshooting</h2>
              <div className="mt-4 grid gap-4 md:grid-cols-3">
                {[
                  {
                    k: "Mic blocked",
                    v: "Allow Microphone in OS settings, then hold again.",
                  },
                  { k: "No mic", v: "Check OS sound settings / Privacy." },
                  { k: "Mic busy", v: "Close the other app and retry." },
                  {
                    k: "Paste fails",
                    v: "Wayland: install ydotool & enable clipboard mode; macOS: grant Accessibility.",
                  },
                  {
                    k: "Elevated app",
                    v: "On Windows, run Algorith Voice elevated to paste into elevated apps.",
                  },
                  {
                    k: "Pill missing",
                    v: "Dictate → Show pill, or restart app — pill auto-shows after onboarding (650ms).",
                  },
                ].map((it, idx) => (
                  <div
                    key={it.k}
                    className="group relative overflow-hidden rounded-md border border-line bg-surface p-4 transition-all duration-200 hover:-translate-y-0.5 hover:border-ink hover:bg-white hover:shadow-md dark:bg-white/[0.03] dark:hover:bg-white/[0.06] dark:hover:border-white/20"
                  >
                    <span className="absolute left-0 top-0 h-full w-0.5 bg-ink opacity-0 transition-opacity duration-200 group-hover:opacity-100" />
                    <p className="flex items-center gap-2 text-sm font-medium text-ink">
                      <span className="grid size-6 place-items-center rounded-full border border-line bg-white text-xs text-black group-hover:border-black group-hover:bg-black group-hover:text-white dark:border-white/20 dark:bg-white dark:text-black dark:group-hover:border-white dark:group-hover:bg-white dark:group-hover:text-black">
                        {idx + 1}
                      </span>
                      {it.k}
                    </p>
                    <p className="t-body mt-2 text-sub">{it.v}</p>
                  </div>
                ))}
              </div>
            </section>
          </Reveal>

          <div className="mt-12 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
            <a
              href="/download"
              className="inline-flex min-h-[44px] items-center justify-center rounded-full bg-black px-5 text-sm font-medium text-white dark:bg-white dark:text-black"
            >
              Download v0.5.10
            </a>
            <a
              href="/pricing"
              className="inline-flex min-h-[44px] items-center justify-center rounded-full border border-line bg-white px-5 text-sm font-medium text-black hover:bg-gray-50 dark:border-gray-700 dark:bg-black dark:text-white dark:hover:bg-white dark:hover:text-black"
            >
              Pricing
            </a>
          </div>
        </main>

        {/* Right TOC — sticky, on-page (Vercel/Linear pattern) */}
        <aside className="hidden w-[180px] shrink-0 xl:block">
          <div className="sticky top-16 py-8">
            <p className="t-cap text-faint">Contents</p>
            <ul className="mt-3 flex flex-col gap-1 border-l border-line pl-3 text-sm">
              <li>
                <a
                  href="#quickstart"
                  className="block py-1 text-sub hover:text-ink"
                >
                  Quickstart
                </a>
              </li>
              <li>
                <a href="#macos" className="block py-1 text-sub hover:text-ink">
                  macOS
                </a>
              </li>
              <li>
                <a
                  href="#windows"
                  className="block py-1 text-sub hover:text-ink"
                >
                  Windows
                </a>
              </li>
              <li>
                <a href="#linux" className="block py-1 text-sub hover:text-ink">
                  Linux
                </a>
              </li>
              <li>
                <a href="#modes" className="block py-1 text-sub hover:text-ink">
                  Local vs Cloud
                </a>
              </li>
              <li>
                <a
                  href="#models"
                  className="block py-1 text-sub hover:text-ink"
                >
                  6 models
                </a>
              </li>
              <li>
                <a
                  href="#troubleshoot"
                  className="block py-1 text-sub hover:text-ink"
                >
                  Troubleshooting
                </a>
              </li>
            </ul>
          </div>
        </aside>
      </div>
      <SiteFooter />
    </div>
  );
}
