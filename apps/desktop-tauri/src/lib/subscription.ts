import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useState } from "react";
import { isTauri } from "./session/env.js";

const API =
  (import.meta.env.VITE_API_URL as string | undefined) ??
  (import.meta.env.DEV ? "http://localhost:3001" : "https://api.trqsh.uz");

export const APP_URL =
  (import.meta.env.VITE_APP_URL as string | undefined) ??
  (import.meta.env.DEV ? "http://localhost:3000" : "https://app.trqsh.uz");

export interface DesktopEntitlement {
  valid: boolean;
  status: string;
  planTier: "free" | "pro";
  currentPeriodEnd: string | null;
  reason: string | null;
}

const UNAVAILABLE: DesktopEntitlement = {
  valid: false,
  status: "unavailable",
  planTier: "free",
  currentPeriodEnd: null,
  reason: "Subscription could not be verified.",
};

export async function getDesktopEntitlement(
  force = false,
): Promise<DesktopEntitlement> {
  if (!isTauri()) return UNAVAILABLE;
  try {
    return await invoke<DesktopEntitlement>("license_status", {
      apiUrl: API,
      api_url: API,
      force,
    });
  } catch (error) {
    return {
      ...UNAVAILABLE,
      reason:
        error instanceof Error ? error.message : "Subscription check failed.",
    };
  }
}

export function useDesktopEntitlement(enabled: boolean) {
  const [entitlement, setEntitlement] = useState<DesktopEntitlement | null>(
    null,
  );
  const [refreshing, setRefreshing] = useState(false);

  const refresh = useCallback(
    async (force = true) => {
      if (!enabled) {
        setEntitlement(null);
        return;
      }
      setRefreshing(true);
      try {
        setEntitlement(await getDesktopEntitlement(force));
      } finally {
        setRefreshing(false);
      }
    },
    [enabled],
  );

  useEffect(() => {
    if (!enabled) {
      setEntitlement(null);
      return;
    }
    void refresh(false);
    const timer = window.setInterval(() => void refresh(false), 60_000);
    const onFocus = () => void refresh(false);
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [enabled, refresh]);

  return { entitlement, refreshing, refresh };
}
