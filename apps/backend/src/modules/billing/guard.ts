import {
  FREE_CLOUD_SECONDS_PER_MONTH,
  FREE_DEVICE_LIMIT,
  PRO_DEVICE_LIMIT,
} from "@algorith-voice/shared-types";
import type { PrismaClient } from "@prisma/client";

// Strict entitlement: only ACTIVE (or legacy TRIALING) with a future period
// end counts as pro. PAST_DUE / CANCELED / INCOMPLETE are free immediately.
// User.planTier is webhook-lagged — always prefer the live Subscription row.

export async function getActiveSubscription(
  prisma: PrismaClient,
  userId: string,
) {
  return prisma.subscription.findFirst({
    where: {
      userId,
      status: { in: ["ACTIVE", "TRIALING"] },
      currentPeriodEnd: { gt: new Date() },
    },
    orderBy: { currentPeriodEnd: "desc" },
  });
}

export async function isProUser(
  prisma: PrismaClient,
  userId: string,
): Promise<boolean> {
  const sub = await getActiveSubscription(prisma, userId);
  return sub !== null;
}

export async function deviceLimitForUser(
  prisma: PrismaClient,
  userId: string,
): Promise<number> {
  return (await isProUser(prisma, userId))
    ? PRO_DEVICE_LIMIT
    : FREE_DEVICE_LIMIT;
}

export async function cloudLimitForUser(
  prisma: PrismaClient,
  userId: string,
): Promise<number> {
  return (await isProUser(prisma, userId)) ? -1 : FREE_CLOUD_SECONDS_PER_MONTH;
}
