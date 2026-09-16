"use client";
import { useEffect, useState } from "react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";

export default function AdminModelsPage() {
  const [rows, setRows] = useState<Array<{ model: string; requests: number; avgLatencyMs: number; costUsd: number; errorRate: number }>>([]);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    fetch("/api/admin/stats/models")
      .then((r) => (r.ok ? r.json() : Promise.reject(r.statusText)))
      .then((j) => setRows(j.data ?? []))
      .catch((e) => setErr(String(e)));
  }, []);
  if (err) return <p className="text-sm text-red-400">Failed: {err}</p>;
  return (
    <div className="flex flex-col gap-6">
      <h1 className="t-h1">Models</h1>
      <div className="h-[280px] rounded-lg border border-line bg-surface p-4">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="model" />
            <YAxis />
            <Tooltip />
            <Bar dataKey="requests" fill="black" />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="overflow-auto rounded-lg border border-line">
        <table className="w-full text-sm">
          <thead className="bg-surface">
            <tr><th className="p-2 text-left">Model</th><th className="p-2 text-right">Req</th><th className="p-2 text-right">Avg ms</th><th className="p-2 text-right">Cost $</th><th className="p-2 text-right">Err %</th></tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.model} className="border-t border-line">
                <td className="p-2">{r.model}</td><td className="p-2 text-right">{r.requests}</td><td className="p-2 text-right">{r.avgLatencyMs}</td><td className="p-2 text-right">{r.costUsd.toFixed(4)}</td><td className="p-2 text-right">{r.errorRate}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
