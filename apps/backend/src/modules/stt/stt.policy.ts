import { FREE_CLOUD_SECONDS_PER_MONTH } from "@algorith-voice/shared-types";
import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import type { Env } from "../../config/env.js";
import { getActiveSubscription } from "../billing/guard.js";

export const asyncSttQuerySchema = z
  .object({
    language: z
      .string()
      .min(2)
      .max(16)
      .regex(/^(auto|[a-z]{2,3}(?:-[A-Z]{2})?)$/)
      .optional(),
    model: z.string().min(1).max(128).optional(),
  })
  .strict();

export function allowedSttModels(env: Env): ReadonlySet<string> {
  return new Set([env.STT_PRIMARY, env.STT_FALLBACK]);
}

export function selectSttModel(env: Env, requested?: string): string {
  const selected = requested ?? env.STT_PRIMARY;
  if (!allowedSttModels(env).has(selected)) {
    throw Object.assign(new Error("unsupported_model"), { statusCode: 400 });
  }
  return selected;
}

export async function assertWithinQuota(
  prisma: PrismaClient,
  userId: string,
): Promise<void> {
  if (await getActiveSubscription(prisma, userId)) return;
  const now = new Date();
  const periodStart = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
  );
  const used = await prisma.usageRecord.aggregate({
    where: {
      userId,
      metric: "STT_SECONDS",
      recordedAt: { gte: periodStart },
    },
    _sum: { quantity: true },
  });
  const raw = used._sum.quantity;
  const usedSeconds = typeof raw === "number" ? raw : (raw?.toNumber() ?? 0);
  if (usedSeconds < FREE_CLOUD_SECONDS_PER_MONTH) return;
  await prisma.auditLog.create({
    data: { actorUserId: userId, action: "stt.quota_exceeded" },
  });
  throw Object.assign(new Error("quota_exceeded"), { statusCode: 402 });
}

export function safeSttFailure(): string {
  return "transcription_failed";
}
