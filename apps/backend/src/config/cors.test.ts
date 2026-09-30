import cors from "@fastify/cors";
import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { corsOrigins } from "./cors.js";

const productionEnv = {
  APP_URL: "https://app.trqsh.uz",
  NODE_ENV: "production" as const,
};

async function preflight(origin: string) {
  const app = Fastify();
  await app.register(cors, {
    origin: corsOrigins(productionEnv),
    credentials: true,
    methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  });
  app.post("/oauth2/token", async () => ({ ok: true }));
  const response = await app.inject({
    method: "OPTIONS",
    url: "/oauth2/token",
    headers: {
      origin,
      "access-control-request-method": "POST",
      "access-control-request-headers": "content-type,authorization",
    },
  });
  await app.close();
  return response;
}

describe("M-BACKEND-6: CORS origins", () => {
  it("M-BACKEND-6: does not allow arbitrary localhost ports or untrusted origins", async () => {
    for (const origin of [
      "http://localhost:1420",
      "http://localhost:1421",
      "http://127.0.0.1:3000",
      "https://evil.example",
    ]) {
      const response = await preflight(origin);
      expect(response.statusCode).toBe(204);
      expect(response.headers["access-control-allow-origin"]).toBeUndefined();
    }
  });

  it("M-BACKEND-6: keeps local web origins limited to non-production environments", () => {
    expect(corsOrigins(productionEnv)).not.toContain("http://localhost:3000");
    expect(
      corsOrigins({ ...productionEnv, NODE_ENV: "development" }),
    ).toContain("http://localhost:3000");
    expect(
      corsOrigins({ ...productionEnv, NODE_ENV: "development" }),
    ).toContain("http://localhost:1420");
  });
});
