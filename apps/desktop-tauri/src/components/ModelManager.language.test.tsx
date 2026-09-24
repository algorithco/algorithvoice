// @vitest-environment jsdom
import type { LocalModel } from "@algorith-voice/shared-types";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("../lib/session/env.js", () => ({ isTauri: () => true }));

const model: LocalModel = {
  id: "whisper-small",
  name: "Whisper Small",
  version: "1.0.0",
  engine: "sherpa-onnx",
  quantization: "int8",
  files: [
    {
      filename: "model.onnx",
      url: "https://example.com/model.onnx",
      sha256: "a".repeat(64),
      sizeBytes: 1,
    },
  ],
  languages: ["en", "ru", "uz"],
  minRamGb: 2,
  recommendedRamGb: 4,
  minVramGb: 0,
  recommendedVramGb: 0,
  license: "Apache-2.0",
  attribution: "Test model",
  supportedOs: ["windows"],
  supportedArch: ["x64"],
};

vi.mock("../lib/localModels.js", () => ({
  cancelDownload: vi.fn(),
  deleteModel: vi.fn(),
  downloadModel: vi.fn(),
  getHardwareInfo: async () => ({
    os: "windows",
    arch: "x64",
    cpuCoresLogical: 8,
    totalRamBytes: 16_000_000_000,
    availableRamBytes: 8_000_000_000,
    supportedRuntimes: ["sherpa-onnx-cpu"],
  }),
  getModelCompatibilities: async () => [
    { id: "whisper-small", level: "compatible", reasons: [] },
  ],
  getModelStatus: async () => ({
    id: "whisper-small",
    status: "ready",
    downloadedBytes: 1,
    totalBytes: 1,
  }),
  getTranscriptionStatus: async () => ({
    lifecycle: "ready",
    modelId: "whisper-small",
  }),
  listAvailableModels: async () => [model],
  onDownloadProgress: async () => () => {},
  onModelLoadProgress: async () => () => {},
  onModelStatusChanged: async () => () => {},
  selectActiveModel: vi.fn(),
  verifyModel: vi.fn(),
}));

import { DEFAULT_PREFS } from "../lib/prefs.js";
import { ModelManager } from "./ModelManager.js";

afterEach(() => {
  document.body.innerHTML = "";
});

describe("ModelManager transcription language", () => {
  it("lists only active-model languages and saves the chosen code", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const onPrefs = vi.fn();

    await act(async () => {
      root.render(
        <ModelManager
          prefs={{
            ...DEFAULT_PREFS,
            mode: "local",
            activeModelId: "whisper-small",
          }}
          onPrefs={onPrefs}
        />,
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const select = container.querySelector<HTMLSelectElement>(
      "#av-transcription-language",
    );
    expect(select).not.toBeNull();
    expect(
      Array.from(select?.options ?? []).map((option) => option.value),
    ).toEqual(["auto", "en", "ru", "uz"]);

    await act(async () => {
      if (!select) return;
      select.value = "uz";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(onPrefs).toHaveBeenLastCalledWith(
      expect.objectContaining({ language: "uz" }),
    );

    await act(async () => root.unmount());
  });
});
