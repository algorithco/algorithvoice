import { NextResponse } from "next/server";

const API = process.env.API_URL ?? "http://localhost:3001";
const COOKIE_NAME = "__Host-av_at";
const COOKIE_MAX_AGE = 60 * 15; // 15m matches JWT

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
  const setCookie = res.headers.get("set-cookie");
  if (setCookie) headers.set("set-cookie", setCookie);

  if (res.ok) {
    try {
      const data = JSON.parse(text) as { accessToken?: string };
      const token = data.accessToken;
      if (token) {
        // __Host- cookies are rejected by browsers unless Secure is set —
        // even in local dev. localhost is a trustworthy origin, so
        // Secure-over-http still works there.
        const response = new NextResponse(text, {
          status: res.status,
          headers,
        });
        response.cookies.set(COOKIE_NAME, token, {
          httpOnly: true,
          secure: true,
          sameSite: "lax",
          path: "/",
          maxAge: COOKIE_MAX_AGE,
        });
        const backendCookie = res.headers.get("set-cookie");
        if (backendCookie) response.headers.append("set-cookie", backendCookie);
        return response;
      }
    } catch {
      // fall through to plain response
    }
  }
  return new NextResponse(text, { status: res.status, headers });
}
