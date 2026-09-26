"use client";

import { loginSchema } from "@algorith-voice/shared-types";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import {
  AuthShell,
  Field,
  Input,
  OAuthButtons,
  OAuthDivider,
} from "../../components/AuthShell";
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
  const searchParams = useSearchParams();
  const returnTo = safeReturnTo(searchParams.get("returnTo"));
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
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
      // Hard navigation (not router.push): guarantees the next page — e.g.
      // /oauth2/consent?request=… for desktop auth — loads fresh with the
      // just-set httpOnly session cookies. Client-side push could render the
      // consent page with stale unauthenticated state, forcing the user back
      // to the desktop app to click Log in again.
      window.location.href = returnTo ?? "/dashboard";
      return;
    } catch {
      setErr("Network error.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Reveal>
      <AuthShell
        title="Sign in to Algorith Voice"
        subtitle="Login"
        description="Continue to your workspace"
        footer={
          <>
            No account?{" "}
            <Link
              href={
                (returnTo
                  ? `/register?returnTo=${encodeURIComponent(returnTo)}`
                  : "/register") as never
              }
              className="text-ink underline decoration-line underline-offset-4 transition-colors hover:decoration-ink"
            >
              Create one
            </Link>
            <span className="mx-2 text-faint">·</span>
            <Link
              href="/"
              className="underline decoration-line underline-offset-4 transition-colors hover:text-ink hover:decoration-ink"
            >
              Home
            </Link>
          </>
        }
      >
        <div className="flex flex-col gap-6">
          <OAuthButtons mode="login" />
          <OAuthDivider text="OR CONTINUE WITH EMAIL" />
          <form onSubmit={submit} className="flex flex-col gap-5">
            <Field label="Email or phone">
              <Input
                type="email"
                autoComplete="email"
                placeholder="Email or phone number"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </Field>
            <Field label="Password">
              <div className="relative">
                <Input
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  placeholder="••••••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="pr-20"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-pressed={showPassword}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  className="t-cap absolute top-1/2 right-2 -translate-y-1/2 rounded px-2 py-1.5 text-faint transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ink/50"
                >
                  {showPassword ? "Hide" : "Show"}
                </button>
              </div>
            </Field>
            {err ? (
              <p className="t-cap normal-case text-red-400">{err}</p>
            ) : null}
            <MorphButton
              type="submit"
              disabled={busy}
              className="min-h-[52px] w-full text-base active:translate-y-px"
            >
              {busy ? "Signing in…" : "Sign in"}
            </MorphButton>
          </form>
        </div>
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
