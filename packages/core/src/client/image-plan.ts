/**
 * Image processing plan and worker protocol.
 *
 * The pure decisions shared by the `ImageProcessor` facade on the main thread
 * and the `image-worker` that decodes and encodes off it. Nothing here touches
 * the DOM, so both sides — and the tests — import it without a canvas.
 */

/** Cap for the shorter image side — the side that determines text sharpness. */
export const MAX_SHORT_SIDE = 1920;

/**
 * Largest long side we can still redraw on a canvas. A canvas bounded by
 * MAX_SHORT_SIDE × MAX_LONG_SIDE (1920 × 8192 ≈ 15.7M px) stays under the
 * ~16.7M-pixel area limit older mobile Safari enforces. Anything longer
 * can't be re-encoded, so it uploads as-is.
 */
export const MAX_LONG_SIDE = 8192;

/** Longest side of the tiny canvas a blurhash is sampled from. */
export const BLURHASH_MAX_SIDE = 32;

export interface ImageProcessOptions {
  maxShortSide: number;
  maxLongSide: number;
  quality: number;
  mimeType: "image/webp" | "image/jpeg" | "image/png";
}

export const DEFAULT_IMAGE_PROCESS_OPTIONS: ImageProcessOptions = {
  maxShortSide: MAX_SHORT_SIDE,
  maxLongSide: MAX_LONG_SIDE,
  quality: 0.85,
  mimeType: "image/webp",
};

export interface ImageProcessPlan {
  /** When true, upload the original file untouched (too large to re-encode). */
  passthrough: boolean;
  /** Target dimensions — equal to the source dimensions when `passthrough`. */
  width: number;
  height: number;
}

/**
 * Decide how to handle an image given its source dimensions.
 *
 * - Long side over `maxLongSide` → `passthrough` (canvas can't redraw it).
 * - Short side within `maxShortSide` → keep dimensions, just re-encode.
 * - Otherwise → scale down so the short side hits `maxShortSide`.
 *
 * @param sourceWidth - Natural image width in pixels
 * @param sourceHeight - Natural image height in pixels
 * @param options - `maxShortSide` and `maxLongSide` caps
 * @returns The processing plan
 *
 * @example
 * ```ts
 * planImageProcessing(1080, 6000, { maxShortSide: 1920, maxLongSide: 8192 });
 * // { passthrough: false, width: 1080, height: 6000 }
 * ```
 */
export function planImageProcessing(
  sourceWidth: number,
  sourceHeight: number,
  options: { maxShortSide: number; maxLongSide: number },
): ImageProcessPlan {
  const longSide = Math.max(sourceWidth, sourceHeight);
  if (longSide > options.maxLongSide) {
    return { passthrough: true, width: sourceWidth, height: sourceHeight };
  }

  const shortSide = Math.min(sourceWidth, sourceHeight);
  if (shortSide <= options.maxShortSide) {
    return { passthrough: false, width: sourceWidth, height: sourceHeight };
  }

  const scale = options.maxShortSide / shortSide;
  return {
    passthrough: false,
    width: Math.round(sourceWidth * scale),
    height: Math.round(sourceHeight * scale),
  };
}

/**
 * Settle the encoding format after a probe encode.
 *
 * A browser that cannot encode the requested format does not fail — it
 * silently hands back a PNG (Safari has no WebP encoder). PNG ignores the
 * quality parameter and produces oversized files, so anything other than the
 * format asked for means "encode as JPEG", which every engine can do lossily.
 * Probing a 1×1 canvas once beats encoding every photo twice.
 *
 * @param requested - The MIME type asked of the encoder
 * @param produced - The MIME type of the blob it returned
 * @returns The MIME type to encode real images with
 *
 * @example
 * ```ts
 * resolveEncodedMimeType("image/webp", "image/png"); // "image/jpeg"
 * resolveEncodedMimeType("image/webp", "image/webp"); // "image/webp"
 * ```
 */
export function resolveEncodedMimeType(
  requested: string,
  produced: string,
): string {
  return produced === requested ? requested : "image/jpeg";
}

/**
 * Size of the canvas a blurhash is sampled from: the image scaled so its
 * longest side is at most {@link BLURHASH_MAX_SIDE}, never below 1px.
 *
 * @param width - Source width in pixels
 * @param height - Source height in pixels
 * @returns The sample canvas dimensions
 *
 * @example
 * ```ts
 * blurhashDimensions(4032, 3024); // { width: 32, height: 24 }
 * ```
 */
export function blurhashDimensions(
  width: number,
  height: number,
): { width: number; height: number } {
  const scale = Math.min(
    BLURHASH_MAX_SIDE / width,
    BLURHASH_MAX_SIDE / height,
    1,
  );
  return {
    width: Math.max(Math.round(width * scale), 1),
    height: Math.max(Math.round(height * scale), 1),
  };
}

// ── Worker protocol ──────────────────────────────────────────────────────

export interface ImageWorkerRequest {
  id: number;
  file: File;
  options: ImageProcessOptions;
}

export interface ImageWorkerSuccess {
  id: number;
  ok: true;
  blob: Blob;
  width: number;
  height: number;
  /** False when `blob` is the untouched original (too large to re-encode). */
  processed: boolean;
  blurhash?: string;
}

export interface ImageWorkerFailure {
  id: number;
  ok: false;
  error: string;
}

export type ImageWorkerResponse = ImageWorkerSuccess | ImageWorkerFailure;
