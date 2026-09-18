"use client";

import { Player, type PlayerRef } from "@remotion/player";
import { useRef, useState } from "react";
import { HowToUse } from "../../remotion/HowToUse";
import {
  CHAPTERS,
  DURATION_IN_FRAMES,
  FPS,
  HEIGHT,
  WIDTH,
} from "../../remotion/theme";

function fmt(frame: number) {
  const s = Math.floor(frame / FPS);
  return `0:${String(s).padStart(2, "0")}`;
}

export function VideoPlayer() {
  const ref = useRef<PlayerRef>(null);
  const [active, setActive] = useState(CHAPTERS[0].id);

  const jump = (id: string, from: number) => {
    setActive(id);
    ref.current?.seekTo(from);
    ref.current?.play();
  };

  return (
    <div>
      <div
        style={{
          borderRadius: 16,
          overflow: "hidden",
          border: "1px solid var(--color-line)",
          background: "#000",
        }}
      >
        <Player
          ref={ref}
          component={HowToUse}
          durationInFrames={DURATION_IN_FRAMES}
          compositionWidth={WIDTH}
          compositionHeight={HEIGHT}
          fps={FPS}
          controls
          loop
          clickToPlay
          acknowledgeRemotionLicense
          style={{ width: "100%", aspectRatio: "16 / 9" }}
        />
      </div>
      <div className="mt-6 flex flex-wrap gap-2">
        {CHAPTERS.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => jump(c.id, c.from)}
            className={[
              "t-cap inline-flex min-h-[44px] items-center gap-2 rounded-full border px-4",
              active === c.id
                ? "border-ink bg-ink text-canvas"
                : "border-line bg-surface text-sub hover:text-ink",
            ].join(" ")}
          >
            <span className="text-faint">{fmt(c.from)}</span>
            {c.label}
          </button>
        ))}
      </div>
    </div>
  );
}
