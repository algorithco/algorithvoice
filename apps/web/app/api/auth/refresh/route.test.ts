import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route.js";

describe("H1: refresh proxy cookie retention", () => {
  afterEach(() => vi.restoreAllMocks());

  it("H1: backend 503 keeps existing session cookies", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: "unavailable" }), {
          status: 503,
          headers: { "content-type": "application/json" },
        }),
      ),
    );
    const response = await POST(
      new Request("http://localhost/api/auth/refresh", {
        method: "POST",
        headers: { cookie: "__Host-av_rt=refresh-token" },
      }),
    );
    expect(response.status).toBe(503);
    expect(response.headers.get("set-cookie")).toBeNull();
  });
});
