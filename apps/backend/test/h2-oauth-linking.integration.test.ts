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
import { createTestApp, createUser, truncateTestState } from "./helpers/app.js";

describe("H2: OAuth account linking", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    process.env.OAUTH_GITHUB_CLIENT_ID = "integration-github-client";
    process.env.OAUTH_GITHUB_CLIENT_SECRET = "integration-github-secret";
    app = await createTestApp();
  });

  beforeEach(async () => {
    await truncateTestState(app);
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    process.env.OAUTH_GITHUB_CLIENT_ID = "";
    process.env.OAUTH_GITHUB_CLIENT_SECRET = "";
    await app.close();
  });

  it("H2: refuses to auto-link an OAuth identity to a password account", async () => {
    const email = "existing-password-user@example.invalid";
    const { user } = await createUser(app, { email });
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url === "https://github.com/login/oauth/access_token") {
        return new Response(JSON.stringify({ access_token: "github-token" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (url === "https://api.github.com/user") {
        return new Response(
          JSON.stringify({
            id: 123456,
            login: "attacker-controlled-github",
            name: "Attacker",
            email,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (url === "https://api.github.com/user/emails") {
        return new Response(
          JSON.stringify([{ email, primary: true, verified: true }]),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const started = await app.inject({
      method: "GET",
      url: "/auth/oauth/github/start?device=web&callback=http%3A%2F%2F127.0.0.1%3A3000%2Flogin",
    });
    expect(started.statusCode).toBe(302);
    const state = new URL(started.headers.location ?? "").searchParams.get(
      "state",
    );
    const cookie = String(started.headers["set-cookie"]).split(";", 1)[0];
    expect(state).toBeTruthy();
    if (!state) throw new Error("OAuth start response is missing state");
    const response = await app.inject({
      method: "GET",
      url: `/auth/oauth/github/callback?code=oauth-code&state=${encodeURIComponent(state)}`,
      headers: { cookie },
    });

    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toContain(
      "error=account_exists_sign_in_first",
    );
    expect(await app.prisma.account.count({ where: { userId: user.id } })).toBe(
      0,
    );
    expect(await app.prisma.session.count({ where: { userId: user.id } })).toBe(
      0,
    );
  });

  it("H2: rejects a public GitHub email unless GitHub marks it verified", async () => {
    const email = "public-but-unverified@example.invalid";
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
              id: 654321,
              login: "public-email-user",
              email,
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        if (url === "https://api.github.com/user/emails") {
          return new Response("provider unavailable", { status: 503 });
        }
        throw new Error(`unexpected fetch: ${url}`);
      }),
    );

    const started = await app.inject({
      method: "GET",
      url: "/auth/oauth/github/start?device=web&callback=http%3A%2F%2F127.0.0.1%3A3000%2Flogin",
    });
    const state = new URL(started.headers.location ?? "").searchParams.get(
      "state",
    );
    const cookie = String(started.headers["set-cookie"]).split(";", 1)[0];
    const response = await app.inject({
      method: "GET",
      url: `/auth/oauth/github/callback?code=oauth-code&state=${encodeURIComponent(state ?? "")}`,
      headers: { cookie },
    });

    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toContain("error=no_verified_email");
    expect(await app.prisma.user.count({ where: { email } })).toBe(0);
  });
});
