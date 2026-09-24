import {
  authPairSchema,
  errorSchema,
  loginSchema,
  signupSchema,
  userSchema,
} from "@algorith-voice/shared-types";
import type { AuthProvider, DeviceType } from "@prisma/client";
import * as argon2 from "argon2";
import type { FastifyInstance } from "fastify";
import { getAppEnv } from "../../config/env.js";
import {
  hashRefreshToken,
  newFamilyId,
  newOpaqueToken,
  REFRESH_ABSOLUTE_SEC,
  REFRESH_SLIDING_SEC,
} from "../oauth2/oauth2.store.js";

// ---- GitHub OAuth (Phase 3, minimal) ----
// Browser (web) + desktop deep-link flows share one callback. The client
// secret never leaves the server: `start` redirects to github.com, GitHub
// redirects back to `${API_URL}/auth/oauth/github/callback`, we exchange
// the code server-side and finish with a first-party redirect.
// State is a short-lived backend-signed JWT (no Redis needed): it binds
// the provider, the validated return callback, and the client state.
const HASH_OPTS = {
  type: argon2.argon2id,
  memoryCost: 65536,
  timeCost: 3,
  parallelism: 4,
  hashLength: 32,
} as const;

// Precomputed dummy hash: verified on login-miss so valid and invalid
// emails take the same time (no timing oracle for user enumeration).
const DUMMY_HASH =
  "$argon2id$v=19$m=65536,t=3,p=4$xSOEF+zYJxUh2Z6QplEj7g$bmxrOQUSGpzpBURngAcoUZcv+azJynPluSfIYUd0v24";

function toDeviceType(input: unknown): DeviceType {
  switch (input) {
    case "desktop-windows":
      return "DESKTOP_WINDOWS";
    case "desktop-linux":
      return "DESKTOP_LINUX";
    default:
      return "DESKTOP_MACOS";
  }
}

const publicUser = {
  id: true,
  email: true,
  name: true,
  planTier: true,
  stripeCustomerId: true,
  createdAt: true,
} as const;

function toUserSchema(u: {
  id: string;
  email: string;
  name: string | null;
  planTier: string;
  stripeCustomerId: string | null;
  createdAt: Date;
}) {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    planTier: u.planTier,
    stripeCustomerId: u.stripeCustomerId,
    createdAt: u.createdAt.toISOString(),
  };
}

interface OAuthState {
  provider: string;
  device: string;
  cb: string;
  s?: string;
}

interface GitHubUser {
  id: number;
  login: string;
  name: string | null;
  email: string | null;
}

interface GitHubEmail {
  email: string;
  primary: boolean;
  verified: boolean;
}

function githubRedirectUri(apiUrl: string): string {
  return `${apiUrl.replace(/\/$/, "")}/auth/oauth/github/callback`;
}

// ---- Web sliding sessions (fixes 15m hard logout) ----
// Email/password web logins mint a short-lived access JWT (15m) plus an
// opaque rotating refresh token stored hashed in the Session table (30d
// sliding, 90d absolute cap — same windows as the desktop OAuth2 flow).
// Raw refresh values never touch the DB or logs; revocation kills the
// whole family so token theft cannot be replayed.
async function mintWebSession(
  prisma: {
    session: {
      create: (args: {
        data: {
          userId: string;
          refreshHash: string;
          familyId: string;
          deviceInfo?: string;
          ip?: string;
          expiresAt: Date;
          absoluteLimitAt: Date;
        };
      }) => Promise<unknown>;
    };
  },
  userId: string,
  pepper: string,
  opts?: { deviceInfo?: string; ip?: string },
): Promise<string> {
  const refreshToken = newOpaqueToken();
  const now = new Date();
  await prisma.session.create({
    data: {
      userId,
      refreshHash: hashRefreshToken(refreshToken, pepper),
      familyId: newFamilyId(),
      deviceInfo: (opts?.deviceInfo ?? "web").slice(0, 200),
      ip: opts?.ip,
      expiresAt: new Date(now.getTime() + REFRESH_SLIDING_SEC * 1000),
      absoluteLimitAt: new Date(now.getTime() + REFRESH_ABSOLUTE_SEC * 1000),
    },
  });
  return refreshToken;
}

