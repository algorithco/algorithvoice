export function maskKey(key: string): string {
  if (key.length <= 4) return "••••";
  return `••••${key.slice(-4)}`;
}
