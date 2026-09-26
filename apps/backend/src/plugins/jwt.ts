import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import fp from "fastify-plugin";
import { denyKey } from "../modules/oauth2/oauth2.store.js";
import { redis } from "../queues/connection.js";

declare module "fastify" {
  interface FastifyInstance {
    authenticate: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

export default fp(async (app: FastifyInstance) => {
  app.decorate(
    "authenticate",
    async (req: FastifyRequest, reply: FastifyReply) => {
      try {
        await req.jwtVerify();
      } catch {
        // Must return the reply: otherwise Fastify continues into the
        // route handler with req.user unset (auth bypass + double-send).
        return reply.code(401).send({ error: "unauthorized" });
      }
      // Enforce access-token revocation (POST /oauth2/revoke writes
      // oauth2:deny:{jti}). Previously written but never checked, so revoke
      // was a no-op until 15m expiry. Fail open on Redis outage (short-lived
      // JWTs bound the window); fail closed on explicit deny.
      try {
        const user = req.user as { jti?: unknown } | undefined;
        const jti = user?.jti;
        if (typeof jti === "string" && jti !== "") {
          const denied = await redis.get(denyKey(jti));
          if (denied) {
            return reply.code(401).send({ error: "revoked" });
          }
        }
      } catch {
        // Redis down: allow the request (15m JWT bounds risk); /ready already
        // reports redis down for operators.
      }
    },
  );
});
