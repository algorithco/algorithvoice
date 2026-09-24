import { NextResponse } from "next/server";

const API = process.env.API_URL ?? "https://api.trqsh.uz";
const COOKIE_NAME = "__Host-av_at";
const REFRESH_COOKIE_NAME = "__Host-av_rt";

function getCookieValue(cookieHeader: string, name: string): string | null {
  const found = cookieHeader
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${name}=`));
  return found ? decodeURIComponent(found.slice(name.length + 1)) : null;
}

export async function POST(req: Request) {
  // Best-effort backend logout (revokes the refresh family); cookie clear
  // is authoritative.
  try {
    const cookie = req.headers.get("cookie") ?? "";
    const refreshToken = getCookieValue(cookie, REFRESH_COOKIE_NAME);
    await fetch(`${API}/auth/logout`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(refreshToken ? { refresh_token: refreshToken } : {}),
    });
  } catch {
    // ignore
  }
  const response = NextResponse.json({ ok: true });
  // Must match the setter attributes (Secure) or the clear is ignored.
  for (const name of [COOKIE_NAME, REFRESH_COOKIE_NAME]) {
    response.cookies.set(name, "", {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: 0,
    });
  }
  return response;
}
