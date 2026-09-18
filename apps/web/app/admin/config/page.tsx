"use client";
import { useCallback, useEffect, useState } from "react";

export default function AdminConfigPage() {
  const [configs, setConfigs] = useState<
    Array<{
      modelId: string;
      displayName: string;
      isActive: boolean;
      isFallback: boolean;
    }>
  >([]);
  const [msg, setMsg] = useState<string | null>(null);
  const load = useCallback(
    () =>
      fetch("/api/admin/config/ai-model")
        .then((r) => r.json())
        .then((j) => setConfigs(j.all ?? []))
        .catch(() => {}),
    [],
  );
  useEffect(() => {
    void load();
  }, [load]);
  const setActive = async (modelId: string) => {
    const res = await fetch("/api/admin/config/ai-model", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ activeModelId: modelId }),
    });
    if (res.ok) {
      setMsg(`active → ${modelId}`);
      void load();
    } else setMsg("failed");
  };
  const setFallback = async (modelId: string) => {
    const res = await fetch("/api/admin/config/ai-model", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ fallbackModelId: modelId }),
    });
    if (res.ok) {
      setMsg(`fallback → ${modelId}`);
      void load();
    } else setMsg("failed");
  };
  return (
    <div className="flex flex-col gap-4">
      <h1 className="t-h1">AI Model Config</h1>
      {msg ? <p className="text-sm text-faint">{msg}</p> : null}
      <div className="overflow-auto rounded-lg border border-line">
        <table className="w-full min-w-[560px] text-sm">
          <thead>
            <tr className="bg-surface">
              <th className="whitespace-nowrap p-2 text-left">Model</th>
              <th className="whitespace-nowrap p-2 text-left">Active</th>
              <th className="whitespace-nowrap p-2 text-left">Fallback</th>
              <th className="p-2 text-left">Actions</th>
            </tr>
          </thead>
          <tbody>
            {configs.map((c) => (
              <tr key={c.modelId} className="border-t border-line">
                <td className="p-2">
                  <span className="block">{c.displayName}</span>
                  <span className="block font-mono text-xs break-all text-faint">
                    {c.modelId}
                  </span>
                </td>
                <td className="whitespace-nowrap p-2">
                  {c.isActive ? "✓" : ""}
                </td>
                <td className="whitespace-nowrap p-2">
                  {c.isFallback ? "✓" : ""}
                </td>
                <td className="p-2">
                  <div className="flex min-w-[220px] flex-col gap-2 sm:flex-row">
                    <button
                      type="button"
                      onClick={() => void setActive(c.modelId)}
                      className="inline-flex min-h-[44px] items-center justify-center rounded border px-3 text-xs whitespace-nowrap"
                    >
                      Set active
                    </button>
                    <button
                      type="button"
                      onClick={() => void setFallback(c.modelId)}
                      className="inline-flex min-h-[44px] items-center justify-center rounded border px-3 text-xs whitespace-nowrap"
                    >
                      Set fallback
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="t-cap text-faint">
        Changes apply instantly via Redis 30s cache — no restart.
      </p>
    </div>
  );
}
