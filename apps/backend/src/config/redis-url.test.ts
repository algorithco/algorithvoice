import { describe, expect, it } from "vitest";
import { safeRedisEndpoint } from "./redis-url.js";

describe("O-OBSERVABILITY: Redis URL redaction", () => {
  it("never includes credentials or query parameters in connection logs", () => {
    expect(
      safeRedisEndpoint(
        "rediss://service-user:super-secret@redis.example.invalid:6380/4?token=also-secret",
      ),
    ).toBe("rediss://redis.example.invalid:6380/4");
    expect(safeRedisEndpoint("not a URL")).toBe("[configured Redis endpoint]");
  });
});
