export function isAllowedOpenUrl(url: string): boolean {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    if (u.protocol !== "https:") return false;
    // This helper is used for OAuth/browser handoff, not arbitrary content.
    // Exact first-party hosts keep a compromised renderer from abusing the
    // native opener with broad third-party or wildcard subdomain access.
    return host === "api.trqsh.uz" || host === "app.trqsh.uz";
  } catch {
    return false;
  }
}

export async function safeOpenUrl(url: string): Promise<void> {
  if (!isAllowedOpenUrl(url)) {
    throw new Error("Blocked opening untrusted URL");
  }
  const { openUrl } = await import("@tauri-apps/plugin-opener");
  await openUrl(url);
}
