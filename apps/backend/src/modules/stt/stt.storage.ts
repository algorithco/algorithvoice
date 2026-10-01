import {
  mkdir,
  readdir,
  readFile,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { resolve, sep } from "node:path";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getAppEnv } from "../../config/env.js";

const AUDIO_KEY_RE = /^[a-zA-Z0-9-]{1,128}$/;
const R2_PREFIX = "stt/";
let r2Client: S3Client | null = null;

function validateKey(key: string): void {
  if (!AUDIO_KEY_RE.test(key)) throw new Error("invalid audio key");
}

function pathFor(key: string, configuredRoot?: string): string {
  validateKey(key);
  const root = resolve(configuredRoot ?? getAppEnv().STT_TEMP_DIR);
  const path = resolve(root, key);
  if (!path.startsWith(`${root}${sep}`)) throw new Error("invalid audio path");
  return path;
}

function objectKey(key: string): string {
  validateKey(key);
  return `${R2_PREFIX}${key}`;
}

function getR2Client(): S3Client {
  if (r2Client) return r2Client;
  const env = getAppEnv();
  if (
    !env.R2_ACCOUNT_ID ||
    !env.R2_ACCESS_KEY_ID ||
    !env.R2_SECRET_ACCESS_KEY
  ) {
    throw new Error("R2 storage is not configured");
  }
  r2Client = new S3Client({
    region: "auto",
    endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: env.R2_ACCESS_KEY_ID,
      secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    },
  });
  return r2Client;
}

function useR2(): boolean {
  return getAppEnv().STT_STORAGE_BACKEND === "r2";
}

export async function storeSttAudio(key: string, audio: Buffer) {
  // A crashed worker cannot run its normal finally cleanup. Throttle a
  // best-effort sweep so abandoned uploads get the same short lifetime as
  // queued job results even when no provider call completes.
  void cleanupSttAudio().catch(() => {});
  if (useR2()) {
    const env = getAppEnv();
    await getR2Client().send(
      new PutObjectCommand({
        Bucket: env.R2_BUCKET,
        Key: objectKey(key),
        Body: audio,
        ContentType: "application/octet-stream",
        CacheControl: "no-store",
      }),
    );
    return;
  }
  const path = pathFor(key);
  await mkdir(resolve(getAppEnv().STT_TEMP_DIR), { recursive: true });
  await writeFile(path, Uint8Array.from(audio), { flag: "wx", mode: 0o600 });
}

const DEFAULT_AUDIO_TTL_MS = 60 * 60 * 1000;
let lastCleanupAt = 0;

export async function cleanupSttAudio(
  maxAgeMs = DEFAULT_AUDIO_TTL_MS,
  root?: string,
): Promise<number> {
  const now = Date.now();
  if (root === undefined && useR2()) {
    if (now - lastCleanupAt < 60_000) return 0;
    lastCleanupAt = now;
    return cleanupR2Audio(maxAgeMs, now);
  }
  const configuredRoot = root ?? getAppEnv().STT_TEMP_DIR;
  if (root === undefined && now - lastCleanupAt < 60_000) {
    return 0;
  }
  if (root === undefined) lastCleanupAt = now;
  const directory = resolve(configuredRoot);
  let entries: Awaited<ReturnType<typeof readdir>>;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error: unknown) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return 0;
    throw error;
  }
  let removed = 0;
  for (const entry of entries) {
    if (!entry.isFile() || !/^[a-zA-Z0-9-]{1,128}$/.test(entry.name)) {
      continue;
    }
    const filePath = resolve(directory, entry.name);
    const metadata = await stat(filePath).catch(() => null);
    if (!metadata || now - metadata.mtimeMs < maxAgeMs) continue;
    await unlink(filePath).catch(() => {});
    removed += 1;
  }
  return removed;
}

async function cleanupR2Audio(maxAgeMs: number, now: number): Promise<number> {
  const env = getAppEnv();
  const client = getR2Client();
  let continuationToken: string | undefined;
  let removed = 0;
  do {
    const page = await client.send(
      new ListObjectsV2Command({
        Bucket: env.R2_BUCKET,
        Prefix: R2_PREFIX,
        ...(continuationToken ? { ContinuationToken: continuationToken } : {}),
      }),
    );
    for (const object of page.Contents ?? []) {
      if (
        !object.Key ||
        !object.LastModified ||
        now - object.LastModified.getTime() < maxAgeMs
      ) {
        continue;
      }
      await client.send(
        new DeleteObjectCommand({ Bucket: env.R2_BUCKET, Key: object.Key }),
      );
      removed += 1;
    }
    continuationToken = page.IsTruncated
      ? page.NextContinuationToken
      : undefined;
  } while (continuationToken);
  return removed;
}

export async function readSttAudio(key: string): Promise<Buffer> {
  if (!useR2()) return readFile(pathFor(key));
  const env = getAppEnv();
  const response = await getR2Client().send(
    new GetObjectCommand({ Bucket: env.R2_BUCKET, Key: objectKey(key) }),
  );
  if (!response.Body) throw new Error("audio object has no body");
  return Buffer.from(await response.Body.transformToByteArray());
}

export async function deleteSttAudio(key: string): Promise<void> {
  if (useR2()) {
    const env = getAppEnv();
    await getR2Client().send(
      new DeleteObjectCommand({
        Bucket: env.R2_BUCKET,
        Key: objectKey(key),
      }),
    );
    return;
  }
  await unlink(pathFor(key)).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") throw error;
  });
}
