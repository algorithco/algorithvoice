import { redis } from "../../queues/connection.js";

const SLOT_TTL_SEC = 60 * 60;
const RESERVE_SCRIPT = `
local count = redis.call("SCARD", KEYS[1])
if count >= tonumber(ARGV[2]) then
  return 0
end
redis.call("SADD", KEYS[1], ARGV[1])
redis.call("EXPIRE", KEYS[1], ARGV[3])
return 1
`;

const RELEASE_SCRIPT = `
redis.call("SREM", KEYS[1], ARGV[1])
if redis.call("SCARD", KEYS[1]) == 0 then
  redis.call("DEL", KEYS[1])
end
return 1
`;

function slotKey(userId: string): string {
  return `stt:slots:${userId}`;
}

/** Atomically reserve one in-flight async STT slot for a user. */
export async function reserveSttSlot(
  userId: string,
  jobId: string,
  limit: number,
): Promise<boolean> {
  const result = await redis.eval(
    RESERVE_SCRIPT,
    1,
    slotKey(userId),
    jobId,
    String(limit),
    String(SLOT_TTL_SEC),
  );
  return Number(result) === 1;
}

/** Release an in-flight slot after success or a terminal failure. */
export async function releaseSttSlot(
  userId: string,
  jobId: string,
): Promise<void> {
  await redis.eval(RELEASE_SCRIPT, 1, slotKey(userId), jobId);
}
