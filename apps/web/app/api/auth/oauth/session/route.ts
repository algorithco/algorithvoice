import { NextResponse } from "next/server";

const API = process.env.API_URL ?? "http://localhost:3001";
const COOKIE_NAME = "__Host-av_at";
const COOKIE_MAX_AGE = 60 * 15; // 15m matches JWT

// Completes a GitHub OAuth login: the backend redirects back to the login
// page with ?access_token= (15-min first-party JWT). The browser cannot set
// httpOnly cookies itself, so it POSTs the token here; we validate it
// against the backend (/auth/me) and only then set the session cookie.
// A forged token gains nothing — /me is the authority, not this route.
export async function POST(req: Request) {
  let accessToken: unknown;
  try {
    accessToken = (await req.json())?.accessToken;
  } catch {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }
  if (typeof accessToken !== "string" || accessToken.length > 16384) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }
  let me: Response;
  try {
    me = await fetch(`${API}/auth/me`, {
      headers: { authorization: `Bearer ${accessToken}` },
    });
  } catch {
    return NextResponse.json({ error: "network_error" }, { status: 502 });
  }
  if (!me.ok) {
    return NextResponse.json({ error: "invalid_token" }, { status: 401 });
  }
  const response = NextResponse.json({ ok: true });
  // __Host- cookies are rejected by browsers unless Secure is set — even
  // in local dev (secure-by-NODE_ENV left every login broken). localhost
  // is a trustworthy origin, so Secure-over-http still works there.
  response.cookies.set(COOKIE_NAME, accessToken, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: COOKIE_MAX_AGE,
  });
  return response;
}
