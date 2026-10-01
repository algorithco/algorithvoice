-- Existing web sessions intentionally receive no OAuth scopes.
ALTER TABLE "Session" ADD COLUMN "scopes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
