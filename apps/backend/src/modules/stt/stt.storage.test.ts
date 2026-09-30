import { access, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadEnv, setAppEnv } from "../../config/env.js";

const objectStore = vi.hoisted(() => ({ send: vi.fn() }));

vi.mock("@aws-sdk/client-s3", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@aws-sdk/client-s3")>();
  return {
    ...actual,
    S3Client: class {
      send = objectStore.send;
    },
  };
});

import {
  cleanupSttAudio,
  deleteSttAudio,
  readSttAudio,
  storeSttAudio,
} from "./stt.storage.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  objectStore.send.mockReset();
  setAppEnv(loadEnv({ ...process.env, STT_STORAGE_BACKEND: "local" }));
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("STT audio storage cleanup", () => {
  it("C3: removes abandoned audio after its short TTL and preserves fresh files", async () => {
    const directory = await mkdtemp(join(tmpdir(), "algorith-voice-stt-test-"));
    temporaryDirectories.push(directory);
    const stale = join(directory, "stale-job");
    const fresh = join(directory, "fresh-job");
    await writeFile(stale, "stale");
    await writeFile(fresh, "fresh");
    const old = new Date(Date.now() - 2 * 60 * 60 * 1000);
    await utimes(stale, old, old);

    expect(await cleanupSttAudio(60 * 60 * 1000, directory)).toBe(1);
    await expect(access(stale)).rejects.toThrow();
    await expect(access(fresh)).resolves.toBeUndefined();
  });

  it("C3: stores, reads, and deletes async audio through R2 when configured", async () => {
    setAppEnv(
      loadEnv({
        ...process.env,
        STT_STORAGE_BACKEND: "r2",
        R2_ACCOUNT_ID: "0123456789abcdef0123456789abcdef",
        R2_ACCESS_KEY_ID: "test-access-key",
        R2_SECRET_ACCESS_KEY: "test-secret-key",
        R2_BUCKET: "test-audio",
      }),
    );
    objectStore.send.mockImplementation(async (command: object) => {
      if (command instanceof ListObjectsV2Command) {
        return { Contents: [], IsTruncated: false };
      }
      if (command instanceof GetObjectCommand) {
        return {
          Body: {
            transformToByteArray: async () => new Uint8Array([1, 2, 3]),
          },
        };
      }
      return {};
    });

    await storeSttAudio("stt-r2-test", Buffer.from([1, 2, 3]));
    await expect(readSttAudio("stt-r2-test")).resolves.toEqual(
      Buffer.from([1, 2, 3]),
    );
    await deleteSttAudio("stt-r2-test");

    const commands = objectStore.send.mock.calls.map(([command]) => command);
    expect(
      commands.some((command) => command instanceof PutObjectCommand),
    ).toBe(true);
    expect(
      commands.some((command) => command instanceof GetObjectCommand),
    ).toBe(true);
    expect(
      commands.some((command) => command instanceof DeleteObjectCommand),
    ).toBe(true);
  });
});
