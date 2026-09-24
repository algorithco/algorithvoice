import { NextResponse } from "next/server";

const API = process.env.API_URL ?? "https://api.trqsh.uz";
const COOKIE_NAME = "__Host-av_at";
const REFRESH_COOKIE_NAME = "__Host-av_rt";
const COOKIE_MAX_AGE = 60 * 15;
const REFRESH_COOKIE_MAX_AGE = 30 * 24 * 60 * 60;

function getCookieValue(cookieHeader: string, name: string): string | null {
  const found = cookieHeader
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${name}=`));
  return found ? decodeURIComponent(found.slice(name.length + 1)) : null;
}

export async function GET(req: Request) {
  const cookie = req.headers.get("cookie") ?? "";
  // Try Authorization header first, then cookie
  const authHeader = req.headers.get("authorization");
  const token =
    authHeader?.replace(/^Bearer\s+/i, "") ??
    getCookieValue(cookie, COOKIE_NAME);
  if (!token) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const res = await fetch(`${API}/auth/me`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (res.status !== 401) {
    const text = await res.text();
    return new NextResponse(text, {
      status: res.status,
      headers: {
        "content-type": res.headers.get("content-type") ?? "application/json",
      },
    });
  }

  // Access expired — spend the refresh cookie once and retry instead of
  // surfacing a logout for a session that is still alive.
  const refreshToken = getCookieValue(cookie, REFRESH_COOKIE_NAME);
  if (!refreshToken) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const refreshRes = await fetch(`${API}/auth/refresh`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ refresh_token: refreshToken }),
      cache: "no-store",
    });
    if (!refreshRes.ok) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    const pair = (await refreshRes.json()) as {
      accessToken?: string;
      refreshToken?: string;
    };
    if (!pair.accessToken) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    const retry = await fetch(`${API}/auth/me`, {
      headers: { Authorization: `Bearer ${pair.accessToken}` },
      cache: "no-store",
    });
    const text = await retry.text();
    const response = new NextResponse(text, {
      status: retry.status,
      headers: {
        "content-type": retry.headers.get("content-type") ?? "application/json",
      },
    });
    response.cookies.set(COOKIE_NAME, pair.accessToken, {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: COOKIE_MAX_AGE,
    });
    if (pair.refreshToken) {
      response.cookies.set(REFRESH_COOKIE_NAME, pair.refreshToken, {
        httpOnly: true,
        secure: true,
        sameSite: "lax",
        path: "/",
        maxAge: REFRESH_COOKIE_MAX_AGE,
      });
    }
    return response;
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
}
