import { randomUUID } from "node:crypto";
import {
  errorDetailsSchema,
  errorSchema,
  transcribeRequestSchema,
  transcriptSchema,
} from "@algorith-voice/shared-types";
import type { FastifyInstance } from "fastify";
import { getAppEnv } from "../../config/env.js";
import { getUserId } from "../../plugins/jwt.js";
import {
  enqueueMetering,
  enqueueStt,
  QUEUES,
  redis,
} from "../../queues/connection.js";
import { recordAiRequest } from "../usage/metering.js";
import { selectConfiguredSttModel } from "./stt.models.js";
import {
  assertWithinQuota,
  asyncSttQuerySchema,
  safeSttFailure,
} from "./stt.policy.js";
import { releaseSttSlot, reserveSttSlot } from "./stt.slots.js";
import { deleteSttAudio, storeSttAudio } from "./stt.storage.js";
import {
  isAbortError,
  mimeForFormat,
  ProviderError,
  resolveAudioFormat,
  resolveDurationSec,
} from "./stt.utils.js";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/audio/transcriptions";
const MAX_SYNC_BYTES = 10 * 1024 * 1024;
const MAX_ASYNC_BYTES = 10 * 1024 * 1024;
const MAX_USER_ASYNC_JOBS = 3;

interface ProviderOut {
  text: string;
  language?: string;
  duration?: number;
  usage?: { cost?: number };
}

async function transcribeViaOpenRouter(
  apiKey: string,
  audio: Uint8Array<ArrayBuffer>,
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
    if (isAbortError(e)) throw new ProviderError(504);
    throw new ProviderError(503);
  }
  if (!res.ok) {
    await res.body?.cancel().catch(() => undefined);
    throw new ProviderError(res.status);
  }
  return (await res.json()) as ProviderOut;
}

