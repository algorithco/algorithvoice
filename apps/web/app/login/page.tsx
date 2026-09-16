"use client";

import { loginSchema } from "@algorith-voice/shared-types";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { AuthShell, Field, Input } from "../../components/AuthShell";
import { MorphButton } from "../../components/MorphButton";
import { Reveal } from "../../components/Reveal";

function safeReturnTo(raw: string | null): string | null {
  if (!raw || !raw.startsWith("/")) return null;
  try {
    const u = new URL(raw, "http://x");
    if (u.host !== "x") return null;
    return raw;
  } catch {
    return null;
  }
}

function LoginInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const returnTo = safeReturnTo(searchParams.get("returnTo"));
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = loginSchema.safeParse({ email: email.trim(), password });
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      setErr(issue.message ?? "Check your email and password.");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: email.trim(), password }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setErr(
          data.error === "invalid_credentials"
            ? "Invalid email or password."
            : (data.error ?? "Login failed."),
        );
        return;
      }
      router.push(
        (returnTo ?? "/dashboard") as unknown as Parameters<
          typeof router.push
        >[0],
      );
      router.refresh();
    } catch {
      setErr("Network error.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Reveal>
      <AuthShell
        title="Welcome back."
        subtitle="Login"
        footer={
          <>
            No account?{" "}
            <Link
              href={"/register" as never}
              className="underline hover:text-ink"
            >
              Create one
            </Link>
            {" · "}
            <Link href="/" className="underline hover:text-ink">
              Home
            </Link>
          </>
        }
      >
        <form onSubmit={submit} className="flex flex-col gap-5">
          <Field label="Email">
            <Input
              type="email"
              autoComplete="email"
              placeholder="you@algorithvoice.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </Field>
          <Field label="Password">
            <Input
              type="password"
              autoComplete="current-password"
              placeholder="••••••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </Field>
          {err ? <p className="t-cap normal-case text-red-400">{err}</p> : null}
          <MorphButton type="submit" disabled={busy} className="w-full">
            {busy ? "Signing in…" : "Sign in"}
          </MorphButton>
        </form>
      </AuthShell>
    </Reveal>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginInner />
    </Suspense>
  );
}
