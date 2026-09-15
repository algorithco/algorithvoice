import { z } from "zod";

export const checkoutRequestSchema = z
  .object({
    priceId: z.string().min(1),
    successUrl: z.string().url(),
    cancelUrl: z.string().url(),
  })
  .strict();
export type CheckoutRequest = z.infer<typeof checkoutRequestSchema>;

export const subscriptionSchema = z
  .object({
    status: z.enum([
      "trialing",
      "active",
      "past_due",
      "canceled",
      "incomplete",
      "free",
    ]),
    planTier: z.enum(["free", "pro"]),
    currentPeriodEnd: z.string().nullable(),
    cancelAtPeriodEnd: z.boolean().default(false),
  })
  .strict();
export type Subscription = z.infer<typeof subscriptionSchema>;

export const usageSummarySchema = z
  .object({
    periodStart: z.string(),
    periodEnd: z.string(),
    cloudSecondsUsed: z.number(),
    cloudSecondsLimit: z.number(),
    requests: z.number(),
    planTier: z.enum(["free", "pro"]),
  })
  .strict();
export type UsageSummary = z.infer<typeof usageSummarySchema>;

export const settingsPatchSchema = z
  .object({
    hotkey: z.string().max(50).optional(),
    sttMode: z.enum(["local", "cloud", "byok"]).optional(),
    cloudSyncEnabled: z.boolean().optional(),
    byokKey: z.string().max(500).optional(),
    vadThreshold: z.number().min(0).max(1).optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: "empty patch" });
export type SettingsPatch = z.infer<typeof settingsPatchSchema>;
