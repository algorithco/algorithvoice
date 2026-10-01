import formbody from "@fastify/formbody";
import type { FastifyInstance, FastifyReply } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { getAppEnv } from "../../config/env.js";
import { getUserId } from "../../plugins/jwt.js";
import { redis } from "../../queues/connection.js";
import { rotateRefreshSession } from "../auth/refresh-rotation.js";
import { OAuth2Audit, writeOAuthAudit } from "./oauth2.audit.js";
import {
  approveBodySchema,
  approveResponseSchema,
  CUSTOM_SCHEME_REDIRECT,
  DESKTOP_CLIENT_ID,
  healthResponseSchema,
  LEGACY_CUSTOM_SCHEME_REDIRECT,
  metadataResponseSchema,
  tokenResponseSchema,
} from "./oauth2.schemas.js";
import {
  ACCESS_TTL_SEC,
  CODE_TTL_SEC,
  codeKey,
  denyKey,
  hashRefreshToken,
  isRegisteredClient,
  isValidS256Challenge,
  isValidStateValue,
  newFamilyId,
  newJti,
  newOpaqueToken,
  newRequestId,
  type PendingRequest,
  parseScope,
  REFRESH_ABSOLUTE_SEC,
  REFRESH_SLIDING_SEC,
  REQUEST_TTL_SEC,
  reqKey,
  type StoredCode,
  scopeString,
  sha256Hex,
  stateKey,
  validateRedirectUri,
  verifyCodeChallenge,
} from "./oauth2.store.js";

// First-party OAuth 2.0 authorization server for the Tauri desktop app
// (public client `desktop-app`, no secret). New `/oauth2/*` namespace —
// every existing `/auth/*` route and envelope is untouched.
//
// Flow: system browser → GET /oauth2/authorize → Next.js consent page
// (existing web login) → POST /oauth2/approve → deep-link code →
// POST /oauth2/token (PKCE S256) → rotating refresh in Prisma Session.
//
// Error shapes on this namespace follow RFC 6749 §5.2
// ({ error, error_description }) instead of the API's { error }
// envelope — documented, intentional, and confined to new routes.

function tokenError(
  reply: FastifyReply,
  status: 400 | 401 | 409,
  error: string,
  description: string,
) {
  return reply.code(status).send({ error, error_description: description });
}

function authorizeRedirect(
  reply: { redirect: (url: string, code?: number) => unknown },
  redirectUri: string,
  params: Record<string, string>,
) {
  const query = Object.entries(params)
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join("&");
  return reply.redirect(`${redirectUri}?${query}`, 302);
}

function auditMeta(extra?: Record<string, string>) {
  return extra;
}

