export function getApiUrl(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.API_URL?.trim();
  if (configured) return configured.replace(/\/$/, "");
  if (env.NODE_ENV === "production") {
    throw new Error("API_URL is required in production");
  }
  return "http://localhost:3001";
}
