import type { FastifyInstance } from "fastify";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { QUEUES } from "../src/queues/connection.js";
import {
  authHeader,
  createTestApp,
  createUser,
  signAccessToken,
  truncateTestState,
} from "./helpers/app.js";

function joinBytes(parts: readonly ArrayLike<number>[]): Buffer {
  const result = Buffer.alloc(
    parts.reduce((total, part) => total + part.length, 0),
  );
  let offset = 0;
  for (const part of parts) {
    for (let index = 0; index < part.length; index++) {
      result[offset + index] = part[index] ?? 0;
    }
    offset += part.length;
  }
  return result;
}

function wavPayload(): Buffer {
  const dataBytes = 3200;
  const wav = Buffer.alloc(44 + dataBytes);
  wav.write("RIFF", 0, "ascii");
  wav.writeUInt32LE(36 + dataBytes, 4);
  wav.write("WAVE", 8, "ascii");
  wav.write("fmt ", 12, "ascii");
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(16_000, 24);
  wav.writeUInt32LE(32_000, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36, "ascii");
  wav.writeUInt32LE(dataBytes, 40);
  return wav;
}

function multipart(audio: Buffer, filename = "sample.wav") {
  const boundary = "----algorith-voice-sync-test";
  return {
    headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
    payload: joinBytes([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: audio/wav\r\n\r\n`,
      ),
      audio,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]),
  };
}

describe("T-TESTS: synchronous STT route", () => {
  let app: FastifyInstance;
  let headers: { authorization: string };

  beforeAll(async () => {
    app = await createTestApp();
  });

  beforeEach(async () => {
    await truncateTestState(app);
    const { user } = await createUser(app, {
      email: "sync-stt@example.invalid",
    });
    headers = authHeader(signAccessToken(app, user.id));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  afterAll(async () => {
    await app.close();
  });

  it("T-TESTS: transcribe sends validated audio to OpenRouter and queues metering", async () => {
    const provider = vi.fn(async (_input: unknown, init?: RequestInit) => {
      expect(init?.headers).toMatchObject({
        Authorization: expect.stringMatching(/^Bearer /),
      });
      const form = init?.body as FormData;
      expect(form.get("model")).toBeTruthy();
      expect(form.get("language")).toBe("uz");
      return new Response(
        JSON.stringify({
          text: "salom dunyo",
          language: "uz",
          duration: 0,
          usage: { cost: 0.001 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
    vi.stubGlobal("fetch", provider);
    const body = multipart(wavPayload());
    const response = await app.inject({
      method: "POST",
      url: "/stt/transcribe?language=uz",
      headers: { ...headers, ...body.headers },
      payload: body.payload,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      text: "salom dunyo",
      language: "uz",
      durationSec: 1,
    });
    expect(provider).toHaveBeenCalledTimes(1);
    expect(await app.prisma.aiRequestLog.count()).toBe(1);
    const jobs = await QUEUES.metering.getJobs(["wait", "delayed"]);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.data).toMatchObject({
      metric: "STT_SECONDS",
      quantity: 1,
    });
  });

  it("T-TESTS: retryable primary failure uses the configured fallback", async () => {
    const provider = vi
      .fn()
      .mockResolvedValueOnce(new Response("temporary", { status: 503 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ text: "fallback result", duration: 1 }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    vi.stubGlobal("fetch", provider);
    const body = multipart(wavPayload());
    const response = await app.inject({
      method: "POST",
      url: "/stt/transcribe",
      headers: { ...headers, ...body.headers },
      payload: body.payload,
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["x-stt-fallback"]).toBe("1");
    expect(response.json()).toMatchObject({ text: "fallback result" });
    expect(provider).toHaveBeenCalledTimes(2);
    expect(
      await app.prisma.aiRequestLog.count({ where: { success: false } }),
    ).toBe(1);
    expect(
      await app.prisma.aiRequestLog.count({ where: { success: true } }),
    ).toBe(1);
  });

  it("T-TESTS: unsupported audio is rejected before a provider call", async () => {
    const provider = vi.fn();
    vi.stubGlobal("fetch", provider);
    const body = multipart(Buffer.from("not audio"), "sample.unsupported");
    const response = await app.inject({
      method: "POST",
      url: "/stt/transcribe",
      headers: { ...headers, ...body.headers },
      payload: body.payload,
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "unsupported_audio_format" });
    expect(provider).not.toHaveBeenCalled();
  });
});
