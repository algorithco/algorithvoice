import { randomUUID } from "node:crypto";
import compress from "@fastify/compress";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import jwt from "@fastify/jwt";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import websocket from "@fastify/websocket";
import Fastify, { LogController } from "fastify";
import {
  hasZodFastifySchemaValidationErrors,
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from "fastify-type-provider-zod";
import { loadEnv, setAppEnv } from "./config/env.js";
import { adminRoutes } from "./modules/admin/admin.routes.js";
import { authRoutes } from "./modules/auth/auth.routes.js";
import { billingRoutes } from "./modules/billing/billing.routes.js";
import { licenseRoutes } from "./modules/devices/license.routes.js";
import { oauth2Routes } from "./modules/oauth2/oauth2.routes.js";
import { sttRoutes } from "./modules/stt/stt.routes.js";
import { usageRoutes } from "./modules/usage/usage.routes.js";
import jwtPlugin from "./plugins/jwt.js";
import prismaPlugin from "./plugins/prisma.js";
import { pingRedis } from "./queues/connection.js";

export function buildApp() {
  const env = setAppEnv(loadEnv());
  const app = Fastify({
    logger: {
      level: env.LOG_LEVEL,
      redact: [
        "req.headers.authorization",
        "req.headers.cookie",
        "req.body.password",
        "req.body.byokKey",
        "req.body.refresh_token",
        "req.body.refreshToken",
        "req.body.code",
        "req.body.code_verifier",
        "req.body.token",
        "req.body.access_token",
      ],
    },
    // The onResponse hook below already logs completions (and skips
    // /health + /ready); the built-in line would duplicate it.
    logController: new LogController({ disableRequestLogging: true }),
    trustProxy: true,
    genReqId: () => randomUUID(),
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  app.register(cors, {
    origin: [
      env.APP_URL,
      "tauri://localhost",
      "http://tauri.localhost",
      // Local-dev loopback (direct localhost access bypassing the tunnel).
      "http://localhost:3000",
      "http://127.0.0.1:3000",
    ],
    credentials: true,
    methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  });
  app.register(helmet);
  app.register(compress, { global: true, threshold: 1024 });
  app.register(cookie);
  // Simple response-time + structured log: 1.1, 1.6
  app.addHook("onResponse", (req, reply, done) => {
    const startTime = (req as unknown as { startTime?: number }).startTime;
    const ms =
      reply.elapsedTime ??
      (startTime !== undefined ? Date.now() - startTime : 0);
    if (req.url !== "/health" && req.url !== "/ready") {
      req.log.info(
        {
          reqId: req.id,
          method: req.method,
          url: req.url,
          statusCode: reply.statusCode,
          responseTime: Math.round(ms),
        },
        "request completed",
      );
    }
    done();
  });
  app.register(jwt, {
    secret: env.JWT_ACCESS_SECRET,
    sign: {
      algorithm: "HS256",
      expiresIn: "15m",
      iss: "algorith-voice",
      aud: "api",
    },
    verify: {
      algorithms: ["HS256"],
      allowedIss: ["algorith-voice"],
      allowedAud: ["api"],
    },
  });
  app.register(multipart, { limits: { fileSize: 25 * 1024 * 1024 } });
  app.register(rateLimit, { global: true, max: 100, timeWindow: "1 minute" });
  app.register(websocket);

  app.register(swagger, {
    openapi: {
      openapi: "3.0.0",
      info: {
        title: "Algorith Voice API",
        description:
          "Accounts, licensing, billing, usage, and cloud transcription for the Algorith Voice desktop app.",
        version: "0.1.0",
      },
      servers: [{ url: env.API_URL ?? `http://localhost:${env.PORT}` }],
      components: {
        securitySchemes: {
          bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" },
        },
      },
    },
    transform: jsonSchemaTransform,
  });
  app.register(swaggerUi, {
    routePrefix: "/docs",
    uiConfig: { docExpansion: "list", deepLinking: true },
  });

  app.register(prismaPlugin);
  app.register(jwtPlugin);

  app.get("/health", async () => ({
    ok: true,
    service: "algorith-voice-backend",
    uptimeSec: Math.round(process.uptime()),
  }));
  app.get("/ready", async (_req, reply) => {
    const checks: Record<string, string> = {};
    try {
      await app.prisma.$queryRaw`SELECT 1`;
      checks.db = "ok";
    } catch {
      checks.db = "down";
    }
    try {
      checks.redis = (await pingRedis(1000)) ? "ok" : "down";
    } catch {
      checks.redis = "down";
    }
    if (checks.db === "ok" && checks.redis === "ok") {
      return { ok: true, checks };
    }
    return reply.code(503).send({ ok: false, checks });
  });

  app.register(authRoutes, { prefix: "/auth" });
  app.register(oauth2Routes, { prefix: "/oauth2" });
  app.register(adminRoutes, { prefix: "/admin" });
  app.register(licenseRoutes, { prefix: "/license" });
  app.register(sttRoutes);
  app.register(billingRoutes, { prefix: "/billing" });
  app.register(usageRoutes, { prefix: "/usage" });

  app.setNotFoundHandler((_req, reply) => {
    reply.code(404).send({ error: "not_found" });
  });

  app.setErrorHandler(
    (err: Error & { statusCode?: number; code?: string }, req, reply) => {
      req.log.error({ err, reqId: req.id });
      if (hasZodFastifySchemaValidationErrors(err)) {
        return reply
          .code(400)
          .send({ error: "validation_error", issues: err.validation });
      }
      if (err.code === "P2002") {
        return reply.code(409).send({ error: "conflict" });
      }
      if (err.code === "P2025") {
        return reply.code(404).send({ error: "not_found" });
      }
      // Redis down (local dev without Docker, failover gap, …): fail the
      // request fast with a clear 503 instead of a generic 500. Matches
      // ioredis closed-connection errors and our ping timeout.
      const msg = err.message ?? "";
      if (
        err.code === "ECONNREFUSED" ||
        /connection is closed|redis.*unavailable|redis ping timeout/i.test(msg)
      ) {
        return reply.code(503).send({ error: "redis_unavailable" });
      }
      const status =
        err.statusCode && err.statusCode < 500 ? err.statusCode : 500;
      reply
        .code(status)
        .send({ error: status === 500 ? "internal_error" : "request_failed" });
    },
  );

  return app;
}
