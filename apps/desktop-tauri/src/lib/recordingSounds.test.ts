import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createRecordingCuePlayer,
  RECORDING_CUE_VOLUME,
  START_CUE_TIMEOUT_MS,
} from "./recordingSounds.js";

type CueEvent = "ended" | "error";

class FakeAudio {
  preload = "";
  volume = 1;
  currentTime = 9;
  paused = true;
  play = vi.fn(async () => {
    this.paused = false;
  });
  pause = vi.fn(() => {
    this.paused = true;
  });
  private listeners = new Map<CueEvent, Set<() => void>>();

  constructor(readonly src: string) {}

  addEventListener(type: CueEvent, listener: () => void) {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: CueEvent, listener: () => void) {
    this.listeners.get(type)?.delete(listener);
  }

  emit(type: CueEvent) {
    for (const listener of [...(this.listeners.get(type) ?? [])]) listener();
  }
}

function setup() {
  const sounds: FakeAudio[] = [];
  const player = createRecordingCuePlayer((src) => {
    const sound = new FakeAudio(src);
    sounds.push(sound);
    return sound;
  });
  return { player, sounds };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("recording cue player", () => {
  it("preloads both local WAV masters at a gentle fixed volume", () => {
    const { player, sounds } = setup();

    player.preload();

    expect(sounds).toHaveLength(2);
    expect(sounds[0]?.src).toContain("recording-start.wav");
    expect(sounds[1]?.src).toContain("recording-stop.wav");
    for (const sound of sounds) {
      expect(sound.preload).toBe("auto");
      expect(sound.volume).toBe(RECORDING_CUE_VOLUME);
    }
  });

  it("waits for the start cue to end before resolving", async () => {
    const { player, sounds } = setup();
    player.preload();
    let resolved = false;

    const pending = player.playStart().then(() => {
      resolved = true;
    });
    await Promise.resolve();

    expect(sounds[0]?.play).toHaveBeenCalledOnce();
    expect(resolved).toBe(false);
    sounds[0]?.emit("ended");
    await pending;
    expect(resolved).toBe(true);
  });

  it("plays the stop cue immediately and cancels overlapping audio", () => {
    const { player, sounds } = setup();
    player.preload();
    if (sounds[0]) sounds[0].paused = false;

    player.playStop();

    expect(sounds[0]?.pause).toHaveBeenCalled();
    expect(sounds[1]?.pause).not.toHaveBeenCalled();
    expect(sounds[1]?.currentTime).toBe(0);
    expect(sounds[1]?.play).toHaveBeenCalledOnce();
  });

  it("cancels and resolves a pending start cue without playing stop", async () => {
    const { player, sounds } = setup();
    player.preload();

    const pending = player.playStart();
    await Promise.resolve();
    player.cancel();

    await expect(pending).resolves.toBeUndefined();
    expect(sounds[0]?.pause).toHaveBeenCalledOnce();
    expect(sounds[1]?.play).not.toHaveBeenCalled();
  });

  it("fails open when media playback is blocked", async () => {
    const { player, sounds } = setup();
    player.preload();
    sounds[0]?.play.mockRejectedValueOnce(new Error("autoplay blocked"));

    await expect(player.playStart()).resolves.toBeUndefined();
  });

  it("times out instead of delaying microphone capture indefinitely", async () => {
    vi.useFakeTimers();
    const { player } = setup();

    const pending = player.playStart();
    await vi.advanceTimersByTimeAsync(START_CUE_TIMEOUT_MS);

    await expect(pending).resolves.toBeUndefined();
  });
});
