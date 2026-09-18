import type { NextConfig } from "next";

const config: NextConfig = {
  // Required for the Docker image: emits apps/web/.next/standalone/server.js
  // with a pruned node_modules. Vercel ignores this setting (uses its own
  // build output), so web deploys stay unchanged.
  output: "standalone",
  typedRoutes: true,
  transpilePackages: ["@algorith-voice/ui", "@algorith-voice/shared-types"],
};

export default config;
