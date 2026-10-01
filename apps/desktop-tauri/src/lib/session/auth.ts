import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { API_URL as API } from "../endpoints.js";
import { isTauri } from "./env.js";
import type { AuthResponse, SessionInfo } from "./types.js";
import { safeOpenUrl } from "./url-safety.js";

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

export async function sessionStatus(): Promise<SessionInfo> {
  const stored = await tauri<SessionInfo>("session_status", undefined, {
    loggedIn: false,
  });
  if (stored.loggedIn) return stored;
  // Browser preview has no keyring: without a stored desktop session the
  // user is signed out (sign in via the backend).
  return { loggedIn: false };
}

export async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs = 10000,
  externalSignal?: AbortSignal,
): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  const onExternalAbort = () => controller.abort(externalSignal?.reason);
  if (externalSignal?.aborted) onExternalAbort();
  else
    externalSignal?.addEventListener("abort", onExternalAbort, {
      once: true,
    });
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    return res;
  } finally {
    clearTimeout(id);
    externalSignal?.removeEventListener("abort", onExternalAbort);
  }
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
    // Persist refresh for future rotation/revocation; older keyring entries
    // without it keep working (access-only, 15m).
    refreshToken: data.refreshToken ?? null,
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
    refreshToken: data.refreshToken ?? null,
  });
  return { loggedIn: true, email: data.user.email };
}

export async function logout(): Promise<void> {
  try {
    localStorage.removeItem("algorith-voice-history");
    localStorage.removeItem("algorith-voice-last-transcript");
  } catch {}
  if (!isTauri()) return;
  // Rust reads and revokes the keyring tokens, then clears them even offline.
  await tauri("revoke_and_clear_session", { apiBase: API });
}

// ---- First-party desktop OAuth (authorization_code + PKCE S256) ----

// `algorithvoice` is the protocol registered by released Windows installers.
// Keep accepting the reverse-domain alias, but do not select it until every
// supported installer registers it reliably.
const PREFERRED_REDIRECT_URI = "algorithvoice://auth-callback";
const ALTERNATE_REDIRECT_URI = "com.algorithvoice.app://oauth-callback";
const DESKTOP_CLIENT_ID = "desktop-app";
// Matches backend REQUEST_TTL_SEC (300s): the pending browser request never
// outlives the desktop listener, and Cancel/close deletes it immediately via
// POST /oauth2/cancel so neither side waits the full window.
const DESKTOP_AUTH_TIMEOUT_MS = 300_000;
const CALLBACK_CODE_RE = /^[A-Za-z0-9_-]{43,256}$/;
const CALLBACK_STATE_RE = /^[A-Za-z0-9_-]{22,128}$/;
const OAUTH_ERROR_RE = /^[A-Za-z0-9_]{1,64}$/;

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

async function resolveDesktopRedirectUri(
  signal?: AbortSignal,
): Promise<string> {
  try {
    const response = await fetchWithTimeout(
      `${API}/oauth2/metadata`,
      { headers: { accept: "application/json" } },
      3000,
      signal,
    );
    if (!response.ok) return PREFERRED_REDIRECT_URI;
    const metadata = (await response.json()) as {
      code_challenge_methods_supported?: unknown;
      redirect_uris_supported?: unknown;
    };
    const methods = metadata.code_challenge_methods_supported;
    const redirects = metadata.redirect_uris_supported;
    if (
      Array.isArray(methods) &&
      methods.includes("S256") &&
      Array.isArray(redirects) &&
      redirects.includes(PREFERRED_REDIRECT_URI)
    ) {
      return PREFERRED_REDIRECT_URI;
    }
  } catch {
    if (signal?.aborted) {
      throw new DOMException("Sign-in cancelled", "AbortError");
    }
  }
  return PREFERRED_REDIRECT_URI;
}

