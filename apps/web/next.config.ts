import type { NextConfig } from "next";

// Server-only API routes resolve API_URL at runtime and fail closed in
// production. Next also evaluates those modules during `next build`; give
// that build-time evaluation a non-production placeholder without persisting
// it into the standalone runner's environment.
const isNextBuild = process.argv.some(
  (argument) => argument === "build" || argument.endsWith("/build"),
);
if (isNextBuild && !process.env.API_URL) {
  process.env.API_URL = "http://127.0.0.1:3001";
}

const config: NextConfig = {
  // Required for the Docker image: emits apps/web/.next/standalone/server.js
  // with a pruned node_modules. Vercel ignores this setting (uses its own
  // build output), so web deploys stay unchanged.
  output: "standalone",
  typedRoutes: true,
  transpilePackages: ["@algorith-voice/ui", "@algorith-voice/shared-types"],
  // Tunnel dev: the app is opened via https://app.trqsh.uz while Next runs
  // on localhost:3000. Without this, dev-mode client resources are blocked
  // cross-origin and the page renders SSR-only (no animations/interaction).
  allowedDevOrigins: ["app.trqsh.uz", "api.trqsh.uz"],
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          {
            key: "Content-Security-Policy-Report-Only",
            value:
              "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; connect-src 'self' https://api.trqsh.uz",
          },
          { key: "X-Frame-Options", value: "DENY" },
          {
            key: "Strict-Transport-Security",
            value: "max-age=31536000; includeSubDomains",
          },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "no-referrer" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), payment=()",
          },
        ],
      },
    ];
  },
};

export default config;
