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
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-surface">
              <th className="p-2 text-left">Model</th>
              <th className="p-2 text-left">Active</th>
              <th className="p-2 text-left">Fallback</th>
              <th className="p-2 text-left">Actions</th>
            </tr>
          </thead>
          <tbody>
            {configs.map((c) => (
              <tr key={c.modelId} className="border-t border-line">
                <td className="p-2">
                  {c.displayName}{" "}
                  <span className="text-xs text-faint">({c.modelId})</span>
                </td>
                <td className="p-2">{c.isActive ? "✓" : ""}</td>
                <td className="p-2">{c.isFallback ? "✓" : ""}</td>
                <td className="p-2 flex gap-2">
                  <button
                    type="button"
                    onClick={() => void setActive(c.modelId)}
                    className="rounded border px-2 py-1 text-xs"
                  >
                    Set active
                  </button>
                  <button
                    type="button"
                    onClick={() => void setFallback(c.modelId)}
                    className="rounded border px-2 py-1 text-xs"
                  >
                    Set fallback
                  </button>
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
