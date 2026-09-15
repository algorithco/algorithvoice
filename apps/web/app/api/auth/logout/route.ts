import { NextResponse } from "next/server";

const API = process.env.API_URL ?? "http://localhost:3001";
const COOKIE_NAME = "__Host-av_at";

export async function POST(req: Request) {
  // Best-effort backend logout; cookie clear is authoritative.
  try {
    const cookie = req.headers.get("cookie") ?? "";
    await fetch(`${API}/auth/logout`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie,
      },
    });
  } catch {
    // ignore
  }
  const response = NextResponse.json({ ok: true });
  response.cookies.set(COOKIE_NAME, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  return response;
}
