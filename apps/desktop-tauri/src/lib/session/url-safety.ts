export function isAllowedOpenUrl(url: string): boolean {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    // Allow http loopback only in DEV (Vite + local API)
    const isLoopback =
      host === "localhost" || host === "127.0.0.1" || host === "::1";
    if (isLoopback) {
      if (
        import.meta.env.DEV &&
        (u.protocol === "http:" || u.protocol === "https:")
      )
        return true;
      return false;
    }
    if (u.protocol !== "https:") return false;
    const allowed = [
      "api.algorithvoice.com",
      "api.trqsh.uz",
      "app.trqsh.uz",
      "github.com",
      "huggingface.co",
    ];
    if (allowed.some((h) => host === h || host.endsWith(`.${h}`))) return true;
    return false;
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
