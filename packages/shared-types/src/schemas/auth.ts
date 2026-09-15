import { z } from "zod";

export const emailSchema = z.string().email().max(254);
export const passwordSchema = z.string().min(12).max(128);

export const signupSchema = z
  .object({
    email: emailSchema,
    password: passwordSchema,
    name: z.string().min(1).max(100).optional(),
    deviceName: z.string().min(1).max(100).optional(),
    deviceType: z
      .enum(["desktop-macos", "desktop-windows", "desktop-linux"])
      .optional(),
  })
  .strict();
export type SignupInput = z.infer<typeof signupSchema>;

export const loginSchema = z
  .object({ email: emailSchema, password: z.string().min(1).max(128) })
  .strict();
export type LoginInput = z.infer<typeof loginSchema>;

export const userSchema = z
  .object({
    id: z.string(),
    email: z.string().email(),
    name: z.string().nullable(),
    planTier: z.enum(["free", "pro"]),
    stripeCustomerId: z.string().nullable(),
    createdAt: z.string(),
  })
  .strict();
export type User = z.infer<typeof userSchema>;

export const authPairSchema = z
  .object({
    user: userSchema,
    accessToken: z.string(),
  })
  .strict();
export type AuthPair = z.infer<typeof authPairSchema>;
