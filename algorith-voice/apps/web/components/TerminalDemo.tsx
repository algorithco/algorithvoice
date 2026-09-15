import { WaveformGlyph } from "@algorith-voice/ui";

// Product shot slot: a faithful terminal dictation frame in Mono.
// Replaced by a real screenshot at release; this is the surface's one
// permitted soft shadow (light mode only).
export function TerminalDemo() {
  return (
    <div className="av-hero-shot overflow-hidden rounded-card border border-gray-200 bg-white dark:border-gray-800 dark:bg-black">
      <div className="flex items-center gap-2 border-b border-gray-200 px-4 py-3 dark:border-gray-800">
        <span className="h-3 w-3 rounded-full border border-gray-300 dark:border-gray-700" />
        <span className="h-3 w-3 rounded-full border border-gray-300 dark:border-gray-700" />
        <span className="h-3 w-3 rounded-full border border-gray-300 dark:border-gray-700" />
        <span className="av-mono ml-2 text-gray-500">agent — zsh</span>
      </div>
      <div className="p-6">
        <p className="av-mono text-gray-500">
          $ agent refactor the auth middleware
        </p>
        <div className="mt-4 flex items-center gap-3 border border-gray-200 px-4 py-3 dark:border-gray-800">
          <WaveformGlyph className="text-black dark:text-white" />
          <span className="av-small">Listening</span>
          <span className="av-mono ml-auto hidden sm:inline">Ctrl+Space</span>
        </div>
        <p className="av-mono mt-4">
          use refresh-token rotation with reuse detection
        </p>
        <p className="av-small mt-4 text-gray-500">
          Injected in 0.6s · local model
        </p>
      </div>
    </div>
  );
}
