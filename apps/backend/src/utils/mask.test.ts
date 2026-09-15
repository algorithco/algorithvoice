import { describe, expect, it } from "vitest";
import { maskKey } from "./mask.js";

describe("maskKey", () => {
  it("shows only the last 4 characters", () => {
    expect(maskKey("sk-live-abcdef")).toBe("••••cdef");
  });
  it("masks short or empty input fully", () => {
    expect(maskKey("abc")).toBe("••••");
    expect(maskKey("")).toBe("••••");
  });
  it("handles unicode safely", () => {
    expect(maskKey("••••••••1234")).toBe("••••1234");
  });
});
