import { cookies } from "next/headers";
import { NextResponse } from "next/server";

const API = process.env.API_URL ?? "https://api.trqsh.uz";

export async function GET(req: Request) {
  const cookieStore = await cookies();
  const token = cookieStore.get("__Host-av_at")?.value;
  if (!token) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { searchParams } = new URL(req.url);
  const limit = searchParams.get("limit") ?? "5";
  const res = await fetch(`${API}/usage/recent?limit=${encodeURIComponent(limit)}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  const text = await res.text();
  return new NextResponse(text, { status: res.status, headers: { "content-type": res.headers.get("content-type") ?? "application/json" } });
}
