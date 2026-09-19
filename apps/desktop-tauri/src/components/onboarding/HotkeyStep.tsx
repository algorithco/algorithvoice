import { Button } from "@algorith-voice/ui";
import { StepProgress } from "./StepProgress.js";

export function HotkeyStep({
  hotkeyInput,
  setHotkeyInput,
  hotkeyError,
  setHotkeyError,
  onContinue,
}: {
  hotkeyInput: string;
  setHotkeyInput: (v: string) => void;
  hotkeyError: string | null;
  setHotkeyError: (v: string | null) => void;
  onContinue: () => void;
}) {
  return (
    <>
      <p className="max-w-[560px] text-[16px] leading-relaxed text-white/50 md:text-[17px]">
        Hold this combination to talk. Release to type. It works in any app.
      </p>
      <div className="h-5" />
      <div className="w-full">
        <div className="flex h-16 w-full items-center justify-center rounded-lg border border-white/15 bg-transparent">
          <input
            value={hotkeyInput}
            onChange={(e) => {
              setHotkeyInput(e.target.value);
              setHotkeyError(null);
            }}
            className="h-full w-full bg-transparent text-center text-[15px] font-medium tracking-wide text-white placeholder:text-white/30 focus:outline-none"
            spellCheck={false}
            aria-label="Hotkey"
            placeholder="Ctrl + Space"
          />
        </div>
        {hotkeyError ? (
          <p className="mt-2 text-center text-xs text-red-400">{hotkeyError}</p>
        ) : (
          <p className="mt-2 text-center text-xs text-white/25">
            Press to record • Example: Ctrl + Space
          </p>
        )}
      </div>
      <div className="h-7" />
      <Button
        onClick={onContinue}
        className="h-[54px] w-[200px] rounded-xl bg-white text-[15px] font-medium text-black hover:bg-white/90"
      >
        Continue
      </Button>
      <div className="h-12" />
      <StepProgress current={0} total={4} />
    </>
  );
}
