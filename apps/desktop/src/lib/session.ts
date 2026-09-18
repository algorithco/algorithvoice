import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";

const API: string =
  (import.meta.env.VITE_API_URL as string | undefined) ??
  (import.meta.env.DEV
    ? "http://localhost:3001"
    : "https://api.algorithvoice.com");

export function isTauri(): boolean {
  // Tauri 2 recommends checking __TAURI__; __TAURI_INTERNALS__ may not be
  // present in secondary webviews until IPC handshake completes.
  return (
    typeof window !== "undefined" &&
    ("__TAURI__" in window || "__TAURI_INTERNALS__" in window)
  );
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
  const stored = await tauri<SessionInfo>("session_status", undefined, {
    loggedIn: false,
  });
  if (stored.loggedIn) return stored;
  // Demo localStorage bypass was reachable from any XSS — only allow it in
  // browser preview (isTauri() === false). In the desktop shell the keyring
  // is the single source of truth.
  if (!isTauri()) {
    return readDemoSession() ?? { loggedIn: false };
  }
  return { loggedIn: false };
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs = 10000,
): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    return res;
  } finally {
    clearTimeout(id);
  }
}

function isAllowedOpenUrl(url: string): boolean {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    // Allow http localhost only in DEV (Vite + local API)
    const isLoopback =
      host === "localhost" || host === "127.0.0.1" || host === "::1";
    if (isLoopback) {
      if (
        import.meta.env.DEV &&
        (u.protocol === "http:" || u.protocol === "https:")
      )
        return true;
      return false;
    }
    if (u.protocol !== "https:") return false;
    const allowed = ["api.algorithvoice.com", "github.com", "huggingface.co"];
    if (allowed.some((h) => host === h || host.endsWith(`.${h}`))) return true;
    return false;
  } catch {
    return false;
  }
}

async function safeOpenUrl(url: string): Promise<void> {
  if (!isAllowedOpenUrl(url)) {
    throw new Error("Blocked opening untrusted URL");
  }
  await openUrl(url);
}

