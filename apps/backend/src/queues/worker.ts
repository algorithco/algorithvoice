import { PrismaClient } from "@prisma/client";
import { type RedisOptions, Worker } from "bullmq";
import pino from "pino";
import { loadEnv } from "../config/env.js";
import { getStripe } from "../modules/billing/stripe.js";
import { QUEUES, redis } from "./connection.js";
import { processStripeEvent } from "./stripe-events.js";

// Separate process: `pnpm worker`. Same image, different CMD on Fly.
const env = loadEnv();
const log = pino({ level: env.LOG_LEVEL });

/** BullMQ owns its ioredis 5 clients; pass options instead of an ioredis 6 instance. */
function makeWorkerConnection(): RedisOptions {
  return {
    url: env.REDIS_URL,
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    keepAlive: 10_000,
    retryStrategy: (times) => Math.min(times * 100, 2000),
  };
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
      {
        connection: makeWorkerConnection(),
        concurrency: 5,
        lockDuration: 60_000,
      },
    ),
  ),
  observe(
    "stripe.webhook-process",
    new Worker(
      "stripe.webhook-process",
      async (job) => {
        const stripe = getStripe();
        if (!stripe) throw new Error("STRIPE_SECRET_KEY not configured");
        const prisma = new PrismaClient();
        try {
          const { eventId } = job.data as { eventId: string };
          return await processStripeEvent(prisma, stripe, eventId, log);
        } finally {
          await prisma.$disconnect();
        }
      },
      {
        connection: makeWorkerConnection(),
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
      {
        connection: makeWorkerConnection(),
        concurrency: 1,
        lockDuration: 60_000,
      },
    ),
  ),
  observe(
    "stt.transcribe",
    new Worker(
      "stt.transcribe",
      async (job) => {
        const {
          jobId,
          userId: _userId,
          format,
          model,
          language,
          audioKey,
          filename,
        } = job.data as {
          jobId: string;
          userId: string;
          format: string;
          model: string;
          language?: string;
          audioKey: string;
          filename?: string;
        };
        const b64 = await redis.getBuffer(audioKey);
        if (!b64)
          throw Object.assign(new Error("audio expired, re-upload"), {
            statusCode: 410,
          });
        const audio = Buffer.from(b64.toString(), "base64");
        const { getAppEnv } = await import("../config/env.js");
        const env = getAppEnv();
        const apiKey = env.OPENROUTER_API_KEY;
        if (!apiKey)
          throw Object.assign(new Error("stt_unavailable"), {
            statusCode: 503,
          });
        // 30s timeout inside worker (not the HTTP handler), retry via BullMQ backoff
        const started = Date.now();
        let text = "";
        try {
          const { mimeForFormat } = await import("../modules/stt/stt.utils.js");
          const form = new FormData();
          form.set(
            "file",
            new Blob([new Uint8Array(audio)], { type: mimeForFormat(format) }),
            filename ?? "audio.wav",
          );
          form.set("model", model);
          if (language && language !== "auto") form.set("language", language);
          const res = await fetch(
            "https://openrouter.ai/api/v1/audio/transcriptions",
            {
              method: "POST",
              headers: {
                Authorization: `Bearer ${apiKey}`,
                "HTTP-Referer": env.APP_URL,
                "X-Title": "Algorith Voice",
              },
              body: form,
              signal: AbortSignal.timeout(30_000),
            },
          );
          if (!res.ok) {
            const body = await res.text().catch(() => "");
            const err = new Error(body.slice(0, 500)) as Error & {
              statusCode?: number;
              retryable?: boolean;
            };
            err.statusCode = res.status;
            err.retryable = res.status === 429 || res.status >= 500;
            if (res.status === 429) {
              const ra = res.headers.get("retry-after");
              const delay = ra ? Number.parseInt(ra, 10) * 1000 : 5000;
              await (
                job as unknown as { rateLimit: (ms: number) => Promise<void> }
              ).rateLimit?.(delay);
            }
            throw err;
          }
          const out = (await res.json()) as { text: string };
          text = out.text;
        } finally {
          await redis.del(audioKey).catch(() => {});
        }
        const latencyMs = Date.now() - started;
        // Persist result for polling (TTL 1h)
        await redis.set(
          `stt:result:${jobId}`,
          JSON.stringify({ text, latencyMs }),
          "EX",
          3600,
        );
        return { text, latencyMs };
      },
      {
        connection: makeWorkerConnection(),
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
