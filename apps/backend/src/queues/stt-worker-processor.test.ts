import { UnrecoverableError } from "bullmq";
import { describe, expect, it, vi } from "vitest";
import {
  processSttJob,
  type SttProcessorDeps,
} from "./stt-worker-processor.js";

function response(status: number, body: object | string): Response {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function makeDeps(fetcher: SttProcessorDeps["fetch"]): SttProcessorDeps {
  return {
    apiKey: "provider-key",
    appUrl: "http://localhost:3000",
    readAudio: vi.fn().mockResolvedValue(Buffer.from("audio")),
    deleteAudio: vi.fn().mockResolvedValue(undefined),
    fetch: fetcher,
    recordAi: vi.fn().mockResolvedValue(undefined),
    enqueueMeter: vi.fn().mockResolvedValue(undefined),
    storeResult: vi.fn().mockResolvedValue(undefined),
    rateLimit: vi.fn().mockResolvedValue(undefined),
    releaseSlot: vi.fn().mockResolvedValue(undefined),
    logError: vi.fn(),
  };
}

const data = {
  jobId: "job-1",
  userId: "user-1",
  format: "wav",
  model: "model-1",
  audioKey: "audio-1",
};

describe("H7: STT worker retry lifecycle", () => {
  it("H7: preserves audio across a transient 503 then meters and deletes once", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(response(503, "provider outage"))
      .mockResolvedValueOnce(response(200, { text: "done", duration: 2 }));
    const deps = makeDeps(fetcher);

    await expect(
      processSttJob({ data, attemptsMade: 0, opts: { attempts: 3 } }, deps),
    ).rejects.toThrow("provider_temporarily_unavailable");
    expect(deps.deleteAudio).not.toHaveBeenCalled();
    expect(deps.releaseSlot).not.toHaveBeenCalled();
    expect(deps.enqueueMeter).not.toHaveBeenCalled();

    await expect(
      processSttJob({ data, attemptsMade: 1, opts: { attempts: 3 } }, deps),
    ).resolves.toMatchObject({ text: "done" });
    expect(deps.deleteAudio).toHaveBeenCalledTimes(1);
    expect(deps.releaseSlot).toHaveBeenCalledTimes(1);
    expect(deps.enqueueMeter).toHaveBeenCalledTimes(1);
  });

  it("H7: makes provider 400 unrecoverable and removes the audio", async () => {
    const deps = makeDeps(
      vi.fn().mockResolvedValue(response(400, "bad input")),
    );
    const error = await processSttJob(
      { data, attemptsMade: 0, opts: { attempts: 3 } },
      deps,
    ).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(UnrecoverableError);
    expect((error as Error).message).toBe("provider_rejected_request");
    expect(deps.deleteAudio).toHaveBeenCalledTimes(1);
    expect(deps.releaseSlot).toHaveBeenCalledTimes(1);
    expect(deps.enqueueMeter).not.toHaveBeenCalled();
  });

  it("H7: removes audio when the final provider attempt is rate-limited", async () => {
    const deps = makeDeps(
      vi.fn().mockResolvedValue(
        new Response("busy", {
          status: 429,
          headers: { "retry-after": "1" },
        }),
      ),
    );
    await expect(
      processSttJob({ data, attemptsMade: 2, opts: { attempts: 3 } }, deps),
    ).rejects.toThrow();
    expect(deps.rateLimit).toHaveBeenCalledWith(1000);
    expect(deps.deleteAudio).toHaveBeenCalledTimes(1);
    expect(deps.releaseSlot).toHaveBeenCalledTimes(1);
  });

  it("H7: preserves audio when result storage fails before the final attempt", async () => {
    const deps = makeDeps(
      vi.fn().mockResolvedValue(response(200, { text: "done", duration: 2 })),
    );
    vi.mocked(deps.storeResult).mockRejectedValue(new Error("redis outage"));

    await expect(
      processSttJob({ data, attemptsMade: 0, opts: { attempts: 3 } }, deps),
    ).rejects.toThrow("redis outage");
    expect(deps.deleteAudio).not.toHaveBeenCalled();
    expect(deps.releaseSlot).not.toHaveBeenCalled();
  });

  it("H7: removes audio when result storage fails on the final attempt", async () => {
    const deps = makeDeps(
      vi.fn().mockResolvedValue(response(200, { text: "done", duration: 2 })),
    );
    vi.mocked(deps.storeResult).mockRejectedValue(new Error("redis outage"));

    await expect(
      processSttJob({ data, attemptsMade: 2, opts: { attempts: 3 } }, deps),
    ).rejects.toThrow("redis outage");
    expect(deps.deleteAudio).toHaveBeenCalledTimes(1);
    expect(deps.releaseSlot).toHaveBeenCalledTimes(1);
  });
});