export function parseOAuthCodeCallback(raw: string): {
  code?: string;
  state: string;
  error?: string;
  redirectUri: string;
} | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  const isAlternate =
    url.protocol === "com.algorithvoice.app:" &&
    (url.host || "").toLowerCase() === "oauth-callback";
  const isPreferred =
    url.protocol === "algorithvoice:" &&
    (url.host || "").toLowerCase() === "auth-callback";
  if (!isAlternate && !isPreferred) return null;
  if (url.username || url.password) return null;
  if (url.port || (url.pathname !== "" && url.pathname !== "/")) return null;
  // Authorization-code responses use the query component. Reject fragments
  // so secrets cannot leak through ambiguous parsing or browser history.
  if (url.hash) return null;
  const query = new URLSearchParams(url.search);
  for (const name of ["code", "state", "error"]) {
    if (query.getAll(name).length > 1) return null;
  }
  const state = query.get("state") ?? "";
  if (!CALLBACK_STATE_RE.test(state)) return null;
  const error = query.get("error");
  const code = query.get("code");
  if (error && code) return null;
  if (error) {
    if (!OAUTH_ERROR_RE.test(error)) return null;
    return {
      error,
      state,
      redirectUri: isAlternate
        ? ALTERNATE_REDIRECT_URI
        : PREFERRED_REDIRECT_URI,
    };
  }
  if (!code || !CALLBACK_CODE_RE.test(code)) return null;
  return {
    code,
    state,
    redirectUri: isAlternate ? ALTERNATE_REDIRECT_URI : PREFERRED_REDIRECT_URI,
  };
}

async function exchangeOAuthCode(
  code: string,
  codeVerifier: string,
  redirectUri: string,
  signal: AbortSignal,
): Promise<{ accessToken: string; refreshToken?: string }> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: DESKTOP_CLIENT_ID,
    code,
    redirect_uri: redirectUri,
    code_verifier: codeVerifier,
  });
  let res: Response;
  try {
    res = await fetchWithTimeout(
      `${API}/oauth2/token`,
      {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: body.toString(),
      },
      15000,
      signal,
    );
  } catch (error) {
    if (signal.aborted) throw error;
    throw new Error(
      "Could not complete sign-in with api.trqsh.uz. Check your connection and try again.",
    );
  }
  const data = (await res.json().catch(() => ({}))) as {
    access_token?: string;
    refresh_token?: string;
    token_type?: string;
    error?: string;
    error_description?: string;
  };
  if (
    !res.ok ||
    data.token_type !== "Bearer" ||
    typeof data.access_token !== "string" ||
    data.access_token.length < 20 ||
    data.access_token.length > 16_384 ||
    /\s/.test(data.access_token) ||
    (data.refresh_token !== undefined &&
      (typeof data.refresh_token !== "string" ||
        data.refresh_token.length < 20 ||
        data.refresh_token.length > 8192 ||
        /\s/.test(data.refresh_token)))
  ) {
    throw new Error(
      data.error_description ?? data.error ?? "OAuth exchange failed.",
    );
  }
  return { accessToken: data.access_token, refreshToken: data.refresh_token };
}

async function fetchEmailForAccessToken(
  accessToken: string,
  signal: AbortSignal,
): Promise<string | null> {
  try {
    const res = await fetchWithTimeout(
      `${API}/auth/me`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      },
      10000,
      signal,
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { email?: unknown };
    if (
      typeof data.email !== "string" ||
      data.email.length > 320 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)
    ) {
      return null;
    }
    return data.email;
  } catch {
    return null;
  }
}

function mapOAuthError(raw: string): string {
  if (raw === "access_denied")
    return "Authorization was denied in the browser. You can safely try again.";
  if (raw === "invalid_request")
    return "The sign-in request was invalid or expired. Please try again.";
  if (raw === "temporarily_unavailable")
    return "Sign-in is temporarily unavailable. Please try again shortly.";
  return "Sign-in could not be completed. Please try again.";
}

/**
 * Best-effort expiry of the pending browser authorization for `state`.
 * Called on Cancel button, unmount, and timeout so closing the Chrome tab or
 * pressing Cancel never leaves the backend request lingering until TTL.
 * Always resolves (never throws): backend cancel is idempotent 200.
 */
export async function cancelDesktopAuthorize(state: string): Promise<void> {
  if (!state) return;
  try {
    await fetchWithTimeout(
      `${API}/oauth2/cancel`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ state }),
      },
      5000,
    ).catch(() => null);
  } catch {
    // Best-effort: TTL (5m) + desktop timeout still bound the window.
  }
}

/**
 * First-party desktop sign-in. Generates a PKCE pair, opens the system
 * browser to the web consent page, and completes when the backend redirects
 * to `algorithvoice://auth-callback?code=&state=`.
 *
 * Pass an AbortSignal to allow Cancel: abort rejects the pending promise
 * and releases the deep-link listener + timeout immediately instead of
 * waiting the full 5 minutes.
 */
