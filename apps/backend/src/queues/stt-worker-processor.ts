import { UnrecoverableError, Worker } from "bullmq";
import { mimeForFormat, resolveDurationSec } from "../modules/stt/stt.utils.js";

export interface SttProcessorJob {
  data: {
    jobId: string;
    userId: string;
    format: string;
    model: string;
    language?: string;
    audioKey: string;
    filename?: string;
  };
  attemptsMade: number;
  opts: { attempts?: number };
}

interface AiRecord {
  userId: string;
  model: string;
  latencyMs: number;
  success: boolean;
  cost?: number;
  errorCode?: string;
}

interface MeterRecord {
  sessionId: string;
  seq: number;
  userId: string;
  metric: "STT_SECONDS";
  quantity: number;
  model: string;
  latencyMs: number;
  providerCost?: number;
}

export interface SttProcessorDeps {
  apiKey?: string;
  appUrl: string;
  readAudio: (key: string) => Promise<Buffer>;
  deleteAudio: (key: string) => Promise<void>;
  fetch: typeof fetch;
  recordAi: (record: AiRecord) => Promise<unknown>;
  enqueueMeter: (record: MeterRecord) => Promise<unknown>;
  storeResult: (
    jobId: string,
    value: { userId: string; result: { text: string; latencyMs: number } },
  ) => Promise<unknown>;
  rateLimit: (delayMs: number) => Promise<void>;
  releaseSlot: (userId: string, jobId: string) => Promise<void>;
  logError: (error: unknown, message: string) => void;
}

export async function processSttJob(
  job: SttProcessorJob,
  deps: SttProcessorDeps,
): Promise<{ text: string; latencyMs: number }> {
  const { jobId, userId, format, model, language, audioKey, filename } =
    job.data;
  let audio: Buffer;
  try {
    audio = await deps.readAudio(audioKey);
  } catch {
    await deps
      .releaseSlot(userId, jobId)
      .catch((error: unknown) =>
        deps.logError(error, "STT slot release failed"),
      );
    throw new UnrecoverableError("audio_expired");
  }
  if (!deps.apiKey) {
    await deps.deleteAudio(audioKey).catch(() => {});
    await deps
      .releaseSlot(userId, jobId)
      .catch((error: unknown) =>
        deps.logError(error, "STT slot release failed"),
      );
    throw new UnrecoverableError("stt_unavailable");
  }

  const started = Date.now();
  const providerStarted = Date.now();
  let text = "";
  let duration: number | undefined;
  let providerCost: number | undefined;
  let deleteAfterAttempt = false;
  let rateLimited = false;
  try {
    const form = new FormData();
    form.set(
      "file",
      new Blob([new Uint8Array(audio)], { type: mimeForFormat(format) }),
      filename ?? "audio.wav",
    );
    form.set("model", model);
    if (language && language !== "auto") form.set("language", language);
    const response = await deps.fetch(
      "https://openrouter.ai/api/v1/audio/transcriptions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${deps.apiKey}`,
          "HTTP-Referer": deps.appUrl,
          "X-Title": "Algorith Voice",
        },
        body: form,
        signal: AbortSignal.timeout(30_000),
      },
    );
    if (!response.ok) {
      if (response.status === 429) {
        const retryAfter = response.headers.get("retry-after");
        const parsed = retryAfter ? Number.parseInt(retryAfter, 10) : 0;
        const delayMs =
          Number.isFinite(parsed) && parsed > 0 ? parsed * 1000 : 5000;
        rateLimited = true;
        await deps.rateLimit(delayMs);
        throw Worker.RateLimitError();
      }
      if (response.status >= 400 && response.status < 500) {
        deleteAfterAttempt = true;
        throw new UnrecoverableError("provider_rejected_request");
      }
      throw new Error("provider_temporarily_unavailable");
    }
    const output = (await response.json()) as {
      text?: unknown;
      duration?: number;
      usage?: { cost?: number };
    };
    if (typeof output.text !== "string") {
      throw new Error("provider_invalid_response");
    }
    text = output.text;
    duration = output.duration;
    providerCost = output.usage?.cost;
    await deps
      .recordAi({
        userId,
        model,
        latencyMs: Date.now() - providerStarted,
        success: true,
        ...(providerCost !== undefined ? { cost: providerCost } : {}),
      })
      .catch((error: unknown) =>
        deps.logError(error, "AI request log write failed"),
      );
  } catch (error) {
    await deps
      .recordAi({
        userId,
        model,
        latencyMs: Date.now() - providerStarted,
        success: false,
        errorCode:
          error instanceof UnrecoverableError
            ? error.message
            : rateLimited
              ? "rate_limited"
              : "provider_error",
      })
      .catch((writeError: unknown) =>
        deps.logError(writeError, "AI request log write failed"),
      );
    const attempts = job.opts.attempts ?? 1;
    if (job.attemptsMade + 1 >= attempts) {
      deleteAfterAttempt = true;
    }
    throw error;
  } finally {
    if (deleteAfterAttempt) {
      await deps
        .deleteAudio(audioKey)
        .catch((error: unknown) =>
          deps.logError(error, "STT audio cleanup failed"),
        );
      await deps
        .releaseSlot(userId, jobId)
        .catch((error: unknown) =>
          deps.logError(error, "STT slot release failed"),
        );
    }
  }

  const latencyMs = Date.now() - started;
  const quantity = resolveDurationSec(duration, new Uint8Array(audio), format);
  await deps
    .enqueueMeter({
      sessionId: jobId,
      seq: 0,
      userId,
      metric: "STT_SECONDS",
      quantity,
      model,
      latencyMs,
      ...(providerCost !== undefined ? { providerCost } : {}),
    })
    .catch((error: unknown) =>
      deps.logError(error, "async metering enqueue failed"),
    );
  try {
    await deps.storeResult(jobId, {
      userId,
      result: { text, latencyMs },
    });
  } catch (error) {
    const attempts = job.opts.attempts ?? 1;
    if (job.attemptsMade + 1 >= attempts) {
      await deps
        .deleteAudio(audioKey)
        .catch((cleanupError: unknown) =>
          deps.logError(cleanupError, "STT audio cleanup failed"),
        );
      await deps
        .releaseSlot(userId, jobId)
        .catch((releaseError: unknown) =>
          deps.logError(releaseError, "STT slot release failed"),
        );
    }
    throw error;
  }
  await deps
    .deleteAudio(audioKey)
    .catch((error: unknown) =>
      deps.logError(error, "STT audio cleanup failed"),
    );
  await deps
    .releaseSlot(userId, jobId)
    .catch((error: unknown) => deps.logError(error, "STT slot release failed"));
  return { text, latencyMs };
}
