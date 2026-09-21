import Link from "next/link";

import { Aurora } from "../../components/Aurora";
import { Reveal } from "../../components/Reveal";
import { SiteFooter } from "../../components/SiteFooter";
import { SiteNav } from "../../components/SiteNav";
import DownloadInteractive from "./DownloadInteractive";

export const revalidate = 3600;

type GithubAsset = {
  name: string;
  browser_download_url: string;
  size: number;
  content_type?: string;
  updated_at?: string;
};

type GithubRelease = {
  tag_name: string;
  name: string | null;
  body: string | null;
  published_at: string | null;
  html_url: string;
  assets: GithubAsset[];
  prerelease: boolean;
  draft: boolean;
};

function formatMB(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(iso: string | null) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}

async function getLatest(): Promise<GithubRelease | null> {
  const repo =
    process.env.NEXT_PUBLIC_GITHUB_REPO ?? "algorithco/algorithvoice-app";
  const headers: Record<string, string> = {
    "User-Agent": "algorithvoice-web",
    Accept: "application/vnd.github+json",
  };
  if (process.env.GITHUB_TOKEN)
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  try {
    const res = await fetch(
      `https://api.github.com/repos/${repo}/releases/latest`,
      {
        headers,
        next: { revalidate: 3600 },
      },
    );
    if (!res.ok) return null;
    const json = (await res.json()) as GithubRelease;
    if (json.draft) return null;
    return json;
  } catch {
    return null;
  }
}

function categorize(assets: GithubAsset[]) {
  const installers = assets.filter(
    (a) =>
      /\.(dmg|msi|msix|exe|AppImage|deb|rpm)$/i.test(a.name) &&
      !a.name.endsWith(".sig"),
  );
  const sigs = assets.filter((a) => a.name.endsWith(".sig"));
  const other = assets.filter(
    (a) =>
      !installers.includes(a) && !sigs.includes(a) && a.name !== "latest.json",
  );

  const windows = installers.filter((a) => /\.(exe|msi|msix)$/i.test(a.name));
  const linux = installers.filter((a) => /\.(AppImage|deb|rpm)$/i.test(a.name));
  const mac = installers.filter((a) => /\.dmg$/i.test(a.name));

  // Prefer ordering: exe > msi, AppImage > deb
  const sortAsset = (list: GithubAsset[]) =>
    [...list].sort((a, b) => {
      const order = (n: string) => {
        if (/\.exe$/i.test(n)) return 0;
        if (/\.msi$/i.test(n)) return 1;
        if (/\.AppImage$/i.test(n)) return 0;
        if (/\.deb$/i.test(n)) return 1;
        return 9;
      };
      return order(a.name) - order(b.name) || a.size - b.size;
    });

  return {
    installers: sortAsset(installers),
    windows: sortAsset(windows),
    linux: sortAsset(linux),
    mac: sortAsset(mac),
    sigs,
    other,
    latestJson: assets.find((a) => a.name === "latest.json") ?? null,
  };
}

function PlatformIcon({ platform }: { platform: "windows" | "linux" | "mac" }) {
  if (platform === "windows") {
    return (
      <span
        className="grid size-10 place-items-center rounded-xl bg-[#0a0a0a] ring-1 ring-line"
        aria-hidden
      >
        <svg viewBox="0 0 24 24" className="size-5" fill="currentColor">
          <path d="M3 3.5L11 3v8H3zM12.5 3l7.5-.9v8.9h-7.5zM3 12.5H11V21L3 20.1zM12.5 12.5H20V21l-7.5.9z" />
        </svg>
      </span>
    );
  }
  if (platform === "linux") {
    return (
      <span
        className="grid size-10 place-items-center rounded-xl bg-[#0a0a0a] ring-1 ring-line"
        aria-hidden
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          className="size-5"
          stroke="currentColor"
          strokeWidth="1.7"
        >
          <rect x="3" y="4" width="18" height="14" rx="2" />
          <path d="M8 20h8M12 14v6" strokeLinecap="round" />
          <path d="M7 8h3M7 11h5" strokeLinecap="round" />
        </svg>
      </span>
    );
  }
  return (
    <span
      className="grid size-10 place-items-center rounded-xl bg-[#0a0a0a] ring-1 ring-line"
      aria-hidden
    >
      <svg viewBox="0 0 24 24" className="size-5" fill="currentColor">
        <path d="M12 2.2a4.5 4.5 0 0 0-2.3.6A5.2 5.2 0 0 0 6 6.2c0 1.2.4 2.3 1.2 3.2A5.1 5.1 0 0 0 12 12a5.1 5.1 0 0 0 4.8-2.6c.8-.9 1.2-2 1.2-3.2a5.2 5.2 0 0 0-3.7-3.4A4.5 4.5 0 0 0 12 2.2zm-3.2 8.6c-1.4.4-2.8 1.6-3.3 3.2-.5 1.7-.2 3.5 1 5A8.2 8.2 0 0 0 12 21a8.2 8.2 0 0 0 5.5-2c1.2-1.5 1.5-3.3 1-5-.5-1.6-1.9-2.8-3.3-3.2a5.8 5.8 0 0 1-3.2 1 5.8 5.8 0 0 1-3.2-1z" />
      </svg>
    </span>
  );
}

