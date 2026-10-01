-- Additive rollout: deploy this migration before the worker version that
-- writes reconciliation attempt metadata.
ALTER TABLE "Subscription"
ADD COLUMN "lastSyncAttemptAt" TIMESTAMP(3),
ADD COLUMN "syncFailureCount" INTEGER NOT NULL DEFAULT 0;

CREATE INDEX "Subscription_status_lastSyncAttemptAt_idx"
ON "Subscription"("status", "lastSyncAttemptAt");
