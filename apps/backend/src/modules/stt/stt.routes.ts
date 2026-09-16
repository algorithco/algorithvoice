import {
  errorDetailsSchema,
  errorSchema,
  FREE_CLOUD_SECONDS_PER_MONTH,
  transcribeRequestSchema,
  transcriptSchema,
} from "@algorith-voice/shared-types";
import type { FastifyInstance } from "fastify";
import { getAppEnv } from "../../config/env.js";
import { enqueueMetering } from "../../queues/connection.js";
import {
  isAbortError,
  mimeForFormat,
  ProviderError,
  resolveAudioFormat,
  resolveDurationSec,
} from "./stt.utils.js";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/audio/transcriptions";
const MAX_SYNC_BYTES = 25 * 1024 * 1024;

interface ProviderOut {
  text: string;
  language?: string;
  duration?: number;
  usage?: { cost?: number };
}

async function transcribeViaOpenRouter(
  apiKey: string,
  audio: ArrayBuffer,
  filename: string,
  format: string,
  model: string,
  language?: string,
): Promise<ProviderOut> {
  const appUrl = getAppEnv().APP_URL;
  const form = new FormData();
  form.set(
    "file",
    new Blob([audio], { type: mimeForFormat(format) }),
    filename,
  );
  form.set("model", model);
  if (language && language !== "auto") form.set("language", language);

  let res: Response;
  try {
    res = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "HTTP-Referer": appUrl,
        "X-Title": "Algorith Voice",
      },
      body: form,
      signal: AbortSignal.timeout(30_000),
    });
  } catch (e: unknown) {
    if (isAbortError(e)) throw new ProviderError(504, "provider timeout");
    throw new ProviderError(
      503,
      e instanceof Error ? e.message : "network error",
    );
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new ProviderError(res.status, body.slice(0, 500));
  }
  return (await res.json()) as ProviderOut;
}

