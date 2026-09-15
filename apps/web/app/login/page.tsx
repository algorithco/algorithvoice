"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { AuthShell, Field, Input } from "../../components/AuthShell";
import { MorphButton } from "../../components/MorphButton";
import { Reveal } from "../../components/Reveal";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
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
        setErr(data.error ?? "Login failed.");
        return;
      }
      router.push("/dashboard");
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
