import { z } from "zod";

// Local-model contracts for on-device speech recognition.
// Shapes only — real download URLs and checksums live in the signed model
// manifest shipped with the desktop app, never here.

export const modelEngineSchema = z.enum(["sherpa-onnx", "whisper-cpp"]);
export type ModelEngine = z.infer<typeof modelEngineSchema>;

const httpsUrlSchema = z
  .string()
  .url()
  .refine((u) => u.startsWith("https://"), {
    message: "model downloads must use HTTPS",
  });

const sha256Schema = z
  .string()
  .regex(/^[0-9a-fA-F]{64}$/, { message: "sha256 must be 64 hex chars" });

const safeFilenameSchema = z
  .string()
  .min(1)
  .max(256)
  .refine(
    (n) => {
      // Bare filenames or safe relative subpaths (e.g. tokenizer/vocab.json).
      const segments = n.split("/");
      return (
        segments.length <= 3 &&
        segments.every(
          (s) =>
            s.length > 0 &&
            s !== "." &&
            !s.startsWith(".") &&
            !s.includes("..") &&
            !s.includes("\\"),
        )
      );
    },
    {
      message: "filename must be a safe relative path without traversal",
    },
  );

export const modelFileSchema = z
  .object({
    filename: safeFilenameSchema,
    url: httpsUrlSchema,
    fallbackUrl: httpsUrlSchema.optional(),
    sha256: sha256Schema,
    sizeBytes: z.number().int().positive(),
  })
  .strict();
export type ModelFile = z.infer<typeof modelFileSchema>;

export const localModelSchema = z
  .object({
    id: z
      .string()
      .min(1)
      .max(100)
      .regex(/^[a-z0-9][a-z0-9._-]*$/, {
        message: "model id must be a safe slug",
      }),
    name: z.string().min(1).max(120),
    version: z
      .string()
      .min(1)
      .max(32)
      .regex(/^[0-9]+\.[0-9]+\.[0-9]+$/, {
        message: "model version must be semver x.y.z",
      }),
    engine: modelEngineSchema,
    quantization: z.string().min(1).max(32),
    files: z.array(modelFileSchema).min(1),
    languages: z.array(z.string().regex(/^[a-z]{2,3}(-[A-Z]{2})?$/)).min(1),
    minRamGb: z.number().nonnegative(),
    recommendedRamGb: z.number().nonnegative(),
    minVramGb: z.number().nonnegative(),
    recommendedVramGb: z.number().nonnegative(),
    license: z.string().min(1).max(120),
    attribution: z.string().min(1).max(500),
    supportedOs: z.array(z.enum(["windows", "macos", "linux"])).min(1),
    supportedArch: z.array(z.enum(["x64", "arm64"])).min(1),
  })
  .strict()
  .superRefine((m, ctx) => {
    if (m.recommendedRamGb < m.minRamGb) {
      ctx.addIssue({
        code: "custom",
        message: "recommendedRamGb must be >= minRamGb",
      });
    }
    if (m.recommendedVramGb < m.minVramGb) {
      ctx.addIssue({
        code: "custom",
        message: "recommendedVramGb must be >= minVramGb",
      });
    }
    const names = new Set<string>();
    for (const f of m.files) {
      if (names.has(f.filename)) {
        ctx.addIssue({
          code: "custom",
          message: `duplicate filename: ${f.filename}`,
        });
      }
      names.add(f.filename);
    }
  });
export type LocalModel = z.infer<typeof localModelSchema>;

export const modelManifestSchema = z
  .object({
    manifestVersion: z.number().int().min(1),
    models: z.array(localModelSchema).min(1),
  })
  .strict()
  .superRefine((m, ctx) => {
    const ids = new Set<string>();
    for (const model of m.models) {
      if (ids.has(model.id)) {
        ctx.addIssue({
          code: "custom",
          message: `duplicate model id: ${model.id}`,
        });
      }
      ids.add(model.id);
    }
  });
export type ModelManifest = z.infer<typeof modelManifestSchema>;

export const modelStatusSchema = z.enum([
  "not-downloaded",
  "downloading",
  "verifying",
  "ready",
  "error",
]);
export type ModelStatus = z.infer<typeof modelStatusSchema>;

export const modelStatusInfoSchema = z
  .object({
    id: z.string().min(1),
    status: modelStatusSchema,
    downloadedBytes: z.number().int().nonnegative(),
    totalBytes: z.number().int().nonnegative(),
    errorCode: z.string().optional(),
    errorMessage: z.string().optional(),
    version: z.string().optional(),
  })
  .strict();
export type ModelStatusInfo = z.infer<typeof modelStatusInfoSchema>;

export const downloadProgressSchema = z
  .object({
    id: z.string().min(1),
    downloadedBytes: z.number().int().nonnegative(),
    totalBytes: z.number().int().nonnegative(),
    bytesPerSecond: z.number().nonnegative(),
    etaSeconds: z.number().nonnegative().optional(),
  })
  .strict();
export type DownloadProgress = z.infer<typeof downloadProgressSchema>;
