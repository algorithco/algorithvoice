import { NextResponse } from "next/server";
import { getApiUrl } from "@/lib/api-url";

const API = getApiUrl();
const COOKIE_NAME = "__Host-av_at";
const REFRESH_COOKIE_NAME = "__Host-av_rt";
const COOKIE_MAX_AGE = 60 * 15; // 15m matches JWT
const REFRESH_COOKIE_MAX_AGE = 30 * 24 * 60 * 60; // 30d sliding refresh

function getCookieValue(cookieHeader: string, name: string): string | null {
  const found = cookieHeader
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${name}=`));
  return found ? decodeURIComponent(found.slice(name.length + 1)) : null;
}

// Sliding web sessions: exchanges the httpOnly refresh cookie for a fresh
// access + refresh pair and re-sets both cookies. Called by middleware and
// by proxies on a 401 from the backend.
export async function POST(req: Request) {
  const cookieHeader = req.headers.get("cookie") ?? "";
  const refreshToken = getCookieValue(cookieHeader, REFRESH_COOKIE_NAME);
  if (!refreshToken) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  let res: Response;
  try {
    res = await fetch(`${API}/auth/refresh`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ refresh_token: refreshToken }),
      cache: "no-store",
    });
  } catch {
    return NextResponse.json({ error: "network_error" }, { status: 502 });
  }
  const text = await res.text();
  if (!res.ok) {
    const response = new NextResponse(text, {
      status: res.status,
      headers: { "content-type": "application/json" },
    });
    let invalidGrant = false;
    if (res.status === 400 || res.status === 401) {
      try {
        invalidGrant =
          (JSON.parse(text) as { error?: unknown }).error === "invalid_grant";
      } catch {
        invalidGrant = false;
      }
    }
    if (invalidGrant) {
      for (const name of [COOKIE_NAME, REFRESH_COOKIE_NAME]) {
        response.cookies.set(name, "", {
          httpOnly: true,
          secure: true,
          sameSite: "lax",
          path: "/",
          maxAge: 0,
        });
      }
    }
    return response;
  }
  try {
    const data = JSON.parse(text) as {
      accessToken?: string;
      refreshToken?: string;
    };
    if (!data.accessToken) throw new Error("no access token");
    const response = NextResponse.json({ ok: true });
    response.cookies.set(COOKIE_NAME, data.accessToken, {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: COOKIE_MAX_AGE,
    });
    if (data.refreshToken) {
      response.cookies.set(REFRESH_COOKIE_NAME, data.refreshToken, {
        httpOnly: true,
        secure: true,
        sameSite: "lax",
        path: "/",
        maxAge: REFRESH_COOKIE_MAX_AGE,
      });
    }
    return response;
  } catch {
    return NextResponse.json({ error: "invalid_response" }, { status: 502 });
  }
}
