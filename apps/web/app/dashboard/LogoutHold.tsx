"use client";

import { useState } from "react";

import HoldButton from "../../components/HoldButton";

export function LogoutHold() {
  const [done, setDone] = useState(false);

  async function doLogout() {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch {}
    setDone(true);
    setTimeout(() => {
      window.location.href = "/login";
    }, 600);
  }

  if (done) {
    return (
      <div className="rounded-xl border border-line bg-canvas px-4 py-3 text-center">
        <p className="font-mono text-xs font-medium text-ink">Logged out — redirecting…</p>
      </div>
    );
  }

  return (
    <HoldButton
      size="md"
      radius={12}
      holdTime={1400}
      fillDirection="right"
      backgroundColor="#0a0a0a"
      fillColor="#e5484d"
      textColor="#f5f5f5"
      fillTextColor="#ffffff"
      doneLabel="Logged out"
      className="w-full"
      onHold={doLogout}
    >
      Hold to log out
    </HoldButton>
  );
}
