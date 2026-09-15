"use client";

import { signupSchema } from "@algorith-voice/shared-types";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { AuthShell, Field, Input } from "../../components/AuthShell";
import { Reveal } from "../../components/Reveal";

export default function RegisterPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirm) {
      setErr("Passwords do not match.");
      return;
    }
    const parsed = signupSchema.safeParse({
      email: email.trim(),
      password,
      ...(name.trim() ? { name: name.trim() } : {}),
    });
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      setErr(issue.message ?? "Check your input.");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: email.trim(),
          password,
          ...(name.trim() ? { name: name.trim() } : {}),
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setErr(
          data.error === "email_taken"
            ? "That email is already registered."
            : (data.error ?? "Sign up failed."),
        );
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
        title="Create your account."
        subtitle="Register"
        footer={
          <>
            Already have an account?{" "}
            <Link href={"/login" as never} className="underline hover:text-ink">
              Sign in
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
          <Field label="Name (optional)">
            <Input
              type="text"
              autoComplete="name"
              placeholder="Ada Lovelace"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          <Field label="Password">
            <Input
              type="password"
              autoComplete="new-password"
              placeholder="At least 12 characters"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </Field>
          <Field label="Confirm password">
            <Input
              type="password"
              autoComplete="new-password"
              placeholder="Repeat password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              required
            />
          </Field>
          {err ? <p className="t-cap normal-case text-red-400">{err}</p> : null}
          <button
            type="submit"
            disabled={busy}
            className="btn btn-primary w-full"
          >
            {busy ? "Creating…" : "Create account"}
          </button>
        </form>
      </AuthShell>
    </Reveal>
  );
}
