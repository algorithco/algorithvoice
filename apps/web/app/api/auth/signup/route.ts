import { NextResponse } from "next/server";

const API = process.env.API_URL ?? "http://localhost:3001";

async function proxy(req: Request, path: string) {
  const res = await fetch(`${API}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: await req.text(),
  });
  const text = await res.text();
  const headers = new Headers({
    "content-type": res.headers.get("content-type") ?? "application/json",
  });
  const setCookie = res.headers.get("set-cookie");
  if (setCookie) headers.set("set-cookie", setCookie);
  return new NextResponse(text, { status: res.status, headers });
}

export async function POST(req: Request) {
  return proxy(req, "/auth/signup");
}
