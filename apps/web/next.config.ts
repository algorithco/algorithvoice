import type { NextConfig } from "next";

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
};

export default config;
