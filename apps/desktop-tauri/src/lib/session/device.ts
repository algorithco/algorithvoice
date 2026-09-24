// Stable desktop device identity + license activation.
//
// Kept separate from `auth.ts` on purpose: the OAuth-UX task owns that file
// right now. Wire-up is a single call — after any successful sign-in that
// yields an `accessToken` (signInDesktop / login / signup / signInWithOAuth):
//
//   import { ensureDeviceLinked } from "./device.js";
//   await ensureDeviceLinked(data.accessToken);
//
// `ensureDeviceLinked` is idempotent (backend upserts by fingerprint) and
// best-effort: only a full seat table (`seats_exhausted`) throws, everything
// else warns so sign-in never breaks on a flaky network.

export type DesktopDeviceType =
  | "desktop-macos"
  | "desktop-windows"
  | "desktop-linux";

export interface DeviceIdentity {
  deviceName: string;
  deviceType: DesktopDeviceType;
  deviceFingerprint: string;
}

const FINGERPRINT_KEY = "algorith-voice-device-fingerprint";
const NAME_KEY = "algorith-voice-device-name";

const API: string =
  (import.meta.env.VITE_API_URL as string | undefined) ??
  (import.meta.env.DEV ? "http://localhost:3001" : "https://api.trqsh.uz");

/** Infer the desktop OS without new native dependencies. */
export function detectDeviceType(): DesktopDeviceType {
  const nav = typeof navigator !== "undefined" ? navigator : undefined;
  const platform =
    (nav as { userAgentData?: { platform?: string } } | undefined)
      ?.userAgentData?.platform ??
    (nav as { platform?: string } | undefined)?.platform ??
    "";
  const ua = nav?.userAgent ?? "";
  const hay = `${platform} ${ua}`.toLowerCase();
  if (
    hay.includes("win") ||
    hay.includes("windows") ||
    hay.includes("win32") ||
    hay.includes("win64")
  ) {
    return "desktop-windows";
  }
  if (hay.includes("linux") || hay.includes("x11") || hay.includes("wayland")) {
    return "desktop-linux";
  }
  if (
    hay.includes("mac") ||
    hay.includes("darwin") ||
    hay.includes("iphone") ||
    hay.includes("ipad")
  ) {
    return "desktop-macos";
  }
  // Tauri ships Windows & Linux only; Windows is the most common seat.
  return "desktop-windows";
}

function osLabel(type: DesktopDeviceType): string {
  switch (type) {
    case "desktop-windows":
      return "Windows";
    case "desktop-linux":
      return "Linux";
    case "desktop-macos":
      return "Mac";
  }
}

function loadStored(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function storeValue(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Private mode / no storage: identity just won't persist.
  }
}

/** Stable per-install fingerprint (UUID, persisted). */
export function getDeviceFingerprint(): string {
  const stored = loadStored(FINGERPRINT_KEY);
  if (stored && stored.length >= 8 && stored.length <= 256) return stored;
  const fresh =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `dev-${Date.now().toString(36)}-${Math.floor(Math.random() * 2 ** 32).toString(36)}`;
  storeValue(FINGERPRINT_KEY, fresh);
  return fresh;
}

/** Stable friendly name, e.g. "Windows Desktop". */
export function getDeviceName(): string {
  const stored = loadStored(NAME_KEY);
  if (stored && stored.length >= 1 && stored.length <= 100) return stored;
  const fresh = `${osLabel(detectDeviceType())} Desktop`;
  storeValue(NAME_KEY, fresh);
  return fresh;
}

export function getDeviceIdentity(): DeviceIdentity {
  return {
    deviceName: getDeviceName(),
    deviceType: detectDeviceType(),
    deviceFingerprint: getDeviceFingerprint(),
  };
}

/**
 * Register (or heartbeat) this device so `GET /license/devices` lists it.
 * Throws only on `seats_exhausted`; all other failures warn and resolve so
 * sign-in stays usable offline.
 */
export async function ensureDeviceLinked(accessToken: string): Promise<void> {
  const identity = getDeviceIdentity();
  let res: Response;
  try {
    res = await fetch(`${API}/license/activate`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(identity),
    });
  } catch (e) {
    console.warn("algorith-voice: device activation skipped (network)", e);
    return;
  }
  if (res.ok) return;
  let body: { error?: string; seatsUsed?: number; seatsMax?: number } | null =
    null;
  try {
    body = (await res.json()) as {
      error?: string;
      seatsUsed?: number;
      seatsMax?: number;
    } | null;
  } catch {
    body = null;
  }
  if (res.status === 403 && body?.error === "seats_exhausted") {
    const used = body.seatsUsed ?? "?";
    const max = body.seatsMax ?? "?";
    throw new Error(
      `Device limit reached (${used}/${max} seats used). Unlink a device from the dashboard to add this one.`,
    );
  }
  console.warn(
    "algorith-voice: device activation skipped",
    res.status,
    body?.error ?? res.statusText,
  );
}
