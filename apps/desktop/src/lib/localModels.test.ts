// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
}));

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  downloadModel,
  getHardwareInfo,
  listAvailableModels,
  onDownloadProgress,
} from "./localModels.js";

const mockInvoke = invoke as unknown as ReturnType<typeof vi.fn>;
const mockListen = listen as unknown as ReturnType<typeof vi.fn>;

function setTauri(on: boolean): void {
  if (on) {
    // @ts-expect-error - test flag
    window.__TAURI__ = {};
  } else {
    // @ts-expect-error - cleanup
    delete window.__TAURI__;
    // @ts-expect-error - cleanup
    delete window.__TAURI_INTERNALS__;
  }
}

beforeEach(() => {
  mockInvoke.mockReset();
  mockListen.mockClear();
  setTauri(false);
});

describe("localModels typed wrappers", () => {
  it("throws outside Tauri shell", async () => {
    await expect(listAvailableModels()).rejects.toThrow("desktop app shell");
    await expect(getHardwareInfo()).rejects.toThrow("desktop app shell");
  });

  it("forwards to invoke inside Tauri", async () => {
    setTauri(true);
    mockInvoke.mockResolvedValue([]);
    await expect(listAvailableModels()).resolves.toEqual([]);
    expect(mockInvoke).toHaveBeenCalledWith("list_available_models");
    mockInvoke.mockResolvedValue({ ok: true });
    await downloadModel("parakeet-tdt-0.6b-v3");
    expect(mockInvoke).toHaveBeenCalledWith("download_model", {
      id: "parakeet-tdt-0.6b-v3",
    });
  });

  it("subscribes to progress events", async () => {
    const handler = vi.fn();
    await onDownloadProgress(handler);
    expect(mockListen).toHaveBeenCalledWith(
      "model-download-progress",
      expect.any(Function),
    );
  });
});
