export function getErrorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  if (e && typeof e === "object") {
    const o = e as Record<string, unknown>;
    if (typeof o.message === "string" && o.message) return o.message;
    if (typeof o.errorMessage === "string" && o.errorMessage)
      return o.errorMessage;
    if (typeof o.error === "string" && o.error) return o.error;
    // Tauri AppError shape: {code, message}
    if (typeof o.code === "string" && typeof o.message === "string")
      return o.message;
    try {
      const s = JSON.stringify(o);
      if (s && s !== "{}" && s !== "null") return s;
    } catch {}
  }
  return String(e);
}
