-- C2: make metering retries safe. Additive and nullable for existing rows.
ALTER TABLE "UsageRecord" ADD COLUMN "idempotencyKey" TEXT;
CREATE UNIQUE INDEX "UsageRecord_idempotencyKey_key" ON "UsageRecord"("idempotencyKey");