export async function oauth2Routes(
  app: FastifyInstance & { prisma: import("@prisma/client").PrismaClient },
) {
  const typed = app.withTypeProvider<ZodTypeProvider>();
  // Alias so the rest of the file can keep using `app` helpers
  const api = typed as unknown as typeof app;
  // RFC 6749 token requests are form-encoded; accept those plus JSON.
  // Registered inside this encapsulated plugin so no other route gains
  // a form parser.
  await app.register(formbody);

  // ---- liveness (keeps /health and /ready untouched) ----
  api.get(
    "/health",
    { schema: { response: { 200: healthResponseSchema } } },
    async () => ({ ok: true as const }),
  );

  // Deployment-specific capability document. New desktop builds use this to
  // roll out the reverse-domain callback without breaking older servers.
  api.get(
    "/metadata",
    { schema: { response: { 200: metadataResponseSchema } } },
    async (_req, reply) => {
      reply.header("Cache-Control", "public, max-age=300");
      const env = getAppEnv();
      const apiUrl = env.API_URL.replace(/\/$/, "");
      return {
        authorization_endpoint: `${apiUrl}/oauth2/authorize`,
        token_endpoint: `${apiUrl}/oauth2/token`,
        code_challenge_methods_supported: ["S256"] as const,
        redirect_uris_supported: [
          LEGACY_CUSTOM_SCHEME_REDIRECT,
          CUSTOM_SCHEME_REDIRECT,
        ],
      };
    },
  );

  // ---- GET /oauth2/authorize ----
  // Query is validated manually (not via a zod querystring schema) so
  // that failures with a usable redirect_uri become 302 error redirects
  // per RFC 6749 §4.1.2.1 — the desktop deep-link listener must resolve
  // instead of hanging. Only a missing/invalid redirect_uri (nowhere
  // safe to send the user) becomes direct 400 JSON.
  api.get(
    "/authorize",
    { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } },
    async (req, reply) => {
      reply.header("Cache-Control", "no-store");
      reply.header("Pragma", "no-cache");
      reply.header("Referrer-Policy", "no-referrer");
      const q = (req.query ?? {}) as Record<string, unknown>;
      const ip = req.ip;
      const ua = req.headers["user-agent"];
      const fail = (action: string, description: string) =>
        writeOAuthAudit(app.prisma, {
          action: action as (typeof OAuth2Audit)[keyof typeof OAuth2Audit],
          ip,
          userAgent: ua,
          metadata: auditMeta({
            client_id: String(q.client_id ?? ""),
            error: description,
          }),
        });

      if (!isRegisteredClient(q.client_id)) {
        await fail(OAuth2Audit.AUTHORIZE_ERROR, "unknown client");
        return reply.code(400).send({
          error: "invalid_client",
          error_description: "Unknown client.",
        });
      }
      const redirect = validateRedirectUri(q.redirect_uri);
      if (!redirect.ok) {
        await fail(OAuth2Audit.AUTHORIZE_ERROR, "bad redirect_uri");
        return reply.code(400).send({
          error: "invalid_request",
          error_description: "Invalid redirect_uri.",
        });
      }
      const redirectUri = redirect.normalized;
      const state = typeof q.state === "string" ? q.state : "";
      const errRedirect = (error: string, description: string) => {
        void fail(OAuth2Audit.AUTHORIZE_ERROR, description);
        const params: Record<string, string> = { error };
        if (state !== "") params.state = state;
        return authorizeRedirect(reply, redirectUri, params);
      };

      if (q.response_type !== "code") {
        return errRedirect(
          "unsupported_response_type",
          "Only response_type=code is supported.",
        );
      }
      if (
        !isValidS256Challenge(q.code_challenge) ||
        q.code_challenge_method !== "S256"
      ) {
        return errRedirect(
          "invalid_request",
          "code_challenge with method S256 is required.",
        );
      }
      if (!isValidStateValue(state)) {
        return errRedirect("invalid_request", "A valid state is required.");
      }
      const scope = parseScope(q.scope);
      if (!scope.ok) {
        return errRedirect("invalid_scope", "Unknown scope requested.");
      }

      const request: PendingRequest = {
        clientId: DESKTOP_CLIENT_ID,
        redirectUri,
        challenge: q.code_challenge,
        state,
        scopes: scope.scopes,
        createdAt: new Date().toISOString(),
      };
      const requestId = newRequestId();
      await redis.set(
        reqKey(requestId),
        JSON.stringify(request),
        "EX",
        REQUEST_TTL_SEC,
      );
      // State is a one-time transaction identifier. Fail closed on the
      // practically impossible collision instead of creating an ambiguous
      // cancel/approval mapping.
      const indexed = await redis.set(
        stateKey(state),
        requestId,
        "EX",
        REQUEST_TTL_SEC,
        "NX",
      );
      if (indexed !== "OK") {
        await redis.del(reqKey(requestId));
        return errRedirect(
          "invalid_request",
          "Authorization state has already been used.",
        );
      }
      await writeOAuthAudit(app.prisma, {
        action: OAuth2Audit.AUTHORIZE_START,
        ip,
        userAgent: ua,
        metadata: auditMeta({ request_id: requestId }),
      });
      const env = getAppEnv();
      return reply.redirect(
        `${env.APP_URL}/oauth2/consent?request=${encodeURIComponent(requestId)}`,
        302,
      );
    },
  );

  // ---- POST /oauth2/approve ----
  // Called server-side by the Next.js consent page, which forwards the
  // web-issued access JWT. This module never sees a password.
  api.post(
    "/approve",
    {
      onRequest: [app.authenticate],
      schema: {
        body: approveBodySchema,
        response: {
          200: approveResponseSchema,
          400: z.object({ error: z.string() }),
        },
      },
      config: { rateLimit: { max: 30, timeWindow: "10 minutes" } },
    },
    async (req, reply) => {
      const {
        request_id: requestId,
        approved,
        via,
      } = req.body as {
        request_id: string;
        approved: boolean;
        via?: "button" | "close";
      };
      const sub = getUserId(req);
      const ip = req.ip;
      const ua = req.headers["user-agent"];

      // Atomically consume before validation so two approval requests can
      // never both mint an authorization code.
      const raw = await redis.getdel(reqKey(requestId));
      if (!raw) {
        // Idempotent deny for tab-close beacons and double-submits: the
        // request is already consumed or expired, so there is nothing left
        // to deny. Return a no-op (not 400) so close-beacons stay silent.
        // Approvals still fail closed — a missing request can never mint.
        if (!approved) return { redirect_to: "/" };
        return reply.code(400).send({ error: "invalid_request" });
      }
      let pending: PendingRequest;
      try {
        pending = JSON.parse(raw) as PendingRequest;
      } catch {
        await redis.del(reqKey(requestId));
        return reply.code(400).send({ error: "invalid_request" });
      }
      // Remove the secondary state index after atomic request consumption.
      try {
        if (isValidStateValue(pending.state)) {
          await redis.del(stateKey(pending.state));
        }
      } catch {
        // Index cleanup is best-effort; TTL bounds any leftover.
      }

      if (!approved) {
        const abandoned = via === "close";
        await writeOAuthAudit(app.prisma, {
          action: abandoned
            ? OAuth2Audit.AUTHORIZE_ABANDONED
            : OAuth2Audit.AUTHORIZE_DENIED,
          actorUserId: sub,
          ip,
          userAgent: ua,
          metadata: auditMeta({
            request_id: requestId,
            ...(via ? { via } : {}),
          }),
        });
        return {
          redirect_to: `${pending.redirectUri}?error=${encodeURIComponent(
            "access_denied",
          )}&state=${encodeURIComponent(pending.state)}`,
        };
      }

      const code = newOpaqueToken();
      const stored: StoredCode = {
        userId: sub,
        clientId: pending.clientId,
        redirectUri: pending.redirectUri,
        challenge: pending.challenge,
        scopes: pending.scopes,
        deviceInfo: (ua ?? "desktop").slice(0, 200),
        familyId: newFamilyId(),
      };
      await redis.set(
        codeKey(code),
        JSON.stringify(stored),
        "EX",
        CODE_TTL_SEC,
      );
      await writeOAuthAudit(app.prisma, {
        action: OAuth2Audit.AUTHORIZE_APPROVED,
        actorUserId: sub,
        ip,
        userAgent: ua,
        metadata: auditMeta({ request_id: requestId }),
      });
      await writeOAuthAudit(app.prisma, {
        action: OAuth2Audit.CODE_ISSUED,
        actorUserId: sub,
        ip,
        userAgent: ua,
        metadata: auditMeta({
          code_hash: sha256Hex(code).slice(0, 16),
          family_id: stored.familyId,
        }),
      });
      return {
        redirect_to: `${pending.redirectUri}?code=${encodeURIComponent(
          code,
        )}&state=${encodeURIComponent(pending.state)}`,
      };
    },
  );

  // ---- POST /oauth2/cancel ----
  // Desktop Cancel button / timeout calls this with the unguessable `state`
  // it generated for authorize. Deletes the pending request + state index
  // immediately so a closed Chrome tab never lingers until TTL, and the
  // desktop deep-link listener unblocks without waiting 5m.
  // Public (no auth): `state` is 256-bit random, unguessable; always 200
  // (no oracle for request existence). Rate-limited like approve.
  api.post(
    "/cancel",
    { config: { rateLimit: { max: 30, timeWindow: "10 minutes" } } },
    async (req, reply) => {
      reply.header("Cache-Control", "no-store");
      reply.header("Pragma", "no-cache");
      const body = (req.body ?? {}) as Record<string, unknown>;
      const state = body.state;
      const ip = req.ip;
      const ua = req.headers["user-agent"];
      if (!isValidStateValue(state)) {
        return reply.code(400).send({
          error: "invalid_request",
          error_description: "A valid state is required.",
        });
      }
      // Redis errors bubble to the global handler -> 503 redis_unavailable
      // (never a false ok). Missing/expired requests still return ok.
      const requestId = await redis.get(stateKey(state));
      if (requestId) {
        await redis.del(reqKey(requestId));
        await redis.del(stateKey(state));
        await writeOAuthAudit(app.prisma, {
          action: OAuth2Audit.AUTHORIZE_CANCELLED,
          ip,
          userAgent: ua,
          metadata: auditMeta({ request_id: requestId, via: "cancel" }),
        });
      }
      // Always ok: existed-and-deleted and already-gone look identical.
      return { ok: true as const };
    },
  );

  // ---- POST /oauth2/token ----
  api.post(
    "/token",
    {
      schema: {
        response: {
          200: tokenResponseSchema,
          400: z.object({ error: z.string(), error_description: z.string() }),
          401: z.object({ error: z.string(), error_description: z.string() }),
          409: z.object({ error: z.string(), error_description: z.string() }),
        },
      },
      config: { rateLimit: { max: 20, timeWindow: "10 minutes" } },
    },
    async (req, reply) => {
      reply.header("Cache-Control", "no-store");
      reply.header("Pragma", "no-cache");
      const body = (req.body ?? {}) as Record<string, unknown>;
      const ip = req.ip;
      const ua = req.headers["user-agent"];
      const grant = body.grant_type;

      if (grant !== "authorization_code" && grant !== "refresh_token") {
        return tokenError(
          reply,
          400,
          typeof grant === "string"
            ? "unsupported_grant_type"
            : "invalid_request",
          "Unsupported grant_type.",
        );
      }
      if (!isRegisteredClient(body.client_id)) {
        return tokenError(reply, 401, "invalid_client", "Unknown client.");
      }

      if (grant === "authorization_code") {
        return exchangeCode(app, reply, body, ip, ua);
      }
      return rotateRefresh(app, reply, body, ip, ua);
    },
  );

  // ---- POST /oauth2/revoke (RFC 7009) ----
  // Always 200, even for unknown tokens (§2.2.1 — no oracle).
  api.post(
    "/revoke",
    { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const token = body.token;
      const hint = body.token_type_hint;
      const ip = req.ip;
      const ua = req.headers["user-agent"];
      if (typeof token !== "string" || token === "") {
        return reply.code(400).send({
          error: "invalid_request",
          error_description: "Missing token.",
        });
      }
      const env = getAppEnv();
      if (hint === undefined || hint === "refresh_token") {
        const row = await app.prisma.session.findUnique({
          where: {
            refreshHash: hashRefreshToken(token, env.JWT_REFRESH_PEPPER),
          },
          select: { userId: true, familyId: true },
        });
        if (row) {
          await app.prisma.session.updateMany({
            where: { familyId: row.familyId, revokedAt: null },
            data: { revokedAt: new Date() },
          });
          await writeOAuthAudit(app.prisma, {
            action: OAuth2Audit.REVOKED,
            actorUserId: row.userId,
            ip,
            userAgent: ua,
            metadata: auditMeta({ family_id: row.familyId }),
          });
        }
      }
      if (hint === undefined || hint === "access_token") {
        try {
          const decoded = app.jwt.verify<{ jti?: string; exp?: number }>(token);
          if (decoded?.jti) {
            const ttl = decoded.exp
              ? Math.max(
                  1,
                  Math.min(
                    decoded.exp - Math.floor(Date.now() / 1000),
                    ACCESS_TTL_SEC,
                  ),
                )
              : ACCESS_TTL_SEC;
            await redis.set(denyKey(decoded.jti), "1", "EX", ttl);
          }
        } catch {
          // Unknown/malformed access token: still 200, per RFC 7009.
        }
      }
      return reply.send({});
    },
  );
}

