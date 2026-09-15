import {
  FREE_CLOUD_SECONDS_PER_MONTH,
  usageSummarySchema,
} from "@algorith-voice/shared-types";
import type { FastifyInstance } from "fastify";

export function monthWindowUTC(now = new Date()) {
  const periodStart = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
  );
  const periodEnd = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1),
  );
  return { periodStart, periodEnd };
}

export async function usageRoutes(app: FastifyInstance) {
  app.get(
    "/summary",
    {
      onRequest: [app.authenticate],
      schema: { response: { 200: usageSummarySchema } },
    },
    async (req) => {
      const { sub } = req.user as { sub: string };
      const { periodStart, periodEnd } = monthWindowUTC();
      const [agg, user] = await Promise.all([
        app.prisma.usageRecord.aggregate({
          where: {
            userId: sub,
            metric: "STT_SECONDS",
            recordedAt: { gte: periodStart, lt: periodEnd },
          },
          _sum: { quantity: true },
          _count: true,
        }),
        app.prisma.user.findUniqueOrThrow({ where: { id: sub } }),
      ]);
      const rawQty = agg._sum.quantity;
      const used =
        typeof rawQty === "number" ? rawQty : (rawQty?.toNumber() ?? 0);
      const isPro = user.planTier === "pro";
      return {
        periodStart: periodStart.toISOString(),
        periodEnd: periodEnd.toISOString(),
        cloudSecondsUsed: used,
        cloudSecondsLimit: isPro ? -1 : FREE_CLOUD_SECONDS_PER_MONTH,
        requests: agg._count,
        planTier: user.planTier,
      };
    },
  );
}
