import { type JobsOptions, Queue } from "bullmq";
import { Redis } from "ioredis";
import { z } from "zod";
import { loadEnv } from "../config/env.js";

// Single validated Redis connection for queues. No localhost fallback:
// a missing REDIS_URL must fail boot loudly, never silently queue nowhere.
//
// Local dev without Docker: Redis may simply not be running yet. Every
// client gets an error guard (otherwise ioredis emits "Unhandled error
// event" per retry and floods the log), retries quietly in the background,
// and auto-heals when Redis appears. The shared API client fails fast
// (enableOfflineQueue: false) so /ready and routes 503 quickly instead
// of hanging. Production (Docker/Fly) is unchanged — same URL, same queues.
const env = loadEnv();

// Throttle reconnect warnings: one line per client per interval, not one
// per retry. Without any 'error' listener ioredis throws "Unhandled error
// event" on every failed reconnect.
function guardRedis(client: Redis, label: string) {
  let lastWarn = 0;
  client.on("error", (err: Error) => {
    const now = Date.now();
    if (now - lastWarn > 30_000) {
      lastWarn = now;
      const detail =
        (err as Error & { code?: string }).code ?? err.message ?? String(err);
      console.warn(
        `[redis:${label}] Redis unavailable at ${env.REDIS_URL} [${detail}]. ` +
          `API keeps running; queue/auth-code features 503 until Redis is back. ` +
          `Start it with: pnpm redis:wsl (no Docker needed)`,
      );
    }
  });
  return client;
}

/** Plain-Redis client factory (fast-fail tuned for the API process). */
export function makeApiRedis() {
  return guardRedis(
    new Redis(env.REDIS_URL, {
      // Fail commands immediately while disconnected so HTTP handlers
      // 503 fast instead of queueing forever.
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
      enableReadyCheck: false,
      connectTimeout: 5000,
      // Docker Desktop (Windows) NAT drops idle host→container TCP mappings
      // faster than Redis' own 300s keepalive, leaving half-open corpses
      // (ECONNRESET on next use). Kernel probes every 10s keep the mapping
      // alive; harmless everywhere else.
      keepAlive: 10_000,
      retryStrategy: (times) => Math.min(times * 100, 2000),
    }),
    "api",
  );
}

/** BullMQ client factory (BullMQ requires maxRetriesPerRequest: null). */
export function makeQueueRedis(label: string) {
  return guardRedis(
    new Redis(env.REDIS_URL, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
      // Same NAT idle-death workaround as makeApiRedis.
      keepAlive: 10_000,
      retryStrategy: (times) => Math.min(times * 100, 2000),
    }),
    label,
  );
}

function makeRedis() {
  return makeQueueRedis("queue");
}

/** Shared by API process (enqueue + /ready ping). Workers use their own. */
export const redis = makeApiRedis();

/** Ping with a hard timeout so /ready 503s fast when Redis is down. */
export async function pingRedis(timeoutMs = 1000): Promise<boolean> {
  try {
    const pong = await Promise.race([
      redis.ping(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("redis ping timeout")), timeoutMs),
      ),
    ]);
    return pong === "PONG";
  } catch {
    return false;
  }
}

export function closeRedis() {
  // quit() hangs/rejects when never connected — fall back to disconnect.
  return redis.quit().catch(() => {
    redis.disconnect();
  });
}

const queueDefaults: JobsOptions = {
  attempts: 5,
  backoff: { type: "exponential", delay: 1000 },
  removeOnComplete: { age: 3600, count: 1000 },
  removeOnFail: { age: 24 * 3600, count: 5000 },
};

export const QUEUES = {
  stripeWebhook: new Queue("stripe.webhook-process", {
    connection: makeRedis(),
    defaultJobOptions: queueDefaults,
  }),
  billingReconcile: new Queue("billing.reconcile", {
    connection: makeRedis(),
    defaultJobOptions: queueDefaults,
  }),
  usageRollup: new Queue("usage.report-to-stripe", {
    connection: makeRedis(),
    defaultJobOptions: queueDefaults,
  }),
  metering: new Queue("metering", {
    connection: makeRedis(),
    defaultJobOptions: queueDefaults,
  }),
  stt: new Queue("stt.transcribe", {
    connection: makeRedis(),
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: "exponential", delay: 2000 },
      removeOnComplete: { age: 3600, count: 2000 },
      removeOnFail: { age: 24 * 3600, count: 5000 },
    },
  }),
} as const;

export function closeQueues() {
  return Promise.all(
    Object.values(QUEUES).map((q) => q.close().catch(() => {})),
  );
}

const MeteringJob = z
  .object({
    sessionId: z.string().min(1),
    seq: z.number().int().nonnegative(),
    userId: z.string().min(1),
    metric: z.enum(["STT_SECONDS", "WS_MINUTES"]),
    quantity: z.number().nonnegative(),
    model: z.string().max(100).optional(),
    latencyMs: z.number().int().nonnegative().optional(),
    providerCost: z.number().nonnegative().optional(),
  })
  .strict();
export type MeteringJob = z.infer<typeof MeteringJob>;

export function enqueueMetering(data: unknown, opts?: JobsOptions) {
  const job = MeteringJob.parse(data);
  const jobId = `meter:${job.sessionId}:${job.seq}`;
  // jobId last: callers must not override idempotency.
  return QUEUES.metering.add("meter", job, {
    ...opts,
    ...queueDefaults,
    jobId,
  });
}

export const SttJob = z
  .object({
    jobId: z.string().min(1).max(128),
    userId: z.string().min(1),
    format: z.string().min(1).max(32),
    model: z.string().min(1).max(128),
    language: z.string().max(16).optional(),
    audioKey: z.string().min(1).max(256),
    filename: z.string().max(256).optional(),
  })
  .strict();
export type SttJob = z.infer<typeof SttJob>;

export async function enqueueStt(data: SttJob) {
  const job = SttJob.parse(data);
  return QUEUES.stt.add("transcribe", job, { jobId: job.jobId });
}
