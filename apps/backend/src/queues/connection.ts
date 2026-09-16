import { type JobsOptions, Queue } from "bullmq";
import { Redis } from "ioredis";
import { z } from "zod";
import { loadEnv } from "../config/env.js";

// Single validated Redis connection for queues. No localhost fallback:
// a missing REDIS_URL must fail boot loudly, never silently queue nowhere.
const env = loadEnv();

function makeRedis() {
  return new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    retryStrategy: (times) => Math.min(times * 100, 2000),
  });
}

/** Shared by API process (enqueue + /ready ping). Workers use their own. */
export const redis = makeRedis();

export function closeRedis() {
  return redis.quit();
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
  return Promise.all(Object.values(QUEUES).map((q) => q.close()));
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
