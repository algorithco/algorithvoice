import { Composition } from "remotion";
import { HowToUse } from "./HowToUse";
import { DURATION_IN_FRAMES, FPS, HEIGHT, WIDTH } from "./theme";

export function RemotionRoot() {
  return (
    <>
      <Composition
        id="HowToUse"
        component={HowToUse}
        durationInFrames={DURATION_IN_FRAMES}
        fps={FPS}
        width={WIDTH}
        height={HEIGHT}
        defaultProps={{}}
      />
      {/* Square + vertical cuts reuse the same 16:9 design via the
          scale-to-fit wrapper in HowToUse (letterboxed, never cropped).
          Dedicated reframes can replace these later. */}
      <Composition
        id="HowToUseSquare"
        component={HowToUse}
        durationInFrames={DURATION_IN_FRAMES}
        fps={FPS}
        width={1080}
        height={1080}
        defaultProps={{}}
      />
      <Composition
        id="HowToUseVertical"
        component={HowToUse}
        durationInFrames={DURATION_IN_FRAMES}
        fps={FPS}
        width={1080}
        height={1920}
        defaultProps={{}}
      />
    </>
  );
}
