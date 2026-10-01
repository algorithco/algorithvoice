import { NextResponse } from "next/server";
import { getApiUrl } from "@/lib/api-url";

const API = getApiUrl();
const COOKIE_NAME = "__Host-av_at";
const REFRESH_COOKIE_NAME = "__Host-av_rt";
const COOKIE_MAX_AGE = 60 * 15;
const REFRESH_COOKIE_MAX_AGE = 30 * 24 * 60 * 60;

export async function POST(req: Request) {
  if (!req.headers.get("content-type")?.startsWith("application/json")) {
    return NextResponse.json({ error: "invalid_request" }, { status: 415 });
  }
  const origin = req.headers.get("origin");
  const fetchSite = req.headers.get("sec-fetch-site");
  if (origin !== new URL(req.url).origin || fetchSite !== "same-origin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  let code: unknown;
  try {
    code = (await req.json())?.code;
  } catch {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }
  if (typeof code !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(code)) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  let exchange: Response;
  try {
    exchange = await fetch(`${API}/auth/oauth/exchange`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    return NextResponse.json({ error: "network_error" }, { status: 502 });
  }
  if (!exchange.ok) {
    const error = (await exchange.json().catch(() => null)) as {
      error?: string;
    } | null;
    return NextResponse.json(
      { error: error?.error ?? "oauth_exchange_failed" },
      { status: exchange.status },
    );
  }

  const data = (await exchange.json().catch(() => null)) as {
    accessToken?: string;
    refreshToken?: string;
  } | null;
  if (!data?.accessToken || !data.refreshToken) {
    return NextResponse.json({ error: "invalid_response" }, { status: 502 });
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set(COOKIE_NAME, data.accessToken, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: COOKIE_MAX_AGE,
  });
  response.cookies.set(REFRESH_COOKIE_NAME, data.refreshToken, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: REFRESH_COOKIE_MAX_AGE,
  });
  return response;
}
