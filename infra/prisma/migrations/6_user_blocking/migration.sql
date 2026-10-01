-- Additive rollout: deploy before the API version that enforces blockedAt.
ALTER TABLE "User" ADD COLUMN "blockedAt" TIMESTAMP(3);
