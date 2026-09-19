import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useState } from "react";

export function detectWindowLabels(): {
  isSettings: boolean;
  isPill: boolean;
} {
  try {
    // Tauri 2 WebviewWindow label is the source of truth for secondary windows.
    // Fallback to Window label for browser preview / older mocks.
    let label: string | null = null;
    try {
      label = getCurrentWebviewWindow().label;
    } catch {
      try {
        label = getCurrentWindow().label;
      } catch {
        label = null;
      }
    }
    return {
      isSettings: label === "settings",
      isPill: label === "floating-pill",
    };
  } catch {
    return { isSettings: false, isPill: false };
  }
}

/** Detects secondary Tauri windows, with a late re-check for async IPC injection. */
export function useWindowLabel() {
  const [labels, setLabels] = useState(detectWindowLabels);
  const { isSettings, isPill } = labels;

  useEffect(() => {
    if (isSettings || isPill) return;
    const id = window.setTimeout(() => {
      const late = detectWindowLabels();
      if (late.isSettings || late.isPill) setLabels(late);
    }, 120);
    return () => clearTimeout(id);
  }, [isSettings, isPill]);

  return labels;
}
