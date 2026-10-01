import { Button } from "@algorith-voice/ui";
import { StepProgress } from "./StepProgress.js";

export function ModeStep({
  cloudOnly,
  setCloudOnly,
  onContinue,
}: {
  cloudOnly: boolean;
  setCloudOnly: (v: boolean) => void;
  onContinue: () => void;
}) {
  return (
    <>
      <p className="max-w-[560px] text-[16px] leading-relaxed text-white/50 md:text-[17px]">
        Choose how your voice is transcribed. You can change this later in
        Settings.
      </p>
      <div className="h-8" />
      <div className="flex w-full flex-col gap-3">
        <button
          type="button"
          onClick={() => setCloudOnly(true)}
          className={`flex h-16 w-full items-center justify-center rounded-lg border text-[14px] font-medium transition-all ${
            cloudOnly
              ? "border-white bg-white text-black"
              : "border-white/15 bg-transparent text-white hover:bg-white/[0.04]"
          }`}
        >
          Cloud (Groq Whisper) — Recommended
        </button>
        <button
          type="button"
          onClick={() => setCloudOnly(false)}
          title="On-device transcription — audio never leaves this computer"
          className={`flex h-16 w-full items-center justify-center rounded-lg border text-[14px] font-medium transition-all ${
            !cloudOnly
              ? "border-white bg-white text-black"
              : "border-white/15 bg-transparent text-white hover:bg-white/[0.04]"
          }`}
        >
          Local (on-device) — audio never leaves this PC
        </button>
      </div>
      <p className="mt-4 max-w-[560px] text-sm leading-relaxed text-white/60">
        {cloudOnly
          ? "Cloud uses Groq Whisper securely. Audio is sent only while you hold the hotkey and transcripts are stored only locally."
          : "Local mode transcribes fully on-device. Pick and download a model in Settings to start dictating offline."}
      </p>
      <div className="h-7" />
      <Button
        onClick={onContinue}
        className="h-[54px] w-[200px] rounded-xl bg-white text-[15px] font-medium text-black hover:bg-white/90"
      >
        Continue
      </Button>
      <div className="h-12" />
      <StepProgress current={1} total={4} />
    </>
  );
}
