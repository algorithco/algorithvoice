import { DocsModelLanguages } from "../../components/DocsModelLanguages";
import { Reveal } from "../../components/Reveal";
import { SiteFooter } from "../../components/SiteFooter";
import { SiteNav } from "../../components/SiteNav";

export const metadata = {
  title: "Supported languages — Algorith Voice",
  description:
    "All 6 on-device models and the languages they support — 25 to 99 langs, with flags and full names.",
};

export default function LanguagesPage() {
  return (
    <div className="min-h-screen bg-canvas text-ink">
      <SiteNav />
      <main className="w-full px-4 py-10 sm:px-6 md:px-8 lg:px-8">
        <div className="mx-auto w-full max-w-[1400px]">
          <Reveal>
            <p className="t-cap text-faint">Languages • 6 models • offline</p>
            <h1 className="t-h1 mt-3">Supported languages.</h1>
          </Reveal>

          {/* Responsive language explorer — 1 col on mobile, 2 on md, 3 on xl */}
          <div className="mt-8">
            <DocsModelLanguages />
          </div>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
