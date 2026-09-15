import { NextResponse } from "next/server";

const API = process.env.API_URL ?? "http://localhost:3001";

export async function GET(req: Request) {
  const cookie = req.headers.get("cookie") ?? "";
  // Try Authorization header first, then cookie
  const authHeader = req.headers.get("authorization");
  const tokenFromCookie = cookie
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith("__Host-av_at="))
    ?.split("=")[1];

  const token = authHeader?.replace(/^Bearer\s+/i, "") ?? tokenFromCookie;
  if (!token) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const res = await fetch(`${API}/auth/me`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  const text = await res.text();
  return new NextResponse(text, {
    status: res.status,
    headers: {
      "content-type": res.headers.get("content-type") ?? "application/json",
    },
  });
}
