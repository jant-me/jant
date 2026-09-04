// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  blurhashDimensions,
  planImageProcessing,
  resolveEncodedMimeType,
  type ImageWorkerRequest,
  type ImageWorkerResponse,
} from "../image-plan.js";

const OPTS = { maxShortSide: 1920, maxLongSide: 8192 };

describe("planImageProcessing", () => {
  it("leaves small images untouched", () => {
    expect(planImageProcessing(800, 600, OPTS)).toEqual({
      passthrough: false,
      width: 800,
      height: 600,
    });
  });

  it("keeps long screenshots at full resolution", () => {
    expect(planImageProcessing(1080, 6000, OPTS)).toEqual({
      passthrough: false,
      width: 1080,
      height: 6000,
    });
  });

  it("keeps wide screenshots at full resolution", () => {
    expect(planImageProcessing(6000, 1080, OPTS)).toEqual({
      passthrough: false,
      width: 6000,
      height: 1080,
    });
  });

  it("downscales a large photo by its short side, not its long side", () => {
    const plan = planImageProcessing(4032, 3024, OPTS);
    expect(plan.passthrough).toBe(false);
    expect(plan.height).toBe(1920);
    expect(plan.width).toBe(Math.round(4032 * (1920 / 3024)));
  });

  it("caps the short side regardless of orientation", () => {
    const portrait = planImageProcessing(3024, 4032, OPTS);
    expect(portrait.width).toBe(1920);
    expect(portrait.height).toBe(Math.round(4032 * (1920 / 3024)));
  });

  it("uploads images taller than the canvas limit untouched", () => {
    expect(planImageProcessing(1080, 12000, OPTS)).toEqual({
      passthrough: true,
      width: 1080,
      height: 12000,
    });
  });

  it("uploads images wider than the canvas limit untouched", () => {
    expect(planImageProcessing(12000, 1080, OPTS)).toEqual({
      passthrough: true,
      width: 12000,
      height: 1080,
    });
  });

  it("treats the long-side cap as inclusive", () => {
    expect(planImageProcessing(1080, 8192, OPTS).passthrough).toBe(false);
    expect(planImageProcessing(1080, 8193, OPTS).passthrough).toBe(true);
  });
});

describe("resolveEncodedMimeType", () => {
  it("keeps the requested format when the encoder produced it", () => {
    expect(resolveEncodedMimeType("image/webp", "image/webp")).toBe(
      "image/webp",
    );
    expect(resolveEncodedMimeType("image/png", "image/png")).toBe("image/png");
  });

  it("switches to JPEG when the encoder silently fell back to PNG", () => {
    expect(resolveEncodedMimeType("image/webp", "image/png")).toBe(
      "image/jpeg",
    );
  });

  it("switches to JPEG when the encoder produced nothing recognizable", () => {
    expect(resolveEncodedMimeType("image/webp", "")).toBe("image/jpeg");
  });
});

describe("blurhashDimensions", () => {
  it("scales the longest side down to 32px", () => {
    expect(blurhashDimensions(4032, 3024)).toEqual({ width: 32, height: 24 });
    expect(blurhashDimensions(3024, 4032)).toEqual({ width: 24, height: 32 });
  });

  it("never scales up and never drops below one pixel", () => {
    expect(blurhashDimensions(10, 10)).toEqual({ width: 10, height: 10 });
    expect(blurhashDimensions(100, 6000)).toEqual({ width: 1, height: 32 });
  });
});

// ── The facade: worker first, page canvas as fallback ────────────────────

const { FakeWorker, createdWorkers, workerScript, workerSupport } = vi.hoisted(
  () => {
    type WorkerEvent = { data?: unknown; message?: string };
    type Listener = (event: WorkerEvent) => void;

    class FakeWorker {
      posted: unknown[] = [];
      terminated = false;
      private listeners = new Map<string, Listener[]>();

      addEventListener(type: string, listener: Listener) {
        const list = this.listeners.get(type) ?? [];
        list.push(listener);
        this.listeners.set(type, list);
      }

      postMessage(request: unknown) {
        this.posted.push(request);
        const reply = workerScript.reply;
        if (!reply) return;
        queueMicrotask(() => this.emit("message", { data: reply(request) }));
      }

      terminate() {
        this.terminated = true;
      }

      emit(type: string, event: WorkerEvent) {
        for (const listener of this.listeners.get(type) ?? []) listener(event);
      }
    }

    const workerScript: { reply: ((request: unknown) => unknown) | null } = {
      reply: null,
    };

    return {
      FakeWorker,
      createdWorkers: [] as FakeWorker[],
      workerScript,
      workerSupport: { supported: true },
    };
  },
);

