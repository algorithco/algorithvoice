import { cookies } from "next/headers";
import { NextResponse } from "next/server";

const API = process.env.API_URL ?? "http://localhost:3001";

export async function POST(req: Request) {
  const cookieStore = await cookies();
  const token = cookieStore.get("__Host-av_at")?.value;
  if (!token)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.text();
  const res = await fetch(`${API}/billing/create-portal-session`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body,
  });
  const text = await res.text();
  return new NextResponse(text, {
    status: res.status,
    headers: {
      "content-type": res.headers.get("content-type") ?? "application/json",
    },
  });
}
