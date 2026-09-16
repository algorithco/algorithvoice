import cluster from "node:cluster";
import { availableParallelism } from "node:os";
import { buildApp } from "./app.js";
import { loadEnv } from "./config/env.js";
import { closeRedis } from "./queues/connection.js";

const env = loadEnv();

// 1.5 — multi-core: in production with >1 CPU, fork via cluster.
// Fly single-cpu still runs single process; PM2 not needed in container.
if (
  cluster.isPrimary &&
  env.NODE_ENV === "production" &&
  availableParallelism() > 1
) {
  const workers = Math.min(availableParallelism(), 4);
  for (let i = 0; i < workers; i++) cluster.fork();
  cluster.on("exit", (w, code) => {
    console.error(
      `worker ${w.process.pid} died (${code}), forking replacement`,
    );
    cluster.fork();
  });
} else {
  const app = buildApp();

  async function shutdown(signal: string) {
    app.log.info({ signal }, "shutting down");
    await app.close();
    await closeRedis().catch(() => {});
    process.exit(0);
  }

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("unhandledRejection", (err) => {
    app.log.fatal({ err }, "unhandled rejection");
    process.exit(1);
  });

  app.listen({ port: env.PORT, host: "::" }).catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
}
