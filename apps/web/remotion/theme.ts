import {
  fontFamily as interFamily,
  loadFont as loadInter,
} from "@remotion/google-fonts/Inter";
import {
  loadFont as loadMono,
  fontFamily as monoFamily,
} from "@remotion/google-fonts/JetBrainsMono";

loadInter("normal", {
  weights: ["400", "600", "700"],
  subsets: ["latin"],
});
loadMono("normal", { weights: ["400", "500"], subsets: ["latin"] });

export const FPS = 30;
export const WIDTH = 1920;
export const HEIGHT = 1080;
/** 60 seconds @ 30fps */
export const DURATION_IN_FRAMES = 1800;

export const COLORS = {
  bg: "#000000",
  surface: "#0a0a0a",
  raised: "#141414",
  border: "#262626",
  ink: "#ffffff",
  sub: "#9a9a9a",
  faint: "#5c5c5c",
  accent: "#ffffff",
} as const;

export const FONT_SANS = `${interFamily}, "Inter Variable", Inter, system-ui, sans-serif`;
export const FONT_MONO = `${monoFamily}, "JetBrains Mono", ui-monospace, monospace`;

export type Chapter = {
  id: string;
  label: string;
  /** first frame (global timeline) */
  from: number;
  durationInFrames: number;
};

/**
 * 60s "How to use Algorith Voice" timeline.
 * Content mirrors apps/web/app/docs/page.tsx + app/page.tsx so the
 * video never drifts from the real setup guide.
 */
export const CHAPTERS: Chapter[] = [
  { id: "intro", label: "Intro", from: 0, durationInFrames: 150 },
  { id: "install", label: "1 · Install", from: 150, durationInFrames: 300 },
  {
    id: "talk",
    label: "2 · Hold Ctrl+Space",
    from: 450,
    durationInFrames: 300,
  },
  {
    id: "modes",
    label: "3 · Local vs Cloud",
    from: 750,
    durationInFrames: 300,
  },
  {
    id: "models",
    label: "4 · 6 on-device models",
    from: 1050,
    durationInFrames: 240,
  },
  { id: "pill", label: "5 · Pill & tips", from: 1290, durationInFrames: 270 },
  { id: "outro", label: "Outro", from: 1560, durationInFrames: 240 },
];

export function chapterAtFrame(frame: number): Chapter {
  return [...CHAPTERS].reverse().find((c) => frame >= c.from) ?? CHAPTERS[0];
}
