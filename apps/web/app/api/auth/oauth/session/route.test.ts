import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route.js";

describe("H3: OAuth session BFF", () => {
  afterEach(() => vi.restoreAllMocks());

  it("H3: rejects a cross-origin session installation", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const response = await POST(
      new Request("http://localhost/api/auth/oauth/session", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://attacker.example",
          "sec-fetch-site": "cross-site",
        },
        body: JSON.stringify({ code: "a".repeat(43) }),
      }),
    );
    expect(response.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("H3: exchanges a code and stores both tokens only in HttpOnly cookies", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            accessToken: "access-token",
            refreshToken: "refresh-token",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      ),
    );
    const response = await POST(
      new Request("http://localhost/api/auth/oauth/session", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "http://localhost",
          "sec-fetch-site": "same-origin",
        },
        body: JSON.stringify({ code: "a".repeat(43) }),
      }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    const cookies = response.headers.getSetCookie().join("\n");
    expect(cookies).toContain("__Host-av_at=access-token");
    expect(cookies).toContain("__Host-av_rt=refresh-token");
    expect(cookies).toContain("HttpOnly");
    expect(cookies).not.toContain("undefined");
  });
});
