import {
  FREE_CLOUD_SECONDS_PER_MONTH,
  usageSummarySchema,
} from "@algorith-voice/shared-types";
import type { FastifyInstance } from "fastify";
import { getActiveSubscription } from "../billing/guard.js";

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
      const [agg, activeSub] = await Promise.all([
        app.prisma.usageRecord.aggregate({
          where: {
            userId: sub,
            metric: "STT_SECONDS",
            recordedAt: { gte: periodStart, lt: periodEnd },
          },
          _sum: { quantity: true },
          _count: true,
        }),
        getActiveSubscription(app.prisma, sub),
      ]);
      const rawQty = agg._sum.quantity;
      const used =
        typeof rawQty === "number" ? rawQty : (rawQty?.toNumber() ?? 0);
      const isPro = activeSub !== null;
      return {
        periodStart: periodStart.toISOString(),
        periodEnd: periodEnd.toISOString(),
        cloudSecondsUsed: used,
        cloudSecondsLimit: isPro ? -1 : FREE_CLOUD_SECONDS_PER_MONTH,
        requests: agg._count,
        planTier: isPro ? ("pro" as const) : ("free" as const),
      };
    },
  );

  // Real daily breakdown for last N days (default 7) — no mocks
  app.get("/daily", { onRequest: [app.authenticate] }, async (req) => {
    const { sub } = req.user as { sub: string };
    const q = req.query as { days?: string };
    const days = Math.min(
      30,
      Math.max(1, parseInt(String(q.days ?? "7"), 10) || 7),
    );
    const since = new Date();
    since.setUTCHours(0, 0, 0, 0);
    since.setDate(since.getDate() - (days - 1));
    const records = await app.prisma.usageRecord.findMany({
      where: {
        userId: sub,
        metric: "STT_SECONDS",
        recordedAt: { gte: since },
      },
      select: { quantity: true, recordedAt: true },
      orderBy: { recordedAt: "asc" },
    });
    const buckets = new Map<string, { seconds: number; requests: number }>();
    for (let i = 0; i < days; i++) {
      const d = new Date(since);
      d.setDate(since.getDate() + i);
      const key = d.toISOString().slice(0, 10);
      buckets.set(key, { seconds: 0, requests: 0 });
    }
    for (const r of records) {
      const key = r.recordedAt.toISOString().slice(0, 10);
      const b = buckets.get(key);
      if (!b) continue;
      const qty =
        typeof r.quantity === "number"
          ? r.quantity
          : (r.quantity as unknown as { toNumber: () => number }).toNumber();
      b.seconds += qty;
      b.requests += 1;
    }
    const out: {
      date: string;
      label: string;
      seconds: number;
      requests: number;
    }[] = [];
    for (const [date, v] of buckets) {
      const label = new Date(`${date}T00:00:00Z`)
        .toLocaleDateString("en-GB", { weekday: "short" })
        .slice(0, 3);
      out.push({
        date,
        label,
        seconds: Math.round(v.seconds * 100) / 100,
        requests: v.requests,
      });
    }
    return { days, daily: out };
  });

  // Real recent activity — last N usage records
  app.get("/recent", { onRequest: [app.authenticate] }, async (req) => {
    const { sub } = req.user as { sub: string };
    const q = req.query as { limit?: string };
    const limit = Math.min(
      20,
      Math.max(1, parseInt(String(q.limit ?? "5"), 10) || 5),
    );
    const rows = await app.prisma.usageRecord.findMany({
      where: { userId: sub },
      orderBy: { recordedAt: "desc" },
      take: limit,
      select: {
        id: true,
        metric: true,
        quantity: true,
        model: true,
        latencyMs: true,
        recordedAt: true,
      },
    });
    return {
      recent: rows.map((r) => ({
        id: r.id,
        metric: r.metric,
        seconds:
          typeof r.quantity === "number"
            ? r.quantity
            : (r.quantity as unknown as { toNumber: () => number }).toNumber(),
        model: r.model,
        latencyMs: r.latencyMs,
        recordedAt: r.recordedAt.toISOString(),
      })),
    };
  });
}
