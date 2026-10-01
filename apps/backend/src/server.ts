import cluster from "node:cluster";
import { availableParallelism } from "node:os";
import { buildApp } from "./app.js";
import { clusterRestartDelayMs } from "./cluster-policy.js";
import { loadEnv } from "./config/env.js";
import { closeQueues, closeRedis } from "./queues/connection.js";

const env = loadEnv();

// 1.5 — multi-core: in production with >1 CPU, fork via cluster.
// Fly single-cpu still runs single process; PM2 not needed in container.
if (
  cluster.isPrimary &&
  env.NODE_ENV === "production" &&
  availableParallelism() > 1
) {
  const workers = Math.min(availableParallelism(), 4);
  let shuttingDown = false;
  let consecutiveCrashes = 0;
  const startedAt = new Map<number, number>();
  const fork = () => {
    const worker = cluster.fork();
    if (worker.process.pid) startedAt.set(worker.process.pid, Date.now());
  };
  for (let i = 0; i < workers; i++) fork();
  cluster.on("exit", (w, code) => {
    const pid = w.process.pid;
    const lifetimeMs = pid
      ? Date.now() - (startedAt.get(pid) ?? Date.now())
      : 0;
    if (pid) startedAt.delete(pid);
    if (shuttingDown) return;
    consecutiveCrashes = lifetimeMs >= 30_000 ? 0 : consecutiveCrashes + 1;
    const delayMs = clusterRestartDelayMs(consecutiveCrashes);
    console.error(`worker ${pid} died (${code}), restarting in ${delayMs}ms`);
    setTimeout(fork, delayMs);
  });
  const shutdownPrimary = (signal: NodeJS.Signals) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.info(`primary received ${signal}, draining workers`);
    for (const worker of Object.values(cluster.workers ?? {})) {
      worker?.process.kill(signal);
    }
    const forced = setTimeout(() => {
      for (const worker of Object.values(cluster.workers ?? {})) {
        worker?.kill("SIGKILL");
      }
      process.exit(1);
    }, 12_000);
    forced.unref();
    cluster.disconnect(() => {
      clearTimeout(forced);
      process.exit(0);
    });
  };
  process.on("SIGTERM", () => shutdownPrimary("SIGTERM"));
  process.on("SIGINT", () => shutdownPrimary("SIGINT"));
} else {
  const app = buildApp();

  async function shutdown(signal: string) {
    app.log.info({ signal }, "shutting down");
    await app.close();
    await closeQueues().catch(() => {});
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