vi.mock("../image-worker-client.js", () => ({
  supportsImageWorker: () => workerSupport.supported,
  createImageWorker: () => {
    const worker = new FakeWorker();
    createdWorkers.push(worker);
    return worker;
  },
}));

const originalCreateObjectURL = URL.createObjectURL;
const originalRevokeObjectURL = URL.revokeObjectURL;
const originalImage = globalThis.Image;
const originalGetContext = HTMLCanvasElement.prototype.getContext;
const originalToBlob = HTMLCanvasElement.prototype.toBlob;

const imagesDecodedOnPage = vi.fn();

/** Stand in for `<img>` + `<canvas>` — the in-page path, WebP-capable. */
function installPageCanvasMocks() {
  URL.createObjectURL = vi.fn(() => "blob:image-source");
  URL.revokeObjectURL = vi.fn();

  class MockImage {
    width = 4032;
    height = 3024;
    onload: null | (() => void) = null;
    onerror: null | (() => void) = null;
    private _src = "";

    constructor() {
      imagesDecodedOnPage();
    }

    set src(value: string) {
      this._src = value;
      queueMicrotask(() => this.onload?.());
    }

    get src() {
      return this._src;
    }
  }
  globalThis.Image = MockImage as unknown as typeof Image;

  HTMLCanvasElement.prototype.getContext = vi.fn(function (
    this: HTMLCanvasElement,
  ) {
    return {
      drawImage: vi.fn(),
      getImageData: (_x: number, _y: number, w: number, h: number) => ({
        data: new Uint8ClampedArray(w * h * 4),
      }),
    };
  }) as unknown as typeof HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.toBlob = vi.fn(function (
    callback: BlobCallback,
    type?: string,
  ) {
    callback(new Blob(["encoded"], { type: type ?? "image/png" }));
  }) as typeof HTMLCanvasElement.prototype.toBlob;
}

function restorePageCanvasMocks() {
  URL.createObjectURL = originalCreateObjectURL;
  URL.revokeObjectURL = originalRevokeObjectURL;
  globalThis.Image = originalImage;
  HTMLCanvasElement.prototype.getContext = originalGetContext;
  HTMLCanvasElement.prototype.toBlob = originalToBlob;
}

function asRequest(posted: unknown): ImageWorkerRequest {
  return posted as ImageWorkerRequest;
}

function workerResult(request: unknown): ImageWorkerResponse {
  return {
    id: asRequest(request).id,
    ok: true,
    blob: new Blob(["from-worker"], { type: "image/webp" }),
    width: 2560,
    height: 1920,
    processed: true,
    blurhash: "LEHV6nWB2yk8pyo0adR*.7kCMdnj",
  };
}

async function loadProcessor() {
  const { ImageProcessor } = await import("../image-processor.js");
  return ImageProcessor;
}

