import { invoke } from "@tauri-apps/api/core";

const API: string =
  (import.meta.env.VITE_API_URL as string | undefined) ??
  "http://localhost:3001";

export function isTauri(): boolean {
  return "__TAURI_INTERNALS__" in window;
}

async function tauri<T>(
  cmd: string,
  args?: Record<string, unknown>,
  fallback?: T,
): Promise<T> {
  if (!isTauri()) {
    if (fallback !== undefined) return fallback;
    throw new Error("not in Tauri shell");
  }
  return invoke<T>(cmd, args);
}

export interface SessionInfo {
  loggedIn: boolean;
  email?: string | null;
}

interface AuthResponse {
  user: { email: string };
  accessToken: string;
}

export async function sessionStatus(): Promise<SessionInfo> {
  return tauri<SessionInfo>("session_status", undefined, { loggedIn: false });
}

export async function login(
  email: string,
  password: string,
): Promise<SessionInfo> {
  const res = await fetch(`${API}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok)
    throw new Error(
      res.status === 401 ? "Invalid email or password." : "Login failed.",
    );
  const data = (await res.json()) as AuthResponse;
  await tauri("store_session", {
    accessToken: data.accessToken,
    email: data.user.email,
  });
  return { loggedIn: true, email: data.user.email };
}

export async function signup(
  email: string,
  password: string,
  deviceName: string,
): Promise<SessionInfo> {
  const res = await fetch(`${API}/auth/signup`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password, deviceName }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as {
      error?: string;
    } | null;
    throw new Error(
      body?.error === "unique" ? "Account already exists." : "Signup failed.",
    );
  }
  const data = (await res.json()) as AuthResponse;
  await tauri("store_session", {
    accessToken: data.accessToken,
    email: data.user.email,
  });
  return { loggedIn: true, email: data.user.email };
}

export async function logout(): Promise<void> {
  try {
    await fetch(`${API}/auth/logout`, { method: "POST" });
  } catch {
    // Backend logout is best-effort in Phase 1; keyring clear is authoritative.
  }
  await tauri("clear_session");
}

export type TrayState = "idle" | "recording" | "processing";

export async function setTrayState(state: TrayState): Promise<void> {
  try {
    await tauri("set_tray_state", { state });
  } catch {
    // Browser preview: tray doesn't exist.
  }
}

export async function openSettingsWindow(): Promise<void> {
  await tauri("open_settings");
}
