/**
 * Client-side Image Processor
 *
 * Processes images before upload:
 * - Resizes oversized images (caps the short side; the long side rides free)
 * - Strips all metadata (privacy)
 * - Converts to WebP format (JPEG fallback when WebP encoding is unavailable)
 * - Samples a blurhash placeholder from the decoded pixels
 *
 * The work runs in a Web Worker (`image-worker.ts`) wherever the browser can
 * decode and encode there — every engine with OffscreenCanvas. Decoding a
 * photo and encoding the result are the heaviest things the composer does on
 * the client; on the main thread they froze the page for their whole
 * duration, and several photos at once froze it for seconds. Browsers without
 * OffscreenCanvas, and any file the worker cannot decode, take the in-page
 * canvas path below.
 *
 * EXIF orientation is handled by the browser on both paths — `<img>`, canvas
 * `drawImage`, and `createImageBitmap` with `imageOrientation: "from-image"`
 * all report and draw the oriented image.
 *
 * Long and wide screenshots (chat logs, articles, wide tables) lose their
 * text legibility if the short side is scaled down, so the resize step caps
 * only the *short* side and leaves the long side alone. Images whose long
 * side exceeds the safe canvas limit can't be redrawn at all — those upload
 * untouched, so images of any length are supported.
 */

import { encode } from "blurhash";
import {
  DEFAULT_IMAGE_PROCESS_OPTIONS,
  blurhashDimensions,
  planImageProcessing,
  resolveEncodedMimeType,
  type ImageProcessOptions,
  type ImageWorkerRequest,
  type ImageWorkerResponse,
} from "./image-plan.js";
import {
  createImageWorker,
  supportsImageWorker,
} from "./image-worker-client.js";

type ProcessOptions = Partial<ImageProcessOptions>;

export interface ProcessResult {
  blob: Blob;
  width: number;
  height: number;
  /** False when `blob` is the untouched original (too large to re-encode). */
  processed: boolean;
  /** Absent only when the pixels could not be sampled. */
  blurhash?: string;
}

export interface ProcessToFileResult {
  file: File;
  width: number;
  height: number;
  blurhash?: string;
}

// ── Worker path ──────────────────────────────────────────────────────────

interface PendingRequest {
  resolve(result: ProcessResult): void;
  reject(error: Error): void;
}

let worker: Worker | null = null;
let nextRequestId = 1;
const pending = new Map<number, PendingRequest>();

/** One worker for the page, started on the first image and kept warm. */
function getWorker(): Worker {
  if (worker) return worker;
  const created = createImageWorker();
  created.addEventListener(
    "message",
    (event: MessageEvent<ImageWorkerResponse>) => {
      const response = event.data;
      const request = pending.get(response.id);
      if (!request) return;
      pending.delete(response.id);
      if (response.ok) {
        request.resolve({
          blob: response.blob,
          width: response.width,
          height: response.height,
          processed: response.processed,
          blurhash: response.blurhash,
        });
      } else {
        request.reject(new Error(response.error));
      }
    },
  );
  // A worker that dies takes every in-flight image with it. Fail them over to
  // the in-page path and start clean for the next one.
  created.addEventListener("error", (event) => {
    if (worker !== created) return;
    worker = null;
    created.terminate();
    const requests = [...pending.values()];
    pending.clear();
    const error = new Error(event.message || "Image worker failed");
    for (const request of requests) request.reject(error);
  });
  worker = created;
  return created;
}

function processInWorker(
  file: File,
  options: ImageProcessOptions,
): Promise<ProcessResult> {
  const target = getWorker();
  return new Promise((resolve, reject) => {
    const id = nextRequestId++;
    pending.set(id, { resolve, reject });
    const request: ImageWorkerRequest = { id, file, options };
    target.postMessage(request);
  });
}

// ── In-page path ─────────────────────────────────────────────────────────

/**
 * Load image from file
 */
function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(img.src);
      resolve(img);
    };
    img.onerror = () => reject(new Error("Failed to load image"));
    img.src = URL.createObjectURL(file);
  });
}

function createCanvas(width: number, height: number) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Failed to get canvas context");
  return { canvas, ctx };
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  type: string,
  quality: number,
): Promise<Blob> {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("Failed to create blob"))),
      type,
      quality,
    );
  });
}

const pageEncodeTypeByRequest = new Map<string, Promise<string>>();

/** The format `toBlob` really produces for `requested`, probed once. */
function resolveEncodeTypeOnPage(
  requested: string,
  quality: number,
): Promise<string> {
  let pending = pageEncodeTypeByRequest.get(requested);
  if (!pending) {
    pending = canvasToBlob(createCanvas(1, 1).canvas, requested, quality).then(
      (probe) => resolveEncodedMimeType(requested, probe.type),
    );
    pageEncodeTypeByRequest.set(requested, pending);
  }
  return pending;
}

/** Best-effort: no blurhash beats no upload. */
function blurhashOf(img: HTMLImageElement): string | undefined {
  try {
    const { width, height } = blurhashDimensions(img.width, img.height);
    const { ctx } = createCanvas(width, height);
    ctx.drawImage(img, 0, 0, width, height);
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

async function processOnPage(
  file: File,
  options: ImageProcessOptions,
): Promise<ProcessResult> {
  const img = await loadImage(file);

  // img.width / img.height already reflect EXIF orientation in modern browsers
  const plan = planImageProcessing(img.width, img.height, options);
  const blurhash = blurhashOf(img);

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

  const { canvas, ctx } = createCanvas(plan.width, plan.height);
  // drawImage respects EXIF orientation — no manual rotation needed
  ctx.drawImage(img, 0, 0, plan.width, plan.height);

  const type = await resolveEncodeTypeOnPage(options.mimeType, options.quality);
  const blob = await canvasToBlob(canvas, type, options.quality);

  return {
    blob,
    width: plan.width,
    height: plan.height,
    processed: true,
    blurhash,
  };
}

// ── Facade ───────────────────────────────────────────────────────────────

/**
 * Process image file
 */
async function process(
  file: File,
  options: ProcessOptions = {},
): Promise<ProcessResult> {
  const opts = { ...DEFAULT_IMAGE_PROCESS_OPTIONS, ...options };

  if (supportsImageWorker()) {
    try {
      return await processInWorker(file, opts);
    } catch {
      // The worker could not decode this file, or never started. `<img>`
      // accepts a few things `createImageBitmap` does not, and if it fails
      // too, that is the error worth reporting.
    }
  }

  return processOnPage(file, opts);
}

/**
 * Process file and create a new File object
 */
async function processToFile(
  file: File,
  options: ProcessOptions = {},
): Promise<ProcessToFileResult> {
  const result = await process(file, options);

  // Original kept untouched — upload the file as-is.
  if (!result.processed) {
    return {
      file,
      width: result.width,
      height: result.height,
      blurhash: result.blurhash,
    };
  }

  // Use actual blob type — Safari falls back to JPEG when WebP encoding isn't supported
  const EXT_MAP: Record<string, string> = {
    "image/webp": "webp",
    "image/jpeg": "jpg",
    "image/png": "png",
  };
  const ext = EXT_MAP[result.blob.type] ?? "png";
  const originalName = file.name.replace(/\.[^.]+$/, "");
  const newName = `${originalName}.${ext}`;

  return {
    file: new File([result.blob], newName, { type: result.blob.type }),
    width: result.width,
    height: result.height,
    blurhash: result.blurhash,
  };
}

export const ImageProcessor = { process, processToFile };
