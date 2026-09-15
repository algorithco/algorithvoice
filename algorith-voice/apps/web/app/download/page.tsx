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
    <div className="min-h-screen bg-white text-black dark:bg-black dark:text-white">
      <SiteNav />
      <main className="mx-auto max-w-[1200px] px-6 py-24 md:px-16 md:py-32">
        <h1 className="av-section-h">Download</h1>
        <p className="av-body-lg mt-4 text-gray-500">
          {rel
            ? `Latest release: ${rel.tag_name}`
            : "Releases publish on version tags."}
        </p>
        <ul className="mt-12 divide-y divide-gray-200 border-y border-gray-200 dark:divide-gray-800 dark:border-gray-800">
          {assets.map((a) => (
            <li
              key={a.name}
              className="flex items-center justify-between gap-4 py-4"
            >
              <a href={a.browser_download_url} className="av-mono underline">
                {a.name}
              </a>
              <span className="av-small shrink-0 text-gray-500">
                {(a.size / 1e6).toFixed(1)} MB
              </span>
            </li>
          ))}
          {assets.length === 0 ? (
            <li className="av-body-lg py-8 text-gray-500">
              No installers published yet. First signed builds ship in Phase 5.
            </li>
          ) : null}
        </ul>
        <p className="av-small mt-6 text-gray-500">
          Linux Wayland sessions need an extra setup step — see the docs.
        </p>
      </main>
      <SiteFooter />
    </div>
  );
}
