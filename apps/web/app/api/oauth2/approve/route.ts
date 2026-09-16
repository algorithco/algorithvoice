import { cookies } from "next/headers";
import { NextResponse } from "next/server";

const API = process.env.API_URL ?? "http://localhost:3001";

// Thin BFF: the browser's httpOnly __Host-av_at cookie never leaves this
// origin. We read it server-side and forward it to the backend as Bearer.
// This page is never called by the desktop directly.
export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }
  const cookieStore = await cookies();
  const token = cookieStore.get("__Host-av_at")?.value;
  const res = await fetch(`${API}/oauth2/approve`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  const headers = new Headers({ "content-type": "application/json" });
  // Forward httpOnly cookies if backend sets any (defense in depth).
  const setCookie = res.headers.get("set-cookie");
  if (setCookie) headers.set("set-cookie", setCookie);
  return new NextResponse(text, { status: res.status, headers });
}
