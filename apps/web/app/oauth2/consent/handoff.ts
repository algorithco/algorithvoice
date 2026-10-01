const ALLOWED_HANDOFFS = new Map([
  ["algorithvoice:", "auth-callback"],
  ["com.algorithvoice.app:", "oauth-callback"],
]);

export function safeDesktopHandoffUrl(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length > 4096) return null;
  try {
    const url = new URL(raw);
    const expectedHost = ALLOWED_HANDOFFS.get(url.protocol);
    if (!expectedHost || url.hostname.toLowerCase() !== expectedHost) {
      return null;
    }
    if (
      url.username ||
      url.password ||
      url.port ||
      (url.pathname !== "" && url.pathname !== "/") ||
      url.hash
    ) {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}
