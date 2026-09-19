import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "./env.js";
import type { SessionInfo } from "./types.js";

// ---- Local demo account (no backend) ----
// Isolated here so the plaintext localStorage path can never run inside the
// Tauri shell. All localStorage access asserts !isTauri() at runtime.

export const DEMO_EMAIL = "demo@algorithvoice.local";
const DEMO_TOKEN = "demo-local-no-backend";
const DEMO_KEY = "algorith-voice-demo-session";

function assertNonTauri(context: string): void {
  if (isTauri()) {
    throw new Error(
      `demo-account ${context} is browser-preview only and must never run in the Tauri shell`,
    );
  }
}

export function readDemoSession(): SessionInfo | null {
  assertNonTauri("read");
  try {
    return localStorage.getItem(DEMO_KEY) === DEMO_EMAIL
      ? { loggedIn: true, email: DEMO_EMAIL }
      : null;
  } catch {
    return null;
  }
}

export function clearDemoSession(): void {
  // Clearing is idempotent and safe in both runtimes (logout always calls
  // it), but only touches localStorage outside Tauri.
  if (isTauri()) return;
  try {
    localStorage.removeItem(DEMO_KEY);
  } catch {
    // Storage unavailable.
  }
}

function writeDemoSession(): void {
  assertNonTauri("write");
  try {
    localStorage.setItem(DEMO_KEY, DEMO_EMAIL);
  } catch {
    // Storage unavailable.
  }
}

/**
 * Sign in with the built-in demo account. Fully local — never touches the
 * backend. In the Tauri shell the session is stored in the OS keyring like
 * a real login; in browser preview it falls back to localStorage.
 */
export async function loginDemo(): Promise<SessionInfo> {
  const session: SessionInfo = { loggedIn: true, email: DEMO_EMAIL };
  if (isTauri()) {
    await invoke("store_session", {
      accessToken: DEMO_TOKEN,
      email: DEMO_EMAIL,
    });
    return session;
  }
  writeDemoSession();
  return session;
}
