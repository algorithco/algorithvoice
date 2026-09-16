"use client";
import { useEffect, useState } from "react";

export default function AdminUsersPage() {
  const [rows, setRows] = useState<Array<{ id: string; email: string; role: string; planTier: string; createdAt: string }>>([]);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  useEffect(() => {
    const q = new URLSearchParams({ page: String(page), limit: "20", ...(search ? { search } : {}) });
    fetch(`/api/admin/users?${q.toString()}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r.statusText)))
      .then((j) => setRows(j.data ?? []))
      .catch(() => {});
  }, [page, search]);
  return (
    <div className="flex flex-col gap-4">
      <h1 className="t-h1">Users</h1>
      <input placeholder="search email or name" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} className="w-full max-w-sm rounded border border-line px-3 py-2 text-sm" />
      <div className="overflow-auto rounded-lg border border-line">
        <table className="w-full text-sm">
          <thead><tr className="bg-surface"><th className="p-2 text-left">Email</th><th className="p-2 text-left">Role</th><th className="p-2 text-left">Plan</th><th className="p-2 text-left">Created</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-line"><td className="p-2">{r.email}</td><td className="p-2">{r.role}</td><td className="p-2">{r.planTier}</td><td className="p-2 text-xs">{new Date(r.createdAt).toLocaleDateString()}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex gap-2">
        <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="rounded border px-3 py-1 text-sm disabled:opacity-50">Prev</button>
        <button onClick={() => setPage((p) => p + 1)} className="rounded border px-3 py-1 text-sm">Next</button>
      </div>
    </div>
  );
}
