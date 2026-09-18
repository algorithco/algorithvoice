import { useCallback, useRef, useSyncExternalStore } from "react";
import type { Prefs } from "../components/SettingsView.js";
import { DEFAULT_PREFS } from "./prefs.js";
import type { SessionInfo } from "./session/types.js";

// Lightweight global store — no new dependency (Zustand-compatible shape,
// hand-rolled with useSyncExternalStore).
// Judgment call: the task prefers Zustand, but prefs/session/mode is tiny
// (<50 lines) and adding a dep for 3 fields is heavier than a minimal store.
// If the store grows beyond prefs/session (e.g. server-cache data), migrate
// to Zustand + React Query at that point. See CHANGELOG.

export interface AppState {
  prefs: Prefs;
  session: SessionInfo;
  onboarded: boolean;
}

type Listener = () => void;

let state: AppState = {
  prefs: DEFAULT_PREFS,
  session: { loggedIn: false },
  onboarded: true,
};

const listeners = new Set<Listener>();

function setState(partial: Partial<AppState>): void {
  state = { ...state, ...partial };
  for (const l of listeners) l();
}

export function getAppState(): AppState {
  return state;
}

function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useAppState(): AppState {
  return useSyncExternalStore(subscribe, getAppState, getAppState);
}

export function usePrefs(): Prefs {
  return useSyncExternalStore(
    subscribe,
    () => getAppState().prefs,
    () => getAppState().prefs,
  );
}

export function useSession(): SessionInfo {
  return useSyncExternalStore(
    subscribe,
    () => getAppState().session,
    () => getAppState().session,
  );
}

/** Shallow equality for selector results (flat records/arrays of primitives). */
export function isShallowEqual<T>(a: T, b: T): boolean {
  if (Object.is(a, b)) return true;
  if (
    typeof a !== "object" ||
    typeof b !== "object" ||
    a === null ||
    b === null
  ) {
    return false;
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) {
      return false;
    }
    return a.every((v, i) => Object.is(v, (b as unknown[])[i]));
  }
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  return ka.every((k) =>
    Object.is(
      (a as Record<string, unknown>)[k],
      (b as Record<string, unknown>)[k],
    ),
  );
}

/**
 * Selector-based subscription with an equality bailout (zustand-style).
 * The selected slice is memoized: as long as `isEqual(prev, next)` holds,
 * subscribers keep a stable snapshot reference and do NOT re-render — so a
 * `prefs.theme`-only component ignores hotkey/session updates.
 *
 * Pass a STABLE selector (module-level function or `useCallback`); an
 * inline closure is re-created per render and only costs an extra cheap
 * comparison, never a spurious re-render while the selected value is equal.
 */
export function useStoreSelector<T>(
  selector: (s: AppState) => T,
  isEqual: (a: T, b: T) => boolean = Object.is,
): T {
  const last = useRef<{ value: T } | null>(null);
  const getSnapshot = useCallback(() => {
    const next = selector(getAppState());
    if (last.current !== null && isEqual(last.current.value, next)) {
      return last.current.value;
    }
    last.current = { value: next };
    return next;
  }, [selector, isEqual]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export const appStore = {
  get: getAppState,
  set: setState,
  setPrefs(prefs: Prefs): void {
    setState({ prefs });
  },
  setSession(session: SessionInfo): void {
    setState({ session });
  },
  setOnboarded(onboarded: boolean): void {
    setState({ onboarded });
  },
};
