// Compatibility shim — implementation moved to src/lib/session/*.ts.
// Kept so existing `../lib/session.js` imports keep working during the
// incremental migration. New code should import from the split modules
// directly (e.g. `./session/env.js` for isTauri) to avoid pulling OAuth/PKCE
// into lightweight bundles like the floating pill.
export * from "./session/index.js";
