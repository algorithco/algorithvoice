import type { PrismaClient } from "@prisma/client";
import { redis } from "../../queues/connection.js";
import {
  FAMILY_LOCK_SEC,
  familyLockKey,
  hashRefreshToken,
  newOpaqueToken,
  REFRESH_SLIDING_SEC,
} from "../oauth2/oauth2.store.js";

const REUSE_GRACE_MS = 10_000;

export type RefreshRotationResult =
  | {
      status: "rotated";
      userId: string;
      familyId: string;
      refreshToken: string;
      scopes: string[];
    }
  | { status: "retry" }
  | { status: "invalid"; reuse: boolean; userId?: string; familyId?: string };

export async function rotateRefreshSession(
  prisma: PrismaClient,
  presented: string,
  pepper: string,
  ip?: string,
): Promise<RefreshRotationResult> {
  const refreshHash = hashRefreshToken(presented, pepper);
  const row = await prisma.session.findUnique({
    where: { refreshHash },
    include: { user: { select: { blockedAt: true } } },
  });
  if (!row) return { status: "invalid", reuse: false };
  if (row.user.blockedAt) {
    await prisma.session.updateMany({
      where: { familyId: row.familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return { status: "invalid", reuse: false };
  }
  const now = new Date();
  if (row.revokedAt) {
    const activeSuccessor = await prisma.session.count({
      where: { familyId: row.familyId, revokedAt: null },
    });
    if (
      activeSuccessor > 0 &&
      now.getTime() - row.revokedAt.getTime() <= REUSE_GRACE_MS
    ) {
      return { status: "retry" };
    }
    const familyRevokedAt = new Date(now.getTime() - REUSE_GRACE_MS - 1);
    await prisma.session.updateMany({
      where: { familyId: row.familyId, revokedAt: null },
      data: { revokedAt: familyRevokedAt },
    });
    return {
      status: "invalid",
      reuse: true,
      userId: row.userId,
      familyId: row.familyId,
    };
  }
  if (row.expiresAt <= now || row.absoluteLimitAt <= now) {
    const familyRevokedAt = new Date(now.getTime() - REUSE_GRACE_MS - 1);
    await prisma.session.updateMany({
      where: { familyId: row.familyId, revokedAt: null },
      data: { revokedAt: familyRevokedAt },
    });
    return { status: "invalid", reuse: false };
  }

  const locked = await redis.set(
    familyLockKey(row.familyId),
    "1",
    "EX",
    FAMILY_LOCK_SEC,
    "NX",
  );
  if (locked !== "OK") return { status: "retry" };
  try {
    const next = newOpaqueToken();
    const rotatedAt = new Date();
    const won = await prisma.$transaction(async (tx) => {
      const consumed = await tx.session.updateMany({
        where: { id: row.id, revokedAt: null },
        data: { revokedAt: rotatedAt },
      });
      if (consumed.count !== 1) return false;
      await tx.session.create({
        data: {
          userId: row.userId,
          refreshHash: hashRefreshToken(next, pepper),
          familyId: row.familyId,
          ...(row.deviceInfo === null ? {} : { deviceInfo: row.deviceInfo }),
          ...(ip === undefined ? {} : { ip }),
          expiresAt: new Date(
            Math.min(
              rotatedAt.getTime() + REFRESH_SLIDING_SEC * 1000,
              row.absoluteLimitAt.getTime(),
            ),
          ),
          absoluteLimitAt: row.absoluteLimitAt,
          scopes: row.scopes,
        },
      });
      return true;
    });
    return won
      ? {
          status: "rotated",
          userId: row.userId,
          familyId: row.familyId,
          refreshToken: next,
          scopes: row.scopes,
        }
      : { status: "retry" };
  } finally {
    await redis.del(familyLockKey(row.familyId)).catch(() => {});
  }
}
