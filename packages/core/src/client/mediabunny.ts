/**
 * Lazy access to mediabunny.
 *
 * mediabunny is ≈900 KB minified (≈170 KB gzipped) and only does anything once
 * a video or audio file is picked for upload, so the processors fetch it on
 * demand instead of shipping it in `client-auth.js`. Same pattern as `heic-to`
 * in `compose-bridge.ts`; the build guard in `vite.shared.ts` keeps it out of
 * the entry chunks.
 *
 * @example
 * ```ts
 * const { Input, BlobSource, ALL_FORMATS } = await loadMediabunny();
 * const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
 * ```
 */

type Mediabunny = typeof import("mediabunny");

let loading: Promise<Mediabunny> | undefined;

/**
 * Load mediabunny once and share the module across callers.
 *
 * @returns The mediabunny module namespace
 */
export function loadMediabunny(): Promise<Mediabunny> {
  loading ??= import("mediabunny");
  return loading;
}
