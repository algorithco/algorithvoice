"use client";

import { useEffect, useMemo, useState } from "react";

type Asset = {
  name: string;
  browser_download_url: string;
  size: number;
};

type Props = {
  assets: Asset[];
  tag: string | null;
  publishedAt: string | null;
};

function formatMB(bytes: number) {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function detectOS(): "windows" | "linux" | "mac" | "unknown" {
  if (typeof navigator === "undefined") return "unknown";
  const ua = navigator.userAgent.toLowerCase();
  const platform = (navigator as unknown as { userAgentData?: { platform: string } }).userAgentData?.platform?.toLowerCase() ?? "";
  if (ua.includes("win") || platform.includes("win")) return "windows";
  if (ua.includes("mac") || platform.includes("mac")) return "mac";
  if (ua.includes("linux") || platform.includes("linux")) return "linux";
  return "unknown";
}

function pickForOS(assets: Asset[], os: string) {
  if (os === "windows") {
    return assets.find((a) => /\.exe$/i.test(a.name)) ?? assets.find((a) => /\.msi$/i.test(a.name)) ?? null;
  }
  if (os === "linux") {
    return assets.find((a) => /\.AppImage$/i.test(a.name)) ?? assets.find((a) => /\.deb$/i.test(a.name)) ?? null;
  }
  if (os === "mac") {
    return assets.find((a) => /\.dmg$/i.test(a.name)) ?? null;
  }
  return null;
}

export default function DownloadInteractive({ assets, tag, publishedAt }: Props) {
  const [os, setOs] = useState<"windows" | "linux" | "mac" | "unknown">("unknown");
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    setOs(detectOS());
  }, []);

  const primary = useMemo(() => pickForOS(assets, os), [assets, os]);

  const label =
    os === "windows" ? "Windows" : os === "linux" ? "Linux" : os === "mac" ? "macOS" : "your OS";

  if (assets.length === 0) return null;

  return (
    <div className="mx-auto mt-10 max-w-[1200px]">
      {/* Auto-detected pill */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-2 rounded-full border border-line bg-raised px-3 py-1.5">
          <span className="h-2 w-2 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.6)]" aria-hidden />
          <span className="font-mono text-xs font-medium tracking-wide text-ink">
            Detected: <span className="text-ink">{label}</span>
          </span>
          {tag ? <span className="hidden text-xs text-faint sm:inline">· {tag}</span> : null}
          {publishedAt ? (
            <span className="hidden text-xs text-faint sm:inline">
              · {new Date(publishedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
            </span>
          ) : null}
        </span>
        <span className="t-cap text-faint">We picked the best installer for you</span>
      </div>

      {/* Primary download */}
      {primary ? (
        <div className="mt-6 rounded-[24px] border border-line bg-gradient-to-b from-surface to-raised p-6 shadow-[0_12px_40px_rgba(0,0,0,0.45),0_1px_2px_rgba(255,255,255,0.06)_inset] sm:p-8">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
            <div className="min-w-0">
              <p className="t-cap text-faint">Recommended for {label}</p>
              <h2 className="mt-2 flex flex-wrap items-center gap-3 font-mono text-lg font-semibold tracking-tight text-ink sm:text-xl">
                <span className="truncate">{primary.name}</span>
                <span className="rounded-full border border-line bg-canvas px-2.5 py-1 text-xs font-medium text-sub">
                  {formatMB(primary.size)}
                </span>
              </h2>
              <p className="t-body mt-3 max-w-[56ch] text-sub">
                {os === "windows"
                  ? "NSIS installer — WebView2 installs automatically if missing. No admin needed."
                  : os === "linux"
                    ? "AppImage is portable (chmod +x && run). .deb also available below."
                    : os === "mac"
                      ? "Universal .dmg — native Swift app for macOS 13+."
                      : "Optimized installer for your system."}
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                {os === "linux" ? (
                  <code className="rounded-lg border border-line bg-canvas px-3 py-2 font-mono text-xs text-sub">
                    chmod +x {primary.name} && ./{primary.name}
                  </code>
                ) : null}
                {os === "windows" ? (
                  <code className="rounded-lg border border-line bg-canvas px-3 py-2 font-mono text-xs text-sub">
                    winget install Algorith.Voice
                  </code>
                ) : null}
              </div>
            </div>
            <div className="flex shrink-0 flex-col gap-3 lg:items-end">
              <a
                href={primary.browser_download_url}
                className="group inline-flex min-h-[52px] items-center justify-center gap-2 rounded-full bg-ink px-8 text-[15px] font-semibold text-canvas shadow-[0_8px_24px_rgba(255,255,255,0.12)] transition-all duration-200 hover:translate-y-[-1px] hover:bg-white hover:shadow-[0_12px_32px_rgba(255,255,255,0.18)] active:translate-y-px"
                download
              >
                <svg aria-hidden viewBox="0 0 24 24" fill="none" className="h-5 w-5 shrink-0" stroke="currentColor" strokeWidth="1.8">
                  <path d="M12 3v14" strokeLinecap="round" />
                  <path d="M7 12l5 5 5-5" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2" strokeLinecap="round" />
                </svg>
                Download for {label}
              </a>
              <span className="text-center font-mono text-xs text-faint">
                {formatMB(primary.size)} ·{" "}
                {os === "windows" ? "Windows 10 1809+" : os === "linux" ? "Ubuntu 22.04+ · x64" : "macOS 13+ · Universal"}
              </span>
              <button
                type="button"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(primary.browser_download_url);
                    setCopied("primary");
                    setTimeout(() => setCopied(null), 1500);
                  } catch {}
                }}
                className="font-mono text-xs text-sub underline decoration-line underline-offset-4 hover:text-ink"
              >
                {copied === "primary" ? "Copied link ✓" : "Copy direct link"}
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="mt-6 rounded-2xl border border-dashed border-line bg-surface/50 p-6 text-center">
          <p className="t-body text-sub">
            No auto-matched installer for <span className="font-medium text-ink">{label}</span> — pick manually below.
          </p>
        </div>
      )}

      {/* Quick switcher */}
      <div className="mt-4 flex flex-wrap gap-2">
        {(["windows", "linux", "mac"] as const).map((o) => {
          const isActive = o === os;
          const name = o === "windows" ? "Windows" : o === "linux" ? "Linux" : "macOS";
          return (
            <button
              key={o}
              type="button"
              onClick={() => setOs(o as never)}
              className={[
                "rounded-full border px-4 py-2 font-mono text-xs font-medium transition-colors",
                isActive
                  ? "border-ink bg-ink text-canvas"
                  : "border-line bg-surface text-sub hover:border-sub hover:text-ink",
              ].join(" ")}
              aria-pressed={isActive}
            >
              {name}
            </button>
          );
        })}
        <a href="#all-downloads" className="rounded-full border border-line bg-surface px-4 py-2 font-mono text-xs font-medium text-sub hover:text-ink">
          View all →
        </a>
      </div>
    </div>
  );
}