async function exchangeGitHubCode(
  code: string,
  clientId: string,
  clientSecret: string,
  redirectUri: string,
): Promise<string | null> {
  let res: Response;
  try {
    res = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: redirectUri,
      }),
    });
  } catch {
    return null;
  }
  if (!res.ok) return null;
  const data = (await res.json().catch(() => null)) as {
    access_token?: string;
    error?: string;
  } | null;
  return typeof data?.access_token === "string" ? data.access_token : null;
}

async function fetchGitHubUser(token: string): Promise<GitHubUser | null> {
  try {
    const res = await fetch("https://api.github.com/user", {
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/vnd.github+json",
        "user-agent": "algorith-voice",
      },
    });
    if (!res.ok) return null;
    const u = (await res.json()) as GitHubUser;
    if (typeof u?.id !== "number") return null;
    // Public email is often null — fall back to the verified primary below.
    try {
      const er = await fetch("https://api.github.com/user/emails", {
        headers: {
          authorization: `Bearer ${token}`,
          accept: "application/vnd.github+json",
          "user-agent": "algorith-voice",
        },
      });
      if (er.ok) {
        const emails = (await er.json()) as GitHubEmail[];
        const primary = emails.find((e) => e.primary && e.verified)?.email;
        const anyVerified = emails.find((e) => e.verified)?.email;
        if (primary ?? anyVerified) u.email = primary ?? anyVerified ?? null;
      }
    } catch {
      // Keep whatever /user returned.
    }
    return u;
  } catch {
    return null;
  }
}

