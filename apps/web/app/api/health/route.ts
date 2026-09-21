import { cookies } from "next/headers";
import { NextResponse } from "next/server";

const API = process.env.API_URL ?? "https://api.trqsh.uz";

// Generic BFF proxy: browser -> /api/* (same-origin, httpOnly cookies) -> Fastify.
async function proxy(req: Request, path: string) {
  const url = `${API}${path}`;
  const cookieStore = await cookies();
  const token = cookieStore.get("__Host-av_at")?.value;
  const headers: Record<string, string> = {
    "content-type": req.headers.get("content-type") ?? "application/json",
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  // Forward Authorization if present in original request (for BFF auth passthrough)
  const incomingAuth = req.headers.get("authorization");
  if (incomingAuth) headers.Authorization = incomingAuth;
  const res = await fetch(url, {
    method: req.method,
    headers,
    body:
      req.method === "GET" || req.method === "HEAD"
        ? undefined
        : await req.text(),
  });
  const text = await res.text();
  return new NextResponse(text, {
    status: res.status,
    headers: {
      "content-type": res.headers.get("content-type") ?? "application/json",
    },
  });
}

export async function GET(req: Request) {
  return proxy(req, "/health");
}

export async function POST(req: Request) {
  return proxy(req, "/health");
}
