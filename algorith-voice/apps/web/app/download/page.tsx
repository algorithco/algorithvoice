async function getLatest() {
  try {
    const repo =
      process.env.NEXT_PUBLIC_GITHUB_REPO ?? "algorithco/algorithvoice";
    const res = await fetch(
      `https://api.github.com/repos/${repo}/releases/latest`,
      {
        next: { revalidate: 3600 },
      },
    );
    if (!res.ok) return null;
    return (await res.json()) as {
      tag_name: string;
      assets: { name: string; browser_download_url: string; size: number }[];
    };
  } catch {
    return null;
  }
}

export default async function DownloadPage() {
  const rel = await getLatest();
  return (
    <main className="mx-auto max-w-5xl p-6">
      <h1 className="text-3xl font-semibold">Download</h1>
      <p className="mt-2 text-sm opacity-60">
        {rel
          ? `Latest: ${rel.tag_name}`
          : "Releases publish on tags (Phase 5)."}
      </p>
      <ul className="mt-6 space-y-2">
        {(rel?.assets ?? [])
          .filter((a) => /\.(dmg|msi|AppImage|deb)$/.test(a.name))
          .map((a) => (
            <li key={a.name} className="border rounded-[4px] p-3 text-sm">
              <a href={a.browser_download_url} className="underline">
                {a.name}
              </a>{" "}
              <span className="opacity-60">
                ({(a.size / 1e6).toFixed(1)} MB)
              </span>
            </li>
          ))}
      </ul>
      <p className="mt-6 text-xs opacity-60">
        Linux Wayland users: extra ydotool setup required — see Docs.
      </p>
    </main>
  );
}
