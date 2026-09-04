/**
 * Image processing worker.
 *
 * Decodes, resizes, re-encodes, and blurhashes an image entirely off the main
 * thread: `createImageBitmap` decodes without touching the DOM, and
 * `OffscreenCanvas.convertToBlob` encodes without a synchronous readback on
 * the UI thread. Selecting a 12-megapixel photo used to hold the composer for
 * a couple of hundred milliseconds per image; here it costs the page a
 * `postMessage`.
 *
 * Protocol in `image-plan.ts`. A failure is reported back, not retried: the
 * caller falls back to the in-page canvas path, which is also what browsers
 * without OffscreenCanvas use.
 */

import { encode } from "blurhash";
import {
  blurhashDimensions,
  planImageProcessing,
  resolveEncodedMimeType,
  type ImageProcessOptions,
  type ImageWorkerRequest,
  type ImageWorkerResponse,
  type ImageWorkerSuccess,
} from "./image-plan.js";

// The DOM lib types `self` as a Window; the worker needs only the two members
// both scopes share, typed against this module's own protocol.
const scope = self as unknown as {
  addEventListener(
    type: "message",
    listener: (event: MessageEvent<ImageWorkerRequest>) => void,
  ): void;
  postMessage(message: ImageWorkerResponse): void;
};

const encodeTypeByRequest = new Map<string, Promise<string>>();

/** The format `convertToBlob` really produces for `requested`, probed once. */
function resolveEncodeType(
  requested: string,
  quality: number,
): Promise<string> {
  let pending = encodeTypeByRequest.get(requested);
  if (!pending) {
    const { canvas } = draw(null, 1, 1);
    pending = canvas
      .convertToBlob({ type: requested, quality })
      .then((probe) => resolveEncodedMimeType(requested, probe.type));
    encodeTypeByRequest.set(requested, pending);
  }
  return pending;
}

function draw(
  source: ImageBitmap | null,
  width: number,
  height: number,
): { canvas: OffscreenCanvas; ctx: OffscreenCanvasRenderingContext2D } {
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Failed to get canvas context");
  if (source) ctx.drawImage(source, 0, 0, width, height);
  return { canvas, ctx };
}

/** Best-effort, like the metadata pass it replaces: no blurhash beats no upload. */
function blurhashOf(bitmap: ImageBitmap): string | undefined {
  try {
    const { width, height } = blurhashDimensions(bitmap.width, bitmap.height);
    const { ctx } = draw(bitmap, width, height);
    return encode(
      ctx.getImageData(0, 0, width, height).data,
      width,
      height,
      4,
      3,
    );
  } catch {
    return undefined;
  }
}

async function processImage(
  file: File,
  options: ImageProcessOptions,
): Promise<Omit<ImageWorkerSuccess, "id" | "ok">> {
  // `from-image` applies EXIF orientation, so the bitmap's dimensions are the
  // ones the photo is meant to be seen at — the same as `<img>` reports.
  const bitmap = await createImageBitmap(file, {
    imageOrientation: "from-image",
  });
  try {
    const plan = planImageProcessing(bitmap.width, bitmap.height, options);
    const blurhash = blurhashOf(bitmap);

    // Too large to redraw on a canvas without crushing detail — keep the
    // original bytes so images of any length upload at full quality.
    if (plan.passthrough) {
      return {
        blob: file,
        width: plan.width,
        height: plan.height,
        processed: false,
        blurhash,
      };
    }

    const { canvas } = draw(bitmap, plan.width, plan.height);
    const type = await resolveEncodeType(options.mimeType, options.quality);
    const blob = await canvas.convertToBlob({ type, quality: options.quality });
    return {
      blob,
      width: plan.width,
      height: plan.height,
      processed: true,
      blurhash,
    };
  } finally {
    bitmap.close();
  }
}

scope.addEventListener("message", async (event) => {
  const { id, file, options } = event.data;
  try {
    scope.postMessage({ id, ok: true, ...(await processImage(file, options)) });
  } catch (error) {
    scope.postMessage({
      id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});