async function mintAccessToken(
  app: Parameters<typeof oauth2Routes>[0],
  sub: string,
  scopes: string[],
): Promise<{ token: string; jti: string }> {
  const jti = newJti();
  const token = app.jwt.sign({
    sub,
    jti,
    scope: scopeString(scopes),
    client_id: DESKTOP_CLIENT_ID,
  });
  return { token, jti };
}

async function exchangeCode(
  app: Parameters<typeof oauth2Routes>[0],
  reply: FastifyReply,
  body: Record<string, unknown>,
  ip: string | undefined,
  ua: string | undefined,
) {
  const code = body.code;
  if (typeof code !== "string" || code === "") {
    return tokenError(reply, 400, "invalid_grant", "Invalid code.");
  }
  // Single-use: consume first, validate after. A failed attempt can
  // never be retried (RFC 6749 §4.1.2).
  const raw = await redis.getdel(codeKey(code));
  if (!raw) {
    await writeOAuthAudit(app.prisma, {
      action: OAuth2Audit.AUTHORIZE_ERROR,
      ip,
      userAgent: ua,
      metadata: auditMeta({ reason: "unknown_or_reused_code" }),
    });
    return tokenError(reply, 400, "invalid_grant", "Invalid code.");
  }
  let stored: StoredCode;
  try {
    stored = JSON.parse(raw) as StoredCode;
  } catch {
    return tokenError(reply, 400, "invalid_grant", "Invalid code.");
  }
  const fail = (reason: string) => {
    void writeOAuthAudit(app.prisma, {
      action: OAuth2Audit.AUTHORIZE_ERROR,
      ip,
      userAgent: ua,
      metadata: auditMeta({ reason }),
    });
    return tokenError(reply, 400, "invalid_grant", "Invalid grant.");
  };
  if (body.client_id !== stored.clientId) return fail("client_mismatch");
  if (body.redirect_uri !== stored.redirectUri)
    return fail("redirect_mismatch");
  if (!verifyCodeChallenge(body.code_verifier, stored.challenge)) {
    return fail("pkce_mismatch");
  }

  const tokenUser = await app.prisma.user.findUnique({
    where: { id: stored.userId },
    select: { blockedAt: true },
  });
  if (!tokenUser || tokenUser.blockedAt) return fail("account_blocked");

  const env = getAppEnv();
  const { token: accessToken, jti } = await mintAccessToken(
    app,
    stored.userId,
    stored.scopes,
  );
  let refreshToken: string | undefined;
  if (stored.scopes.includes("offline_access")) {
    refreshToken = newOpaqueToken();
    const now = new Date();
    await app.prisma.session.create({
      data: {
        userId: stored.userId,
        refreshHash: hashRefreshToken(refreshToken, env.JWT_REFRESH_PEPPER),
        familyId: stored.familyId,
        deviceInfo: stored.deviceInfo,
        ...(ip ? { ip } : {}),
        expiresAt: new Date(now.getTime() + REFRESH_SLIDING_SEC * 1000),
        absoluteLimitAt: new Date(now.getTime() + REFRESH_ABSOLUTE_SEC * 1000),
        scopes: stored.scopes,
      },
    });
  }
  await writeOAuthAudit(app.prisma, {
    action: OAuth2Audit.CODE_EXCHANGED,
    actorUserId: stored.userId,
    ip,
    userAgent: ua,
    metadata: auditMeta({ family_id: stored.familyId, jti }),
  });
  return {
    access_token: accessToken,
    token_type: "Bearer" as const,
    expires_in: ACCESS_TTL_SEC,
    ...(refreshToken ? { refresh_token: refreshToken } : {}),
    scope: scopeString(stored.scopes),
  };
}

