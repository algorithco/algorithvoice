import { Reveal } from "../../components/Reveal";
import { SiteFooter } from "../../components/SiteFooter";
import { SiteNav } from "../../components/SiteNav";

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
  const assets = (rel?.assets ?? []).filter((a) =>
    /\.(dmg|msi|AppImage|deb)$/.test(a.name),
  );
  return (
    <div className="min-h-screen bg-canvas text-ink">
      <SiteNav />
      <main className="mx-auto max-w-[1200px] px-6 py-24 md:px-16 md:py-32">
        <Reveal>
          <p className="t-cap text-faint">Download</p>
          <h1 className="t-h1 mt-4">Get Algorith Voice.</h1>
          <p className="t-cap mt-4 text-faint">
            {rel
              ? `Latest release · ${rel.tag_name}`
              : "Releases publish on version tags"}
          </p>
        </Reveal>
        <Reveal className="mt-12">
          <ul className="divide-y divide-line rounded-lg border border-line bg-surface">
            {assets.map((a) => (
              <li
                key={a.name}
                className="flex items-center justify-between gap-4 p-4"
              >
                <a
                  href={a.browser_download_url}
                  className="font-mono text-sm leading-6 font-medium underline"
                >
                  {a.name}
                </a>
                <span className="t-cap shrink-0 text-faint">
                  {(a.size / 1e6).toFixed(1)} MB
                </span>
              </li>
            ))}
            {assets.length === 0 ? (
              <li className="t-body p-8 text-sub">
                No installers published yet. First signed builds ship in Phase
                5.
              </li>
            ) : null}
          </ul>
        </Reveal>
        <p className="t-cap mt-8 text-faint">
          Linux Wayland needs ydotool — see the docs
        </p>
      </main>
      <SiteFooter />
    </div>
  );
}
