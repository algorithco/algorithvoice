"use client";

import { cn } from "@algorith-voice/ui";
import * as React from "react";

export function AuthShell({
  title,
  subtitle,
  description,
  children,
  footer,
}: {
  title: string;
  subtitle: string;
  description?: string;
  children: React.ReactNode;
  footer: React.ReactNode;
}) {
  return (
    <div className="mx-auto flex min-h-[50vh] w-full max-w-[440px] flex-col justify-center px-4 py-12 sm:px-6 sm:py-24">
      <div className="flex items-center gap-2.5">
        <span
          className="inline-block size-1.5 shrink-0 bg-ink"
          aria-hidden="true"
        />
        <p className="t-cap text-faint">{subtitle}</p>
      </div>
      <h1 className="t-h1 mt-3 tracking-[-0.02em]">{title}</h1>
      {description ? (
        <p className="t-body mt-3 text-sub">{description}</p>
      ) : null}
      <div className="mt-8 rounded-lg border border-line bg-surface p-6 ring-1 ring-inset ring-white/[0.05] sm:p-8">
        {children}
      </div>
      <p className="t-body mx-auto mt-5 w-fit max-w-full rounded-full border border-line/60 bg-canvas/65 px-4 py-2 text-center text-sub backdrop-blur-md [&_a]:inline-block [&_a]:py-1">
        {footer}
      </p>
    </div>
  );
}

export function Field({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="block">
      <span className="t-cap text-faint">{label}</span>
      <div className="mt-2">{children}</div>
      {error ? (
        <span className="t-cap mt-2 block normal-case text-red-400">
          {error}
        </span>
      ) : null}
    </div>
  );
}

export function Input({
  className,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={cn(
        "min-h-[48px] w-full rounded-md border border-line bg-canvas px-4 py-3 text-base leading-6 text-ink transition-colors placeholder:text-faint hover:border-sub focus:border-ink focus:outline-none focus:ring-1 focus:ring-ink/40",
        className,
      )}
    />
  );
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

function GoogleMark() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="shrink-0"
    >
      <path d="M20.6 12.2A8.6 8.6 0 1 1 12 3.4c2.4 0 4.4 1 5.9 2.5" />
      <path d="M12.4 12h8.2" />
    </svg>
  );
}

function GitHubMark() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      className="shrink-0"
    >
      <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
    </svg>
  );
}

export function OAuthButtons({ mode }: { mode: "login" | "register" }) {
  const [notice, setNotice] = React.useState<string | null>(null);

  React.useEffect(() => {
    try {
      const q = new URLSearchParams(window.location.search);
      const error = q.get("error");
      const provider = q.get("provider");
      if (error === "oauth_not_configured" || error === "not_implemented") {
        const name =
          provider === "google"
            ? "Google"
            : provider === "github"
              ? "GitHub"
              : "Social";
        setNotice(`${name} sign-in isn't available yet — use email for now.`);
      } else if (error === "oauth_failed" || error === "no_verified_email") {
        setNotice(
          error === "no_verified_email"
            ? "GitHub sign-in needs a verified email on your GitHub account."
            : "GitHub sign-in failed — please try again or use email.",
        );
      }
      // GitHub success: backend redirected back with ?access_token=&email=.
      // Complete the session through the BFF (sets the httpOnly cookie),
      // then land on the dashboard. The token never stays in history:
      // replace the URL before navigating.
      const token = q.get("access_token");
      if (token && !error) {
        setNotice("Finishing GitHub sign-in…");
        void fetch("/api/auth/oauth/session", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ accessToken: token }),
        })
          .then((res) => {
            if (!res.ok) throw new Error("session");
            const clean = new URL(window.location.href);
            clean.searchParams.delete("access_token");
            clean.searchParams.delete("email");
            clean.searchParams.delete("provider");
            window.history.replaceState(null, "", clean.toString());
            window.location.href = "/dashboard";
          })
          .catch(() => {
            setNotice("GitHub sign-in failed — please try again or use email.");
          });
      }
    } catch {
      // Non-browser context or malformed query — no notice.
    }
  }, []);

  const start = (provider: "google" | "github") => {
    try {
      const origin = window.location.origin;
      const path = mode === "register" ? "/register" : "/login";
      const current = new URLSearchParams(window.location.search);
      const returnTo = current.get("returnTo");
      const callback =
        mode === "login" &&
        returnTo &&
        returnTo.startsWith("/") &&
        !returnTo.startsWith("//")
          ? `${origin}${path}?returnTo=${encodeURIComponent(returnTo)}`
          : `${origin}${path}`;
      window.location.href = `${API_BASE}/auth/oauth/${provider}/start?device=web&callback=${encodeURIComponent(callback)}`;
    } catch {
      window.location.href = `${API_BASE}/auth/oauth/${provider}/start?device=web`;
    }
  };

  const verb = mode === "register" ? "Sign up" : "Continue";

  return (
    <div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <button
          type="button"
          onClick={() => start("google")}
          aria-label={
            mode === "register"
              ? "Continue with Google to create your account"
              : "Continue with Google"
          }
          className="btn btn-secondary min-h-[44px] w-full transition-all duration-150 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ink/50 active:translate-y-px"
        >
          <GoogleMark />
          {verb} with Google
        </button>
        <button
          type="button"
          onClick={() => start("github")}
          aria-label={
            mode === "register"
              ? "Continue with GitHub to create your account"
              : "Continue with GitHub"
          }
          className="btn btn-secondary min-h-[44px] w-full transition-all duration-150 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ink/50 active:translate-y-px"
        >
          <GitHubMark />
          {verb} with GitHub
        </button>
      </div>
      {notice ? (
        <output className="mt-3 block rounded-md border border-line bg-canvas px-3 py-2.5 text-center text-[13px] normal-case leading-5 text-sub">
          {notice}
        </output>
      ) : null}
    </div>
  );
}

export function OAuthDivider({ text }: { text: string }) {
  return (
    <div className="flex items-center gap-4">
      <span className="h-px flex-1 bg-line" />
      <span className="t-cap shrink-0 text-faint">{text}</span>
      <span className="h-px flex-1 bg-line" />
    </div>
  );
}
