import type { FastifyInstance } from "fastify";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { redis } from "../src/queues/connection.js";
import { createTestApp, truncateTestState } from "./helpers/app.js";

describe("H3: web OAuth handoff", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    process.env.OAUTH_GITHUB_CLIENT_ID = "integration-github-client";
    process.env.OAUTH_GITHUB_CLIENT_SECRET = "integration-github-secret";
    app = await createTestApp();
  });

  beforeEach(async () => {
    await truncateTestState(app);
    vi.restoreAllMocks();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        if (url === "https://github.com/login/oauth/access_token") {
          return new Response(
            JSON.stringify({ access_token: "github-token" }),
            {
              status: 200,
              headers: { "content-type": "application/json" },
            },
          );
        }
        if (url === "https://api.github.com/user") {
          return new Response(
            JSON.stringify({
              id: 987654,
              login: "verified-user",
              name: "Verified User",
              email: "verified@example.invalid",
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        if (url === "https://api.github.com/user/emails") {
          return new Response(
            JSON.stringify([
              {
                email: "verified@example.invalid",
                primary: true,
                verified: true,
              },
            ]),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        throw new Error(`unexpected fetch: ${url}`);
      }),
    );
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    process.env.OAUTH_GITHUB_CLIENT_ID = "";
    process.env.OAUTH_GITHUB_CLIENT_SECRET = "";
    await app.close();
  });

  async function start() {
    const response = await app.inject({
      method: "GET",
      url: "/auth/oauth/github/start?device=web&callback=http%3A%2F%2F127.0.0.1%3A3000%2Flogin",
    });
    expect(response.statusCode).toBe(302);
    const location = new URL(response.headers.location ?? "");
    const state = location.searchParams.get("state");
    expect(state).toBeTruthy();
    const setCookie = response.headers["set-cookie"];
    expect(setCookie).toBeTruthy();
    const cookie = String(setCookie).split(";", 1)[0];
    return { state: state ?? "", cookie };
  }

  async function callback(state: string, cookie?: string) {
    return app.inject({
      method: "GET",
      url: `/auth/oauth/github/callback?code=oauth-code&state=${encodeURIComponent(state)}`,
      headers: cookie ? { cookie } : undefined,
    });
  }

  it("H3: callback without the initiating browser cookie is rejected", async () => {
    const initiated = await start();
    const response = await callback(initiated.state);
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "invalid_state" });
  });

  it("H3: state from another browser is rejected", async () => {
    const browserA = await start();
    const browserB = await start();
    const response = await callback(browserA.state, browserB.cookie);
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "invalid_state" });
  });

  it("M-DESKTOP-4: legacy OAuth start rejects alternate deep-link targets", async () => {
    for (const callback of [
      "algorithvoice://attacker",
      "algorithvoice://auth-callback/extra",
      "algorithvoice:auth-callback",
    ]) {
      const response = await app.inject({
        method: "GET",
        url: `/auth/oauth/github/start?device=desktop&callback=${encodeURIComponent(callback)}`,
      });
      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({ error: "invalid_callback" });
    }
  });

  it("H3: one-time code is short-lived and single-use", async () => {
    const initiated = await start();
    const completed = await callback(initiated.state, initiated.cookie);
    expect(completed.statusCode).toBe(302);
    const location = new URL(completed.headers.location ?? "");
    expect(location.searchParams.get("access_token")).toBeNull();
    const code = location.searchParams.get("code");
    expect(code).toBeTruthy();

    const key = `oauth:handoff:${code}`;
    const ttl = await redis.ttl(key);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(60);

    const first = await app.inject({
      method: "POST",
      url: "/auth/oauth/exchange",
      payload: { code },
    });
    expect(first.statusCode).toBe(200);
    expect(first.json()).toMatchObject({
      accessToken: expect.any(String),
      refreshToken: expect.any(String),
    });

    const replay = await app.inject({
      method: "POST",
      url: "/auth/oauth/exchange",
      payload: { code },
    });
    expect(replay.statusCode).toBe(400);
    expect(replay.json()).toEqual({ error: "invalid_grant" });

    const another = await start();
    const anotherCompleted = await callback(another.state, another.cookie);
    const expiredCode = new URL(
      anotherCompleted.headers.location ?? "",
    ).searchParams.get("code");
    expect(expiredCode).toBeTruthy();
    await redis.del(`oauth:handoff:${expiredCode}`);
    const expired = await app.inject({
      method: "POST",
      url: "/auth/oauth/exchange",
      payload: { code: expiredCode },
    });
    expect(expired.statusCode).toBe(400);
    expect(expired.json()).toEqual({ error: "invalid_grant" });
  });
});
