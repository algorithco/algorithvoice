-- Rollout preflight: verify there are no duplicate non-null fingerprints per
-- user before applying. This index closes concurrent activation races.
CREATE UNIQUE INDEX "Device_userId_fingerprint_unique"
ON "Device"("userId", "fingerprint")
WHERE "fingerprint" IS NOT NULL;
