import { createHmac } from "node:crypto";
import { getAppEnv } from "../../config/env.js";
import { redis } from "../../queues/connection.js";

const ACCOUNT_WINDOW_SEC = 10 * 60;
const MAX_DELAY_MS = 2_000;
const PASSWORD_WORK_CONCURRENCY = 2;

function accountKey(email: string): string {
  const digest = createHmac("sha256", getAppEnv().JWT_ACCESS_SECRET)
    .update(email.trim().toLowerCase())
    .digest("base64url");
  return `login:account:${digest}`;
}

export function progressiveLoginDelayMs(failures: number): number {
  if (failures < 3) return 0;
  return Math.min(MAX_DELAY_MS, 100 * 2 ** Math.min(failures - 3, 8));
}

export async function waitForAccountLogin(email: string): Promise<void> {
  const failures = Number.parseInt(
    (await redis.get(accountKey(email))) ?? "0",
    10,
  );
  const delay = progressiveLoginDelayMs(
    Number.isFinite(failures) ? failures : 0,
  );
  if (delay > 0) {
    await new Promise<void>((resolve) => setTimeout(resolve, delay));
  }
}

export async function recordAccountLoginFailure(email: string): Promise<void> {
  const key = accountKey(email);
  await redis.multi().incr(key).expire(key, ACCOUNT_WINDOW_SEC).exec();
}

export async function clearAccountLoginFailures(email: string): Promise<void> {
  await redis.del(accountKey(email));
}

let activePasswordWork = 0;
const passwordWorkWaiters: Array<() => void> = [];

export async function withPasswordWork<T>(work: () => Promise<T>): Promise<T> {
  if (activePasswordWork >= PASSWORD_WORK_CONCURRENCY) {
    await new Promise<void>((resolve) => passwordWorkWaiters.push(resolve));
  }
  activePasswordWork += 1;
  try {
    return await work();
  } finally {
    activePasswordWork -= 1;
    passwordWorkWaiters.shift()?.();
  }
}