export async function login(
  email: string,
  password: string,
): Promise<SessionInfo> {
  const res = await fetchWithTimeout(`${API}/auth/login`, {
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
  const res = await fetchWithTimeout(`${API}/auth/signup`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password, deviceName }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as {
      error?: string;
    } | null;
    const err = body?.error;
    if (err === "email_taken" || err === "conflict" || err === "unique") {
      throw new Error("That email is already registered.");
    }
    if (err === "validation_error")
      throw new Error("Check your email and password (12+ characters).");
    throw new Error(err ?? "Signup failed.");
  }
  const data = (await res.json()) as AuthResponse;
  await tauri("store_session", {
    accessToken: data.accessToken,
    email: data.user.email,
  });
  return { loggedIn: true, email: data.user.email };
}

export async function logout(): Promise<void> {
  clearDemoSession();
  try {
    localStorage.removeItem("algorith-voice-history");
    localStorage.removeItem("algorith-voice-last-transcript");
  } catch {}
  try {
    await fetchWithTimeout(`${API}/auth/logout`, { method: "POST" }, 5000);
  } catch {
    // Backend logout is best-effort in Phase 1; keyring clear is authoritative.
  }
  await tauri("clear_session");
}

// ---- Local demo account (no backend) ----

export const DEMO_EMAIL = "demo@algorithvoice.local";
const DEMO_TOKEN = "demo-local-no-backend";
const DEMO_KEY = "algorith-voice-demo-session";

function readDemoSession(): SessionInfo | null {
  try {
    return localStorage.getItem(DEMO_KEY) === DEMO_EMAIL
      ? { loggedIn: true, email: DEMO_EMAIL }
      : null;
  } catch {
    return null;
  }
}

function clearDemoSession(): void {
  try {
    localStorage.removeItem(DEMO_KEY);
  } catch {
    // Storage unavailable.
  }
}

/**
 * Sign in with the built-in demo account. Fully local — never touches the
 * backend. The session is stored in the OS keyring like a real login (with a
 * localStorage mirror for browser preview), so it survives restarts and
 * clears on logout.
 */
export async function loginDemo(): Promise<SessionInfo> {
  const session: SessionInfo = { loggedIn: true, email: DEMO_EMAIL };
  try {
    await tauri("store_session", {
      accessToken: DEMO_TOKEN,
      email: DEMO_EMAIL,
    });
  } catch {
    // Browser preview or keyring unavailable — mirror below covers it.
  }
  try {
    localStorage.setItem(DEMO_KEY, DEMO_EMAIL);
  } catch {
    // Storage unavailable.
  }
  return session;
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

function oauthStartUrl(provider: OAuthProvider, state?: string): string {
  const params = new URLSearchParams({
    callback: "algorithvoice://auth-callback",
    device: "Desktop",
  });
  if (state) params.set("state", state);
  return `${API}/auth/oauth/${provider}/start?${params.toString()}`;
}

// ---- First-party desktop OAuth (authorization_code + PKCE S256) ----

const REDIRECT_URI = "algorithvoice://auth-callback";
const DESKTOP_CLIENT_ID = "desktop-app";

function randomBase64Url(bytes: number): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  let s = "";
  for (const b of buf) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function pkceChallenge(verifier: string): Promise<string> {
  const data = new TextEncoder().encode(verifier);
  const digest = await crypto.subtle.digest("SHA-256", data);
  const bytes = new Uint8Array(digest);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function parseOAuthCodeCallback(raw: string): {
  code?: string;
  state?: string;
  error?: string;
} | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "algorithvoice:") return null;
  if ((url.host || "").toLowerCase() !== "auth-callback") return null;
  if (url.username || url.password) return null;
  const query = new URLSearchParams(url.search);
  if (url.hash.length > 1) {
    const hash = new URLSearchParams(url.hash.slice(1));
    hash.forEach((value, key) => {
      if (!query.has(key)) query.set(key, value);
    });
  }
  const error = query.get("error");
  if (error) return { error };
  const code = query.get("code") ?? undefined;
  const state = query.get("state") ?? undefined;
  if (!code) return null;
  return { code, state };
}

async function exchangeOAuthCode(
  code: string,
  codeVerifier: string,
  redirectUri: string,
): Promise<{ accessToken: string; refreshToken?: string }> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: DESKTOP_CLIENT_ID,
    code,
    redirect_uri: redirectUri,
    code_verifier: codeVerifier,
  });
  const res = await fetchWithTimeout(
    `${API}/oauth2/token`,
    {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    },
    15000,
  );
  const data = (await res.json().catch(() => ({}))) as {
    access_token?: string;
    refresh_token?: string;
    error?: string;
    error_description?: string;
  };
  if (!res.ok || !data.access_token) {
    throw new Error(
      data.error_description ?? data.error ?? "OAuth exchange failed.",
    );
  }
  return { accessToken: data.access_token, refreshToken: data.refresh_token };
}

async function fetchEmailForAccessToken(
  accessToken: string,
): Promise<string | null> {
  try {
    const res = await fetchWithTimeout(
      `${API}/auth/me`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      },
      10000,
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { email?: string };
    return data.email ?? null;
  } catch {
    return null;
  }
}

/**
 * First-party desktop sign-in. Generates a PKCE pair, opens the system
 * browser to the web consent page, and completes when the backend redirects
 * to `algorithvoice://auth-callback?code=&state=`. The code is exchanged
 * server-side via `/oauth2/token`; rotating refresh tokens are stored in
 * the OS keyring alongside the access token.
 */
