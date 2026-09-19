export function isTauri(): boolean {
  // Tauri 2 recommends checking __TAURI__; __TAURI_INTERNALS__ may not be
  // present in secondary webviews until IPC handshake completes.
  return (
    typeof window !== "undefined" &&
    ("__TAURI__" in window || "__TAURI_INTERNALS__" in window)
  );
}
