import type { PrismaClient } from "@prisma/client";
import type { MeteringJob } from "../../queues/connection.js";

export async function persistMeteringJob(
  prisma: PrismaClient,
  data: MeteringJob,
  jobId: string,
) {
  return prisma.usageRecord.upsert({
    where: { idempotencyKey: jobId },
    create: {
      idempotencyKey: jobId,
      userId: data.userId,
      metric: data.metric,
      quantity: data.quantity,
      ...(data.model === undefined ? {} : { model: data.model }),
      ...(data.latencyMs === undefined ? {} : { latencyMs: data.latencyMs }),
      ...(data.providerCost === undefined
        ? {}
        : { metadata: { providerCost: data.providerCost } }),
    },
    update: {},
  });
}

export interface AiRequestRecord {
  userId: string;
  model: string;
  latencyMs: number;
  success: boolean;
  errorCode?: string;
  cost?: number;
}

export function recordAiRequest(prisma: PrismaClient, record: AiRequestRecord) {
  return prisma.aiRequestLog.create({
    data: {
      userId: record.userId,
      model: record.model,
      latencyMs: record.latencyMs,
      success: record.success,
      ...(record.errorCode === undefined
        ? {}
        : { errorCode: record.errorCode }),
      costUsd: record.cost ?? 0,
    },
  });
}
