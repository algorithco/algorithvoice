import type { SessionInfo } from "../lib/session/types.js";

/** Signed-out users land on login, but Settings stays reachable (trap door). */
export function useAuthGate(session: SessionInfo | null): {
  showAuth: boolean;
  loggedIn: boolean;
} {
  const loggedIn = session?.loggedIn === true;
  return { showAuth: session !== null && !loggedIn, loggedIn };
}
