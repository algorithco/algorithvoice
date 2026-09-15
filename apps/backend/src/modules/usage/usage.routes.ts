import { FREE_CLOUD_SECONDS_PER_MONTH } from "@algorith-voice/shared-types";
import type { FastifyInstance } from "fastify";

export async function usageRoutes(app: FastifyInstance) {
  app.get("/summary", { onRequest: [app.authenticate] }, async (req) => {
    const { sub } = req.user as { sub: string };
    const periodStart = new Date();
    periodStart.setDate(1);
    periodStart.setHours(0, 0, 0, 0);
    const agg = await app.prisma.usageRecord.aggregate({
      where: {
        userId: sub,
        metric: "STT_SECONDS",
        recordedAt: { gte: periodStart },
      },
      _sum: { quantity: true },
      _count: true,
    });
    const user = await app.prisma.user.findUniqueOrThrow({
      where: { id: sub },
    });
    return {
      periodStart: periodStart.toISOString(),
      periodEnd: new Date().toISOString(),
      cloudSecondsUsed: agg._sum.quantity ?? 0,
      cloudSecondsLimit:
        user.planTier === "pro" ? -1 : FREE_CLOUD_SECONDS_PER_MONTH,
      requests: agg._count,
      planTier: user.planTier,
    };
  });
}
