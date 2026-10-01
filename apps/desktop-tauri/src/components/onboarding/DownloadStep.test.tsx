import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DownloadStep } from "./DownloadStep.js";
import { formatEta, formatSpeed } from "./format.js";

const noop = () => {};

function render(
  overrides: Partial<Parameters<typeof DownloadStep>[0]> = {},
): string {
  return renderToString(
    <DownloadStep
      modelName="Parakeet"
      progress={null}
      status={null}
      error={null}
      onCancel={noop}
      onRetry={noop}
      onUseCloud={noop}
      {...overrides}
    />,
  );
}

describe("DownloadStep", () => {
  it("renders indeterminate progress before the first event", () => {
    const html = render();
    expect(html).toContain("Downloading Parakeet");
    expect(html).toContain("starting…");
    expect(html).toContain("Cancel");
    expect(html).toContain("Use Cloud instead");
  });

  it("renders percent, bytes, speed, and ETA from progress events", () => {
    const html = render({
      progress: {
        id: "parakeet-tdt-0.6b-v3",
        downloadedBytes: 335_000_000,
        totalBytes: 670_000_000,
        bytesPerSecond: 5_000_000,
        etaSeconds: 67,
      },
    });
    expect(html).toContain("50%");
    // SSR renders JSX whitespace as comments, so assert the parts.
    expect(html).toContain("319.5 MB");
    expect(html).toContain("639.0 MB");
    expect(html).toContain("4.8 MB/s");
    expect(html).toContain("1m 7s");
  });

  it("falls back to status bytes when no live event arrived yet", () => {
    const html = render({
      status: {
        id: "parakeet-tdt-0.6b-v3",
        status: "downloading",
        downloadedBytes: 100,
        totalBytes: 200,
      },
    });
    expect(html).toContain("50%");
  });

  it("shows the verifying state without speed lines", () => {
    const html = render({
      status: {
        id: "parakeet-tdt-0.6b-v3",
        status: "verifying",
        downloadedBytes: 200,
        totalBytes: 200,
      },
    });
    expect(html).toContain("Verifying Parakeet");
    expect(html).not.toContain("ETA");
  });

  it("renders the error state with retry and cloud escape", () => {
    const html = render({ error: "connection reset" });
    expect(html).toContain("failed");
    expect(html).toContain("connection reset");
    expect(html).toContain("Retry download");
    expect(html).toContain("Use Cloud instead");
    expect(html).toContain("resumes where it stopped");
  });
});

describe("onboarding format helpers", () => {
  it("formats speed and ETA", () => {
    expect(formatSpeed(0)).toBe("—");
    expect(formatSpeed(5_000_000)).toBe("4.8 MB/s");
    expect(formatEta(undefined)).toBe("—");
    expect(formatEta(67)).toBe("1m 7s");
    expect(formatEta(45)).toBe("45s");
  });
});