export async function signInDesktop(options?: {
  signal?: AbortSignal;
}): Promise<SessionInfo> {
  if (!isTauri()) {
    throw new Error("Desktop sign-in needs the desktop app shell.");
  }
  const verifier = randomBase64Url(32);
  const challenge = await pkceChallenge(verifier);
  const redirectUri = await resolveDesktopRedirectUri(options?.signal);
  // 256 bits makes state independently unguessable even if the PKCE verifier
  // generation were ever changed. Both values are transaction-specific.
  const state = randomBase64Url(32);
  const params = new URLSearchParams({
    response_type: "code",
    client_id: DESKTOP_CLIENT_ID,
    redirect_uri: redirectUri,
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
  const signal = options?.signal;
  const exchangeController = new AbortController();
  let finished = false;
  let exchangeStarted = false;
  // Once the keyring write begins, the authorization is committed. The Rust
  // command emits `session-changed` before its invoke promise resolves; that
  // event removes AuthView, whose cleanup aborts this controller. Treating
  // that lifecycle abort as a user cancellation used to delete the session
  // immediately after a successful approval.
  let commitStarted = false;
  const unlisten = await listen<string[]>("auth-callback", (event) => {
    if (finished || exchangeStarted) return;
    const urls = event.payload ?? [];
    for (const raw of urls) {
      const parsed = parseOAuthCodeCallback(raw);
      if (!parsed) continue;
      // Ignore callbacks for other/stale transactions. Never let an
      // unsolicited deep link cancel the user's active login.
      if (parsed.state !== state) continue;
      if (parsed.redirectUri !== redirectUri) continue;
      if (parsed.error) {
        finished = true;
        rejectSession(new Error(mapOAuthError(parsed.error)));
        return;
      }
      if (!parsed.code) continue;
      exchangeStarted = true;
      void exchangeOAuthCode(
        parsed.code,
        verifier,
        redirectUri,
        exchangeController.signal,
      )
        .then(async ({ accessToken, refreshToken }) => {
          const email =
            (await fetchEmailForAccessToken(
              accessToken,
              exchangeController.signal,
            )) ?? "";
          if (!email)
            throw new Error("Signed in, but could not fetch profile.");
          if (signal?.aborted || exchangeController.signal.aborted) {
            throw new DOMException("Sign-in cancelled", "AbortError");
          }
          commitStarted = true;
          await tauri("store_session", {
            accessToken,
            email,
            refreshToken: refreshToken ?? null,
          });
          finished = true;
          resolveSession({ loggedIn: true, email });
        })
        .catch((e: unknown) => {
          if (finished) return;
          finished = true;
          rejectSession(e instanceof Error ? e : new Error(String(e)));
        });
      return;
    }
  });
  // Never wait forever (e.g. callback emitted to a different window than
  // the one listening, or the browser tab was closed). Timeout + Cancel both
  // expire the backend pending request immediately via POST /oauth2/cancel
  // so Chrome-close never lingers until TTL.
  const timeout = window.setTimeout(() => {
    if (finished) return;
    finished = true;
    exchangeController.abort();
    void cancelDesktopAuthorize(state);
    rejectSession(
      new Error(
        "Sign-in timed out — the browser tab was closed or no approval was received. Please try again.",
      ),
    );
  }, DESKTOP_AUTH_TIMEOUT_MS);
  const onAbort = () => {
    // Do not roll back a successfully authorized session just because the
    // login view unmounted in response to Rust's `session-changed` event.
    if (finished || commitStarted) return;
    finished = true;
    exchangeController.abort(signal?.reason);
    void cancelDesktopAuthorize(state);
    rejectSession(new DOMException("Sign-in cancelled", "AbortError"));
  };
  if (signal?.aborted) {
    clearTimeout(timeout);
    unlisten();
    exchangeController.abort();
    void cancelDesktopAuthorize(state);
    throw new DOMException("Sign-in cancelled", "AbortError");
  }
  signal?.addEventListener("abort", onAbort, { once: true });
  try {
    await safeOpenUrl(authorizeUrl);
  } catch {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", onAbort);
    unlisten();
    exchangeController.abort();
    void cancelDesktopAuthorize(state);
    throw new Error("Could not open the system browser.");
  }
  try {
    return await completed;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", onAbort);
    unlisten();
    if (!finished) exchangeController.abort();
  }
}
