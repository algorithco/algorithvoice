import { Worker } from "bullmq";
import { Redis } from "ioredis";

const connection = new Redis(
  process.env.REDIS_URL ?? "redis://localhost:6379",
  {
    maxRetriesPerRequest: null,
  },
);

// Separate process: `pnpm worker`. Same image, different CMD on Fly/Railway.
new Worker(
  "metering",
  async (job) => {
    // TODO Phase 2: batch 60s windows -> usage_daily -> monthly rollup.
    return { ok: true, id: job.id };
  },
  { connection, concurrency: 10 },
);

new Worker(
  "stripe.webhook-process",
  async (job) => {
    // TODO Phase 4: idempotent via StripeEvent.id.
    return { ok: true, id: job.id };
  },
  { connection, concurrency: 5 },
);
