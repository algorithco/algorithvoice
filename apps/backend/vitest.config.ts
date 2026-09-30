import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "test/**/*.test.ts"],
    exclude: ["dist/**", "node_modules/**"],
    fileParallelism: false,
    maxWorkers: 1,
    setupFiles: ["./test/setup-env.ts"],
    hookTimeout: 30_000,
    testTimeout: 60_000,
  },
});
