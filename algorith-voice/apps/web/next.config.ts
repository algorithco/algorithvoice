import type { NextConfig } from "next";

const config: NextConfig = {
  typedRoutes: true,
  transpilePackages: ["@algorith-voice/ui", "@algorith-voice/shared-types"],
};

export default config;
