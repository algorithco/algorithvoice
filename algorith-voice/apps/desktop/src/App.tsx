import { Button, Card } from "@algorith-voice/ui";
import { useEffect, useState } from "react";

type TrayState = "idle" | "recording" | "processing";

export default function App() {
  const [tray, setTray] = useState<TrayState>("idle");
  const [hotkey, setHotkey] = useState("Ctrl+Space");
  const [mode, setMode] = useState<"local" | "cloud">("local");

  useEffect(() => {
    document.documentElement.classList.add("dark");
  }, []);

  return (
    <main className="min-h-screen bg-white text-black dark:bg-black dark:text-white">
      <div className="mx-auto max-w-xl p-6">
        <h1 className="text-2xl font-semibold">Algorith Voice</h1>
        <p className="mt-1 text-sm opacity-60">
          Hold {hotkey} to talk. Release to inject text. Local mode never leaves
          your device.
        </p>
        <Card className="mt-6 p-4">
          <p className="text-sm opacity-60">Status: {tray}</p>
          <div className="mt-3 flex gap-2">
            <Button
              onClick={() => {
                setTray("recording");
                setTimeout(() => setTray("processing"), 800);
                setTimeout(() => setTray("idle"), 1600);
              }}
            >
              Simulate PTT (Phase 1)
            </Button>
            <Button
              variant="secondary"
              onClick={() => setMode(mode === "local" ? "cloud" : "local")}
            >
              Mode: {mode}
            </Button>
          </div>
          <div className="mt-4 flex gap-2 text-sm">
            <label>
              Hotkey{" "}
              <input
                value={hotkey}
                onChange={(e) => setHotkey(e.target.value)}
                className="border px-2 py-1 bg-transparent"
              />
            </label>
          </div>
          <p className="mt-3 text-xs opacity-60">
            Phase 2 wires cpal → Silero VAD → whisper.cpp / WS proxy → enigo
            paste.
          </p>
        </Card>
      </div>
    </main>
  );
}