export async function signInDesktop(): Promise<SessionInfo> {
  if (!isTauri()) {
    window.open(`${API}/oauth2/authorize`, "_blank", "noopener");
    throw new Error("Desktop sign-in needs the desktop app shell.");
  }
  const verifier = randomBase64Url(32);
  const challenge = await pkceChallenge(verifier);
  const state = randomBase64Url(16);
  const params = new URLSearchParams({
    response_type: "code",
    client_id: DESKTOP_CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    code_challenge: challenge,
    code_challenge_method: "S256",
    state,
    scope: "email offline_access",
  });
  const authorizeUrl = `${API}/oauth2/authorize?${params.toString()}`;

  let resolveSession!: (s: SessionInfo) => void;
  let rejectSession!: (e: Error) => void;
  const completed = new Promise<SessionInfo>((resolve, reject) => {
    resolveSession = resolve;
    rejectSession = reject;
  });
  const unlisten = await listen<string[]>("auth-callback", (event) => {
    for (const raw of event.payload ?? []) {
      const parsed = parseOAuthCodeCallback(raw);
      if (!parsed) continue;
      if (parsed.error) {
        rejectSession(new Error(parsed.error));
        return;
      }
      if (parsed.state !== state) {
        rejectSession(new Error("State mismatch — please try again."));
        return;
      }
      if (!parsed.code) continue;
      void exchangeOAuthCode(parsed.code, verifier, REDIRECT_URI)
        .then(async ({ accessToken, refreshToken }) => {
          const email = (await fetchEmailForAccessToken(accessToken)) ?? "";
          if (!email)
            throw new Error("Signed in, but could not fetch profile.");
          await tauri("store_session", {
            accessToken,
            email,
            refreshToken: refreshToken ?? null,
          });
          resolveSession({ loggedIn: true, email });
        })
        .catch((e: unknown) => {
          rejectSession(e instanceof Error ? e : new Error(String(e)));
        });
      return;
    }
  });
  try {
    await safeOpenUrl(authorizeUrl);
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

function parseOAuthCallbackUrl(
  raw: string,
  expectedState?: string,
): {
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
  if ((url.host || "").toLowerCase() !== "auth-callback") return null;
  if (url.username || url.password) return null;
  const query = new URLSearchParams(url.search);
  // Some platforms deliver deep-link params in the fragment instead.
  if (url.hash.length > 1) {
    const hash = new URLSearchParams(url.hash.slice(1));
    hash.forEach((value, key) => {
      if (!query.has(key)) query.set(key, value);
    });
  }
  // State binding for the legacy OAuth flow (prevents session fixation)
  if (expectedState !== undefined) {
    const got = query.get("state");
    if (got !== expectedState) return null;
  }
  // Surface backend errors as readable messages so the Promise can reject
  // instead of hanging forever when OAuth is not configured.
  const error = query.get("error");
  if (error) {
    if (error === "oauth_not_configured") {
      throw new Error(
        "Google/GitHub sign-in is not configured on this server. Use email sign-in or contact support.",
      );
    }
    if (error === "not_implemented") {
      throw new Error(
        "Google/GitHub sign-in is coming soon — please use email sign-in for now.",
      );
    }
    throw new Error(error);
  }
  const accessToken =
    query.get("accessToken") ?? query.get("access_token") ?? query.get("token");
  const email = query.get("email");
  if (!accessToken || !email) return null;
  // Basic email sanity (full validation happens server-side)
  if (email.length > 320 || !email.includes("@")) return null;
  if (accessToken.length > 16384) return null;
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
  const state = randomBase64Url(16);
  const startUrl = oauthStartUrl(provider, state);
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
      try {
        const parsed = parseOAuthCallbackUrl(raw, state);
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
      } catch (e) {
        rejectSession(e instanceof Error ? e : new Error(String(e)));
        return;
      }
    }
  });
  // Auto-reject if no valid callback within 5 minutes (prevents hanging)
  const timeout = window.setTimeout(() => {
    rejectSession(new Error("OAuth timed out — please try again."));
  }, 300_000);
  try {
    await safeOpenUrl(startUrl);
  } catch {
    clearTimeout(timeout);
    unlisten();
    throw new Error("Could not open the system browser.");
  }
  try {
    return await completed;
  } finally {
    clearTimeout(timeout);
    unlisten();
  }
}
