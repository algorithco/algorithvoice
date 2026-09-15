import Link from "next/link";

// Minimal footer: single row, wordmark + links + copyright.
// No newsletter box, no social icon soup.
export function SiteFooter() {
  return (
    <footer className="border-t border-gray-200 dark:border-gray-800">
      <div className="mx-auto flex max-w-[1200px] flex-col gap-4 px-6 py-8 sm:flex-row sm:items-center sm:justify-between md:px-16">
        <span className="av-small font-semibold">Algorith Voice</span>
        <nav className="flex gap-6" aria-label="Footer">
          {(
            [
              { href: "/docs", label: "Docs" },
              { href: "/pricing", label: "Pricing" },
              { href: "/design-system", label: "Design system" },
            ] as const
          ).map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="av-small text-gray-500 transition-colors duration-150 ease-app hover:text-black dark:hover:text-white"
            >
              {l.label}
            </Link>
          ))}
        </nav>
        <span className="av-small text-gray-500">© 2026 Algorith Voice</span>
      </div>
    </footer>
  );
}
