import { describe, expect, it } from "vitest";
import { loginSchema, signupSchema } from "./schemas/auth.js";
import { settingsPatchSchema } from "./schemas/billing.js";
import { wsHelloSchema } from "./schemas/voice.js";

describe("shared-types", () => {
  it("rejects short passwords", () => {
    expect(
      signupSchema.safeParse({ email: "a@b.co", password: "short" }).success,
    ).toBe(false);
  });
  it("rejects empty settings patch", () => {
    expect(settingsPatchSchema.safeParse({}).success).toBe(false);
  });
  it("validates WS hello", () => {
    expect(
      wsHelloSchema.safeParse({
        type: "hello",
        sampleRate: 16000,
        codec: "pcm16",
        language: "en",
        sessionId: "123e4567-e89b-12d3-a456-426614174000",
      }).success,
    ).toBe(true);
  });
  it("rejects login without email", () => {
    expect(loginSchema.safeParse({ password: "x".repeat(12) }).success).toBe(
      false,
    );
  });
});
