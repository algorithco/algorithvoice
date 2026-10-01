import type { Prisma } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getAppEnv } from "../../config/env.js";
import { getUserId } from "../../plugins/jwt.js";
import { redis } from "../../queues/connection.js";
import { invalidateSttModelCache } from "../stt/stt.models.js";

// Redis is a best-effort cache here, never load-bearing: when it is down
// (local dev without Docker) fall through to Postgres instead of 500ing.
async function cacheGet(key: string): Promise<string | null> {
  try {
    return await redis.get(key);
  } catch {
    return null;
  }
}

async function cacheSet(key: string, value: string, ttlSec: number) {
  try {
    await redis.set(key, value, "EX", ttlSec);
  } catch {
    // Cache miss is fine — the DB remains the source of truth.
  }
}

async function cacheDel(key: string) {
  try {
    await redis.del(key);
  } catch {
    // Stale cache entry expires on its own TTL.
  }
}

function maskKey(key: string | undefined | null): string | null {
  if (!key) return null;
  if (key.length <= 4) return "****";
  return `sk-...${key.slice(-4)}`;
}

const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  model: z.string().max(64).optional(),
  errorType: z.string().max(64).optional(),
  search: z.string().max(100).optional(),
});

export async function adminRoutes(app: FastifyInstance) {
  // Admin guard reuses the shared verifier so subject validation and access
  // token revocation cannot drift from the rest of the API.
  const requireAdmin = async (
    req: Parameters<typeof app.authenticate>[0],
    reply: Parameters<typeof app.authenticate>[1],
  ) => {
    await app.authenticate(req, reply);
    if (reply.sent) return;
    const sub = getUserId(req);
    const user = await app.prisma.user.findUnique({
      where: { id: sub },
      select: { role: true },
    });
    if (!user || user.role !== "admin") {
      reply.code(403).send({ error: "forbidden" });
    }
  };

  // Apply admin guard to all /admin/* routes in this plugin
  app.addHook("onRequest", requireAdmin);

  // GET /admin/stats/overview
  app.get("/stats/overview", async (req) => {
    const q = paginationSchema.partial().parse(req.query);
    const from = q.from ?? new Date(Date.now() - 7 * 24 * 3600 * 1000);
    const to = q.to ?? new Date();
    const prisma = (
      app as unknown as { prisma: import("@prisma/client").PrismaClient }
    ).prisma;
    const cacheKey = `admin:overview:${from.toISOString()}:${to.toISOString()}`;
    const cached = await cacheGet(cacheKey);
    if (cached) return JSON.parse(cached);
    const [total, failed, costAgg] = await Promise.all([
      prisma.aiRequestLog.count({
        where: { createdAt: { gte: from, lte: to } },
      }),
      prisma.aiRequestLog.count({
        where: { createdAt: { gte: from, lte: to }, success: false },
      }),
      prisma.aiRequestLog.aggregate({
        where: { createdAt: { gte: from, lte: to } },
        _sum: { costUsd: true },
        _avg: { latencyMs: true },
      }),
    ]);
    const successRate = total ? ((total - failed) / total) * 100 : 0;
    const result = {
      period: { from: from.toISOString(), to: to.toISOString() },
      totalRequests: total,
      failedRequests: failed,
      successRate: Math.round(successRate * 100) / 100,
      avgLatencyMs: costAgg._avg.latencyMs
        ? Math.round(costAgg._avg.latencyMs)
        : 0,
      totalCostUsd:
        costAgg._sum.costUsd?.toNumber?.() ?? Number(costAgg._sum.costUsd ?? 0),
    };
    await cacheSet(cacheKey, JSON.stringify(result), 60);
    return result;
  });

  // GET /admin/stats/models
  app.get("/stats/models", async (req) => {
    const q = paginationSchema.partial().parse(req.query);
    const from = q.from ?? new Date(Date.now() - 7 * 24 * 3600 * 1000);
    const to = q.to ?? new Date();
    const prisma = (
      app as unknown as { prisma: import("@prisma/client").PrismaClient }
    ).prisma;
    const groups = await prisma.aiRequestLog.groupBy({
      by: ["model"],
      where: { createdAt: { gte: from, lte: to } },
      _count: { _all: true },
      _avg: { latencyMs: true },
      _sum: { costUsd: true, promptTokens: true, completionTokens: true },
    });
    const withErrors = await Promise.all(
      groups.map(async (g) => {
        const errCount = await prisma.aiRequestLog.count({
          where: {
            model: g.model,
            success: false,
            createdAt: { gte: from, lte: to },
          },
        });
        return {
          model: g.model,
          requests: g._count._all,
          avgLatencyMs: g._avg.latencyMs ? Math.round(g._avg.latencyMs) : 0,
          costUsd: g._sum.costUsd?.toNumber?.() ?? Number(g._sum.costUsd ?? 0),
          tokens: (g._sum.promptTokens ?? 0) + (g._sum.completionTokens ?? 0),
          errorCount: errCount,
          errorRate: g._count._all
            ? Math.round((errCount / g._count._all) * 10000) / 100
            : 0,
        };
      }),
    );
    return {
      period: { from: from.toISOString(), to: to.toISOString() },
      data: withErrors,
    };
  });

  // GET /admin/config/ai-model
  app.get("/config/ai-model", async () => {
    const prisma = (
      app as unknown as { prisma: import("@prisma/client").PrismaClient }
    ).prisma;
    const cached = await cacheGet("admin:ai-config");
    if (cached) return JSON.parse(cached);
    const configs = await prisma.aiModelConfig.findMany({
      orderBy: { createdAt: "desc" },
    });
    const active = configs.find((c) => c.isActive) ?? null;
    const fallback = configs.find((c) => c.isFallback) ?? null;
    const result = { active, fallback, all: configs };
    await cacheSet("admin:ai-config", JSON.stringify(result), 30);
    return result;
  });

  // PUT /admin/config/ai-model
  app.put("/config/ai-model", async (req, reply) => {
    const bodySchema = z
      .object({
        activeModelId: z.string().min(1).max(128).optional(),
        fallbackModelId: z.string().min(1).max(128).optional(),
      })
      .strict();
    const body = bodySchema.parse(req.body);
    const prisma = (
      app as unknown as { prisma: import("@prisma/client").PrismaClient }
    ).prisma;
    const sub = getUserId(req);
    if (body.activeModelId) {
      const exists = await prisma.aiModelConfig.findUnique({
        where: { modelId: body.activeModelId },
      });
      if (!exists) return reply.code(404).send({ error: "model_not_found" });
      await prisma.$transaction([
        prisma.aiModelConfig.updateMany({ data: { isActive: false } }),
        prisma.aiModelConfig.update({
          where: { modelId: body.activeModelId },
          data: { isActive: true, updatedBy: sub },
        }),
        prisma.auditLog.create({
          data: {
            actorUserId: sub,
            action: "admin.ai_config.update_active",
            metadata: { activeModelId: body.activeModelId },
          },
        }),
      ]);
    }
    if (body.fallbackModelId) {
      const exists = await prisma.aiModelConfig.findUnique({
        where: { modelId: body.fallbackModelId },
      });
      if (!exists) return reply.code(404).send({ error: "model_not_found" });
      await prisma.$transaction([
        prisma.aiModelConfig.updateMany({ data: { isFallback: false } }),
        prisma.aiModelConfig.update({
          where: { modelId: body.fallbackModelId },
          data: { isFallback: true, updatedBy: sub },
        }),
        prisma.auditLog.create({
          data: {
            actorUserId: sub,
            action: "admin.ai_config.update_fallback",
            metadata: { fallbackModelId: body.fallbackModelId },
          },
        }),
      ]);
    }
    await cacheDel("admin:ai-config");
    invalidateSttModelCache();
    const configs = await prisma.aiModelConfig.findMany();
    return { ok: true, configs };
  });

  // GET /admin/logs/errors
  app.get("/logs/errors", async (req) => {
    const q = paginationSchema.parse(req.query);
    const prisma = (
      app as unknown as { prisma: import("@prisma/client").PrismaClient }
    ).prisma;
    const where: Prisma.AiRequestLogWhereInput = { success: false };
    if (q.from || q.to) {
      where.createdAt = {
        ...(q.from ? { gte: q.from } : {}),
        ...(q.to ? { lte: q.to } : {}),
      };
    }
    if (q.model) where.model = q.model;
    if (q.errorType) where.errorCode = q.errorType;
    const [data, total] = await Promise.all([
      prisma.aiRequestLog.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (q.page - 1) * q.limit,
        take: q.limit,
      }),
      prisma.aiRequestLog.count({ where }),
    ]);
    return {
      data,
      meta: {
        page: q.page,
        limit: q.limit,
        total,
        totalPages: Math.ceil(total / q.limit),
      },
    };
  });

  // GET /admin/essays (maps to AudioAsset + AiRequestLog union for demo)
  app.get("/essays", async (req) => {
    const q = paginationSchema.parse(req.query);
    const prisma = (
      app as unknown as { prisma: import("@prisma/client").PrismaClient }
    ).prisma;
    const where: Prisma.AudioAssetWhereInput = {};
    if (q.search) where.r2Key = { contains: q.search, mode: "insensitive" };
    const [data, total] = await Promise.all([
      prisma.audioAsset.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (q.page - 1) * q.limit,
        take: q.limit,
        include: { user: { select: { id: true, email: true } } },
      }),
      prisma.audioAsset.count({ where }),
    ]);
    return {
      data,
      meta: {
        page: q.page,
        limit: q.limit,
        total,
        totalPages: Math.ceil(total / q.limit),
      },
    };
  });

  // GET /admin/users
  app.get("/users", async (req) => {
    const q = paginationSchema.parse(req.query);
    const prisma = (
      app as unknown as { prisma: import("@prisma/client").PrismaClient }
    ).prisma;
    const where: Prisma.UserWhereInput = {};
    if (q.search) {
      where.OR = [
        { email: { contains: q.search, mode: "insensitive" as const } },
        { name: { contains: q.search, mode: "insensitive" as const } },
      ];
    }
    const [data, total] = await Promise.all([
      prisma.user.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (q.page - 1) * q.limit,
        take: q.limit,
        select: {
          id: true,
          email: true,
          name: true,
          planTier: true,
          role: true,
          createdAt: true,
        },
      }),
      prisma.user.count({ where }),
    ]);
    return {
      data,
      meta: {
        page: q.page,
        limit: q.limit,
        total,
        totalPages: Math.ceil(total / q.limit),
      },
    };
  });

  app.post("/users/:id/block", async (req, reply) => {
    const { id } = req.params as { id: string };
    const prisma = (
      app as unknown as { prisma: import("@prisma/client").PrismaClient }
    ).prisma;
    const sub = getUserId(req);
    const target = await prisma.user.findUnique({ where: { id } });
    if (!target) return reply.code(404).send({ error: "user_not_found" });
    await prisma.$transaction([
      prisma.user.update({
        where: { id },
        data: { blockedAt: new Date() },
      }),
      prisma.session.updateMany({
        where: { userId: id, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
      prisma.auditLog.create({
        data: {
          actorUserId: sub,
          action: "admin.user.block",
          recordId: id,
          metadata: { targetUserId: id },
        },
      }),
    ]);
    return { ok: true };
  });

  // GET /admin/keys (masked)
  app.get("/keys", async () => {
    const env = getAppEnv();
    return {
      openrouter: maskKey(env.OPENROUTER_API_KEY),
      mistral: maskKey(env.MISTRAL_API_KEY),
      groq: maskKey(env.GROQ_API_KEY),
    };
  });
}
