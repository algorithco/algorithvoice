import { describe, expect, it } from "vitest";
import { getApiUrl } from "./api-url.js";

describe("H8: web API URL", () => {
  it("defaults to localhost only outside production", () => {
    expect(getApiUrl({ NODE_ENV: "development" })).toBe(
      "http://localhost:3001",
    );
  });

  it("requires API_URL in production", () => {
    expect(() => getApiUrl({ NODE_ENV: "production" })).toThrow(
      "API_URL is required",
    );
  });

  it("uses and normalizes an explicitly configured URL", () => {
    expect(
      getApiUrl({ NODE_ENV: "production", API_URL: "https://api.example/" }),
    ).toBe("https://api.example");
  });
});
