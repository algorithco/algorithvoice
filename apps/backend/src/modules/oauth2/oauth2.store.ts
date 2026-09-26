import {
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import { CUSTOM_SCHEME_REDIRECT, DESKTOP_CLIENT_ID } from "./oauth2.schemas.js";

// Pure helpers for the first-party OAuth 2.0 authorization server.
// No Prisma/Redis imports here so the security-critical validators stay
// unit-testable without infrastructure.

// ---- Lifetimes (seconds) ----

/**
 * Pending browser-side authorization request.
 * 5m matches the desktop deep-link wait — a closed/cancelled tab must never
 * linger 10-15m. Cancel/close deletes the keys immediately (see
 * POST /oauth2/cancel + consent close-beacon); TTL is only the backstop.
 */
export const REQUEST_TTL_SEC = 300;
/** Authorization code: short-lived and single-use (RFC 6749 §4.1.2). */
export const CODE_TTL_SEC = 120;
/** Access JWT lifetime; matches the @fastify/jwt signer default. */
export const ACCESS_TTL_SEC = 900;
/** Refresh sliding window (30 days). */
export const REFRESH_SLIDING_SEC = 30 * 24 * 3600;
/** Refresh absolute cap (90 days, never extended). */
export const REFRESH_ABSOLUTE_SEC = 90 * 24 * 3600;
/** Family rotation lock: prevents concurrent double-spend of one refresh. */
export const FAMILY_LOCK_SEC = 10;

// ---- Redis keys ----

export const reqKey = (requestId: string) => `oauth2:req:${requestId}`;
export const codeKey = (code: string) => `oauth2:code:${code}`;
export const denyKey = (jti: string) => `oauth2:deny:${jti}`;
export const familyLockKey = (familyId: string) =>
  `oauth2:lock:family:${familyId}`;
/**
 * Secondary index: desktop `state` (unguessable 128-bit) -> requestId.
 * Lets the desktop Cancel button expire a pending request immediately via
 * POST /oauth2/cancel without ever learning the server-side requestId.
 * Same TTL as the request itself; deleted together with it on
 * approve/deny/cancel/expire.
 */
export const stateKey = (state: string) => `oauth2:state:${state}`;

/** State must be unguessable + URL-safe; enforced on authorize + cancel. */
export function isValidStateValue(state: unknown): state is string {
  return typeof state === "string" && state.length >= 1 && state.length <= 512;
}

// ---- Client + redirect validation (RFC 8252 §8.4, RFC 9700 §4.1.3) ----

export function isRegisteredClient(clientId: unknown): boolean {
  return clientId === DESKTOP_CLIENT_ID;
}

export type RedirectCheck = { ok: true; normalized: string } | { ok: false };

/**
 * Strict redirect allowlist. Accepts exactly:
 * - the registered custom scheme (`algorithvoice://auth-callback`),
 * - loopback `http://127.0.0.1:<port>/callback` or
 *   `http://[::1]:<port>/callback` with any valid port (RFC 8252 §7.3).
 * The base redirect must carry no query/fragment of its own, otherwise the
 * appended `?code=&state=` parameters could be smuggled or split.
 */
export function validateRedirectUri(raw: unknown): RedirectCheck {
  if (typeof raw !== "string") return { ok: false };
  const input = raw.trim();
  if (input === CUSTOM_SCHEME_REDIRECT) {
    return { ok: true, normalized: CUSTOM_SCHEME_REDIRECT };
  }
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return { ok: false };
  }
  if (url.protocol !== "http:") return { ok: false };
  if (url.username !== "" || url.password !== "") return { ok: false };
  if (url.hostname !== "127.0.0.1" && url.hostname !== "[::1]") {
    return { ok: false };
  }
  // Explicit port required: loopback without a port cannot receive the
  // desktop's one-shot listener.
  if (url.port === "") return { ok: false };
  const port = Number(url.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return { ok: false };
  }
  if (url.pathname !== "/callback") return { ok: false };
  if (url.search !== "" || url.hash !== "") return { ok: false };
  return { ok: true, normalized: `http://${url.hostname}:${port}/callback` };
}

// ---- PKCE (RFC 7636, S256 only) ----

const VERIFIER_RE = /^[A-Za-z0-9\-._~]{43,128}$/;

/**
 * Verify `code_verifier` against the stored `code_challenge` using S256.
 * `plain` is never accepted (RFC 9700 §4.8.2). Comparison is constant-time
 * on the digest encoding; malformed verifiers fail closed.
 */
export function verifyCodeChallenge(
  verifier: unknown,
  challenge: unknown,
): boolean {
  if (typeof verifier !== "string" || typeof challenge !== "string") {
    return false;
  }
  if (!VERIFIER_RE.test(verifier)) return false;
  if (challenge.length === 0 || challenge.length > 256) return false;
  const computed = createHash("sha256")
    .update(verifier, "ascii")
    .digest("base64url");
  if (computed.length !== challenge.length) return false;
  return timingSafeEqual(
    Buffer.from(computed) as unknown as Uint8Array,
    Buffer.from(challenge) as unknown as Uint8Array,
  );
}

// ---- Token minting helpers ----

/** Opaque 256-bit authorization code / refresh token value. */
export function newOpaqueToken(): string {
  return randomBytes(32).toString("base64url");
}

export function newRequestId(): string {
  return randomUUID();
}

export function newFamilyId(): string {
  return randomUUID();
}

export function newJti(): string {
  return randomUUID();
}

/**
 * Refresh-token storage hash: HMAC-SHA256 with the server pepper.
 * Raw refresh tokens never touch the database or logs.
 */
export function hashRefreshToken(token: string, pepper: string): string {
  return createHmac("sha256", pepper).update(token, "utf8").digest("hex");
}

/** SHA-256 hex for correlating audit rows without storing raw values. */
export function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

// ---- Scope ----

const SCOPE_ALLOWLIST = new Set([
  "openid",
  "profile",
  "email",
  "offline_access",
]);

export type ScopeCheck = { ok: true; scopes: string[] } | { ok: false };

export function parseScope(raw: unknown): ScopeCheck {
  const list =
    typeof raw === "string" && raw.trim() !== "" ? raw.trim().split(/\s+/) : [];
  for (const scope of list) {
    if (!SCOPE_ALLOWLIST.has(scope)) return { ok: false };
  }
  return { ok: true, scopes: list };
}

export function scopeString(scopes: string[]): string {
  return scopes.join(" ");
}

// ---- Shapes stored in Redis (JSON) ----

export interface PendingRequest {
  clientId: string;
  redirectUri: string;
  challenge: string;
  state: string;
  scopes: string[];
  createdAt: string;
}

export interface StoredCode {
  userId: string;
  clientId: string;
  redirectUri: string;
  challenge: string;
  scopes: string[];
  deviceInfo: string | null;
  familyId: string;
}
