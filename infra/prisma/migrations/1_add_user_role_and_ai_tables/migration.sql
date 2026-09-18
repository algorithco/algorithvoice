-- Backfill schema drift: User.role (+ UserRole enum) and the
-- AiModelConfig / AiRequestLog tables were added to schema.prisma
-- after 0_init without a migration. Generated via:
--   prisma migrate diff --from-migrations infra/prisma/migrations \
--     --to-schema-datamodel infra/prisma/schema.prisma \
--     --shadow-database-url postgresql://algorith:algorith@postgres:5432/shadowdb \
--     --script

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('user', 'admin');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "role" "UserRole" NOT NULL DEFAULT 'user';

-- CreateTable
CREATE TABLE "AiModelConfig" (
    "id" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "isFallback" BOOLEAN NOT NULL DEFAULT false,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "inputPricePer1k" DECIMAL(10,6) NOT NULL DEFAULT 0,
    "outputPricePer1k" DECIMAL(10,6) NOT NULL DEFAULT 0,
    "maxTokens" INTEGER NOT NULL DEFAULT 4096,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiModelConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiRequestLog" (
    "id" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "latencyMs" INTEGER NOT NULL,
    "promptTokens" INTEGER NOT NULL DEFAULT 0,
    "completionTokens" INTEGER NOT NULL DEFAULT 0,
    "costUsd" DECIMAL(10,6) NOT NULL DEFAULT 0,
    "success" BOOLEAN NOT NULL,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiRequestLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AiModelConfig_modelId_key" ON "AiModelConfig"("modelId");

-- CreateIndex
CREATE INDEX "AiModelConfig_isActive_idx" ON "AiModelConfig"("isActive");

-- CreateIndex
CREATE INDEX "AiModelConfig_provider_idx" ON "AiModelConfig"("provider");

-- CreateIndex
CREATE INDEX "AiRequestLog_createdAt_idx" ON "AiRequestLog"("createdAt" DESC);

-- CreateIndex
CREATE INDEX "AiRequestLog_model_createdAt_idx" ON "AiRequestLog"("model", "createdAt");

-- CreateIndex
CREATE INDEX "AiRequestLog_success_createdAt_idx" ON "AiRequestLog"("success", "createdAt");
