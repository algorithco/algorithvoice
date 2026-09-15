import type { FastifyInstance } from "fastify";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/audio/transcriptions";
const PRIMARY_MODEL = "nvidia/parakeet-tdt-0.6b-v3";
const FALLBACK_MODEL = "openai/whisper-large-v3";

async function transcribeViaOpenRouter(
  apiKey: string,
  audio: Buffer,
  format: string,
  model: string,
  language?: string,
) {
  const base64 = audio.toString("base64");
  const res = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      input_audio: { data: base64, format },
      language,
      response_format: "verbose_json",
      timestamp_granularities: ["segment"],
    }),
  });
  if (!res.ok)
    throw Object.assign(new Error(`stt provider ${res.status}`), {
      statusCode: 502,
    });
  return res.json() as Promise<{
    text: string;
    language?: string;
    duration?: number;
    usage?: { cost?: number };
  }>;
}

export async function sttRoutes(app: FastifyInstance) {
  // Non-streaming fallback. Primary Voxtral-Realtime WS lands with /stt/stream in Phase 2.
  app.post(
    "/stt/transcribe",
    { onRequest: [app.authenticate] },
    async (req, reply) => {
      const apiKey = process.env.OPENROUTER_API_KEY;
      if (!apiKey)
        return reply
          .code(501)
          .send({ error: "stt_not_configured", next: "phase-2" });
      const file = await req.file();
      if (!file) return reply.code(400).send({ error: "audio_required" });
      const chunks: Uint8Array[] = [];
      for await (const c of file.file) chunks.push(c as Uint8Array);
      const total = chunks.reduce((n, c) => n + c.byteLength, 0);
      const merged = new Uint8Array(total);
      let off = 0;
      for (const c of chunks) {
        merged.set(c, off);
        off += c.byteLength;
      }
      const audio = Buffer.from(merged);
      const format = (file.filename?.split(".").pop() ?? "wav").toLowerCase();
      const { language, model } = (req.query ?? {}) as {
        language?: string;
        model?: string;
      };

      const started = Date.now();
      try {
        const out = await transcribeViaOpenRouter(
          apiKey,
          audio,
          format,
          model ?? PRIMARY_MODEL,
          language,
        );
        await meter(
          app,
          req,
          out.duration ?? 0,
          model ?? PRIMARY_MODEL,
          Date.now() - started,
        );
        return {
          text: out.text,
          language: out.language,
          model: model ?? PRIMARY_MODEL,
        };
      } catch {
        const out = await transcribeViaOpenRouter(
          apiKey,
          audio,
          format,
          FALLBACK_MODEL,
          language,
        );
        await meter(
          app,
          req,
          out.duration ?? 0,
          FALLBACK_MODEL,
          Date.now() - started,
        );
        return {
          text: out.text,
          language: out.language,
          model: FALLBACK_MODEL,
          fallback: true,
        };
      }
    },
  );

  // Streaming: Phase 2 implements Voxtral Realtime proxy (binary PCM16 16k, 60ms frames).
  // Contract is frozen in @algorith-voice/shared-types voice schemas.
  app.get("/stt/stream", { websocket: true }, (socket) => {
    socket.send(
      JSON.stringify({
        type: "error",
        code: "not_implemented",
        next: "phase-2",
      }),
    );
    socket.close();
  });
}

async function meter(
  app: FastifyInstance,
  req: { user?: unknown },
  durationSec: number,
  model: string,
  latencyMs: number,
) {
  try {
    const { sub } = (req.user ?? {}) as { sub?: string };
    if (!sub) return;
    await app.prisma.usageRecord.create({
      data: {
        userId: sub,
        metric: "STT_SECONDS",
        quantity: durationSec,
        model,
        latencyMs,
      },
    });
  } catch {
    // metering must never break transcription
  }
}
