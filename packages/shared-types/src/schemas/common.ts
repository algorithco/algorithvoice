import { z } from "zod";

// Stable error envelope for every non-2xx REST response.
// Never put stack traces, SQL, or provider internals in `error`.
export const errorSchema = z
  .object({
    error: z.string().max(100),
  })
  .strict();
export type ApiError = z.infer<typeof errorSchema>;

// Error envelope with machine-readable details (e.g. 413 maxMb).
export const errorDetailsSchema = z
  .object({
    error: z.string().max(100),
    maxMb: z.number().optional(),
  })
  .strict();
export type ApiErrorDetails = z.infer<typeof errorDetailsSchema>;
