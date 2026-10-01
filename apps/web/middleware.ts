import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getApiUrl } from "@/lib/api-url";

const API = getApiUrl();
const COOKIE_NAME = "__Host-av_at";
const REFRESH_COOKIE_NAME = "__Host-av_rt";
const COOKIE_MAX_AGE = 60 * 15; // 15m matches JWT
const REFRESH_COOKIE_MAX_AGE = 30 * 24 * 60 * 60; // 30d sliding refresh
const SKEW_SEC = 60;
const refreshes = new Map<string, Promise<{ status: number; body: string }>>();

export const config = {
  matcher: ["/dashboard/:path*", "/admin/:path*", "/oauth2/consent/:path*"],
};

function accessExpiresAt(token: string): number | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const payload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const json = atob(payload);
    const data = JSON.parse(json) as { exp?: unknown };
    return typeof data.exp === "number" ? data.exp : null;
  } catch {
    return null;
  }
}

function refreshOnce(refreshToken: string) {
  const existing = refreshes.get(refreshToken);
  if (existing) return existing;
  const pending = fetch(`${API}/auth/refresh`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ refresh_token: refreshToken }),
    cache: "no-store",
  })
    .then(async (response) => ({
      status: response.status,
      body: await response.text(),
    }))
    .finally(() => refreshes.delete(refreshToken));
  refreshes.set(refreshToken, pending);
  return pending;
}

function isInvalidGrant(status: number, body: string): boolean {
  if (status !== 400 && status !== 401) return false;
  try {
    return (JSON.parse(body) as { error?: unknown }).error === "invalid_grant";
  } catch {
    return false;
  }
}

function requestCookieHeader(
  original: string,
  accessToken: string,
  refreshToken?: string,
): string {
  const values = new Map<string, string>();
  for (const part of original.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name) values.set(name, rest.join("="));
  }
  values.set(COOKIE_NAME, encodeURIComponent(accessToken));
  if (refreshToken)
    values.set(REFRESH_COOKIE_NAME, encodeURIComponent(refreshToken));
  return [...values].map(([name, value]) => `${name}=${value}`).join("; ");
}

// Sliding sessions for protected pages: if the 15m access cookie is missing
// or expiring within the skew window, spend the 30d refresh cookie once and
// continue with fresh cookies. Unrecoverable sessions redirect to /login
// instead of rendering a dashboard that immediately bounces.
export async function middleware(req: NextRequest) {
  const at = req.cookies.get(COOKIE_NAME)?.value;
  if (at) {
    const exp = accessExpiresAt(at);
    if (exp !== null && exp * 1000 > Date.now() + SKEW_SEC * 1000) {
      return NextResponse.next();
    }
  }
  const rt = req.cookies.get(REFRESH_COOKIE_NAME)?.value;
  if (!rt) return NextResponse.next();

  let refresh: { status: number; body: string };
  try {
    refresh = await refreshOnce(rt);
  } catch {
    return NextResponse.next();
  }
  if (refresh.status < 200 || refresh.status >= 300) {
    if (!isInvalidGrant(refresh.status, refresh.body))
      return NextResponse.next();
    // Revoked/expired family — clear both and send to login with returnTo.
    // Include the query string (e.g. /oauth2/consent?request=…) so a desktop
    // auth handoff survives a mid-flow refresh instead of landing on an
    // "Invalid request" page that forces a second click in the desktop app.
    const loginUrl = req.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.search = "";
    loginUrl.searchParams.set(
      "returnTo",
      `${req.nextUrl.pathname}${req.nextUrl.search}`,
    );
    const redirect = NextResponse.redirect(loginUrl);
    for (const name of [COOKIE_NAME, REFRESH_COOKIE_NAME]) {
      redirect.cookies.set(name, "", {
        httpOnly: true,
        secure: true,
        sameSite: "lax",
        path: "/",
        maxAge: 0,
      });
    }
    return redirect;
  }
  try {
    const data = JSON.parse(refresh.body) as {
      accessToken?: string;
      refreshToken?: string;
    };
    if (!data.accessToken) return NextResponse.next();
    const requestHeaders = new Headers(req.headers);
    requestHeaders.set(
      "cookie",
      requestCookieHeader(
        req.headers.get("cookie") ?? "",
        data.accessToken,
        data.refreshToken,
      ),
    );
    const next = NextResponse.next({ request: { headers: requestHeaders } });
    next.cookies.set(COOKIE_NAME, data.accessToken, {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: COOKIE_MAX_AGE,
    });
    if (data.refreshToken) {
      next.cookies.set(REFRESH_COOKIE_NAME, data.refreshToken, {
        httpOnly: true,
        secure: true,
        sameSite: "lax",
        path: "/",
        maxAge: REFRESH_COOKIE_MAX_AGE,
      });
    }
    return next;
  } catch {
    return NextResponse.next();
  }
}
