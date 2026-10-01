-- H2: record independently verified email ownership without changing signup behavior.
ALTER TABLE "User" ADD COLUMN "emailVerifiedAt" TIMESTAMP(3);
