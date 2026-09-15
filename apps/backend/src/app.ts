import { randomUUID } from "node:crypto";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import jwt from "@fastify/jwt";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import websocket from "@fastify/websocket";
import Fastify from "fastify";
import {
  hasZodFastifySchemaValidationErrors,
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from "fastify-type-provider-zod";
import { loadEnv, setAppEnv } from "./config/env.js";
import { authRoutes } from "./modules/auth/auth.routes.js";
import { billingRoutes } from "./modules/billing/billing.routes.js";
import { licenseRoutes } from "./modules/devices/license.routes.js";
import { sttRoutes } from "./modules/stt/stt.routes.js";
import { usageRoutes } from "./modules/usage/usage.routes.js";
import jwtPlugin from "./plugins/jwt.js";
import prismaPlugin from "./plugins/prisma.js";
import { redis } from "./queues/connection.js";

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
      ],
    },
    trustProxy: true,
    genReqId: () => randomUUID(),
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  app.register(cors, {
    origin: [env.APP_URL, "tauri://localhost", "http://tauri.localhost"],
    credentials: true,
    methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  });
  app.register(helmet);
  app.register(cookie);
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
      const pong = await redis.ping();
      checks.redis = pong === "PONG" ? "ok" : "down";
    } catch {
      checks.redis = "down";
    }
    if (checks.db === "ok" && checks.redis === "ok") {
      return { ok: true, checks };
    }
    return reply.code(503).send({ ok: false, checks });
  });

  app.register(authRoutes, { prefix: "/auth" });
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
      const status =
        err.statusCode && err.statusCode < 500 ? err.statusCode : 500;
      reply
        .code(status)
        .send({ error: status === 500 ? "internal_error" : "request_failed" });
    },
  );

  return app;
}
