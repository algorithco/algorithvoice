"use client";

import { useEffect, useState } from "react";

type OS = "macOS" | "Windows" | "Linux";

// OS-aware primary CTA. Secondary link goes to GitHub (external → arrow earned).
export function DownloadButtons() {
  const [os, setOs] = useState<OS>("macOS");

  useEffect(() => {
    const platform =
      (navigator as Navigator & { userAgentData?: { platform: string } })
        .userAgentData?.platform ?? navigator.platform;
    if (/win/i.test(platform)) setOs("Windows");
    else if (/linux/i.test(platform)) setOs("Linux");
    else setOs("macOS");
  }, []);

  return (
    <div className="flex flex-col gap-3 sm:flex-row">
      <a
        href="/download"
        className="av-body rounded-control bg-black px-4 py-2.5 text-center text-white transition-opacity duration-150 ease-app hover:opacity-85 dark:bg-white dark:text-black"
      >
        Download for {os}
      </a>
      <a
        href="https://github.com/algorithco/algorithvoice"
        target="_blank"
        rel="noreferrer"
        className="av-body rounded-control border border-gray-200 px-4 py-2.5 text-center transition-colors duration-150 ease-app hover:bg-gray-200 dark:border-gray-800 dark:hover:bg-gray-800"
      >
        View on GitHub →
      </a>
    </div>
  );
}
