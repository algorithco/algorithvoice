import { readFile } from "node:fs/promises";

const jsonFiles = [
  "package.json",
  "apps/backend/package.json",
  "apps/web/package.json",
  "apps/desktop-tauri/package.json",
  "packages/shared-types/package.json",
  "packages/ui/package.json",
];
const versions = new Map();
for (const file of jsonFiles) {
  const value = JSON.parse(await readFile(file, "utf8"));
  versions.set(file, value.version);
}
const cargo = await readFile("apps/desktop-tauri/src-tauri/Cargo.toml", "utf8");
versions.set(
  "apps/desktop-tauri/src-tauri/Cargo.toml",
  cargo.match(/^version\s*=\s*"([^"]+)"/m)?.[1],
);
const tauri = JSON.parse(
  await readFile("apps/desktop-tauri/src-tauri/tauri.conf.json", "utf8"),
);
versions.set("apps/desktop-tauri/src-tauri/tauri.conf.json", tauri.version);

const expected = versions.get("package.json");
const mismatches = [...versions].filter(([, version]) => version !== expected);
if (mismatches.length > 0) {
  console.error("Version mismatch:", Object.fromEntries(versions));
  process.exit(1);
}
console.log(`All workspace versions match ${expected}`);
