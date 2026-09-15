import { NextResponse } from "next/server";

const API = process.env.API_URL ?? "http://localhost:3001";

// Generic BFF proxy: browser -> /api/* (same-origin, httpOnly cookies) -> Fastify.
async function proxy(req: Request, path: string) {
  const url = `${API}${path}`;
  const res = await fetch(url, {
    method: req.method,
    headers: {
      "content-type": req.headers.get("content-type") ?? "application/json",
    },
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
