"use client";
import { useEffect, useState } from "react";

export default function AdminLogsPage() {
  const [rows, setRows] = useState<Array<{ id: string; model: string; errorCode: string | null; errorMessage: string | null; createdAt: string }>>([]);
  const [page, setPage] = useState(1);
  const [meta, setMeta] = useState<{ total: number; totalPages: number } | null>(null);
  useEffect(() => {
    fetch(`/api/admin/logs/errors?page=${page}&limit=20`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r.statusText)))
      .then((j) => { setRows(j.data ?? []); setMeta(j.meta); })
      .catch(() => {});
  }, [page]);
  return (
    <div className="flex flex-col gap-4">
      <h1 className="t-h1">Error logs</h1>
      <div className="overflow-auto rounded-lg border border-line">
        <table className="w-full text-sm">
          <thead><tr className="bg-surface"><th className="p-2 text-left">Time</th><th className="p-2 text-left">Model</th><th className="p-2 text-left">Code</th><th className="p-2 text-left">Message</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-line">
                <td className="p-2 text-xs">{new Date(r.createdAt).toLocaleString()}</td><td className="p-2">{r.model}</td><td className="p-2">{r.errorCode ?? "-"}</td><td className="p-2 max-w-[320px] truncate">{r.errorMessage ?? "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex gap-2">
        <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="rounded border px-3 py-1 text-sm disabled:opacity-50">Prev</button>
        <span className="py-1 text-sm">{meta ? `page ${page} / ${meta.totalPages} (${meta.total})` : ""}</span>
        <button disabled={meta ? page >= meta.totalPages : false} onClick={() => setPage((p) => p + 1)} className="rounded border px-3 py-1 text-sm disabled:opacity-50">Next</button>
      </div>
    </div>
  );
}
