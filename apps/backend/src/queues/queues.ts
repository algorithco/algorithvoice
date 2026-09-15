import { type JobsOptions, Queue } from "bullmq";
import { Redis } from "ioredis";

const connection = new Redis(
  process.env.REDIS_URL ?? "redis://localhost:6379",
  {
    maxRetriesPerRequest: null,
  },
);

export const QUEUES = {
  stripeWebhook: new Queue("stripe.webhook-process", { connection }),
  usageRollup: new Queue("usage.report-to-stripe", { connection }),
  metering: new Queue("metering", { connection }),
} as const;

export function enqueueMetering(
  data: Record<string, unknown>,
  opts?: JobsOptions,
) {
  return QUEUES.metering.add("meter", data, {
    jobId: `${data.sessionId}:${data.seq}`,
    attempts: 5,
    backoff: { type: "exponential", delay: 1000 },
    ...opts,
  });
}
