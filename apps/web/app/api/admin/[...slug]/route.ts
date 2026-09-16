import { cookies } from "next/headers";
import { NextResponse } from "next/server";

const API = process.env.API_URL ?? "http://localhost:3001";

async function proxy(req: Request, slug: string[]) {
  const url = new URL(req.url);
  const target = `${API}/admin/${slug.join("/")}${url.search}`;
  const cookieStore = await cookies();
  const token = cookieStore.get("__Host-av_at")?.value;
  const headers: Record<string, string> = {};
  const ct = req.headers.get("content-type");
  if (ct) headers["content-type"] = ct;
  if (token) headers.authorization = `Bearer ${token}`;
  const body = req.method !== "GET" && req.method !== "HEAD" ? await req.text() : undefined;
  const res = await fetch(target, { method: req.method, headers, body, cache: "no-store" });
  const text = await res.text();
  return new NextResponse(text, { status: res.status, headers: { "content-type": res.headers.get("content-type") ?? "application/json" } });
}

export async function GET(req: Request, ctx: { params: Promise<{ slug: string[] }> }) {
  const { slug } = await ctx.params;
  return proxy(req, slug);
}
export async function PUT(req: Request, ctx: { params: Promise<{ slug: string[] }> }) {
  const { slug } = await ctx.params;
  return proxy(req, slug);
}
export async function POST(req: Request, ctx: { params: Promise<{ slug: string[] }> }) {
  const { slug } = await ctx.params;
  return proxy(req, slug);
}
export async function PATCH(req: Request, ctx: { params: Promise<{ slug: string[] }> }) {
  const { slug } = await ctx.params;
  return proxy(req, slug);
}
export async function DELETE(req: Request, ctx: { params: Promise<{ slug: string[] }> }) {
  const { slug } = await ctx.params;
  return proxy(req, slug);
}
