import Link from "next/link";

export default function LandingPage() {
  return (
    <main className="min-h-screen bg-white text-black dark:bg-black dark:text-white">
      <header className="border-b border-black/10 dark:border-white/10">
        <div className="mx-auto flex max-w-5xl items-center justify-between p-4">
          <span className="font-semibold">Algorith Voice</span>
          <nav className="flex gap-4 text-sm">
            <Link href="/pricing">Pricing</Link>
            <Link href="/download">Download</Link>
            <Link href="/docs">Docs</Link>
            <Link href="/dashboard">Dashboard</Link>
          </nav>
        </div>
      </header>
      <section className="mx-auto max-w-5xl px-4 py-20">
        <h1 className="text-5xl font-semibold tracking-tight">
          Hold to talk. Release to type.
        </h1>
        <p className="mt-4 max-w-xl opacity-60">
          Push-to-talk dictation for macOS, Windows, and Linux. Works in your
          terminal, IDE, browser, and AI chat. Local mode = audio never leaves
          your device.
        </p>
        <div className="mt-8 flex gap-3">
          <Link
            href="/download"
            className="bg-black text-white px-6 h-12 inline-flex items-center rounded-[4px] dark:bg-white dark:text-black"
          >
            Download
          </Link>
          <Link
            href="/pricing"
            className="border border-black/10 px-6 h-12 inline-flex items-center rounded-[4px] dark:border-white/10"
          >
            Pricing
          </Link>
        </div>
        <ol className="mt-16 grid gap-4 md:grid-cols-3">
          {[
            ["01", "Install", "One app for macOS, Windows, Linux."],
            ["02", "Hold hotkey", "Default Ctrl+Space, fully remappable."],
            [
              "03",
              "Release",
              "Text appears in the focused app in <1s (cloud) or offline (local).",
            ],
          ].map(([n, t, d]) => (
            <li
              key={n}
              className="border border-black/10 rounded-[6px] p-4 dark:border-white/10"
            >
              <p className="text-sm opacity-60">{n}</p>
              <p className="mt-1 font-medium">{t}</p>
              <p className="mt-1 text-sm opacity-60">{d}</p>
            </li>
          ))}
        </ol>
      </section>
    </main>
  );
}
