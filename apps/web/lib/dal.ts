import { cookies } from "next/headers";
import { getApiUrl } from "./api-url";

const API = getApiUrl();
const COOKIE_NAME = "__Host-av_at";

export interface SessionUser {
  id: string;
  email: string;
  name: string | null;
  planTier: "free" | "pro";
  stripeCustomerId: string | null;
  createdAt: string;
}

export async function getSession(): Promise<{
  user: SessionUser;
  token: string;
} | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (!token) return null;
  try {
    const res = await fetch(`${API}/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    if (!res.ok) return null;
    const user = (await res.json()) as SessionUser;
    return { user, token };
  } catch {
    return null;
  }
}

export async function requireUser(): Promise<SessionUser> {
  const session = await getSession();
  if (!session) {
    const { redirect } = await import("next/navigation");
    return redirect("/login");
  }
  return session.user;
}
