import type { Metadata } from "next";
import { Reveal } from "../../components/Reveal";
import { SiteFooter } from "../../components/SiteFooter";
import { SiteNav } from "../../components/SiteNav";
import { VideoPlayer } from "./VideoPlayer";

export const metadata: Metadata = {
  title: "How to use — video",
  description:
    "60-second tour of Algorith Voice: install, push-to-talk, local vs cloud, models, and tips. Rendered with Remotion.",
};

const RENDER_CMDS = [
  {
    label: "Preview in Remotion Studio",
    cmd: "pnpm --filter @algorith-voice/web remotion:studio",
  },
  {
    label: "Render 1080p MP4",
    cmd: "pnpm --filter @algorith-voice/web remotion:render",
  },
  {
    label: "Export a thumbnail still",
    cmd: "pnpm --filter @algorith-voice/web remotion:still",
  },
] as const;

export default function VideoPage() {
  return (
    <div className="min-h-screen bg-canvas text-ink">
      <SiteNav />
      <main className="mx-auto max-w-[1200px] px-4 py-12 sm:px-6 md:px-16 md:py-20">
        <Reveal>
          <p className="t-cap text-faint">Video · 60s · Remotion</p>
          <h1 className="t-h1 mt-4">How to use Algorith Voice.</h1>
          <p className="t-body mt-4 max-w-[68ch] text-sub">
            Install, hold Ctrl+Space, pick local or cloud, choose a model. The
            player below is the actual Remotion composition — the same code
            renders the downloadable MP4, so the video can never drift from the
            docs.
          </p>
        </Reveal>

        <Reveal delay={80} className="mt-10">
          <VideoPlayer />
        </Reveal>

        <Reveal className="mt-12">
          <h2 className="t-h2">Render it locally</h2>
          <p className="t-body mt-3 max-w-[68ch] text-sub">
            Compositions live in{" "}
            <code className="font-mono text-sm">apps/web/remotion</code>:
            <code className="font-mono text-sm"> HowToUse</code> (1920×1080),
            <code className="font-mono text-sm"> HowToUseSquare</code>{" "}
            (1080×1080),
            <code className="font-mono text-sm"> HowToUseVertical</code>{" "}
            (1080×1920). Output goes to{" "}
            <code className="font-mono text-sm">apps/web/out/</code>{" "}
            (git-ignored).
          </p>
          <div className="mt-6 grid gap-4">
            {RENDER_CMDS.map((r) => (
              <div
                key={r.label}
                className="rounded-lg border border-line bg-surface p-4 sm:p-6"
              >
                <p className="text-sm font-semibold">{r.label}</p>
                <pre className="mt-3 overflow-x-auto rounded-md border border-line bg-black p-3 font-mono text-xs leading-5 text-white">
                  <code>{r.cmd}</code>
                </pre>
              </div>
            ))}
          </div>
        </Reveal>
      </main>
      <SiteFooter />
    </div>
  );
}
