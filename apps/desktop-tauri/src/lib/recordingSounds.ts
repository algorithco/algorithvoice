const START_SOUND_URL = new URL(
  "../assets/sounds/recording-start.wav",
  import.meta.url,
).href;
const STOP_SOUND_URL = new URL(
  "../assets/sounds/recording-stop.wav",
  import.meta.url,
).href;

/** Keep repeated dictation cues gentle on both headphones and laptop speakers. */
export const RECORDING_CUE_VOLUME = 0.22;
/** Recording must never wait indefinitely for a damaged or blocked asset. */
export const START_CUE_TIMEOUT_MS = 700;

type CueName = "start" | "stop";

interface CueAudio {
  preload: string;
  volume: number;
  currentTime: number;
  readonly paused: boolean;
  play(): Promise<void>;
  pause(): void;
  addEventListener(
    type: "ended" | "error",
    listener: () => void,
    options?: AddEventListenerOptions,
  ): void;
  removeEventListener(type: "ended" | "error", listener: () => void): void;
}

type AudioFactory = (src: string) => CueAudio;

export interface RecordingCuePlayer {
  preload(): void;
  /** Resolves when the short start cue ends, or safely times out. */
  playStart(): Promise<void>;
  /** Fire-and-forget because microphone capture has already ended. */
  playStop(): void;
  /** Stops an in-progress cue without playing a replacement sound. */
  cancel(): void;
  dispose(): void;
}

export function createRecordingCuePlayer(
  createAudio: AudioFactory = (src) => new Audio(src),
): RecordingCuePlayer {
  let sounds: Record<CueName, CueAudio> | null = null;
  let finishPendingStart: (() => void) | null = null;

  const ensureSounds = () => {
    if (sounds) return sounds;
    sounds = {
      start: createAudio(START_SOUND_URL),
      stop: createAudio(STOP_SOUND_URL),
    };
    for (const sound of Object.values(sounds)) {
      sound.preload = "auto";
      sound.volume = RECORDING_CUE_VOLUME;
    }
    return sounds;
  };

  const stopAll = () => {
    if (!sounds) return;
    for (const sound of Object.values(sounds)) {
      if (!sound.paused) sound.pause();
      try {
        sound.currentTime = 0;
      } catch {
        // Some media implementations reject seeks until metadata is loaded.
      }
    }
  };

  const cancelPlayback = () => {
    stopAll();
    finishPendingStart?.();
  };

  const startPlayback = (cue: CueName) => {
    const loaded = ensureSounds();
    cancelPlayback();
    const sound = loaded[cue];
    // Re-apply these values in case the browser changed them after suspension.
    sound.volume = RECORDING_CUE_VOLUME;
    try {
      sound.currentTime = 0;
    } catch {
      // Starting from the current position is still preferable to no cue.
    }
    return sound;
  };

  return {
    preload() {
      ensureSounds();
    },
    async playStart() {
      const sound = startPlayback("start");
      await new Promise<void>((resolve) => {
        let settled = false;
        const finish = () => {
          if (settled) return;
          settled = true;
          if (finishPendingStart === finish) finishPendingStart = null;
          globalThis.clearTimeout(timeoutId);
          sound.removeEventListener("ended", finish);
          sound.removeEventListener("error", finish);
          resolve();
        };
        const timeoutId = globalThis.setTimeout(finish, START_CUE_TIMEOUT_MS);
        finishPendingStart = finish;
        sound.addEventListener("ended", finish, { once: true });
        sound.addEventListener("error", finish, { once: true });
        void sound.play().catch(finish);
      });
    },
    playStop() {
      const sound = startPlayback("stop");
      void sound.play().catch(() => {
        // Audible feedback is optional; recording must remain reliable.
      });
    },
    cancel() {
      cancelPlayback();
    },
    dispose() {
      cancelPlayback();
      sounds = null;
    },
  };
}
