import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "./session/env.js";

export interface FrontendErrorPayload {
  kind: string;
  message: string;
  stack?: string;
  url?: string;
}

function stashLocal(payload: FrontendErrorPayload): void {
  try {
    const raw = localStorage.getItem("algorith-voice-error-log");
    const arr = raw ? (JSON.parse(raw) as unknown[]) : [];
    arr.unshift({ ...payload, at: new Date().toISOString() });
    localStorage.setItem(
      "algorith-voice-error-log",
      JSON.stringify(arr.slice(0, 50)),
    );
  } catch {
    // ignore
  }
}

export async function reportFrontendError(
  payload: FrontendErrorPayload,
): Promise<void> {
  if (!isTauri()) {
    stashLocal(payload);
    return;
  }
  try {
    await invoke("log_frontend_error", {
      kind: payload.kind,
      message: payload.message.slice(0, 2000),
      stack: payload.stack?.slice(0, 8000) ?? null,
      url: payload.url ?? null,
    });
  } catch {
    stashLocal(payload);
  }
}

export function installGlobalErrorHandlers(): () => void {
  if (typeof window === "undefined") return () => {};
  const onError = (event: ErrorEvent) => {
    void reportFrontendError({
      kind: "window.onerror",
      message: String(event.message ?? "unknown error").slice(0, 2000),
      stack:
        typeof event.error === "object" && event.error
          ? String((event.error as Error).stack ?? "").slice(0, 8000)
          : undefined,
      url: window.location.href,
    });
  };
  const onRejection = (event: PromiseRejectionEvent) => {
    const reason = event.reason as unknown;
    void reportFrontendError({
      kind: "unhandledrejection",
      message:
        reason instanceof Error
          ? reason.message.slice(0, 2000)
          : String(reason).slice(0, 2000),
      stack: reason instanceof Error ? reason.stack?.slice(0, 8000) : undefined,
      url: window.location.href,
    });
  };
  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onRejection);
  return () => {
    window.removeEventListener("error", onError);
    window.removeEventListener("unhandledrejection", onRejection);
  };
}
