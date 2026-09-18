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

interface Overview {
  totalRequests: number;
  failedRequests: number;
  successRate: number;
  avgLatencyMs: number;
  totalCostUsd: number;
}

export default function AdminOverviewPage() {
  const [data, setData] = useState<Overview | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/admin/stats/overview")
      .then((r) => (r.ok ? r.json() : Promise.reject(r.statusText)))
      .then(setData)
      .catch((e) => setErr(String(e)));
  }, []);

  if (err)
    return (
      <p className="text-red-400 text-sm">Failed: {err} (need admin login)</p>
    );
  if (!data) return <p className="text-sm text-faint">Loading…</p>;

  const chartData = [
    { name: "Total", value: data.totalRequests },
    { name: "Failed", value: data.failedRequests },
  ];

  return (
    <div className="flex flex-col gap-6">
      <h1 className="t-h1">Overview — last 7 days</h1>
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <Stat label="Requests" value={String(data.totalRequests)} />
        <Stat label="Success %" value={`${data.successRate}%`} />
        <Stat label="Avg latency" value={`${data.avgLatencyMs} ms`} />
        <Stat label="Cost" value={`$${data.totalCostUsd.toFixed(4)}`} />
      </div>
      <div className="h-[220px] rounded-lg border border-line bg-surface p-2 sm:h-[240px] sm:p-4">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} margin={{ left: -12, right: 8 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="name" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} width={44} />
            <Tooltip />
            <Bar dataKey="value" fill="black" />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-lg border border-line bg-surface p-3 sm:p-4">
      <div className="t-cap truncate text-faint">{label}</div>
      <div className="mt-2 truncate text-xl font-semibold tabular-nums sm:text-2xl">
        {value}
      </div>
    </div>
  );
}
