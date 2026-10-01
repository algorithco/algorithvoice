import { describe, expect, it } from "vitest";
import { requestLogPath } from "./app.js";

describe("O-OBSERVABILITY: request URL redaction", () => {
  it("never includes OAuth codes, state tokens, or other query values", () => {
    const rawUrl =
      "/auth/oauth/github/callback?code=secret-code&state=secret-state";

    expect(requestLogPath(rawUrl)).toBe("/auth/oauth/github/callback");
    expect(requestLogPath(rawUrl, "/auth/oauth/:provider/callback")).toBe(
      "/auth/oauth/:provider/callback",
    );
  });
});