// NOTE: refresh rotation + OAuth land in Phase 3. Contracts are stable;
// stubs return 501 with a fixed envelope (no roadmap leakage on the wire).
export async function authRoutes(app: FastifyInstance) {
  app.post(
    "/signup",
    {
      schema: {
        body: signupSchema,
        response: { 201: authPairSchema, 409: errorSchema },
      },
      config: { rateLimit: { max: 10, timeWindow: "1 hour" } },
    },
    async (req, reply) => {
      const {
        email,
        password,
        name,
        deviceName,
        deviceType,
        deviceFingerprint,
      } = req.body as {
        email: string;
        password: string;
        name?: string;
        deviceName?: string;
        deviceType?: string;
        deviceFingerprint?: string;
      };
      const passwordHash = await argon2.hash(password, { ...HASH_OPTS });
      try {
        const user = await app.prisma.$transaction(async (tx) => {
          const created = await tx.user.create({
            data: { email, name, passwordHash, planTier: "free" },
            select: publicUser,
          });
          // Phase 1 pairing: register the signup device (seats in Phase 3).
          if (deviceName) {
            await tx.device.create({
              data: {
                userId: created.id,
                name: deviceName,
                type: toDeviceType(deviceType),
                fingerprint: deviceFingerprint ?? null,
                lastSeenAt: new Date(),
              },
            });
            await tx.auditLog.create({
              data: { actorUserId: created.id, action: "device.create" },
            });
          }
          await tx.auditLog.create({
            data: { actorUserId: created.id, action: "auth.signup" },
          });
          return created;
        });
        const accessToken = app.jwt.sign({ sub: user.id });
        const env = getAppEnv();
        const refreshToken = await mintWebSession(
          app.prisma,
          user.id,
          env.JWT_REFRESH_PEPPER,
          { deviceInfo: "web-signup", ip: req.ip },
        );
        return reply
          .code(201)
          .send({ user: toUserSchema(user), accessToken, refreshToken });
      } catch (e: unknown) {
        if (
          typeof e === "object" &&
          e !== null &&
          "code" in e &&
          e.code === "P2002"
        ) {
          return reply.code(409).send({ error: "email_taken" });
        }
        throw e;
      }
    },
  );

  app.post(
    "/login",
    {
      schema: { body: loginSchema },
      config: { rateLimit: { max: 5, timeWindow: "10 minutes" } },
    },
    async (req, reply) => {
      const { email, password } = req.body as {
        email: string;
        password: string;
      };
      const user = await app.prisma.user.findUnique({
        where: { email },
        select: { ...publicUser, passwordHash: true },
      });
      const ok = user?.passwordHash
        ? await argon2.verify(user.passwordHash, password).catch(() => false)
        : await argon2.verify(DUMMY_HASH, password).catch(() => false);
      if (!user?.passwordHash || !ok) {
        return reply.code(401).send({ error: "invalid_credentials" });
      }
      const accessToken = app.jwt.sign({ sub: user.id });
      const env = getAppEnv();
      const refreshToken = await mintWebSession(
        app.prisma,
        user.id,
        env.JWT_REFRESH_PEPPER,
        { deviceInfo: "web-login", ip: req.ip },
      );
      return { user: toUserSchema(user), accessToken, refreshToken };
    },
  );

  app.post("/logout", async (req) => {
    // Revoke the web refresh family when the client sends it; always 200
    // so logout never blocks on an already-expired token. Cookie clearing
    // stays with the web BFF / desktop keyring clear.
    try {
      const body = (req.body ?? {}) as { refresh_token?: unknown };
      const presented =
        typeof body.refresh_token === "string" ? body.refresh_token : null;
      if (presented) {
        const env = getAppEnv();
        const row = await app.prisma.session.findUnique({
          where: {
            refreshHash: hashRefreshToken(presented, env.JWT_REFRESH_PEPPER),
          },
          select: { familyId: true },
        });
        if (row) {
          await app.prisma.session.updateMany({
            where: { familyId: row.familyId, revokedAt: null },
            data: { revokedAt: new Date() },
          });
        }
      }
    } catch {
      // Best-effort: logout must not fail.
    }
    return { ok: true };
  });

  app.post(
    "/refresh",
    { config: { rateLimit: { max: 30, timeWindow: "10 minutes" } } },
    async (req, reply) => {
      const body = (req.body ?? {}) as { refresh_token?: unknown };
      const presented =
        typeof body.refresh_token === "string" ? body.refresh_token : null;
      if (!presented) {
        return reply.code(400).send({ error: "invalid_request" });
      }
      const env = getAppEnv();
      const row = await app.prisma.session.findUnique({
        where: {
          refreshHash: hashRefreshToken(presented, env.JWT_REFRESH_PEPPER),
        },
      });
      const now = new Date();
      // Unknown, revoked, expired, or past absolute cap: kill the family so
      // a stolen token cannot be replayed, then fail closed.
      if (
        !row ||
        row.revokedAt !== null ||
        row.expiresAt <= now ||
        row.absoluteLimitAt <= now
      ) {
        if (row) {
          await app.prisma.session.updateMany({
            where: { familyId: row.familyId, revokedAt: null },
            data: { revokedAt: now },
          });
        }
        return reply.code(401).send({ error: "invalid_grant" });
      }
      const next = newOpaqueToken();
      await app.prisma.$transaction([
        app.prisma.session.update({
          where: { id: row.id },
          data: { revokedAt: now },
        }),
        app.prisma.session.create({
          data: {
            userId: row.userId,
            refreshHash: hashRefreshToken(next, env.JWT_REFRESH_PEPPER),
            familyId: row.familyId,
            deviceInfo: row.deviceInfo,
            ip: req.ip,
            expiresAt: new Date(now.getTime() + REFRESH_SLIDING_SEC * 1000),
            // Absolute cap never extends.
            absoluteLimitAt: row.absoluteLimitAt,
          },
        }),
      ]);
      const accessToken = app.jwt.sign({ sub: row.userId });
      return { accessToken, refreshToken: next };
    },
  );

  app.post("/oauth/:provider", async (_req, reply) => {
    return reply.code(501).send({ error: "not_implemented" });
  });

  // GitHub callback: GitHub redirects here with ?code=&state=. The state
  // is the backend-signed JWT minted by /start (binds return callback).
  // Registered as the OAuth app's Authorization callback URL, e.g.
  // https://api.trqsh.uz/auth/oauth/github/callback
  app.get(
    "/oauth/github/callback",
    { config: { rateLimit: { max: 30, timeWindow: "10 minutes" } } },
    async (req, reply) => {
      const q = req.query as { code?: string; state?: string };
      const { getAppEnv } = await import("../../config/env.js");
      const env = getAppEnv();
      const fail = (error: string) => reply.code(400).send({ error });
      if (!q.code || !q.state) return fail("invalid_request");
      let st: OAuthState;
      try {
        st = app.jwt.verify<OAuthState>(q.state);
      } catch {
        return fail("invalid_state");
      }
      if (st.provider !== "github" || typeof st.cb !== "string" || !st.cb) {
        return fail("invalid_state");
      }
      const clientId = env.OAUTH_GITHUB_CLIENT_ID;
      const clientSecret = env.OAUTH_GITHUB_CLIENT_SECRET;
      if (!clientId || !clientSecret) {
        return fail("oauth_not_configured");
      }
      const redirectUri = githubRedirectUri(
        env.API_URL ?? "http://localhost:3001",
      );
      const ghToken = await exchangeGitHubCode(
        q.code,
        clientId,
        clientSecret,
        redirectUri,
      );
      const errRedirect = (error: string) => {
        const sep = st.cb.includes("?") ? "&" : "?";
        const params = new URLSearchParams({ error, provider: "github" });
        if (st.s) params.set("state", st.s);
        // Desktop deep-link callbacks take the same shape as web:
        // the Tauri shell parses access_token/email/error from the URL.
        return reply.redirect(`${st.cb}${sep}${params.toString()}`, 302);
      };
      if (!ghToken) return errRedirect("oauth_failed");
      const gh = await fetchGitHubUser(ghToken);
      if (!gh?.email) return errRedirect("no_verified_email");
      const email = gh.email.toLowerCase();
      const provider: AuthProvider = "GITHUB";
      const providerId = String(gh.id);
      let userId: string;
      let isSignup = false;
      const linked = await app.prisma.account.findUnique({
        where: { provider_providerId: { provider, providerId } },
        select: { userId: true },
      });
      if (linked) {
        userId = linked.userId;
      } else {
        const existing = await app.prisma.user.findUnique({
          where: { email },
          select: { id: true, name: true },
        });
        if (existing) {
          userId = existing.id;
          await app.prisma.account.create({
            data: {
              userId,
              provider,
              providerId,
              email,
            },
          });
          if (!existing.name && gh.name) {
            await app.prisma.user.update({
              where: { id: userId },
              data: { name: gh.name },
            });
          }
        } else {
          isSignup = true;
          const created = await app.prisma.user.create({
            data: {
              email,
              name: gh.name ?? gh.login,
              passwordHash: null,
              planTier: "free",
              accounts: {
                create: { provider, providerId, email },
              },
              auditLogs: {
                create: { action: "auth.oauth_signup" },
              },
            },
            select: { id: true },
          });
          userId = created.id;
        }
      }
      if (!isSignup) {
        await app.prisma.auditLog.create({
          data: { actorUserId: userId, action: "auth.oauth_login" },
        });
      }
      // Desktop deep-link logins predate /license/activate on older builds:
      // ensure the first desktop link registers a Device so the dashboard
      // stops showing 0 linked. Web callbacks must not create devices.
      // Bookkeeping never breaks login.
      try {
        if (st.cb.toLowerCase().startsWith("algorithvoice:")) {
          const count = await app.prisma.device.count({
            where: { userId },
          });
          if (count === 0) {
            const created = await app.prisma.device.create({
              data: {
                userId,
                name: "Desktop",
                type: toDeviceType(undefined),
                fingerprint: `oauth-${Date.now().toString(36)}-${userId.slice(0, 8)}`,
                lastSeenAt: new Date(),
              },
              select: { id: true },
            });
            await app.prisma.auditLog.create({
              data: {
                actorUserId: userId,
                deviceId: created.id,
                action: "device.create",
              },
            });
          } else {
            const latest = await app.prisma.device.findFirst({
              where: { userId },
              orderBy: { lastSeenAt: "desc" },
              select: { id: true },
            });
            if (latest) {
              await app.prisma.device.update({
                where: { id: latest.id },
                data: { lastSeenAt: new Date() },
              });
            }
          }
        }
      } catch {
        // Ignore — the redirect below still completes sign-in.
      }
      const accessToken = app.jwt.sign({ sub: userId });
      const sep = st.cb.includes("?") ? "&" : "?";
      const params = new URLSearchParams({
        access_token: accessToken,
        email,
        provider: "github",
      });
      if (st.s) params.set("state", st.s);
      return reply.redirect(`${st.cb}${sep}${params.toString()}`, 302);
    },
  );

  // Desktop deep-link flow: GET /auth/oauth/:provider/start?callback=algorithvoice://auth-callback&device=Desktop
  // Opens system browser; backend must validate and either redirect to provider OAuth
  // or redirect back to the deep-link with an error so the Tauri shell can complete.
  app.get("/oauth/:provider/start", async (req, reply) => {
    const { provider } = req.params as { provider: string };
    const query = req.query as {
      callback?: string;
      device?: string;
      state?: string;
    };
    const callback = query.callback ?? "algorithvoice://auth-callback";
    const state = typeof query.state === "string" ? query.state : undefined;
    const device = typeof query.device === "string" ? query.device : undefined;
    const allowedProviders = new Set(["google", "github"]);
    if (!allowedProviders.has(provider)) {
      return reply.code(400).send({ error: "unknown_provider" });
    }
    // Validate state format if provided (base64url 16 bytes ~22 chars, allow 16-128)
    if (state !== undefined && !/^[A-Za-z0-9_-]{16,128}$/.test(state)) {
      return reply.code(400).send({ error: "invalid_state" });
    }
    // Web browser flow (device=web): the web app navigates a full browser
    // tab here, so accept an absolute http(s) callback to the web origin
    // (or a same-origin path resolved against APP_URL) instead of an
    // algorithvoice:// deep link. Redirects carry the same honest error
    // shape (?error=&provider=[&state=]) so the login/register pages can
    // show an inline notice. GitHub is wired (redirects to github.com);
    // Google stays an oauth_not_configured/not_implemented stub until its
    // handler lands.
    // TODO(web-oauth): Google provider authorize redirect + callback.
    if (device === "web") {
      const { getAppEnv } = await import("../../config/env.js");
      const env = getAppEnv();
      const allowedOrigins = new Set<string>();
      try {
        allowedOrigins.add(new URL(env.APP_URL).origin);
      } catch {
        // APP_URL is validated at boot — unreachable in practice.
      }
      // Local-dev loopback (web :3000, backend :3001, same machine).
      for (const o of [
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:3001",
        "http://127.0.0.1:3001",
      ]) {
        allowedOrigins.add(o);
      }
      const raw = (query.callback ?? "").trim();
      let callbackUrl: URL | null = null;
      try {
        callbackUrl =
          raw === ""
            ? new URL("/login", env.APP_URL)
            : raw.startsWith("/") && !raw.startsWith("//")
              ? new URL(raw, env.APP_URL)
              : new URL(raw);
      } catch {
        callbackUrl = null;
      }
      if (
        !callbackUrl ||
        (callbackUrl.protocol !== "http:" &&
          callbackUrl.protocol !== "https:") ||
        !allowedOrigins.has(callbackUrl.origin)
      ) {
        return reply.code(400).send({ error: "invalid_callback" });
      }
      const configured =
        provider === "google"
          ? !!env.OAUTH_GOOGLE_CLIENT_ID && !!env.OAUTH_GOOGLE_CLIENT_SECRET
          : !!env.OAUTH_GITHUB_CLIENT_ID && !!env.OAUTH_GITHUB_CLIENT_SECRET;
      const buildWebRedirect = (error: string) => {
        callbackUrl.searchParams.set("error", error);
        callbackUrl.searchParams.set("provider", provider);
        if (state) callbackUrl.searchParams.set("state", state);
        return callbackUrl.toString();
      };
      if (!configured) {
        return reply.redirect(buildWebRedirect("oauth_not_configured"), 302);
      }
      if (provider === "github") {
        const oauthState = app.jwt.sign(
          { provider, device: "web", cb: callbackUrl.toString(), s: state },
          { expiresIn: "10m" },
        );
        const authUrl = new URL("https://github.com/login/oauth/authorize");
        authUrl.searchParams.set("client_id", env.OAUTH_GITHUB_CLIENT_ID ?? "");
        authUrl.searchParams.set(
          "redirect_uri",
          githubRedirectUri(env.API_URL ?? "http://localhost:3001"),
        );
        authUrl.searchParams.set("scope", "user:email");
        authUrl.searchParams.set("state", oauthState);
        return reply.redirect(authUrl.toString(), 302);
      }
      // Google handler not yet wired — honest stub redirect.
      return reply.redirect(buildWebRedirect("not_implemented"), 302);
    }
    // Validate callback scheme — must be algorithvoice:// to avoid open redirect.
    const isValidCallback =
      typeof callback === "string" &&
      callback.toLowerCase().startsWith("algorithvoice:");
    if (!isValidCallback) {
      return reply.code(400).send({ error: "invalid_callback" });
    }
    // GitHub is wired above (real provider redirect). Google stays a stub:
    // redirect back with error so desktop's auth-callback listener resolves
    // (otherwise openUrl would show a dead 501 page with no deep-link return).
    const { getAppEnv } = await import("../../config/env.js");
    const env = getAppEnv();
    const configured =
      provider === "google"
        ? !!env.OAUTH_GOOGLE_CLIENT_ID && !!env.OAUTH_GOOGLE_CLIENT_SECRET
        : !!env.OAUTH_GITHUB_CLIENT_ID && !!env.OAUTH_GITHUB_CLIENT_SECRET;
    const buildRedirect = (error: string) => {
      const url = new URL(callback);
      url.searchParams.set("error", error);
      url.searchParams.set("provider", provider);
      if (state) url.searchParams.set("state", state);
      return url.toString();
    };
    if (!configured) {
      return reply.redirect(buildRedirect("oauth_not_configured"), 302);
    }
    if (provider === "github") {
      const oauthState = app.jwt.sign(
        { provider, device: device ?? "desktop", cb: callback, s: state },
        { expiresIn: "10m" },
      );
      const authUrl = new URL("https://github.com/login/oauth/authorize");
      authUrl.searchParams.set("client_id", env.OAUTH_GITHUB_CLIENT_ID ?? "");
      authUrl.searchParams.set(
        "redirect_uri",
        githubRedirectUri(env.API_URL ?? "http://localhost:3001"),
      );
      authUrl.searchParams.set("scope", "user:email");
      authUrl.searchParams.set("state", oauthState);
      return reply.redirect(authUrl.toString(), 302);
    }
    // Google handler not yet wired — return honest stub redirect.
    return reply.redirect(buildRedirect("not_implemented"), 302);
  });

  app.get(
    "/me",
    {
      onRequest: [app.authenticate],
      schema: { response: { 200: userSchema } },
    },
    async (req) => {
      const { sub } = req.user as { sub: string };
      const user = await app.prisma.user.findUniqueOrThrow({
        where: { id: sub },
        select: publicUser,
      });
      return toUserSchema(user);
    },
  );

  app.get("/providers", { onRequest: [app.authenticate] }, async (req) => {
    const { sub } = req.user as { sub: string };
    const [accounts, user] = await Promise.all([
      app.prisma.account.findMany({
        where: { userId: sub },
        select: { provider: true, email: true },
      }),
      app.prisma.user.findUnique({
        where: { id: sub },
        select: { email: true },
      }),
    ]);
    if (accounts.length === 0) {
      return {
        providers: [
          { provider: "EMAIL", email: user?.email ?? "", label: "Email" },
        ],
      };
    }
    return {
      providers: accounts.map((a) => ({
        provider: a.provider,
        email: a.email,
        label:
          a.provider === "GITHUB"
            ? "GitHub"
            : a.provider === "GOOGLE"
              ? "Google"
              : a.provider,
      })),
    };
  });
}
