import type { DeviceType } from "@prisma/client";

export function parseDeviceType(input: unknown): DeviceType | null {
  switch (input) {
    case "desktop-windows":
      return "DESKTOP_WINDOWS";
    case "desktop-linux":
      return "DESKTOP_LINUX";
    case "desktop-macos":
      return "DESKTOP_MACOS";
    default:
      return null;
  }
}
