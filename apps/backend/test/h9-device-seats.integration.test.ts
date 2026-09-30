import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  authHeader,
  createTestApp,
  createUser,
  signAccessToken,
  truncateTestState,
} from "./helpers/app.js";

describe("H9: device seat concurrency", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await createTestApp();
  });
  beforeEach(async () => truncateTestState(app));
  afterAll(async () => app.close());

  async function activate(token: string, fingerprint: string) {
    return app.inject({
      method: "POST",
      url: "/license/activate",
      headers: authHeader(token),
      payload: {
        deviceName: fingerprint,
        deviceType: "desktop-windows",
        deviceFingerprint: fingerprint,
      },
    });
  }

  it("H9: parallel distinct activations never exceed the free seat limit", async () => {
    const { user } = await createUser(app);
    const token = signAccessToken(app, user.id);
    const responses = await Promise.all(
      Array.from({ length: 20 }, (_, index) =>
        activate(token, `fingerprint-${index}`),
      ),
    );
    expect(
      responses.filter((response) => response.statusCode === 200),
    ).toHaveLength(2);
    expect(await app.prisma.device.count({ where: { userId: user.id } })).toBe(
      2,
    );
  });

  it("H9: parallel activation of one fingerprint is idempotent", async () => {
    const { user } = await createUser(app);
    const token = signAccessToken(app, user.id);
    const responses = await Promise.all(
      Array.from({ length: 20 }, () => activate(token, "same-fingerprint")),
    );
    expect(responses.every((response) => response.statusCode === 200)).toBe(
      true,
    );
    expect(await app.prisma.device.count({ where: { userId: user.id } })).toBe(
      1,
    );
  });

  it("T-TESTS: device list and delete stay scoped to the authenticated owner", async () => {
    const { user: owner } = await createUser(app, {
      email: "device-owner@example.invalid",
    });
    const { user: other } = await createUser(app, {
      email: "device-other@example.invalid",
    });
    const ownerToken = signAccessToken(app, owner.id);
    const otherToken = signAccessToken(app, other.id);
    const activated = await activate(ownerToken, "owned-fingerprint");
    expect(activated.statusCode).toBe(200);
    const deviceId = activated.json<{ device: { id: string } }>().device.id;

    const listed = await app.inject({
      method: "GET",
      url: "/license/devices",
      headers: authHeader(ownerToken),
    });
    expect(listed.statusCode).toBe(200);
    expect(listed.json<{ devices: Array<{ id: string }> }>().devices).toEqual([
      expect.objectContaining({ id: deviceId }),
    ]);

    const crossUserDelete = await app.inject({
      method: "DELETE",
      url: `/license/devices/${deviceId}`,
      headers: authHeader(otherToken),
    });
    expect(crossUserDelete.statusCode).toBe(404);

    const deleted = await app.inject({
      method: "DELETE",
      url: `/license/devices/${deviceId}`,
      headers: authHeader(ownerToken),
    });
    expect(deleted.statusCode).toBe(200);
    expect(deleted.json()).toMatchObject({ ok: true, seatsUsed: 0 });
    expect(await app.prisma.device.count({ where: { id: deviceId } })).toBe(0);
  });

  it("H9: a downgrade lists every existing device so excess seats can be unlinked", async () => {
    const { user } = await createUser(app, {
      email: "downgraded-devices@example.invalid",
    });
    await app.prisma.device.createMany({
      data: Array.from({ length: 4 }, (_, index) => ({
        userId: user.id,
        name: `Device ${index}`,
        type: "DESKTOP_WINDOWS" as const,
        fingerprint: `downgrade-fingerprint-${index}`,
      })),
    });
    const response = await app.inject({
      method: "GET",
      url: "/license/devices",
      headers: authHeader(signAccessToken(app, user.id)),
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ total: 4, seatsMax: 2 });
    expect(response.json<{ devices: unknown[] }>().devices).toHaveLength(4);
  });
});
