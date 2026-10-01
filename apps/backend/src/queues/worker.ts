import { PrismaClient } from "@prisma/client";
import { Worker } from "bullmq";
import { Redis } from "ioredis";
import pino from "pino";
import { loadEnv } from "../config/env.js";
import { safeRedisEndpoint } from "../config/redis-url.js";
import { getStripe } from "../modules/billing/stripe.js";
import { releaseSttSlot } from "../modules/stt/stt.slots.js";
import {
  cleanupSttAudio,
  deleteSttAudio,
  readSttAudio,
} from "../modules/stt/stt.storage.js";
import {
  persistMeteringJob,
  recordAiRequest,
} from "../modules/usage/metering.js";
import {
  enqueueMetering,
  type MeteringJob,
  QUEUES,
  redis,
} from "./connection.js";
import { processStripeEvent, syncStaleSubscriptions } from "./stripe-events.js";
import { processSttJob } from "./stt-worker-processor.js";

// Separate process: `pnpm worker`. Same image, different CMD on Fly.
const env = loadEnv();
const log = pino({ level: env.LOG_LEVEL });
const prisma = new PrismaClient();

const redisMemoryTimer = setInterval(() => {
  void redis
    .info("memory")
    .then((info) => {
      const used = /^used_memory:(\d+)$/m.exec(info)?.[1];
      log.info(
        {
          event: "redis_memory",
          ...(used ? { usedMemoryBytes: Number(used) } : {}),
        },
        "Redis memory sampled",
      );
    })
    .catch((err: unknown) =>
      log.warn(
        { err, event: "redis_memory_error" },
        "Redis memory sample failed",
      ),
    );
}, 60_000);
redisMemoryTimer.unref();

const sttAudioCleanupTimer = setInterval(() => {
  void cleanupSttAudio().catch((err: unknown) =>
    log.warn(
      { err, event: "stt_audio_cleanup_error" },
      "STT audio cleanup failed",
    ),
  );
}, 5 * 60_000);
sttAudioCleanupTimer.unref();

function makeWorkerRedis() {
  const client = new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    retryStrategy: (times) => Math.min(times * 100, 2000),
  });
  // Same guard as the API process: without an 'error' listener ioredis
  // emits "Unhandled error event" on every reconnect and floods the log.
  let lastWarn = 0;
  client.on("error", (err: Error) => {
    const now = Date.now();
    if (now - lastWarn > 30_000) {
      lastWarn = now;
      log.warn(
        {
          err: (err as Error & { code?: string }).code ?? err.message,
          url: safeRedisEndpoint(env.REDIS_URL),
        },
        "worker redis unavailable — retrying in background",
      );
    }
  });
  return client;
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
        const idempotencyKey =
          typeof (job.data as { idempotencyKey?: unknown }).idempotencyKey ===
          "string"
            ? (job.data as { idempotencyKey: string }).idempotencyKey
            : String(job.id);
        await persistMeteringJob(
          prisma,
          job.data as MeteringJob,
          idempotencyKey,
        );
        return { ok: true, id: job.id, processed: true };
      },
      { connection: makeWorkerRedis(), concurrency: 5, lockDuration: 60_000 },
    ),
  ),
  observe(
    "stripe.webhook-process",
    new Worker(
      "stripe.webhook-process",
      async (job) => {
        const stripe = getStripe();
        if (!stripe) throw new Error("STRIPE_SECRET_KEY not configured");
        const { eventId } = job.data as { eventId: string };
        return processStripeEvent(prisma, stripe, eventId, log);
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
    "billing.reconcile",
    new Worker(
      "billing.reconcile",
      async () => {
        const stripe = getStripe();
        if (!stripe) {
          log.warn(
            "billing reconcile skipped: STRIPE_SECRET_KEY not configured",
          );
          return { ok: true, skipped: true };
        }
        return syncStaleSubscriptions(prisma, stripe, log);
      },
      { connection: makeWorkerRedis(), concurrency: 1, lockDuration: 60_000 },
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
  observe(
    "stt.transcribe",
    new Worker(
      "stt.transcribe",
      (job) =>
        processSttJob(job, {
          apiKey: env.OPENROUTER_API_KEY,
          appUrl: env.APP_URL,
          readAudio: readSttAudio,
          deleteAudio: deleteSttAudio,
          fetch,
          recordAi: (record) => recordAiRequest(prisma, record),
          enqueueMeter: (record) => enqueueMetering(record),
          storeResult: (jobId, value) =>
            redis.set(`stt:result:${jobId}`, JSON.stringify(value), "EX", 3600),
          rateLimit: (delayMs) => QUEUES.stt.rateLimit(delayMs),
          releaseSlot: releaseSttSlot,
          logError: (error, message) => log.error({ err: error }, message),
        }),
      {
        connection: makeWorkerRedis(),
        concurrency: 5,
        limiter: { max: 10, duration: 1000 },
        lockDuration: 60_000,
      },
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

// Hourly billing reconcile (missed-webhook safety net).
void QUEUES.billingReconcile
  .add(
    "reconcile-hourly",
    {},
    { repeat: { every: 3600_000 }, jobId: "reconcile-hourly" },
  )
  .catch((err: unknown) => log.error({ err }, "failed to schedule reconcile"));

async function shutdown(signal: string) {
  clearInterval(redisMemoryTimer);
  clearInterval(sttAudioCleanupTimer);
  log.info({ signal }, "worker shutting down");
  await Promise.all(workers.map((w) => w.close()));
  await Promise.all(Object.values(QUEUES).map((q) => q.close()));
  await prisma.$disconnect();
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("unhandledRejection", (err) => {
  log.fatal({ err }, "unhandled rejection");
  process.exit(1);
});
