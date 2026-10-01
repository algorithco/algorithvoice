import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route.js";

describe("M-WEB-4: release proxy", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("M-WEB-4: caches GitHub requests and keeps the token upstream-only", async () => {
    vi.stubEnv("GITHUB_TOKEN", "github-token-must-not-reach-the-browser");
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ tag_name: "v1.2.3", assets: [] }), {
        status: 200,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET();
    const body = await response.text();
    expect(JSON.parse(body)).toEqual({
      release: { tag: "v1.2.3", assets: [] },
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.github.com/repos/algorithco/algorithvoice-app/releases/latest",
      expect.objectContaining({
        headers: {
          Authorization: "Bearer github-token-must-not-reach-the-browser",
        },
        next: { revalidate: 21_600 },
      }),
    );
    expect(body).not.toContain("github-token");
  });

  it("M-WEB-4: redacts upstream failures even when the error contains the token", async () => {
    const token = "github-token-in-provider-error";
    vi.stubEnv("GITHUB_TOKEN", token);
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error(token)));

    const response = await GET();
    const body = await response.text();
    expect(response.status).toBe(200);
    expect(JSON.parse(body)).toEqual({ release: null });
    expect(body).not.toContain(token);
  });
});
