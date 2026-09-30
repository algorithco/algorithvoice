import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getApiUrl } from "@/lib/api-url";

const API = getApiUrl();

const ADMIN_ROUTES = new Map<string, ReadonlySet<string>>([
  ["stats/overview", new Set(["GET"])],
  ["stats/models", new Set(["GET"])],
  ["config/ai-model", new Set(["GET", "PUT"])],
  ["logs/errors", new Set(["GET"])],
  ["essays", new Set(["GET"])],
  ["users", new Set(["GET"])],
  ["keys", new Set(["GET"])],
]);

export function isAllowedAdminRequest(method: string, slug: string[]): boolean {
  const path = slug.join("/");
  if (ADMIN_ROUTES.get(path)?.has(method)) return true;
  return (
    method === "POST" &&
    slug.length === 3 &&
    slug[0] === "users" &&
    slug[1] !== "" &&
    slug[2] === "block"
  );
}

function isSameOriginMutation(req: Request): boolean {
  if (req.method === "GET" || req.method === "HEAD") return true;
  return (
    req.headers.get("origin") === new URL(req.url).origin &&
    req.headers.get("sec-fetch-site") === "same-origin"
  );
}

async function proxy(req: Request, slug: string[]) {
  if (!isAllowedAdminRequest(req.method, slug)) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (!isSameOriginMutation(req)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const url = new URL(req.url);
  const target = `${API}/admin/${slug.join("/")}${url.search}`;
  const cookieStore = await cookies();
  const token = cookieStore.get("__Host-av_at")?.value;
  const headers: Record<string, string> = {};
  const contentType = req.headers.get("content-type");
  if (contentType) headers["content-type"] = contentType;
  if (token) headers.authorization = `Bearer ${token}`;
  const body =
    req.method !== "GET" && req.method !== "HEAD"
      ? await req.text()
      : undefined;
  const response = await fetch(target, {
    method: req.method,
    headers,
    body,
    cache: "no-store",
  });
  const text = await response.text();
  return new NextResponse(text, {
    status: response.status,
    headers: {
      "content-type":
        response.headers.get("content-type") ?? "application/json",
    },
  });
}

type RouteContext = { params: Promise<{ slug: string[] }> };

export async function GET(req: Request, ctx: RouteContext) {
  return proxy(req, (await ctx.params).slug);
}
export async function PUT(req: Request, ctx: RouteContext) {
  return proxy(req, (await ctx.params).slug);
}
export async function POST(req: Request, ctx: RouteContext) {
  return proxy(req, (await ctx.params).slug);
}
export async function PATCH(req: Request, ctx: RouteContext) {
  return proxy(req, (await ctx.params).slug);
}
export async function DELETE(req: Request, ctx: RouteContext) {
  return proxy(req, (await ctx.params).slug);
}
