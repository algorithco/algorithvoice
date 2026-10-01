import {
  licenseActivateSchema,
  OFFLINE_GRACE_DAYS,
} from "@algorith-voice/shared-types";
import type { FastifyInstance } from "fastify";
import { getUserId } from "../../plugins/jwt.js";
import { deviceLimitForUser } from "../billing/guard.js";
import { parseDeviceType } from "./device-type.js";

// Phase 3 adds RS256 license JWTs with 7d offline grace. Seat counting and
// fingerprint binding are live: activate upserts by (userId, fingerprint).
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
      const sub = getUserId(req);
      const { deviceName, deviceType, deviceFingerprint } = req.body as {
        deviceName: string;
        deviceType: string;
        deviceFingerprint: string;
      };
      const now = new Date();
      const parsedDeviceType = parseDeviceType(deviceType);
      if (!parsedDeviceType) {
        return reply.code(400).send({ error: "invalid_device_type" });
      }
      const select = {
        id: true,
        name: true,
        type: true,
        lastSeenAt: true,
        createdAt: true,
      } as const;
      const seatsMax = await deviceLimitForUser(app.prisma, sub);
      const result = await app.prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${sub}))`;
        const existing = await tx.device.findFirst({
          where: { userId: sub, fingerprint: deviceFingerprint },
          select: { ...select },
        });
        if (existing) {
          const device = await tx.device.update({
            where: { id: existing.id },
            data: { name: deviceName, type: parsedDeviceType, lastSeenAt: now },
            select: { ...select },
          });
          await tx.auditLog.create({
            data: {
              actorUserId: sub,
              deviceId: device.id,
              action: "device.activate",
            },
          });
          return {
            device,
            exhausted: false,
            seatsUsed: await tx.device.count({ where: { userId: sub } }),
          };
        }
        const count = await tx.device.count({ where: { userId: sub } });
        if (count >= seatsMax) {
          return { device: null, exhausted: true, seatsUsed: count };
        }
        const device = await tx.device.create({
          data: {
            userId: sub,
            name: deviceName,
            type: parsedDeviceType,
            fingerprint: deviceFingerprint,
            lastSeenAt: now,
          },
          select: { ...select },
        });
        await tx.auditLog.create({
          data: {
            actorUserId: sub,
            deviceId: device.id,
            action: "device.create",
          },
        });
        return { device, exhausted: false, seatsUsed: count + 1 };
      });
      if (result.exhausted || !result.device) {
        return reply.code(403).send({
          error: "seats_exhausted",
          seatsUsed: result.seatsUsed,
          seatsMax,
        });
      }
      const device = result.device;
      const seatsUsed = result.seatsUsed;
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
    const sub = getUserId(req);
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
      const sub = getUserId(req);
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
