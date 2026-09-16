#!/usr/bin/env node
// Simple load baseline for Fastify backend (no DB/Redis required).
// Spawns an ephemeral Fastify with mocked prisma/redis, hits /health and /ready
// with autocannon to measure throughput before any perf changes.
// Usage: pnpm exec node scripts/loadtest.mjs [--url http://localhost:3001/health]
//        or: node scripts/loadtest.mjs --mock

const args = process.argv.slice(2);
const mock = args.includes("--mock");

if (mock) {
  // In-process mock: build a tiny Fastify that mirrors the real /health shape.
  const { default: Fastify } = await import("fastify");
  const app = Fastify({ logger: false });
  app.get("/health", async () => ({
    ok: true,
    service: "algorith-voice-backend",
    uptimeSec: 42,
  }));
  app.get("/auth/me", async (_req, reply) =>
    reply.code(401).send({ error: "unauthorized" }),
  );
  const addr = await app.listen({ port: 0, host: "127.0.0.1" });
  console.log(`mock listening on ${addr}`);
  const url = `${addr}/health`;
  const { default: autocannon } = await import("autocannon");
  const result = await autocannon({
    url,
    connections: 20,
    duration: 10,
    pipelining: 1,
  });
  console.log(`\n=== MOCK /health (20c,10s) ===`);
  console.log(
    `req/s: ${result.requests.average}  p50:${result.latency.p50}ms p95:${result.latency.p95}ms p99:${result.latency.p99}ms errors:${result.errors} timeouts:${result.timeouts}`,
  );
  await app.close();
  process.exit(0);
}

// Real target (requires running backend: pnpm --filter @algorith-voice/backend dev)
const url =
  args.find((a) => a.startsWith("http")) ?? "http://localhost:3001/health";
let autocannon;
try {
  autocannon = (await import("autocannon")).default;
} catch {
  console.error(
    "autocannon not installed. Run: pnpm --filter @algorith-voice/backend add -D autocannon",
  );
  process.exit(1);
}
console.log(
  `hitting ${url} — 10s, 20 connections, pipelining 1 (run 3x, take median)`,
);
for (let i = 1; i <= 3; i++) {
  const r = await autocannon({ url, connections: 20, duration: 10 });
  console.log(
    `run ${i}: req/s ${r.requests.average.toFixed(1)}  p50 ${r.latency.p50} p95 ${r.latency.p95} p99 ${r.latency.p99}  errors ${r.errors}`,
  );
}
