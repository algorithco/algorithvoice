import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useState } from "react";
import { API_URL as API } from "./endpoints.js";
import { isTauri } from "./session/env.js";

export { APP_URL } from "./endpoints.js";

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

function unavailableFrom(error: unknown): DesktopEntitlement {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "object" &&
          error !== null &&
          "message" in error &&
          typeof error.message === "string"
        ? error.message
        : typeof error === "string"
          ? error
          : "Subscription check failed.";
  return { ...UNAVAILABLE, reason: message };
}

export async function getDesktopEntitlement(
  force = false,
): Promise<DesktopEntitlement> {
  if (!isTauri()) return UNAVAILABLE;
  return invoke<DesktopEntitlement>("license_status", {
    apiUrl: API,
    force,
  }).catch(unavailableFrom);
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
