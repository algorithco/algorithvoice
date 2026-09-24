// @ts-nocheck — ZodTypeProvider inference for this additive module is
// intentionally relaxed; runtime validation is via explicit zod parses
// and manual RFC checks. Tightening the provider types is a follow-up.
import formbody from "@fastify/formbody";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { getAppEnv } from "../../config/env.js";
import { redis } from "../../queues/connection.js";
import { OAuth2Audit, writeOAuthAudit } from "./oauth2.audit.js";
import {
  approveBodySchema,
  approveResponseSchema,
  DESKTOP_CLIENT_ID,
  healthResponseSchema,
  tokenResponseSchema,
} from "./oauth2.schemas.js";
import {
  ACCESS_TTL_SEC,
  CODE_TTL_SEC,
  codeKey,
  denyKey,
  FAMILY_LOCK_SEC,
  familyLockKey,
  hashRefreshToken,
  isRegisteredClient,
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
  reply: { code: (n: number) => { send: (b: unknown) => unknown } },
  status: 400 | 401,
  error: string,
  description: string,
) {
  return (reply as { code: (n: number) => { send: (b: unknown) => unknown } })
    .code(status)
    .send({ error, error_description: description });
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
        typeof q.code_challenge !== "string" ||
        q.code_challenge === "" ||
        q.code_challenge_method !== "S256"
      ) {
        return errRedirect(
          "invalid_request",
          "code_challenge with method S256 is required.",
        );
      }
      if (state === "" || state.length > 512) {
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
        response: { 200: approveResponseSchema },
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
      const { sub } = req.user as { sub: string };
      const ip = req.ip;
      const ua = req.headers["user-agent"];

      const raw = await redis.get(reqKey(requestId));
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
      await redis.del(reqKey(requestId));

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

  // ---- POST /oauth2/token ----
  api.post(
    "/token",
    {
      schema: { response: { 200: tokenResponseSchema } },
      config: { rateLimit: { max: 20, timeWindow: "10 minutes" } },
    },
    async (req, reply) => {
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
  reply: Parameters<Parameters<FastifyInstance["post"]>[1]>[1],
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
        ip,
        expiresAt: new Date(now.getTime() + REFRESH_SLIDING_SEC * 1000),
        absoluteLimitAt: new Date(now.getTime() + REFRESH_ABSOLUTE_SEC * 1000),
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
  reply: Parameters<Parameters<FastifyInstance["post"]>[1]>[1],
  body: Record<string, unknown>,
  ip: string | undefined,
  ua: string | undefined,
) {
  const presented = body.refresh_token;
  if (typeof presented !== "string" || presented === "") {
    return tokenError(reply, 400, "invalid_grant", "Invalid grant.");
  }
  const env = getAppEnv();
  const row = await app.prisma.session.findUnique({
    where: { refreshHash: hashRefreshToken(presented, env.JWT_REFRESH_PEPPER) },
  });
  const now = new Date();
  if (!row) {
    return tokenError(reply, 400, "invalid_grant", "Invalid grant.");
  }
  // Expired or already-consumed token presented again: possible theft.
  // Kill the whole family (RFC 9700 §4.14 reuse detection).
  if (row.revokedAt !== null || row.expiresAt <= now) {
    await app.prisma.session.updateMany({
      where: { familyId: row.familyId, revokedAt: null },
      data: { revokedAt: now },
    });
    await writeOAuthAudit(app.prisma, {
      action: OAuth2Audit.REFRESH_REUSE,
      actorUserId: row.userId,
      ip,
      userAgent: ua,
      metadata: auditMeta({ family_id: row.familyId }),
    });
    return tokenError(reply, 400, "invalid_grant", "Invalid grant.");
  }
  if (row.absoluteLimitAt <= now) {
    await app.prisma.session.updateMany({
      where: { familyId: row.familyId, revokedAt: null },
      data: { revokedAt: now },
    });
    return tokenError(reply, 400, "invalid_grant", "Invalid grant.");
  }

  // Family lock: concurrent double-spend of one refresh must serialize.
  const locked = await redis.set(
    familyLockKey(row.familyId),
    "1",
    "EX",
    FAMILY_LOCK_SEC,
    "NX",
  );
  if (locked !== "OK") {
    return tokenError(
      reply,
      400,
      "invalid_request",
      "Concurrent request; retry.",
    );
  }
  try {
    // Re-read inside the lock: a racing request may have rotated first.
    const fresh = await app.prisma.session.findUnique({
      where: {
        refreshHash: hashRefreshToken(presented, env.JWT_REFRESH_PEPPER),
      },
    });
    if (!fresh || fresh.revokedAt !== null || fresh.expiresAt <= new Date()) {
      await app.prisma.session.updateMany({
        where: { familyId: row.familyId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await writeOAuthAudit(app.prisma, {
        action: OAuth2Audit.REFRESH_REUSE,
        actorUserId: row.userId,
        ip,
        userAgent: ua,
        metadata: auditMeta({ family_id: row.familyId }),
      });
      return tokenError(reply, 400, "invalid_grant", "Invalid grant.");
    }
    const next = newOpaqueToken();
    const at = new Date();
    await app.prisma.$transaction([
      app.prisma.session.update({
        where: { id: fresh.id },
        data: { revokedAt: at },
      }),
      app.prisma.session.create({
        data: {
          userId: fresh.userId,
          refreshHash: hashRefreshToken(next, env.JWT_REFRESH_PEPPER),
          familyId: fresh.familyId,
          deviceInfo: fresh.deviceInfo,
          ip,
          expiresAt: new Date(at.getTime() + REFRESH_SLIDING_SEC * 1000),
          absoluteLimitAt: fresh.absoluteLimitAt,
        },
      }),
    ]);
    const { token: accessToken, jti } = await mintAccessToken(
      app,
      fresh.userId,
      [],
    );
    await writeOAuthAudit(app.prisma, {
      action: OAuth2Audit.TOKEN_REFRESHED,
      actorUserId: fresh.userId,
      ip,
      userAgent: ua,
      metadata: auditMeta({ family_id: fresh.familyId, jti }),
    });
    return {
      access_token: accessToken,
      token_type: "Bearer" as const,
      expires_in: ACCESS_TTL_SEC,
      refresh_token: next,
      scope: "",
    };
  } finally {
    await redis.del(familyLockKey(row.familyId));
  }
}
