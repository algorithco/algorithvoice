import { z } from "zod";

// Schemas for the first-party OAuth 2.0 authorization server mounted at
// `/oauth2/*`. Serves exactly one public client (the Tauri desktop app):
// authorization_code + PKCE S256, rotating refresh tokens, no secrets.

/** The only registered OAuth client. Unknown client_ids are rejected. */
export const DESKTOP_CLIENT_ID = "desktop-app";

/** Exact-match custom-scheme redirect for the Tauri deep-link handler. */
export const CUSTOM_SCHEME_REDIRECT = "algorithvoice://auth-callback";

/** Scopes the desktop client may request. */
export const ALLOWED_SCOPES = [
  "openid",
  "profile",
  "email",
  "offline_access",
] as const;

export const authorizeQuerySchema = z.object({
  response_type: z.string().min(1).max(32),
  client_id: z.string().min(1).max(128),
  redirect_uri: z.string().min(1).max(2048),
  code_challenge: z.string().min(1).max(256),
  code_challenge_method: z.string().min(1).max(16),
  state: z.string().min(1).max(512),
  scope: z.string().max(512).optional(),
});

export type AuthorizeQuery = z.infer<typeof authorizeQuerySchema>;

export const approveBodySchema = z.object({
  request_id: z.string().uuid().max(64),
  approved: z.boolean(),
});

export type ApproveBody = z.infer<typeof approveBodySchema>;

// Token endpoint accepts both application/x-www-form-urlencoded (RFC 6749)
// and JSON. Unknown fields (e.g. a mistakenly sent client_secret) are
// stripped, never required: this client is public and has no secret.
const tokenBaseSchema = z.object({
  grant_type: z.enum(["authorization_code", "refresh_token"]),
  client_id: z.string().min(1).max(128).optional(),
  code: z.string().min(1).max(256).optional(),
  redirect_uri: z.string().min(1).max(2048).optional(),
  code_verifier: z.string().min(1).max(256).optional(),
  refresh_token: z.string().min(1).max(512).optional(),
  scope: z.string().max(512).optional(),
});

export type TokenBody = z.infer<typeof tokenBaseSchema>;
export const tokenBodySchema = tokenBaseSchema;

export const revokeBodySchema = z.object({
  token: z.string().min(1).max(4096),
  token_type_hint: z.enum(["access_token", "refresh_token"]).optional(),
});

export type RevokeBody = z.infer<typeof revokeBodySchema>;

export const tokenResponseSchema = z.object({
  access_token: z.string().min(1),
  token_type: z.literal("Bearer"),
  expires_in: z.number().int(),
  refresh_token: z.string().min(1).optional(),
  scope: z.string(),
});

export const approveResponseSchema = z.object({
  redirect_to: z.string().min(1).max(4096),
});

export const healthResponseSchema = z.object({ ok: z.literal(true) });
