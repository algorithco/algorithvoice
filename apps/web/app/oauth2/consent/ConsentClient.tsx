"use client";

import { useEffect, useState } from "react";

import SlideCommit from "../../../components/SlideCommit";

export function ConsentClient({
  requestId,
  userEmail,
}: {
  requestId: string;
  userEmail: string | null;
}) {
  const [loading, setLoading] = useState<"allow" | "deny" | null>(null);
  const [done, setDone] = useState<"allow" | "deny" | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Auto-redirect to home (and try to close popup) whenever we reach done
  useEffect(() => {
    if (!done) return;
    const t = window.setTimeout(() => {
      try {
        window.close();
      } catch {}
      // Use assign to ensure navigation even if opener was _blank
      window.location.assign("/");
    }, 900);
    return () => window.clearTimeout(t);
  }, [done]);

  async function actDeny() {
    setError(null);
    setLoading("deny");
    try {
      const res = await fetch("/api/oauth2/approve", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ request_id: requestId, approved: false }),
      });
      const body = (await res.json().catch(() => ({}))) as { redirect_to?: string; error?: string };
      if (!res.ok) throw new Error(body.error ?? "Request failed");
      const redirectTo = body.redirect_to;
      if (redirectTo && redirectTo !== "/") {
        try {
          // For desktop deep-link, use hidden iframe to avoid leaving page before home redirect
          const iframe = document.createElement("iframe");
          iframe.style.display = "none";
          iframe.src = redirectTo;
          document.body.appendChild(iframe);
          setTimeout(() => iframe.remove(), 1500);
        } catch {}
      }
      setDone("deny");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
      setLoading(null);
    }
  }

  async function confirmAllow() {
    setError(null);
    const res = await fetch("/api/oauth2/approve", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ request_id: requestId, approved: true }),
    });
    const body = (await res.json().catch(() => ({}))) as { redirect_to?: string; error?: string };
    if (!res.ok) throw new Error(body.error ?? "Request failed");
    const redirectTo = body.redirect_to;
    if (redirectTo && redirectTo !== "/") {
      try {
        // Use iframe for custom scheme so we stay on page for home redirect
        const iframe = document.createElement("iframe");
        iframe.style.display = "none";
        iframe.src = redirectTo;
        document.body.appendChild(iframe);
        setTimeout(() => iframe.remove(), 1500);
      } catch {}
    }
    setDone("allow");
    return;
  }

  function handleAllowDone() {
    // No-op: redirect is handled by useEffect on done, ensures it fires even after SlideCommit unmount
  }

  if (done) {
    return (
      <div className="flex flex-col items-center gap-4 py-2 text-center">
        <span className="grid size-12 place-items-center rounded-full bg-ink text-canvas">
          <svg aria-hidden viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-6 w-6">
            <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
        <div>
          <p className="font-mono text-sm font-semibold tracking-tight text-ink">
            {done === "allow" ? "Access granted" : "Access denied"}
          </p>
          <p className="mt-1 font-mono text-xs leading-4 text-faint">Redirecting to home…</p>
        </div>
        <div className="h-1 w-full overflow-hidden rounded-full bg-raised">
          <div className="h-full w-full animate-[shimmer_1.2s_ease-in-out_infinite] bg-gradient-to-r from-transparent via-ink/20 to-transparent" />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {/* App + user */}
      <div className="flex items-start gap-3 rounded-xl border border-line bg-canvas p-4">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-ink text-canvas" aria-hidden>
          <svg viewBox="0 0 24 24" fill="currentColor" className="size-5">
            <path d="M12 2.2a4.5 4.5 0 0 0-2.3.6A5.2 5.2 0 0 0 6 6.2c0 1.2.4 2.3 1.2 3.2A5.1 5.1 0 0 0 12 12a5.1 5.1 0 0 0 4.8-2.6c.8-.9 1.2-2 1.2-3.2a5.2 5.2 0 0 0-3.7-3.4A4.5 4.5 0 0 0 12 2.2z" />
          </svg>
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm leading-5">
            <span className="font-semibold text-ink">Algorith Voice Desktop</span>
            <span className="text-sub"> wants to access your account</span>
          </p>
          {userEmail ? (
            <p className="mt-2 inline-flex max-w-full items-center gap-1.5 rounded-full border border-line bg-raised px-3 py-1">
              <span className="h-2 w-2 rounded-full bg-emerald-500" aria-hidden />
              <span className="truncate font-mono text-xs font-medium text-ink">{userEmail}</span>
            </p>
          ) : null}
        </div>
      </div>

      <div className="rounded-xl bg-raised/60 p-4 ring-1 ring-line/50">
        <p className="font-mono text-xs leading-4 text-sub">
          This is your <span className="font-medium text-ink">first-party desktop app</span>. No third party receives your data.
        </p>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {["profile", "email", "offline_access"].map((s) => (
            <span key={s} className="rounded-full border border-line bg-canvas px-2.5 py-1 font-mono text-[11px] font-medium tracking-wide text-faint">
              {s}
            </span>
          ))}
        </div>
      </div>

      {error ? (
        <p className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2.5 font-mono text-xs leading-4 text-red-400" role="alert">
          {error}
        </p>
      ) : null}

      <div className="flex flex-col items-center gap-3">
        <SlideCommit
          label="Slide to allow"
          doneLabel="Allowed"
          errorLabel="Failed — try again"
          onConfirm={confirmAllow}
          onDone={handleAllowDone}
          trackColor="#141414"
          handleColor="#ffffff"
          successColor="#ffffff"
          dangerColor="#e5484d"
          width={340}
          height={52}
          radius={26}
          className="w-[340px] max-w-full"
        />
        <button
          type="button"
          disabled={!!loading || !!done}
          onClick={actDeny}
          className="inline-flex min-h-[52px] w-[340px] max-w-full items-center justify-center rounded-full border border-red-500/30 bg-red-500/10 px-6 text-sm font-semibold text-red-400 transition-colors hover:bg-red-500/15 hover:border-red-500/40 hover:text-red-300 disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {loading === "deny" ? (
            <>
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-red-500/30 border-t-red-400" aria-hidden />
              Denying…
            </>
          ) : (
            "Deny"
          )}
        </button>
      </div>

      <p className="text-center font-mono text-[11px] leading-4 text-faint">Slide to approve · you’ll be redirected to home automatically.</p>
    </div>
  );
}
