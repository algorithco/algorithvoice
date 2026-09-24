import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

const API = process.env.API_URL ?? "https://api.trqsh.uz";
const COOKIE_NAME = "__Host-av_at";
const REFRESH_COOKIE_NAME = "__Host-av_rt";
const COOKIE_MAX_AGE = 60 * 15; // 15m matches JWT
const REFRESH_COOKIE_MAX_AGE = 30 * 24 * 60 * 60; // 30d sliding refresh
const SKEW_SEC = 60;

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

  let res: Response;
  try {
    res = await fetch(`${API}/auth/refresh`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ refresh_token: rt }),
      cache: "no-store",
    });
  } catch {
    return NextResponse.next();
  }
  if (!res.ok) {
    // Revoked/expired family — clear both and send to login with returnTo.
    const loginUrl = req.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.searchParams.set("returnTo", req.nextUrl.pathname);
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
    const data = (await res.json()) as {
      accessToken?: string;
      refreshToken?: string;
    };
    if (!data.accessToken) return NextResponse.next();
    const next = NextResponse.next();
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
