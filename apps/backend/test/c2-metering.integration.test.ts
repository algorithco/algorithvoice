import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getAppEnv } from "../src/config/env.js";
import {
  invalidateSttModelCache,
  selectConfiguredSttModel,
} from "../src/modules/stt/stt.models.js";
import {
  persistMeteringJob,
  recordAiRequest,
} from "../src/modules/usage/metering.js";
import { enqueueMetering, QUEUES } from "../src/queues/connection.js";
import {
  authHeader,
  createTestApp,
  createUser,
  signAccessToken,
  truncateTestState,
} from "./helpers/app.js";

describe("C2: durable usage metering", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await createTestApp();
  });

  beforeEach(async () => {
    await truncateTestState(app);
    invalidateSttModelCache();
  });

  afterAll(async () => {
    await app.close();
  });

  it("C2: processing the same metering job twice creates one usage row", async () => {
    const { user } = await createUser(app, { email: "meter@example.invalid" });
    const data = {
      sessionId: "session-1",
      seq: 0,
      userId: user.id,
      metric: "STT_SECONDS" as const,
      quantity: 12.5,
      model: "test/model",
      latencyMs: 25,
      providerCost: 0.001,
    };
    await persistMeteringJob(app.prisma, data, "meter:session-1:0");
    await persistMeteringJob(app.prisma, data, "meter:session-1:0");
    expect(await app.prisma.usageRecord.count()).toBe(1);
    const queued = await enqueueMetering(data);
    expect(queued.id).not.toContain(":");
    expect(queued.data).toMatchObject({
      idempotencyKey: "meter:session-1:0",
    });
    expect(await QUEUES.metering.getJob(queued.id as string)).toBeTruthy();
  });

  it("M-BACKEND-9: metering callers can override queue defaults except jobId", async () => {
    const { user } = await createUser(app, {
      email: "meter-options@example.invalid",
    });
    const queued = await enqueueMetering(
      {
        sessionId: "options-session",
        seq: 0,
        userId: user.id,
        metric: "STT_SECONDS",
        quantity: 1,
      },
      { attempts: 1, delay: 250, jobId: "caller-controlled" },
    );
    expect(queued.opts.attempts).toBe(1);
    expect(queued.opts.delay).toBe(250);
    expect(queued.id).not.toBe("caller-controlled");
  });

  it("C2: usage summary reflects a persisted metering event", async () => {
    const { user } = await createUser(app, {
      email: "summary@example.invalid",
    });
    await persistMeteringJob(
      app.prisma,
      {
        sessionId: "summary-session",
        seq: 0,
        userId: user.id,
        metric: "STT_SECONDS",
        quantity: 42,
      },
      "meter:summary-session:0",
    );
    const response = await app.inject({
      method: "GET",
      url: "/usage/summary",
      headers: authHeader(signAccessToken(app, user.id)),
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      cloudSecondsUsed: 42,
      requests: 1,
    });
    const daily = await app.inject({
      method: "GET",
      url: "/usage/daily?days=7",
      headers: authHeader(signAccessToken(app, user.id)),
    });
    expect(daily.statusCode).toBe(200);
    expect(
      daily.json<{ days: number; daily: Array<{ seconds: number }> }>(),
    ).toMatchObject({
      days: 7,
    });
    expect(
      daily
        .json<{ daily: Array<{ seconds: number }> }>()
        .daily.some((bucket) => bucket.seconds === 42),
    ).toBe(true);
    const recent = await app.inject({
      method: "GET",
      url: "/usage/recent?limit=1",
      headers: authHeader(signAccessToken(app, user.id)),
    });
    expect(recent.statusCode).toBe(200);
    expect(recent.json()).toMatchObject({
      recent: [expect.objectContaining({ seconds: 42 })],
    });
  });

  it("C2: enabled active and fallback database configs control selection", async () => {
    await app.prisma.aiModelConfig.createMany({
      data: [
        {
          modelId: "configured/primary",
          displayName: "Primary",
          provider: "openrouter",
          isActive: true,
        },
        {
          modelId: "configured/fallback",
          displayName: "Fallback",
          provider: "openrouter",
          isFallback: true,
        },
      ],
    });
    invalidateSttModelCache();
    const selection = await selectConfiguredSttModel(app.prisma, getAppEnv());
    expect(selection).toEqual({
      selected: "configured/primary",
      fallback: "configured/fallback",
    });
  });

  it("C2: AI request logs record successes and failures", async () => {
    const { user } = await createUser(app, { email: "ai-log@example.invalid" });
    await recordAiRequest(app.prisma, {
      userId: user.id,
      model: "test/model",
      latencyMs: 10,
      success: true,
      cost: 0.01,
    });
    await recordAiRequest(app.prisma, {
      userId: user.id,
      model: "test/model",
      latencyMs: 11,
      success: false,
      errorCode: "503",
    });
    expect(await app.prisma.aiRequestLog.count()).toBe(2);
    expect(
      await app.prisma.aiRequestLog.count({ where: { success: false } }),
    ).toBe(1);
  });
});
