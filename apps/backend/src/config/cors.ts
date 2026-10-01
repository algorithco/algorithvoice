export interface CorsOriginEnv {
  APP_URL: string;
  NODE_ENV: "development" | "test" | "production";
}

const TAURI_ORIGINS = ["tauri://localhost", "http://tauri.localhost"] as const;

const TAURI_DEV_ORIGINS = [
  "http://localhost:1420",
  "http://127.0.0.1:1420",
] as const;

const LOCAL_WEB_ORIGINS = [
  "http://localhost:3000",
  "http://127.0.0.1:3000",
] as const;

export function corsOrigins(env: CorsOriginEnv): string[] {
  const origins = [new URL(env.APP_URL).origin, ...TAURI_ORIGINS];
  if (env.NODE_ENV !== "production") {
    origins.push(...LOCAL_WEB_ORIGINS, ...TAURI_DEV_ORIGINS);
  }
  return [...new Set(origins)];
}
