/**
 * Where the image worker comes from.
 *
 * Kept apart from `ImageProcessor` so tests can stand in a fake worker, and so
 * the `?worker&inline` import has exactly one home. Inline — Vite bundles the
 * worker into the client script and starts it from a `blob:` URL — rather than
 * a separate file, because client assets may be served from another origin
 * (`ASSET_BASE_URL`) and a worker script must be same-origin with the page.
 * CSP already admits `blob:` scripts for the media workers.
 */

import ImageWorker from "./image-worker.js?worker&inline";

/**
 * Whether this browser can decode and encode images inside a worker.
 *
 * @returns True when `Worker`, `OffscreenCanvas`, and `createImageBitmap` exist
 *
 * @example
 * ```ts
 * if (supportsImageWorker()) worker = createImageWorker();
 * ```
 */
export function supportsImageWorker(): boolean {
  return (
    typeof Worker === "function" &&
    typeof OffscreenCanvas === "function" &&
    typeof createImageBitmap === "function"
  );
}

/**
 * Start a fresh image worker.
 *
 * @returns The worker, speaking the protocol in `image-plan.ts`
 *
 * @example
 * ```ts
 * const worker = createImageWorker();
 * worker.postMessage({ id: 1, file, options });
 * ```
 */
export function createImageWorker(): Worker {
  return new ImageWorker({ name: "jant-image" });
}
