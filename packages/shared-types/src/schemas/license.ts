import { z } from "zod";

export const deviceTypeSchema = z.enum([
  "desktop-macos",
  "desktop-windows",
  "desktop-linux",
]);
export type DeviceType = z.infer<typeof deviceTypeSchema>;

export const deviceSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    type: deviceTypeSchema,
    lastSeenAt: z.string().nullable(),
    createdAt: z.string(),
  })
  .strict();
export type Device = z.infer<typeof deviceSchema>;

export const licenseActivateSchema = z
  .object({
    deviceName: z.string().min(1).max(100),
    deviceType: deviceTypeSchema,
    deviceFingerprint: z.string().min(8).max(256),
  })
  .strict();
export type LicenseActivateInput = z.infer<typeof licenseActivateSchema>;

export const licenseSchema = z
  .object({
    licenseJwt: z.string(),
    device: deviceSchema,
    seatsUsed: z.number(),
    seatsMax: z.number().default(3),
  })
  .strict();
export type License = z.infer<typeof licenseSchema>;
