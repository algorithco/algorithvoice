import { NextResponse } from "next/server";
import { getApiUrl } from "@/lib/api-url";

const API = getApiUrl();
const COOKIE_NAME = "__Host-av_at";
const REFRESH_COOKIE_NAME = "__Host-av_rt";
const COOKIE_MAX_AGE = 60 * 15; // 15m matches JWT
const REFRESH_COOKIE_MAX_AGE = 30 * 24 * 60 * 60; // 30d sliding refresh

export async function POST(req: Request) {
  const body = await req.text();
  const res = await fetch(`${API}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });
  const text = await res.text();
  const headers = new Headers({
    "content-type": res.headers.get("content-type") ?? "application/json",
  });

  if (res.ok) {
    try {
      const data = JSON.parse(text) as {
        accessToken?: string;
        refreshToken?: string;
        user?: unknown;
      };
      const token = data.accessToken;
      if (token) {
        // __Host- cookies are rejected by browsers unless Secure is set —
        // even in local dev. localhost is a trustworthy origin, so
        // Secure-over-http still works there.
        const response = NextResponse.json(
          { user: data.user },
          { status: res.status },
        );
        response.cookies.set(COOKIE_NAME, token, {
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
      }
    } catch {
      // fall through to plain response
    }
  }
  return new NextResponse(text, { status: res.status, headers });
}