export default async function DownloadPage() {
  const rel = await getLatest();
  const repo =
    process.env.NEXT_PUBLIC_GITHUB_REPO ?? "algorithco/algorithvoice-app";
  const { installers, windows, linux, mac, sigs, latestJson } = rel
    ? categorize(rel.assets)
    : {
        installers: [] as GithubAsset[],
        windows: [],
        linux: [],
        mac: [],
        sigs: [],
        latestJson: null,
      };
  const hasRelease = !!rel && installers.length > 0;
  const version = rel?.tag_name ?? null;
  const published = rel?.published_at ?? null;

  const primaryWindows = windows[0] ?? null;
  const primaryLinux =
    linux.find((a) => /\.AppImage$/i.test(a.name)) ?? linux[0] ?? null;
  const hasAnyInstallers = installers.length > 0;

  return (
    <div className="min-h-screen bg-canvas text-ink">
      <SiteNav />

      {/* Hero */}
      <section className="relative -mt-20 overflow-hidden border-b border-line">
        <Aurora
          colorStops={["#ffffff", "#81738f", "#9a93b8"]}
          amplitude={1.0}
          blend={0.5}
          speed={0.9}
          opacity={0.45}
        />
        <div className="relative z-10 mx-auto max-w-[1200px] px-4 pt-36 pb-12 sm:px-6 sm:pt-40 md:px-16 md:pb-16">
          <Reveal>
            <div className="inline-flex items-center gap-2 rounded-full border border-line bg-surface/80 px-3 py-1.5 backdrop-blur">
              <span
                className="h-2 w-2 animate-pulse rounded-full bg-emerald-500"
                aria-hidden
              />
              <span className="font-mono text-xs font-medium tracking-wide text-sub">
                Fetching from <span className="text-ink">{repo}</span>
              </span>
              {version ? (
                <>
                  <span
                    className="hidden h-3 w-px bg-line sm:block"
                    aria-hidden
                  />
                  <span className="hidden font-mono text-xs text-faint sm:inline">
                    {version} · {formatDate(published)}
                  </span>
                </>
              ) : null}
            </div>
            <h1 className="t-hero mt-6 max-w-[18ch] text-balance">
              Download Algorith Voice.
            </h1>
            <p className="t-lead mt-5 max-w-[60ch] text-pretty text-sub">
              Push-to-talk for Windows & Linux today — macOS Swift app coming
              soon. Every build is signed, verified with{" "}
              <span className="font-mono text-xs text-ink">latest.json</span> +{" "}
              <span className="font-mono text-xs text-ink">.sig</span> and
              auto-updates via Tauri updater.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              {hasRelease ? (
                <>
                  <span className="inline-flex items-center gap-2 rounded-full bg-ink px-4 py-2 font-mono text-xs font-semibold text-canvas">
                    {version}
                    <span className="h-1 w-1 rounded-full bg-white/40" />
                    {formatDate(published)}
                  </span>
                  <a
                    href={rel?.html_url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex min-h-[40px] items-center gap-2 rounded-full border border-line bg-surface px-4 font-mono text-xs font-medium text-sub hover:text-ink"
                  >
                    Release notes on GitHub →
                  </a>
                </>
              ) : (
                <span className="t-cap text-faint">
                  Checking GitHub releases… releases publish on version tags
                </span>
              )}
              <a
                href="/docs"
                className="inline-flex min-h-[40px] items-center rounded-full border border-line bg-canvas px-4 font-mono text-xs font-medium text-ink hover:bg-surface"
              >
                View setup guide
              </a>
            </div>
          </Reveal>

          {/* Interactive OS picker */}
          <Reveal delay={80}>
            <DownloadInteractive
              assets={installers}
              tag={version}
              publishedAt={published}
            />
          </Reveal>
        </div>
      </section>

      {/* Platform grid */}
      <main className="mx-auto max-w-[1200px] px-4 py-12 sm:px-6 md:px-16 md:py-16">
        <Reveal>
          <div className="flex flex-wrap items-baseline justify-between gap-4">
            <div>
              <p className="t-cap text-faint">Installers</p>
              <h2 className="t-h1 mt-2">One click per platform.</h2>
              <p className="t-body mt-3 max-w-[62ch] text-sub">
                Pick AppImage for portability or .deb for system install on
                Linux. Windows is a single NSIS installer. All binaries are
                built on CI with pinned Node + Rust.
              </p>
            </div>
            <div className="hidden items-center gap-2 sm:flex">
              <span className="h-2 w-2 rounded-full bg-emerald-500" />
              <span className="font-mono text-xs text-faint">
                {installers.length} files · {version ?? "—"}
              </span>
            </div>
          </div>
        </Reveal>

        <div className="mt-8 grid gap-4 sm:gap-6 lg:grid-cols-3 items-start">
          {/* Windows — compact */}
          <Reveal delay={60} className="min-w-0">
            <article className="group flex flex-col rounded-2xl border border-line bg-surface p-5 shadow-[0_8px_24px_rgba(0,0,0,0.2)] transition-all duration-200 hover:bg-raised sm:p-6">
              <div className="flex items-center justify-between gap-3">
                <PlatformIcon platform="windows" />
                <span className="rounded-full border border-line bg-canvas px-2 py-1 font-mono text-[11px] font-medium text-faint">
                  x64 · NSIS
                </span>
              </div>
              <h3 className="t-h2 mt-3 !text-[22px] sm:!text-[24px]">
                Windows
              </h3>
              <p className="mt-1 font-mono text-xs leading-4 text-faint">
                Windows 10 1809+ · WebView2 auto-installed
              </p>
              {primaryWindows ? (
                <>
                  <div className="mt-4 flex items-center justify-between gap-3 rounded-xl bg-canvas px-3 py-2.5 ring-1 ring-line">
                    <span className="min-w-0 truncate font-mono text-xs font-medium text-ink">
                      {primaryWindows.name
                        .replace("Algorith.Voice_", "")
                        .replace("_x64-setup.exe", ".exe")}
                    </span>
                    <span className="shrink-0 font-mono text-xs text-faint">
                      {formatMB(primaryWindows.size)}
                    </span>
                  </div>
                  <a
                    href={primaryWindows.browser_download_url}
                    className="mt-4 inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-full bg-ink px-6 text-sm font-semibold text-canvas hover:bg-white"
                    download
                  >
                    <svg
                      aria-hidden
                      viewBox="0 0 24 24"
                      fill="none"
                      className="h-4 w-4 shrink-0"
                      stroke="currentColor"
                      strokeWidth="1.8"
                    >
                      <path
                        d="M12 5v10M8 11l4 4 4-4M3 17v2a2 2 0 002 2h14a2 2 0 002-2v-2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                    Download for Windows
                  </a>
                  <details className="mt-3 rounded-xl bg-canvas ring-1 ring-line">
                    <summary className="cursor-pointer list-none px-3 py-2.5 text-center font-mono text-xs text-sub hover:text-ink">
                      Install command
                    </summary>
                    <div className="border-t border-line p-2.5">
                      <code className="block rounded-lg bg-raised px-3 py-2 font-mono text-xs text-sub">
                        winget install Algorith.Voice
                      </code>
                    </div>
                  </details>
                </>
              ) : (
                <div className="mt-4 rounded-xl border border-dashed border-line bg-canvas/50 p-4 text-center">
                  <p className="font-mono text-xs text-faint">
                    No Windows installer in this release
                  </p>
                </div>
              )}
            </article>
          </Reveal>

          {/* Linux — compact, single primary */}
          <Reveal delay={120} className="min-w-0">
            <article className="group flex flex-col rounded-2xl border border-line bg-surface p-5 shadow-[0_8px_24px_rgba(0,0,0,0.2)] transition-all duration-200 hover:bg-raised sm:p-6">
              <div className="flex items-center justify-between gap-3">
                <PlatformIcon platform="linux" />
                <span className="rounded-full border border-line bg-canvas px-2 py-1 font-mono text-[11px] font-medium text-faint">
                  amd64 · portable
                </span>
              </div>
              <h3 className="t-h2 mt-3 !text-[22px] sm:!text-[24px]">Linux</h3>
              <p className="mt-1 font-mono text-xs leading-4 text-faint">
                Ubuntu 22.04+ · Wayland needs ydotool
              </p>
              {linux.length > 0 && primaryLinux ? (
                <>
                  <div className="mt-4 flex items-center justify-between gap-3 rounded-xl bg-canvas px-3 py-2.5 ring-1 ring-line">
                    <span className="min-w-0 truncate font-mono text-xs font-medium text-ink">
                      {primaryLinux.name.replace("Algorith.Voice_", "")}
                    </span>
                    <span className="shrink-0 font-mono text-xs text-faint">
                      {formatMB(primaryLinux.size)}
                    </span>
                  </div>
                  <a
                    href={primaryLinux.browser_download_url}
                    className="mt-4 inline-flex min-h-[44px] w-full items-center justify-center rounded-full bg-ink px-6 text-sm font-semibold text-canvas hover:bg-white"
                    download
                  >
                    Download AppImage
                  </a>
                  {linux.find((a) => /\.deb$/i.test(a.name)) ? (
                    <a
                      href={
                        linux.find((a) => /\.deb$/i.test(a.name))
                          ?.browser_download_url
                      }
                      className="mt-2.5 block text-center font-mono text-xs text-faint underline decoration-line underline-offset-4 hover:text-sub"
                    >
                      .deb ·{" "}
                      {formatMB(
                        linux.find((a) => /\.deb$/i.test(a.name))?.size,
                      )}{" "}
                      — system install
                    </a>
                  ) : null}
                  <details className="mt-3 rounded-xl bg-canvas ring-1 ring-line">
                    <summary className="cursor-pointer list-none px-3 py-2.5 text-center font-mono text-xs text-sub hover:text-ink">
                      Quick run
                    </summary>
                    <div className="border-t border-line p-2.5">
                      <code className="block break-all rounded-lg bg-raised px-3 py-2 font-mono text-xs leading-5 text-sub">
                        chmod +x *.AppImage && ./Algorith*.AppImage
                      </code>
                    </div>
                  </details>
                </>
              ) : (
                <div className="mt-4 rounded-xl border border-dashed border-line bg-canvas/50 p-4 text-center">
                  <p className="font-mono text-xs text-faint">
                    No Linux installers in this release
                  </p>
                </div>
              )}
            </article>
          </Reveal>

          {/* macOS — compact */}
          <Reveal delay={180} className="min-w-0">
            <article className="flex flex-col rounded-2xl border border-line bg-surface p-5 opacity-95 sm:p-6">
              <div className="flex items-center justify-between gap-3">
                <PlatformIcon platform="mac" />
                <span className="rounded-full bg-amber-500/10 px-2.5 py-1 font-mono text-[11px] font-medium text-amber-300 ring-1 ring-amber-500/20">
                  Coming soon
                </span>
              </div>
              <h3 className="t-h2 mt-3 !text-[22px] sm:!text-[24px]">macOS</h3>
              <p className="mt-1 font-mono text-xs leading-4 text-faint">
                macOS 13+ · Swift · separate bundle
              </p>
              <div className="mt-4 rounded-xl border border-dashed border-line bg-canvas/30 px-4 py-6 text-center">
                <p className="font-mono text-xs font-medium text-ink">
                  No download yet
                </p>
                <p className="mx-auto mt-1.5 max-w-[26ch] font-mono text-xs leading-4 text-faint">
                  Swift app in{" "}
                  <code className="rounded bg-raised px-1 py-0.5 text-ink">
                    apps/desktop-swift
                  </code>{" "}
                  — offline-first.
                </p>
                <Link
                  href="/docs#macos"
                  className="mt-3 inline-flex min-h-[36px] items-center justify-center rounded-full border border-line bg-canvas px-4 text-xs font-medium text-ink hover:bg-surface"
                >
                  Read macOS docs
                </Link>
              </div>
              <a
                href={`https://github.com/${repo}/releases`}
                target="_blank"
                rel="noreferrer"
                className="mt-3 block text-center font-mono text-xs text-faint underline decoration-line underline-offset-4 hover:text-sub"
              >
                Releases →
              </a>
            </article>
          </Reveal>
        </div>

        {/* Release notes + system req */}
        <div className="mt-10 grid gap-6 lg:grid-cols-[1.7fr_1fr]">
          <Reveal>
            <section className="rounded-[20px] border border-line bg-surface p-6 sm:p-8">
              <p className="t-cap text-faint">Release notes</p>
              <h3 className="t-h2 mt-2">
                {rel?.name ?? rel?.tag_name ?? "Latest release"}{" "}
                {rel?.prerelease ? (
                  <span className="rounded-full bg-amber-500/15 px-2 py-1 font-mono text-xs text-amber-300">
                    prerelease
                  </span>
                ) : null}
              </h3>
              {rel?.body ? (
                <div className="mt-4 max-h-[320px] overflow-auto rounded-xl border border-line bg-canvas p-4">
                  <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-5 text-sub">
                    {rel.body.slice(0, 4000)}
                  </pre>
                  {rel.body.length > 4000 ? (
                    <p className="mt-3 font-mono text-xs text-faint">
                      … truncated — see GitHub for full notes
                    </p>
                  ) : null}
                </div>
              ) : (
                <p className="t-body mt-3 text-sub">
                  {hasRelease
                    ? "Notes are on GitHub — changelog, checksums, and linked PRs."
                    : "Release notes appear here once a version tag publishes."}
                </p>
              )}
              <div className="mt-6 flex flex-wrap gap-2">
                <a
                  href={rel?.html_url ?? `https://github.com/${repo}/releases`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex min-h-[44px] items-center rounded-full bg-ink px-5 text-sm font-semibold text-canvas hover:bg-white"
                >
                  View on GitHub →
                </a>
                <a
                  href="/docs#linux"
                  className="inline-flex min-h-[44px] items-center rounded-full border border-line bg-canvas px-5 text-sm font-medium text-ink hover:bg-raised"
                >
                  Wayland & ydotool
                </a>
              </div>
            </section>
          </Reveal>

          <Reveal delay={80}>
            <section className="rounded-[20px] border border-line bg-surface p-6 sm:p-8">
              <p className="t-cap text-faint">System requirements</p>
              <h3 className="t-h2 mt-2">Works where you do.</h3>
              <dl className="mt-6 divide-y divide-line rounded-xl border border-line bg-canvas">
                {[
                  { k: "Windows", v: "10 1809+ · x64 · WebView2" },
                  { k: "Linux", v: "Ubuntu 22.04+ · X11 / Wayland + ydotool" },
                  { k: "macOS", v: "13+ · Swift · Universal (soon)" },
                  { k: "Updaters", v: "latest.json + .sig · ed25519" },
                  { k: "Offline", v: "670 MB – 2.4 GB model download once" },
                ].map((r) => (
                  <div
                    key={r.k}
                    className="flex items-center justify-between gap-4 px-4 py-3"
                  >
                    <dt className="font-mono text-xs font-medium uppercase tracking-wide text-faint">
                      {r.k}
                    </dt>
                    <dd className="text-right font-mono text-xs text-ink">
                      {r.v}
                    </dd>
                  </div>
                ))}
              </dl>
              <div className="mt-6 rounded-xl bg-ink p-4 text-canvas">
                <p className="font-mono text-xs font-semibold uppercase tracking-wide opacity-70">
                  Comfort tip
                </p>
                <p className="mt-2 font-mono text-xs leading-5 opacity-80">
                  Pin Algorith Voice to autostart, keep{" "}
                  <code className="rounded bg-white/10 px-1 py-0.5">
                    Ctrl+Space
                  </code>{" "}
                  free, and enable clipboard mode on Wayland — paste feels
                  instant.
                </p>
                <Link
                  href="/docs#troubleshoot"
                  className="mt-3 inline-flex font-mono text-xs font-medium underline underline-offset-4"
                >
                  Troubleshooting →
                </Link>
              </div>
            </section>
          </Reveal>
        </div>

        {/* Bottom CTA */}
        <Reveal className="mt-10">
          <div className="rounded-[20px] border border-line bg-gradient-to-br from-surface via-surface to-raised p-6 sm:p-8">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="t-cap text-faint">Next step</p>
                <h3 className="t-h2 mt-1">Installed? Hold Ctrl+Space.</h3>
                <p className="t-body mt-2 max-w-[56ch] text-sub">
                  Speak anywhere — terminal, IDE, browser. Release to type at
                  the cursor.
                </p>
              </div>
              <div className="flex shrink-0 gap-2">
                <Link
                  href="/docs#quickstart"
                  className="inline-flex min-h-[44px] items-center justify-center rounded-full bg-ink px-6 text-sm font-semibold text-canvas hover:bg-white"
                >
                  Setup guide
                </Link>
                <Link
                  href="/pricing"
                  className="inline-flex min-h-[44px] items-center justify-center rounded-full border border-line bg-canvas px-6 text-sm font-medium text-ink hover:bg-surface"
                >
                  Pricing
                </Link>
              </div>
            </div>
          </div>
        </Reveal>
      </main>

      <SiteFooter />
    </div>
  );
}
