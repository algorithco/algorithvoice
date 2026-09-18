import Link from "next/link";

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-canvas text-ink">
      <nav
        aria-label="Admin"
        className="flex gap-1 overflow-x-auto border-b border-line px-4 py-2 text-sm sm:gap-2 sm:px-6"
      >
        <span className="inline-flex min-h-[44px] shrink-0 items-center px-2 font-semibold">
          Admin
        </span>
        <Link
          href={"/admin" as never}
          className="inline-flex min-h-[44px] shrink-0 items-center whitespace-nowrap px-2 underline"
        >
          Overview
        </Link>
        <Link
          href={"/admin/models" as never}
          className="inline-flex min-h-[44px] shrink-0 items-center whitespace-nowrap px-2 underline"
        >
          Models
        </Link>
        <Link
          href={"/admin/logs" as never}
          className="inline-flex min-h-[44px] shrink-0 items-center whitespace-nowrap px-2 underline"
        >
          Logs
        </Link>
        <Link
          href={"/admin/users" as never}
          className="inline-flex min-h-[44px] shrink-0 items-center whitespace-nowrap px-2 underline"
        >
          Users
        </Link>
        <Link
          href={"/admin/config" as never}
          className="inline-flex min-h-[44px] shrink-0 items-center whitespace-nowrap px-2 underline"
        >
          Config
        </Link>
        <Link
          href="/"
          className="inline-flex min-h-[44px] shrink-0 items-center whitespace-nowrap px-2 underline sm:ml-auto"
        >
          Home
        </Link>
      </nav>
      <main className="mx-auto max-w-[1100px] p-4 sm:p-6">{children}</main>
    </div>
  );
}
