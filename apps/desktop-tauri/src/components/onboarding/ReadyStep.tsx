import { Button } from "@algorith-voice/ui";
import { StepProgress } from "./StepProgress.js";

export function ReadyStep({
  hotkey,
  onDone,
}: {
  hotkey: string;
  onDone: () => void;
}) {
  return (
    <>
      <p className="max-w-[560px] text-[16px] leading-relaxed text-white/50 md:text-[17px]">
        Everything is set. Focus any text field, hold{" "}
        <span className="font-medium text-white">{hotkey}</span>, and speak.
      </p>
      <div className="h-10" />
      <Button
        onClick={onDone}
        className="h-[54px] w-[200px] rounded-xl bg-white text-[15px] font-medium text-black hover:bg-white/90"
      >
        Start dictating
      </Button>
      <div className="h-12" />
      <StepProgress current={3} total={4} />
    </>
  );
}
