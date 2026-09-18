import { AbsoluteFill, Sequence, useVideoConfig } from "remotion";
import { InstallScene } from "./scenes/InstallScene";
import { IntroScene } from "./scenes/IntroScene";
import { ModelsScene } from "./scenes/ModelsScene";
import { ModesScene } from "./scenes/ModesScene";
import { OutroScene } from "./scenes/OutroScene";
import { TalkScene } from "./scenes/TalkScene";
import { TipsScene } from "./scenes/TipsScene";
import { CHAPTERS, type Chapter, COLORS, HEIGHT, WIDTH } from "./theme";
import { Bg, Progress, TopBar } from "./ui";

const byId = (id: string): Chapter => {
  const found = CHAPTERS.find((c) => c.id === id);
  if (!found) {
    throw new Error(`Unknown chapter: ${id}`);
  }
  return found;
};

/**
 * HowToUse — 60s product tour. One Sequence per chapter so each scene
 * animates on its own local clock (useCurrentFrame is sequence-relative).
 *
 * Scenes are designed at 1920x1080 and scale-to-fit into any composition
 * size, so the square/vertical cuts are letterboxed, never cropped.
 */
export function HowToUse() {
  const { width, height } = useVideoConfig();
  const scale = Math.min(width / WIDTH, height / HEIGHT);
  return (
    <AbsoluteFill style={{ backgroundColor: COLORS.bg }}>
      <div
        style={{
          position: "absolute",
          left: (width - WIDTH * scale) / 2,
          top: (height - HEIGHT * scale) / 2,
          width: WIDTH,
          height: HEIGHT,
          transform: `scale(${scale})`,
          transformOrigin: "top left",
        }}
      >
        <Bg>
          <TopBar />
          <Sequence
            from={byId("intro").from}
            durationInFrames={byId("intro").durationInFrames}
          >
            <IntroScene />
          </Sequence>
          <Sequence
            from={byId("install").from}
            durationInFrames={byId("install").durationInFrames}
          >
            <InstallScene />
          </Sequence>
          <Sequence
            from={byId("talk").from}
            durationInFrames={byId("talk").durationInFrames}
          >
            <TalkScene />
          </Sequence>
          <Sequence
            from={byId("modes").from}
            durationInFrames={byId("modes").durationInFrames}
          >
            <ModesScene />
          </Sequence>
          <Sequence
            from={byId("models").from}
            durationInFrames={byId("models").durationInFrames}
          >
            <ModelsScene />
          </Sequence>
          <Sequence
            from={byId("pill").from}
            durationInFrames={byId("pill").durationInFrames}
          >
            <TipsScene />
          </Sequence>
          <Sequence
            from={byId("outro").from}
            durationInFrames={byId("outro").durationInFrames}
          >
            <OutroScene />
          </Sequence>
          <Progress />
        </Bg>
      </div>
    </AbsoluteFill>
  );
}