export async function sttRoutes(app: FastifyInstance) {
  // ---- Async queue: POST /stt/jobs → 202 { jobId } ----
  app.post(
    "/stt/jobs",
    {
      onRequest: [app.authenticate],
      schema: { querystring: asyncSttQuerySchema },
      config: { rateLimit: { max: 20, timeWindow: "1 minute" } },
    },
    async (req, reply) => {
      const sub = getUserId(req);
      const env = getAppEnv();
      if (!env.OPENROUTER_API_KEY) {
        return reply.code(503).send({ error: "stt_unavailable" });
      }
      const q = req.query as { language?: string; model?: string };
      let chosen: string;
      try {
        chosen = (await selectConfiguredSttModel(app.prisma, env, q.model))
          .selected;
        await assertWithinQuota(app.prisma, sub);
      } catch (error) {
        const status = (error as { statusCode?: number }).statusCode;
        if (status === 400) {
          return reply.code(400).send({ error: "unsupported_model" });
        }
        if (status === 402) {
          req.log.warn({ event: "quota_denial" }, "STT quota denied");
          reply.header("Retry-After", "2592000");
          return reply.code(402).send({ error: "quota_exceeded" });
        }
        throw error;
      }
      const pending = await QUEUES.stt.getJobs(
        ["wait", "active", "delayed"],
        0,
        1000,
      );
      req.log.info(
        { event: "stt_queue_depth", queueDepth: pending.length },
        "STT queue depth sampled",
      );
      if (
        pending.filter((job) => job.data.userId === sub).length >=
        MAX_USER_ASYNC_JOBS
      ) {
        return reply.code(429).send({ error: "too_many_queued_jobs" });
      }
      const file = await req.file();
      if (!file) return reply.code(400).send({ error: "audio_required" });
      const chunks: Uint8Array[] = [];
      let total = 0;
      for await (const chunk of file.file) {
        const c = chunk as Uint8Array;
        total += c.byteLength;
        if (total > MAX_ASYNC_BYTES) {
          file.file.destroy();
          return reply.code(413).send({ error: "audio_too_large", maxMb: 10 });
        }
        chunks.push(c);
      }
      if (file.file.truncated) {
        return reply.code(413).send({ error: "audio_too_large", maxMb: 10 });
      }
      const merged = Buffer.concat(chunks);
      const format = resolveAudioFormat(
        file.filename,
        merged as unknown as Uint8Array,
      );
      if (!format)
        return reply.code(400).send({ error: "unsupported_audio_format" });
      const jobId = `stt-${randomUUID()}`;
      const audioKey = jobId;
      const reserved = await reserveSttSlot(sub, jobId, MAX_USER_ASYNC_JOBS);
      if (!reserved) {
        return reply.code(429).send({ error: "too_many_queued_jobs" });
      }
      try {
        await storeSttAudio(audioKey, merged);
        await enqueueStt({
          jobId,
          userId: sub,
          format,
          model: chosen,
          language: q.language,
          audioKey,
          filename: file.filename,
        });
      } catch (error) {
        await deleteSttAudio(audioKey);
        await releaseSttSlot(sub, jobId).catch(() => {});
        throw error;
      }
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
      const sub = getUserId(req);
      const { id } = req.params as { id: string };
      if (!id || id.length > 128)
        return reply.code(400).send({ error: "invalid_job_id" });
      const cached = await redis.get(`stt:result:${id}`);
      if (cached) {
        const cachedValue = JSON.parse(cached) as {
          userId?: string;
          result?: {
            text: string;
            latencyMs: number;
          };
          text: string;
          latencyMs: number;
        };
        if (cachedValue.userId !== sub) {
          return reply.code(404).send({ error: "not_found" });
        }
        return {
          id,
          status: "completed" as const,
          result: cachedValue.result,
        };
      }
      const job = await QUEUES.stt.getJob(id);
      if (!job || job.data.userId !== sub) {
        return reply.code(404).send({ error: "not_found" });
      }
      const state = await job.getState();
      if (state === "failed") {
        return { id, status: "failed" as const, error: safeSttFailure() };
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
      const sub = getUserId(req);
      const { language, model } = req.query as {
        language?: string;
        model?: string;
      };

      const env = getAppEnv();
      let fallback: string;
      let chosen: string;
      try {
        const selection = await selectConfiguredSttModel(
          app.prisma,
          env,
          model,
        );
        chosen = selection.selected;
        fallback = selection.fallback;
      } catch {
        return reply.code(400).send({ error: "unsupported_model" });
      }

      // Quota gate BEFORE buffering audio or spending provider money.
      // Strict: live Subscription row, not lagged User.planTier.
      // PAST_DUE counts as free immediately.
      try {
        await assertWithinQuota(app.prisma, sub);
      } catch (error) {
        if ((error as { statusCode?: number }).statusCode === 402) {
          req.log.warn({ event: "quota_denial" }, "STT quota denied");
          reply.header("Retry-After", "2592000");
          return reply.code(402).send({ error: "quota_exceeded" });
        }
        throw error;
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
          return reply.code(413).send({ error: "audio_too_large", maxMb: 10 });
        }
        chunks.push(c);
      }
      if (file.file.truncated) {
        return reply.code(413).send({ error: "audio_too_large", maxMb: 10 });
      }
      // Consolidate the multipart chunks into one ArrayBuffer-backed view.
      // This is the only full-size copy on the sync path and can be passed
      // directly to Blob plus the format/duration helpers.
      const audio = new Uint8Array(total);
      let offset = 0;
      for (const chunk of chunks) {
        audio.set(chunk, offset);
        offset += chunk.byteLength;
      }

      const format = resolveAudioFormat(file.filename, audio);
      if (!format) {
        return reply.code(400).send({ error: "unsupported_audio_format" });
      }

      const started = Date.now();
      const callProvider = async (providerModel: string) => {
        const providerStarted = Date.now();
        try {
          const out = await transcribeViaOpenRouter(
            apiKey,
            audio,
            file.filename ?? "audio.wav",
            format,
            providerModel,
            language,
          );
          await recordAiRequest(app.prisma, {
            userId: sub,
            model: providerModel,
            latencyMs: Date.now() - providerStarted,
            success: true,
            cost: out.usage?.cost,
          }).catch((err: unknown) => {
            req.log.error({ err, userId: sub }, "AI request log write failed");
          });
          return out;
        } catch (error) {
          req.log.warn(
            {
              event: "provider_error",
              provider: "openrouter",
              model: providerModel,
            },
            "STT provider request failed",
          );
          await recordAiRequest(app.prisma, {
            userId: sub,
            model: providerModel,
            latencyMs: Date.now() - providerStarted,
            success: false,
            errorCode:
              error instanceof ProviderError ? String(error.http) : "unknown",
          }).catch((err: unknown) => {
            req.log.error({ err, userId: sub }, "AI request log write failed");
          });
          throw error;
        }
      };
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
        const durationSec = resolveDurationSec(out.duration, audio, format);
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
        const out = await callProvider(chosen);
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
          const out = await callProvider(fallback);
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
