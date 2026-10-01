export function clusterRestartDelayMs(consecutiveCrashes: number): number {
  return Math.min(30_000, 250 * 2 ** Math.min(consecutiveCrashes, 7));
}
