import { describe, expect, it } from "vitest";
import { clusterRestartDelayMs } from "./cluster-policy.js";

describe("M-BACKEND-8: cluster restart policy", () => {
  it("backs off exponentially with a bounded ceiling", () => {
    expect(clusterRestartDelayMs(0)).toBe(250);
    expect(clusterRestartDelayMs(1)).toBe(500);
    expect(clusterRestartDelayMs(20)).toBe(30_000);
  });
});
