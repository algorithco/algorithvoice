import { describe, expect, it } from "vitest";
import { monthWindowUTC } from "./usage.routes.js";

describe("monthWindowUTC", () => {
  it("returns UTC month boundaries", () => {
    const { periodStart, periodEnd } = monthWindowUTC(
      new Date("2026-09-15T12:00:00+05:00"),
    );
    expect(periodStart.toISOString()).toBe("2026-09-01T00:00:00.000Z");
    expect(periodEnd.toISOString()).toBe("2026-10-01T00:00:00.000Z");
  });
  it("rolls over year end", () => {
    const { periodStart, periodEnd } = monthWindowUTC(
      new Date("2026-12-31T23:00:00Z"),
    );
    expect(periodStart.toISOString()).toBe("2026-12-01T00:00:00.000Z");
    expect(periodEnd.toISOString()).toBe("2027-01-01T00:00:00.000Z");
  });
});