describe("ImageProcessor", () => {
  const photo = new File(["raw"], "photo.jpg", { type: "image/jpeg" });

  beforeEach(() => {
    vi.resetModules();
    createdWorkers.length = 0;
    workerScript.reply = workerResult;
    workerSupport.supported = true;
    imagesDecodedOnPage.mockClear();
    installPageCanvasMocks();
  });

  afterEach(() => {
    restorePageCanvasMocks();
  });

  it("processes in the worker and never decodes on the page", async () => {
    const processor = await loadProcessor();

    const result = await processor.processToFile(photo);

    expect(createdWorkers).toHaveLength(1);
    const request = asRequest(createdWorkers[0].posted[0]);
    expect(request.file).toBe(photo);
    expect(request.options).toMatchObject({
      maxShortSide: 1920,
      maxLongSide: 8192,
      mimeType: "image/webp",
    });
    expect(result.file.name).toBe("photo.webp");
    expect(result.file.type).toBe("image/webp");
    expect(result).toMatchObject({
      width: 2560,
      height: 1920,
      blurhash: "LEHV6nWB2yk8pyo0adR*.7kCMdnj",
    });
    expect(imagesDecodedOnPage).not.toHaveBeenCalled();
  });

  it("keeps one worker warm across images", async () => {
    const processor = await loadProcessor();

    await processor.processToFile(photo);
    await processor.processToFile(photo);

    expect(createdWorkers).toHaveLength(1);
    expect(createdWorkers[0].posted).toHaveLength(2);
  });

  it("hands the original through when the worker says it is too large", async () => {
    workerScript.reply = (request) => ({
      id: asRequest(request).id,
      ok: true,
      blob: photo,
      width: 1080,
      height: 12000,
      processed: false,
      blurhash: "LEHV6nWB2yk8pyo0adR*.7kCMdnj",
    });
    const processor = await loadProcessor();

    const result = await processor.processToFile(photo);

    expect(result.file).toBe(photo);
    expect(result).toMatchObject({ width: 1080, height: 12000 });
  });

  it("falls back to the page canvas for a file the worker cannot decode", async () => {
    workerScript.reply = (request) => ({
      id: asRequest(request).id,
      ok: false,
      error: "The source image could not be decoded.",
    });
    const processor = await loadProcessor();

    const result = await processor.processToFile(photo);

    expect(imagesDecodedOnPage).toHaveBeenCalledTimes(1);
    expect(result.file.name).toBe("photo.webp");
    expect(result.file.type).toBe("image/webp");
    expect(result).toMatchObject({ width: 2560, height: 1920 });
    expect(typeof result.blurhash).toBe("string");
    // The worker is still fine — one bad file does not cost it.
    expect(createdWorkers[0].terminated).toBe(false);
  });

  it("fails in-flight images over to the page when the worker dies, then starts a new one", async () => {
    workerScript.reply = null;
    const processor = await loadProcessor();

    const inFlight = processor.processToFile(photo);
    await Promise.resolve();
    createdWorkers[0].emit("error", { message: "worker crashed" });
    const result = await inFlight;

    expect(result.file.type).toBe("image/webp");
    expect(imagesDecodedOnPage).toHaveBeenCalledTimes(1);
    expect(createdWorkers[0].terminated).toBe(true);

    workerScript.reply = workerResult;
    await processor.processToFile(photo);
    expect(createdWorkers).toHaveLength(2);
  });

  it("uses the page canvas where the browser has no OffscreenCanvas", async () => {
    workerSupport.supported = false;
    const processor = await loadProcessor();

    const result = await processor.processToFile(photo);

    expect(createdWorkers).toHaveLength(0);
    expect(imagesDecodedOnPage).toHaveBeenCalledTimes(1);
    expect(result.file.type).toBe("image/webp");
  });

  it("probes the encoder once and encodes each image once on the page", async () => {
    workerSupport.supported = false;
    const processor = await loadProcessor();

    await processor.processToFile(photo);
    await processor.processToFile(photo);

    // One 1×1 probe, then one real encode per image — never PNG-then-JPEG.
    expect(HTMLCanvasElement.prototype.toBlob).toHaveBeenCalledTimes(3);
  });

  it("encodes JPEG on the page when the browser cannot encode WebP", async () => {
    workerSupport.supported = false;
    HTMLCanvasElement.prototype.toBlob = vi.fn(function (
      callback: BlobCallback,
      type?: string,
    ) {
      // Safari: asked for WebP, silently hands back PNG.
      const produced = type === "image/webp" ? "image/png" : type;
      callback(new Blob(["encoded"], { type: produced ?? "image/png" }));
    }) as typeof HTMLCanvasElement.prototype.toBlob;
    const processor = await loadProcessor();

    const result = await processor.processToFile(photo);

    expect(result.file.type).toBe("image/jpeg");
    expect(result.file.name).toBe("photo.jpg");
  });
});
