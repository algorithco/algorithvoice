// Barrel re-export for backward compatibility. New code should import from
// the split modules directly (./env.js, ./auth.js, ./tray.js,
// ./url-safety.js, ./demo-account.js) to avoid pulling OAuth/PKCE into
// lightweight bundles like the floating pill.

export type { OAuthProvider } from "./auth.js";
export {
  fetchWithTimeout,
  login,
  logout,
  OAUTH_PROVIDERS,
  oauthProviderLabel,
  parseOAuthCallbackUrl,
  parseOAuthCodeCallback,
  sessionStatus,
  signInDesktop,
  signInWithOAuth,
  signup,
} from "./auth.js";
export { DEMO_EMAIL, loginDemo } from "./demo-account.js";
export { isTauri } from "./env.js";
export type { TrayState } from "./tray.js";
export { openSettingsWindow, setTrayState } from "./tray.js";
export type { AuthResponse, SessionInfo } from "./types.js";
export { isAllowedOpenUrl, safeOpenUrl } from "./url-safety.js";
