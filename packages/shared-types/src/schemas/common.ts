import { z } from "zod";

// Stable error envelope for every non-2xx REST response.
// Never put stack traces, SQL, or provider internals in `error`.
export const errorSchema = z
  .object({
    error: z.string().max(100),
  })
  .strict();
export type ApiError = z.infer<typeof errorSchema>;
