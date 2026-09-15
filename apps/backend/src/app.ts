import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import jwt from "@fastify/jwt";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import websocket from "@fastify/websocket";
import Fastify from "fastify";
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from "fastify-type-provider-zod";
import { loadEnv } from "./config/env.js";
import { authRoutes } from "./modules/auth/auth.routes.js";
import { billingRoutes } from "./modules/billing/billing.routes.js";
import { licenseRoutes } from "./modules/devices/license.routes.js";
import { sttRoutes } from "./modules/stt/stt.routes.js";
import { usageRoutes } from "./modules/usage/usage.routes.js";
import jwtPlugin from "./plugins/jwt.js";
import prismaPlugin from "./plugins/prisma.js";

export function buildApp() {
  const env = loadEnv();
  const app = Fastify({ logger: true }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  app.register(cors, { origin: [env.APP_URL], credentials: true });
  app.register(helmet);
  app.register(cookie);
  app.register(jwt, {
    secret: env.JWT_ACCESS_SECRET,
    sign: { expiresIn: "15m" },
  });
  app.register(multipart, { limits: { fileSize: 25 * 1024 * 1024 } });
  app.register(rateLimit, { global: true, max: 100, timeWindow: "1 minute" });
  app.register(websocket);

  app.register(prismaPlugin);
  app.register(jwtPlugin);

  app.get("/health", async () => ({
    ok: true,
    service: "algorith-voice-backend",
  }));
  app.get("/ready", async (req) => {
    await req.server.prisma.$queryRaw`SELECT 1`;
    return { ok: true };
  });

  app.register(authRoutes, { prefix: "/auth" });
  app.register(licenseRoutes, { prefix: "/license" });
  app.register(sttRoutes);
  app.register(billingRoutes, { prefix: "/billing" });
  app.register(usageRoutes, { prefix: "/usage" });

  app.setErrorHandler((err: Error & { statusCode?: number }, req, reply) => {
    req.log.error(err);
    const status =
      err.statusCode && err.statusCode < 500 ? err.statusCode : 500;
    reply
      .code(status)
      .send({ error: status === 500 ? "internal_error" : err.message });
  });

  return app;
}
