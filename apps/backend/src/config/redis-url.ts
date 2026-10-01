/** Return a diagnostic Redis endpoint without credentials or query secrets. */
export function safeRedisEndpoint(raw: string): string {
  try {
    const url = new URL(raw);
    const database = /^\/\d+$/.test(url.pathname) ? url.pathname : "";
    return `${url.protocol}//${url.host}${database}`;
  } catch {
    return "[configured Redis endpoint]";
  }
}
