import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";

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

// ---- OAuth (system browser + algorithvoice:// deep-link callback) ----

export type OAuthProvider = "google" | "github";

export const OAUTH_PROVIDERS: OAuthProvider[] = ["google", "github"];

export function oauthProviderLabel(provider: OAuthProvider): string {
  return provider === "google" ? "Google" : "GitHub";
}

function oauthStartUrl(provider: OAuthProvider): string {
  const params = new URLSearchParams({
    callback: "algorithvoice://auth-callback",
    device: "Desktop",
  });
  return `${API}/auth/oauth/${provider}/start?${params.toString()}`;
}

function parseOAuthCallbackUrl(raw: string): {
  accessToken: string;
  email: string;
} | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "algorithvoice:") return null;
  const query = new URLSearchParams(url.search);
  // Some platforms deliver deep-link params in the fragment instead.
  if (url.hash.length > 1) {
    const hash = new URLSearchParams(url.hash.slice(1));
    hash.forEach((value, key) => {
      if (!query.has(key)) query.set(key, value);
    });
  }
  const accessToken =
    query.get("accessToken") ?? query.get("access_token") ?? query.get("token");
  const email = query.get("email");
  if (!accessToken || !email) return null;
  return { accessToken, email };
}

/**
 * Sign in with an OAuth provider. Opens the provider flow in the system
 * browser, then completes when the backend redirects to
 * `algorithvoice://auth-callback`, which the Rust shell forwards as an
 * `auth-callback` event. The listener is wired before the browser opens
 * so a fast callback can't slip through the race.
 */
export async function signInWithOAuth(
  provider: OAuthProvider,
): Promise<SessionInfo> {
  const startUrl = oauthStartUrl(provider);
  if (!isTauri()) {
    // Browser preview: the deep-link can't return to this tab.
    window.open(startUrl, "_blank", "noopener");
    throw new Error(
      "OAuth needs the desktop app shell to complete — finish in the opened tab, then sign in here.",
    );
  }
  let resolveSession!: (s: SessionInfo) => void;
  let rejectSession!: (e: Error) => void;
  const completed = new Promise<SessionInfo>((resolve, reject) => {
    resolveSession = resolve;
    rejectSession = reject;
  });
  const unlisten = await listen<string[]>("auth-callback", (event) => {
    for (const raw of event.payload ?? []) {
      const parsed = parseOAuthCallbackUrl(raw);
      if (!parsed) continue;
      void tauri("store_session", {
        accessToken: parsed.accessToken,
        email: parsed.email,
      }).then(
        () => resolveSession({ loggedIn: true, email: parsed.email }),
        () =>
          rejectSession(
            new Error("Signed in, but the session could not be saved."),
          ),
      );
      return;
    }
  });
  try {
    await openUrl(startUrl);
  } catch {
    unlisten();
    throw new Error("Could not open the system browser.");
  }
  try {
    return await completed;
  } finally {
    unlisten();
  }
}
