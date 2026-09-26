import {
  licenseActivateSchema,
  OFFLINE_GRACE_DAYS,
} from "@algorith-voice/shared-types";
import type { DeviceType } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { deviceLimitForUser } from "../billing/guard.js";

// Phase 3 adds RS256 license JWTs with 7d offline grace. Seat counting and
// fingerprint binding are live: activate upserts by (userId, fingerprint).
function toDeviceTypeEnum(input: unknown): DeviceType {
  switch (input) {
    case "desktop-windows":
      return "DESKTOP_WINDOWS";
    case "desktop-linux":
      return "DESKTOP_LINUX";
    default:
      return "DESKTOP_MACOS";
  }
}

// Prisma stores DESKTOP_*; the shared contract speaks kebab-case.
function toDeviceTypeKebab(input: string): string {
  const normalized = input.toLowerCase().replace(/_/g, "-");
  if (
    normalized === "desktop-windows" ||
    normalized === "desktop-linux" ||
    normalized === "desktop-macos"
  ) {
    return normalized;
  }
  return normalized;
}
export async function licenseRoutes(app: FastifyInstance) {
  app.post(
    "/activate",
    { onRequest: [app.authenticate], schema: { body: licenseActivateSchema } },
    async (req, reply) => {
      const { sub } = req.user as { sub: string };
      const { deviceName, deviceType, deviceFingerprint } = req.body as {
        deviceName: string;
        deviceType: string;
        deviceFingerprint: string;
      };
      const now = new Date();
      const select = {
        id: true,
        name: true,
        type: true,
        lastSeenAt: true,
        createdAt: true,
      } as const;
      const existing = await app.prisma.device.findFirst({
        where: { userId: sub, fingerprint: deviceFingerprint },
        select: { ...select },
      });
      let device = existing;
      if (existing) {
        device = await app.prisma.device.update({
          where: { id: existing.id },
          data: {
            name: deviceName,
            type: toDeviceTypeEnum(deviceType),
            lastSeenAt: now,
          },
          select: { ...select },
        });
        await app.prisma.auditLog.create({
          data: {
            actorUserId: sub,
            deviceId: existing.id,
            action: "device.activate",
          },
        });
      } else {
        const count = await app.prisma.device.count({
          where: { userId: sub },
        });
        const seatsMax = await deviceLimitForUser(app.prisma, sub);
        if (count >= seatsMax) {
          return reply.code(403).send({
            error: "seats_exhausted",
            seatsUsed: count,
            seatsMax,
          });
        }
        try {
          device = await app.prisma.device.create({
            data: {
              userId: sub,
              name: deviceName,
              type: toDeviceTypeEnum(deviceType),
              fingerprint: deviceFingerprint,
              lastSeenAt: now,
            },
            select: { ...select },
          });
        } catch (e: unknown) {
          // Concurrent double-activate with the same fingerprint hits the
          // partial unique (userId, fingerprint): fall back to updating it.
          if (
            typeof e !== "object" ||
            e === null ||
            !("code" in e) ||
            e.code !== "P2002"
          ) {
            throw e;
          }
          const raced = await app.prisma.device.findFirst({
            where: { userId: sub, fingerprint: deviceFingerprint },
            select: { ...select },
          });
          if (!raced) throw e;
          device = await app.prisma.device.update({
            where: { id: raced.id },
            data: {
              name: deviceName,
              type: toDeviceTypeEnum(deviceType),
              lastSeenAt: now,
            },
            select: { ...select },
          });
        }
        await app.prisma.auditLog.create({
          data: {
            actorUserId: sub,
            deviceId: device.id,
            action: "device.create",
          },
        });
      }
      const seatsUsed = await app.prisma.device.count({
        where: { userId: sub },
      });
      const seatsMax = await deviceLimitForUser(app.prisma, sub);
      return {
        licenseJwt: "stub.license.jwt",
        device: {
          id: device.id,
          name: device.name,
          type: toDeviceTypeKebab(device.type),
          lastSeenAt: device.lastSeenAt?.toISOString() ?? null,
          createdAt: device.createdAt.toISOString(),
        },
        seatsUsed,
        seatsMax,
      };
    },
  );

  app.post("/validate", { onRequest: [app.authenticate] }, async () => ({
    valid: false,
    graceDays: OFFLINE_GRACE_DAYS,
  }));

  // Real devices for dashboard — no mocks. Types are kebab-case per the
  // shared deviceSchema; the dashboard accepts both casings during rollout.
  app.get("/devices", { onRequest: [app.authenticate] }, async (req) => {
    const { sub } = req.user as { sub: string };
    const seatsMax = await deviceLimitForUser(app.prisma, sub);
    const devices = await app.prisma.device.findMany({
      where: { userId: sub },
      orderBy: { lastSeenAt: "desc" },
      select: {
        id: true,
        name: true,
        type: true,
        lastSeenAt: true,
        createdAt: true,
      },
      take: seatsMax,
    });
    return {
      devices: devices.map((d) => ({
        id: d.id,
        name: d.name,
        type: toDeviceTypeKebab(d.type),
        lastSeenAt: d.lastSeenAt?.toISOString() ?? null,
        createdAt: d.createdAt.toISOString(),
      })),
      total: devices.length,
      seatsMax,
    };
  });

  // Unlink a device to free a seat. Scoped to the owner: unknown ids and
  // other users' devices both yield 404 (no ownership oracle).
  app.delete(
    "/devices/:id",
    { onRequest: [app.authenticate] },
    async (req, reply) => {
      const { sub } = req.user as { sub: string };
      const { id } = req.params as { id: string };
      const existing = await app.prisma.device.findFirst({
        where: { id, userId: sub },
        select: { id: true },
      });
      if (!existing) {
        return reply.code(404).send({ error: "device_not_found" });
      }
      await app.prisma.device.delete({ where: { id: existing.id } });
      await app.prisma.auditLog.create({
        data: {
          actorUserId: sub,
          deviceId: existing.id,
          action: "device.revoke",
        },
      });
      const seatsUsed = await app.prisma.device.count({
        where: { userId: sub },
      });
      const seatsMax = await deviceLimitForUser(app.prisma, sub);
      return { ok: true, seatsUsed, seatsMax };
    },
  );
}
