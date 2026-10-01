import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route.js";

describe("H4: login BFF response", () => {
  afterEach(() => vi.restoreAllMocks());

  it("H4: keeps tokens in HttpOnly cookies and out of the response body", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            accessToken: "access-token",
            refreshToken: "refresh-token",
            user: { id: "user-1", email: "user@example.invalid" },
          }),
          {
            status: 200,
            headers: {
              "content-type": "application/json",
              "set-cookie": "backend_cookie=must-not-be-forwarded",
            },
          },
        ),
      ),
    );
    const response = await POST(
      new Request("http://localhost/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ email: "user@example.invalid", password: "x" }),
      }),
    );
    expect(await response.json()).toEqual({
      user: { id: "user-1", email: "user@example.invalid" },
    });
    const cookies = response.headers.getSetCookie().join("\n");
    expect(cookies).toContain("__Host-av_at=access-token");
    expect(cookies).toContain("__Host-av_rt=refresh-token");
    expect(cookies).not.toContain("backend_cookie");
  });
});
