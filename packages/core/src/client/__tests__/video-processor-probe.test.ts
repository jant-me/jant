// @vitest-environment happy-dom

/**
 * The source probe feeds four independent things: the codec that decides
 * whether a re-encode is needed, the bitrate that sizes it, the duration, and
 * the poster/blurhash pair. They used to share one try/catch, so a single
 * failing step returned nothing at all — a mediabunny version without
 * `getCodec()` cost every upload its thumbnail while the video itself went
 * through fine. Each step is now degraded on its own.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const trackStub = {
  displayWidth: 1280,
  displayHeight: 720,
  rotation: 0,
  getCodec: vi.fn(async () => "avc"),
  computePacketStats: vi.fn(async () => ({ averageBitrate: 2_000_000 })),
};

const conversionOptions: { video?: Record<string, unknown> }[] = [];

const canvasSinkStub = {
  getCanvas: vi.fn(async () => ({ canvas: makeCanvas(1280, 720) })),
};

vi.mock("mediabunny", () => {
  class Input {
    getPrimaryVideoTrack = async () => trackStub;
    computeDuration = async () => 20;
    dispose = () => {};
  }
  class CanvasSink {
    getCanvas = () => canvasSinkStub.getCanvas();
  }
  class BufferTarget {
    buffer = new ArrayBuffer(64);
  }
  return {
    Input,
    CanvasSink,
    BufferTarget,
    BlobSource: class {},
    Output: class {},
    Mp4OutputFormat: class {},
    Quality: class {
      constructor(readonly options: unknown) {}
    },
    ALL_FORMATS: [],
    Conversion: {
      init: async (options: { video?: Record<string, unknown> }) => {
        conversionOptions.push(options);
        return { onProgress: undefined, execute: async () => {} };
      },
    },
  };
});

vi.mock("../../lib/mp4-track-flags.js", () => ({
  zeroTrackAlternateGroups: () => {},
}));

/** A canvas whose 2D context and WebP encoding both succeed. */
function makeCanvas(width: number, height: number): HTMLCanvasElement {
  return {
    width,
    height,
    getContext: () => ({
      drawImage: () => {},
      getImageData: (_x: number, _y: number, w: number, h: number) => ({
        data: new Uint8ClampedArray(w * h * 4).fill(120),
      }),
    }),
    toBlob: (cb: (blob: Blob | null) => void) =>
      cb(new Blob(["poster"], { type: "image/webp" })),
  } as unknown as HTMLCanvasElement;
}

const { VideoProcessor } = await import("../video-processor.js");

beforeEach(() => {
  conversionOptions.length = 0;
  trackStub.getCodec.mockImplementation(async () => "avc");
  trackStub.computePacketStats.mockImplementation(async () => ({
    averageBitrate: 2_000_000,
  }));
  canvasSinkStub.getCanvas.mockImplementation(async () => ({
    canvas: makeCanvas(1280, 720),
  }));

  vi.spyOn(document, "createElement").mockImplementation(((tag: string) => {
    if (tag === "canvas") return makeCanvas(1280, 720);
    // `probeVideoDimensions` loads the transcoded output in a <video> element.
    const video = {
      preload: "",
      onloadedmetadata: null as null | (() => void),
      onerror: null,
      videoWidth: 1280,
      videoHeight: 720,
      set src(_value: string) {
        queueMicrotask(() => this.onloadedmetadata?.());
      },
    };
    return video as unknown as HTMLElement;
  }) as typeof document.createElement);

  vi.stubGlobal("URL", {
    createObjectURL: () => "blob:test",
    revokeObjectURL: () => {},
  });
  vi.stubGlobal("VideoEncoder", class {});
});

function sourceFile() {
  return new File(["source"], "clip.mov", { type: "video/quicktime" });
}

describe("VideoProcessor.processToFile source probing", () => {
  it("still captures a poster when the codec cannot be read", async () => {
    // The exact shape of a stale install: the installed mediabunny has no
    // `getCodec()`, so the call throws before the frame is ever captured.
    trackStub.getCodec.mockImplementation(() => {
      throw new TypeError("videoTrack.getCodec is not a function");
    });
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await VideoProcessor.processToFile(sourceFile());

    expect(result.poster).toBeInstanceOf(Blob);
    expect(result.blurhash).toBeTruthy();
    expect(result.durationSeconds).toBe(20);
    // An unreadable codec cannot be vouched for, so the file is re-encoded.
    expect(conversionOptions[0]?.video).toHaveProperty("quality");
  });

  it("still captures a poster when the bitrate cannot be computed", async () => {
    trackStub.computePacketStats.mockRejectedValue(
      new Error("no sample table"),
    );
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await VideoProcessor.processToFile(sourceFile());

    expect(result.poster).toBeInstanceOf(Blob);
    expect(result.blurhash).toBeTruthy();
  });

  it("still reports the duration when the frame cannot be decoded", async () => {
    canvasSinkStub.getCanvas.mockRejectedValue(
      new Error("unsupported codec configuration"),
    );
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await VideoProcessor.processToFile(sourceFile());

    expect(result.poster).toBeUndefined();
    expect(result.blurhash).toBeUndefined();
    // The half that does not need a decoder survives.
    expect(result.durationSeconds).toBe(20);
    expect(conversionOptions[0]?.video).not.toHaveProperty("quality");
  });

  it("names the failing step on the console rather than failing silently", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    trackStub.getCodec.mockRejectedValue(new Error("boom"));

    await VideoProcessor.processToFile(sourceFile());

    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("read codec"),
      expect.any(Error),
    );
  });
});
