import Link from "next/link";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-canvas text-ink">
      <nav className="flex gap-4 border-b border-line px-6 py-4 text-sm">
        <span className="font-semibold">Admin</span>
        <Link href={"/admin" as never} className="underline">Overview</Link>
        <Link href={"/admin/models" as never} className="underline">Models</Link>
        <Link href={"/admin/logs" as never} className="underline">Logs</Link>
        <Link href={"/admin/users" as never} className="underline">Users</Link>
        <Link href={"/admin/config" as never} className="underline">Config</Link>
        <Link href="/" className="ml-auto underline">Home</Link>
      </nav>
      <main className="mx-auto max-w-[1100px] p-6">{children}</main>
    </div>
  );
}