export async function sttRoutes(app: FastifyInstance) {
  // ---- Async queue: POST /stt/jobs → 202 { jobId } ----
  app.post(
    "/stt/jobs",
    {
      onRequest: [app.authenticate],
      config: { rateLimit: { max: 20, timeWindow: "1 minute" } },
    },
    async (req, reply) => {
      const { sub } = req.user as { sub: string };
      const file = await req.file();
      if (!file) return reply.code(400).send({ error: "audio_required" });
      const { randomUUID } = await import("node:crypto");
      const { redis } = await import("../../queues/connection.js");
      const { enqueueStt } = await import("../../queues/connection.js");
      const chunks: Uint8Array[] = [];
      let total = 0;
      for await (const chunk of file.file) {
        const c = chunk as Uint8Array;
        total += c.byteLength;
        if (total > MAX_SYNC_BYTES) {
          file.file.destroy();
          return reply.code(413).send({ error: "audio_too_large", maxMb: 25 });
        }
        chunks.push(c);
      }
      const merged = Buffer.concat(chunks);
      const format = resolveAudioFormat(
        file.filename,
        merged as unknown as Uint8Array,
      );
      if (!format)
        return reply.code(400).send({ error: "unsupported_audio_format" });
      const jobId = `stt-${randomUUID()}`;
      const audioKey = `stt:audio:${jobId}`;
      await redis.set(audioKey, merged.toString("base64"), "EX", 3600);
      const q = req.query as { language?: string; model?: string };
      await enqueueStt({
        jobId,
        userId: sub,
        format,
        model: q.model ?? getAppEnv().STT_PRIMARY,
        language: q.language,
        audioKey,
        filename: file.filename,
      });
      return reply.code(202).send({ jobId, statusUrl: `/stt/jobs/${jobId}` });
    },
  );

  app.get(
    "/stt/jobs/:id",
    {
      onRequest: [app.authenticate],
      config: { rateLimit: { max: 60, timeWindow: "1 minute" } },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      if (!id || id.length > 128)
        return reply.code(400).send({ error: "invalid_job_id" });
      const { redis } = await import("../../queues/connection.js");
      const { QUEUES } = await import("../../queues/connection.js");
      const cached = await redis.get(`stt:result:${id}`);
      if (cached) {
        const result = JSON.parse(cached) as {
          text: string;
          latencyMs: number;
        };
        return { id, status: "completed" as const, result };
      }
      const job = await QUEUES.stt.getJob(id);
      if (!job) return reply.code(404).send({ error: "not_found" });
      const state = await job.getState();
      if (state === "failed") {
        const reason = job.failedReason ?? "failed";
        return { id, status: "failed" as const, error: reason };
      }
      if (state === "completed") {
        const ret = job.returnvalue as { text?: string } | undefined;
        return { id, status: "completed" as const, result: ret };
      }
      return {
        id,
        status: state === "active" ? ("active" as const) : ("queued" as const),
      };
    },
  );

  app.post(
    "/stt/transcribe",
    {
      onRequest: [app.authenticate],
      schema: {
        querystring: transcribeRequestSchema,
        response: {
          200: transcriptSchema,
          400: errorSchema,
          402: errorSchema,
          413: errorDetailsSchema,
          503: errorSchema,
        },
      },
      config: { rateLimit: { max: 30, timeWindow: "1 minute" } },
    },
    async (req, reply) => {
      const apiKey = getAppEnv().OPENROUTER_API_KEY;
      if (!apiKey) {
        return reply.code(503).send({ error: "stt_unavailable" });
      }
      const { sub } = req.user as { sub: string };
      const { language, model } = req.query as {
        language?: string;
        model?: string;
      };

      const primary = getAppEnv().STT_PRIMARY;
      const fallback = getAppEnv().STT_FALLBACK;
      const allowed = new Set([primary, fallback]);
      const chosen = model ?? primary;
      if (!allowed.has(chosen)) {
        return reply.code(400).send({ error: "unsupported_model" });
      }

      // Quota gate BEFORE buffering audio or spending provider money.
      const user = await app.prisma.user.findUniqueOrThrow({
        where: { id: sub },
      });
      if (user.planTier !== "pro") {
        const now = new Date();
        const periodStart = new Date(
          Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
        );
        const used = await app.prisma.usageRecord.aggregate({
          where: {
            userId: sub,
            metric: "STT_SECONDS",
            recordedAt: { gte: periodStart },
          },
          _sum: { quantity: true },
        });
        const rawQty = used._sum.quantity;
        const usedSec =
          typeof rawQty === "number" ? rawQty : (rawQty?.toNumber() ?? 0);
        if (usedSec >= FREE_CLOUD_SECONDS_PER_MONTH) {
          await app.prisma.auditLog.create({
            data: { actorUserId: sub, action: "stt.quota_exceeded" },
          });
          return reply.code(402).send({ error: "quota_exceeded" });
        }
      }

      const file = await req.file();
      if (!file) return reply.code(400).send({ error: "audio_required" });
      const chunks: Uint8Array[] = [];
      let total = 0;
      for await (const chunk of file.file) {
        const c = chunk as Uint8Array;
        total += c.byteLength;
        if (total > MAX_SYNC_BYTES) {
          file.file.destroy();
          return reply.code(413).send({ error: "audio_too_large", maxMb: 25 });
        }
        chunks.push(c);
      }
      const merged = new Uint8Array(new ArrayBuffer(total));
      let off = 0;
      for (const c of chunks) {
        merged.set(c, off);
        off += c.byteLength;
      }
      const audio = merged.buffer as ArrayBuffer;

      const format = resolveAudioFormat(file.filename, merged);
      if (!format) {
        return reply.code(400).send({ error: "unsupported_audio_format" });
      }

      const started = Date.now();
      const meter = (durationSec: number, usedModel: string, cost?: number) => {
        enqueueMetering({
          sessionId: req.id,
          seq: 0,
          userId: sub,
          metric: "STT_SECONDS",
          quantity: durationSec,
          model: usedModel,
          latencyMs: Date.now() - started,
          providerCost: cost,
        }).catch((err: unknown) => {
          // Metering must never break transcription — but must never
          // fail silently either. Queue retries; this log is the alarm.
          req.log.error({ err, userId: sub }, "metering enqueue failed");
        });
      };

      const respond = (
        out: ProviderOut,
        usedModel: string,
        isFallback: boolean,
      ) => {
        const durationSec = resolveDurationSec(out.duration, merged, format);
        meter(durationSec, usedModel, out.usage?.cost);
        if (isFallback) reply.header("X-STT-Fallback", "1");
        return {
          text: out.text,
          language: out.language,
          durationSec,
          model: usedModel,
        };
      };

      try {
        const out = await transcribeViaOpenRouter(
          apiKey,
          audio,
          file.filename ?? "audio.wav",
          format,
          chosen,
          language,
        );
        return respond(out, chosen, false);
      } catch (e: unknown) {
        const retryable =
          e instanceof ProviderError ? e.retryable : isAbortError(e);
        if (!retryable) throw e;
        if (chosen === fallback) throw e;
        req.log.warn(
          { model: chosen, err: e instanceof Error ? e.message : e },
          "stt primary failed, trying fallback",
        );
        try {
          const out = await transcribeViaOpenRouter(
            apiKey,
            audio,
            file.filename ?? "audio.wav",
            format,
            fallback,
            language,
          );
          return respond(out, fallback, true);
        } catch (fallbackErr: unknown) {
          req.log.error(
            {
              err:
                fallbackErr instanceof Error
                  ? fallbackErr.message
                  : fallbackErr,
            },
            "stt fallback failed",
          );
          throw fallbackErr;
        }
      }
    },
  );

  // Streaming: Phase 2 proxies Mistral Voxtral Realtime here.
  // Auth strategy (frozen): POST /stt/token mints a short-lived JWT;
  // the WS verifies ?token= and closes 4401 on failure. Browsers cannot
  // send Authorization headers on WebSocket(), so long-lived access
  // tokens are never accepted in the URL.
  app.get("/stt/stream", { websocket: true }, (socket) => {
    socket.send(JSON.stringify({ type: "error", code: "not_implemented" }));
    socket.close(1013, "try again later");
  });
}
