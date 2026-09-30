import { randomUUID } from "node:crypto";
import { FREE_CLOUD_SECONDS_PER_MONTH } from "@algorith-voice/shared-types";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { deleteSttAudio } from "../src/modules/stt/stt.storage.js";
import { QUEUES, redis } from "../src/queues/connection.js";
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

describe("C3: async STT controls", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await createTestApp();
  });

  beforeEach(async () => {
    await truncateTestState(app);
  });

  afterAll(async () => {
    await app.close();
  });

  async function userAuth(email: string) {
    const { user } = await createUser(app, { email });
    return { user, headers: authHeader(signAccessToken(app, user.id)) };
  }

  it("C3: quota exceeded returns 402 before accepting an async job", async () => {
    const { user, headers } = await userAuth("quota@example.invalid");
    await app.prisma.usageRecord.create({
      data: {
        userId: user.id,
        metric: "STT_SECONDS",
        quantity: FREE_CLOUD_SECONDS_PER_MONTH,
      },
    });
    const response = await app.inject({
      method: "POST",
      url: "/stt/jobs",
      headers,
    });
    expect(response.statusCode).toBe(402);
    expect(response.json()).toEqual({ error: "quota_exceeded" });
  });

  it("C3: forbidden async model returns 400", async () => {
    const { headers } = await userAuth("model@example.invalid");
    const response = await app.inject({
      method: "POST",
      url: "/stt/jobs?model=attacker/expensive-model",
      headers,
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "unsupported_model" });
  });

  it("C3: another user cannot read a queued job or cached result", async () => {
    const owner = await userAuth("owner@example.invalid");
    const other = await userAuth("other@example.invalid");
    const queuedId = `stt-${randomUUID()}`;
    await QUEUES.stt.add(
      "transcribe",
      {
        jobId: queuedId,
        userId: owner.user.id,
        format: "wav",
        model: "nvidia/parakeet-tdt-0.6b-v3",
        audioKey: queuedId,
      },
      { jobId: queuedId },
    );
    const queued = await app.inject({
      method: "GET",
      url: `/stt/jobs/${queuedId}`,
      headers: other.headers,
    });
    expect(queued.statusCode).toBe(404);

    const cachedId = `stt-${randomUUID()}`;
    await redis.set(
      `stt:result:${cachedId}`,
      JSON.stringify({
        userId: owner.user.id,
        result: { text: "private", latencyMs: 1 },
      }),
    );
    const cached = await app.inject({
      method: "GET",
      url: `/stt/jobs/${cachedId}`,
      headers: other.headers,
    });
    expect(cached.statusCode).toBe(404);
  });

  it("C3: async upload rejects files above 10 MiB", async () => {
    const { headers } = await userAuth("large@example.invalid");
    const boundary = "----algorith-voice-test";
    const prefix = Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="large.wav"\r\nContent-Type: audio/wav\r\n\r\n`,
    );
    const suffix = Buffer.from(`\r\n--${boundary}--\r\n`);
    const response = await app.inject({
      method: "POST",
      url: "/stt/jobs",
      headers: {
        ...headers,
        "content-type": `multipart/form-data; boundary=${boundary}`,
      },
      payload: joinBytes([prefix, Buffer.alloc(10 * 1024 * 1024 + 1), suffix]),
    });
    expect(response.statusCode).toBe(413);
    expect(response.json()).toMatchObject({
      error: "audio_too_large",
      maxMb: 10,
    });
  });

  it("C3: a user may have at most three queued jobs", async () => {
    const { user, headers } = await userAuth("depth@example.invalid");
    for (let index = 0; index < 3; index++) {
      const id = `stt-${randomUUID()}`;
      await QUEUES.stt.add(
        "transcribe",
        {
          jobId: id,
          userId: user.id,
          format: "wav",
          model: "nvidia/parakeet-tdt-0.6b-v3",
          audioKey: id,
        },
        { jobId: id },
      );
    }
    const response = await app.inject({
      method: "POST",
      url: "/stt/jobs",
      headers,
    });
    expect(response.statusCode).toBe(429);
    expect(response.json()).toEqual({ error: "too_many_queued_jobs" });
  });

  it("C3: four parallel submissions reserve at most three queue slots", async () => {
    const { headers } = await userAuth("parallel-depth@example.invalid");
    const boundary = "----algorith-voice-parallel-depth";
    const payload = Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="sample.wav"\r\nContent-Type: audio/wav\r\n\r\nRIFF0000WAVE\r\n--${boundary}--\r\n`,
    );
    const responses = await Promise.all(
      Array.from({ length: 4 }, () =>
        app.inject({
          method: "POST",
          url: "/stt/jobs",
          headers: {
            ...headers,
            "content-type": `multipart/form-data; boundary=${boundary}`,
          },
          payload,
        }),
      ),
    );

    expect(
      responses.filter((response) => response.statusCode === 202),
    ).toHaveLength(3);
    expect(
      responses.filter((response) => response.statusCode === 429),
    ).toHaveLength(1);
    for (const response of responses) {
      if (response.statusCode !== 202) continue;
      const { jobId } = response.json() as { jobId: string };
      await deleteSttAudio(jobId);
    }
  });
});
