import { describe, expect, it } from "vitest";
import { maskKey } from "./mask.js";

describe("backend utils", () => {
  it("masks keys", () => {
    expect(maskKey("sk-live-abcdef")).toBe("••••cdef");
  });
});
