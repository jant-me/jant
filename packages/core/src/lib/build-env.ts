/**
 * Build-time environment detection
 *
 * In Vite dev, `__JANT_DEV__` is replaced with `true` via Vite's `define`
 * config. In production (wrangler/esbuild) the typeof check evaluates to false
 * safely.
 *
 * Kept apart from `version.ts` so client bundles can read the flag: the client
 * build defines `__JANT_VERSION__` but none of the Worker-only asset globals
 * that `version.ts` reads at module scope.
 */

declare const __JANT_DEV__: boolean | undefined;

export const IS_VITE_DEV =
  typeof __JANT_DEV__ !== "undefined" && __JANT_DEV__ === true;
