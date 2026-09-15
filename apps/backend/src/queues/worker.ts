import { Worker } from "bullmq";
import { Redis } from "ioredis";
import pino from "pino";
import { loadEnv } from "../config/env.js";
import { QUEUES } from "./connection.js";

// Separate process: `pnpm worker`. Same image, different CMD on Fly.
const env = loadEnv();
const log = pino({ level: env.LOG_LEVEL });

function makeWorkerRedis() {
  return new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });
}

function observe(name: string, worker: Worker) {
  worker.on("failed", (job, err) => {
    log.error({ queue: name, jobId: job?.id, err }, "job failed");
  });
  worker.on("error", (err) => {
    log.error({ queue: name, err }, "worker error");
  });
  worker.on("stalled", (jobId) => {
    log.warn({ queue: name, jobId }, "job stalled");
  });
  return worker;
}

const workers = [
  observe(
    "metering",
    new Worker(
      "metering",
      async (job) => {
        // Phase 2 implements 60s batching -> usage_daily -> monthly rollup.
        // Until then: acknowledge shape, never silently claim work done.
        log.info({ jobId: job.id, data: job.data }, "metering event received");
        return { ok: true, id: job.id, processed: false };
      },
      { connection: makeWorkerRedis(), concurrency: 5, lockDuration: 60_000 },
    ),
  ),
  observe(
    "stripe.webhook-process",
    new Worker(
      "stripe.webhook-process",
      async (job) => {
        // Phase 4: idempotent processing via StripeEvent.id.
        log.info({ jobId: job.id }, "stripe webhook event received");
        return { ok: true, id: job.id, processed: false };
      },
      {
        connection: makeWorkerRedis(),
        concurrency: 5,
        limiter: { max: 20, duration: 1000 },
        lockDuration: 60_000,
      },
    ),
  ),
  observe(
    "usage.report-to-stripe",
    new Worker(
      "usage.report-to-stripe",
      async (job) => {
        // Phase 4: report aggregated usage to Stripe Meters.
        log.info({ jobId: job.id }, "usage rollup tick");
        return { ok: true, id: job.id, processed: false };
      },
      { connection: makeWorkerRedis(), concurrency: 1, lockDuration: 60_000 },
    ),
  ),
];

// Hourly rollup tick (deduplicated by fixed jobId).
void QUEUES.usageRollup
  .add(
    "rollup-hourly",
    {},
    { repeat: { every: 3600_000 }, jobId: "rollup-hourly" },
  )
  .catch((err: unknown) => log.error({ err }, "failed to schedule rollup"));

async function shutdown(signal: string) {
  log.info({ signal }, "worker shutting down");
  await Promise.all(workers.map((w) => w.close()));
  await Promise.all(Object.values(QUEUES).map((q) => q.close()));
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("unhandledRejection", (err) => {
  log.fatal({ err }, "unhandled rejection");
  process.exit(1);
});
