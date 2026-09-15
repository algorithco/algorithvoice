import { z } from "zod";

export const sttModeSchema = z.enum(["local", "cloud", "byok"]);
export type SttMode = z.infer<typeof sttModeSchema>;

export const transcribeRequestSchema = z
  .object({
    model: z.string().max(100).optional(),
    language: z.string().max(12).optional(),
    mode: sttModeSchema.default("cloud"),
  })
  .strict();

// WS protocol (JSON control frames; audio travels as binary PCM16 16k mono)
export const wsHelloSchema = z
  .object({
    type: z.literal("hello"),
    sampleRate: z.literal(16000),
    codec: z.literal("pcm16"),
    language: z.string().max(12).default("auto"),
    sessionId: z.string().uuid(),
  })
  .strict();

export const wsServerMessageSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("ready"),
      sessionId: z.string(),
      provider: z.string(),
    })
    .strict(),
  z
    .object({
      type: z.literal("partial"),
      text: z.string(),
      confidence: z.number().optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("final"),
      text: z.string(),
      language: z.string().optional(),
      durationSec: z.number().optional(),
    })
    .strict(),
  z.object({ type: z.literal("fallback"), reason: z.string() }).strict(),
  z
    .object({
      type: z.literal("error"),
      code: z.string(),
      retryAfterMs: z.number().optional(),
    })
    .strict(),
]);
export type WsServerMessage = z.infer<typeof wsServerMessageSchema>;

export const transcriptSchema = z
  .object({
    text: z.string(),
    language: z.string().optional(),
    durationSec: z.number().optional(),
    model: z.string().optional(),
  })
  .strict();
export type Transcript = z.infer<typeof transcriptSchema>;