async function rotateRefresh(
  app: Parameters<typeof oauth2Routes>[0],
  reply: FastifyReply,
  body: Record<string, unknown>,
  ip: string | undefined,
  ua: string | undefined,
) {
  const presented = body.refresh_token;
  if (typeof presented !== "string" || presented === "") {
    return tokenError(reply, 400, "invalid_grant", "Invalid grant.");
  }
  const env = getAppEnv();
  const rotation = await rotateRefreshSession(
    app.prisma,
    presented,
    env.JWT_REFRESH_PEPPER,
    ip,
  );
  if (rotation.status === "retry") {
    return tokenError(reply, 409, "invalid_request", "Retry refresh.");
  }
  if (rotation.status === "invalid") {
    if (rotation.reuse && rotation.userId) {
      await writeOAuthAudit(app.prisma, {
        action: OAuth2Audit.REFRESH_REUSE,
        actorUserId: rotation.userId,
        ip,
        userAgent: ua,
        metadata: auditMeta({
          ...(rotation.familyId ? { family_id: rotation.familyId } : {}),
        }),
      });
    }
    return tokenError(reply, 400, "invalid_grant", "Invalid grant.");
  }
  const { token: accessToken, jti } = await mintAccessToken(
    app,
    rotation.userId,
    rotation.scopes,
  );
  await writeOAuthAudit(app.prisma, {
    action: OAuth2Audit.TOKEN_REFRESHED,
    actorUserId: rotation.userId,
    ip,
    userAgent: ua,
    metadata: auditMeta({ family_id: rotation.familyId, jti }),
  });
  return {
    access_token: accessToken,
    token_type: "Bearer" as const,
    expires_in: ACCESS_TTL_SEC,
    refresh_token: rotation.refreshToken,
    scope: scopeString(rotation.scopes),
  };
}
