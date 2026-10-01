import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { loadEnv, setAppEnv } from "../../config/env.js";
import {
  hashAuditValue,
  OAuth2Audit,
  writeOAuthAudit,
} from "./oauth2.audit.js";
import { sha256Hex } from "./oauth2.store.js";

describe("M-BACKEND-5: audit identifiers", () => {
  it("uses a keyed hash that rotates by month", () => {
    setAppEnv(loadEnv());
    const value = "203.0.113.42";
    const january = hashAuditValue(value, new Date("2026-01-15T00:00:00Z"));
    const february = hashAuditValue(value, new Date("2026-02-15T00:00:00Z"));
    expect(january).not.toBe(sha256Hex(value));
    expect(february).not.toBe(january);
    expect(hashAuditValue(value, new Date("2026-01-31T23:59:59Z"))).toBe(
      january,
    );
  });

  it("C1: omits absent optional fields under Prisma strict undefined checks", async () => {
    setAppEnv(loadEnv());
    const create = vi.fn().mockResolvedValue({});
    const prisma = { auditLog: { create } } as unknown as PrismaClient;

    await writeOAuthAudit(prisma, { action: OAuth2Audit.AUTHORIZE_START });

    const call = create.mock.calls[0]?.[0] as {
      data: Record<string, unknown>;
    };
    expect(Object.keys(call.data)).toEqual(["action"]);
    expect(Object.values(call.data)).not.toContain(undefined);
  });
});
