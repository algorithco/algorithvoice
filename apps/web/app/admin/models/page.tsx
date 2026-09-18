"use client";
import { useEffect, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export default function AdminModelsPage() {
  const [rows, setRows] = useState<
    Array<{
      model: string;
      requests: number;
      avgLatencyMs: number;
      costUsd: number;
      errorRate: number;
    }>
  >([]);
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
      <div className="h-[240px] rounded-lg border border-line bg-surface p-2 sm:h-[280px] sm:p-4">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} margin={{ left: -12, right: 8 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis
              dataKey="model"
              tick={{ fontSize: 11 }}
              interval="preserveStart"
              tickFormatter={(v: string) =>
                v.length > 14 ? `${v.slice(0, 13)}…` : v
              }
            />
            <YAxis tick={{ fontSize: 11 }} width={44} />
            <Tooltip />
            <Bar dataKey="requests" fill="black" />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="overflow-auto rounded-lg border border-line">
        <table className="w-full min-w-[520px] text-sm">
          <thead className="bg-surface">
            <tr>
              <th className="whitespace-nowrap p-2 text-left">Model</th>
              <th className="whitespace-nowrap p-2 text-right">Req</th>
              <th className="whitespace-nowrap p-2 text-right">Avg ms</th>
              <th className="whitespace-nowrap p-2 text-right">Cost $</th>
              <th className="whitespace-nowrap p-2 text-right">Err %</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.model} className="border-t border-line">
                <td
                  className="max-w-[200px] truncate p-2 font-mono text-xs"
                  title={r.model}
                >
                  {r.model}
                </td>
                <td className="whitespace-nowrap p-2 text-right">
                  {r.requests}
                </td>
                <td className="whitespace-nowrap p-2 text-right">
                  {r.avgLatencyMs}
                </td>
                <td className="whitespace-nowrap p-2 text-right">
                  {r.costUsd.toFixed(4)}
                </td>
                <td className="whitespace-nowrap p-2 text-right">
                  {r.errorRate}%
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
