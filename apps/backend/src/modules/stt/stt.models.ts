import type { PrismaClient } from "@prisma/client";
import type { Env } from "../../config/env.js";

interface ModelSelection {
  primary: string;
  fallback: string;
  allowed: ReadonlySet<string>;
}

let cached: { expiresAt: number; value: ModelSelection } | null = null;

export function invalidateSttModelCache(): void {
  cached = null;
}

export async function getSttModelSelection(
  prisma: PrismaClient,
  env: Env,
): Promise<ModelSelection> {
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const configs = await prisma.aiModelConfig.findMany({
    where: { isEnabled: true },
    select: { modelId: true, isActive: true, isFallback: true },
  });
  const primary =
    configs.find((config) => config.isActive)?.modelId ?? env.STT_PRIMARY;
  const fallback =
    configs.find((config) => config.isFallback)?.modelId ?? env.STT_FALLBACK;
  const value = {
    primary,
    fallback,
    allowed: new Set([
      env.STT_PRIMARY,
      env.STT_FALLBACK,
      ...configs.map((config) => config.modelId),
    ]),
  };
  cached = { expiresAt: Date.now() + 30_000, value };
  return value;
}

export async function selectConfiguredSttModel(
  prisma: PrismaClient,
  env: Env,
  requested?: string,
) {
  const selection = await getSttModelSelection(prisma, env);
  const selected = requested ?? selection.primary;
  if (!selection.allowed.has(selected)) {
    throw Object.assign(new Error("unsupported_model"), { statusCode: 400 });
  }
  return { selected, fallback: selection.fallback };
}
