import type { PrismaClient } from "@prisma/client";
import { sha256Hex } from "./oauth2.store.js";

// Audit action names for the /oauth2/* namespace. Every step of the
// authorization-code flow leaves a row; raw codes, verifiers and tokens
// are never written (only truncated hashes / jtis for correlation).

export const OAuth2Audit = {
  AUTHORIZE_START: "oauth2.authorize_start",
  AUTHORIZE_ERROR: "oauth2.authorize_error",
  AUTHORIZE_APPROVED: "oauth2.authorize_approved",
  AUTHORIZE_DENIED: "oauth2.authorize_denied",
  AUTHORIZE_ABANDONED: "oauth2.authorize_abandoned",
  AUTHORIZE_CANCELLED: "oauth2.authorize_cancelled",
  CODE_ISSUED: "oauth2.code_issued",
  CODE_EXCHANGED: "oauth2.code_exchanged",
  TOKEN_REFRESHED: "oauth2.token_refreshed",
  REFRESH_REUSE: "oauth2.refresh_reuse",
  REVOKED: "oauth2.revoked",
} as const;

export type OAuth2AuditAction = (typeof OAuth2Audit)[keyof typeof OAuth2Audit];

interface AuditFields {
  action: OAuth2AuditAction;
  actorUserId?: string;
  ip?: string;
  userAgent?: string;
  metadata?: Record<string, string>;
}

/**
 * Best-effort audit write: logging must never break the auth flow, and
 * secrets must never reach the log table. Callers pass only hashes/jtis.
 */
export async function writeOAuthAudit(
  prisma: PrismaClient,
  fields: AuditFields,
): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        action: fields.action,
        actorUserId: fields.actorUserId,
        ipHash: fields.ip ? sha256Hex(fields.ip) : undefined,
        userAgentHash: fields.userAgent
          ? sha256Hex(fields.userAgent)
          : undefined,
        metadata: fields.metadata ?? undefined,
      },
    });
  } catch {
    // Audit storage failure is operator-visible via the global error
    // handler on the surrounding request only if we rethrow — we don't:
    // failing closed here would lock users out over a logging issue.
    // Prisma errors still surface in process logs via the request logger.
  }
}
