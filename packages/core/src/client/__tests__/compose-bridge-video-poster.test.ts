// @vitest-environment happy-dom

/**
 * The compose card and the uploaded media used to draw their poster from two
 * different places: the card from a quick `<video>` frame grab, the upload
 * from the mediabunny probe. When the probe came back without one, the card
 * showed a thumbnail the published post did not have. The quick frame is now
 * the upload's fallback, so the two cannot disagree.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const processToFile = vi.fn();
const uploadViaSession = vi.fn();

vi.mock("../video-processor.js", () => ({
  VideoProcessor: {
    isSupported: () => true,
    processToFile: (...args: unknown[]) => processToFile(...args),
  },
}));

vi.mock("../upload-session.js", () => ({
  uploadViaSession: (...args: unknown[]) => uploadViaSession(...args),
}));

await import("../compose-bridge.js");

const QUICK_POSTER = new Blob(["quick"], { type: "image/webp" });
const PROBE_POSTER = new Blob(["probe"], { type: "image/webp" });

/** Stand in for the `<video>` element `captureQuickPoster` grabs a frame from. */
function stubFrameCapture(options: { decodes: boolean }) {
  vi.spyOn(document, "createElement").mockImplementation(((tag: string) => {
    if (tag === "canvas") {
      return {
        width: 0,
        height: 0,
        getContext: () => ({ drawImage: () => {} }),
        toBlob: (cb: (blob: Blob | null) => void) => cb(QUICK_POSTER),
      } as unknown as HTMLElement;
    }
    const video = {
      muted: false,
      playsInline: false,
      preload: "",
      videoWidth: 1280,
      videoHeight: 720,
      onloadeddata: null as null | (() => void),
      onerror: null as null | (() => void),
      removeAttribute: () => {},
      load: () => {},
      set src(_value: string) {
        queueMicrotask(() =>
          options.decodes ? this.onloadeddata?.() : this.onerror?.(),
        );
      },
    };
    return video as unknown as HTMLElement;
  }) as typeof document.createElement);
}

function selectVideoFile() {
  document.dispatchEvent(
    new CustomEvent("jant:files-selected", {
      detail: {
        files: [
          {
            file: new File(["source"], "clip.mov", {
              type: "video/quicktime",
            }),
            clientId: "attachment-1",
          },
        ],
      },
    }),
  );
}

async function settle() {
  for (let i = 0; i < 6; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

function uploadedPoster(): Blob | undefined {
  const metadata = uploadViaSession.mock.calls[0]?.[1] as
    | { poster?: Blob }
    | undefined;
  return metadata?.poster;
}

describe("compose bridge video poster", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
    processToFile.mockReset();
    uploadViaSession.mockReset();
    uploadViaSession.mockResolvedValue({
      id: "med_1",
      filename: "clip.mp4",
      url: "/media/clip.mp4",
      mimeType: "video/mp4",
      size: 10,
    });
    vi.stubGlobal("URL", {
      createObjectURL: () => "blob:test",
      revokeObjectURL: () => {},
    });
  });

  it("uploads the probe's poster when it has one", async () => {
    stubFrameCapture({ decodes: true });
    processToFile.mockResolvedValue({
      file: new File(["out"], "clip.mp4", { type: "video/mp4" }),
      width: 1280,
      height: 720,
      poster: PROBE_POSTER,
      blurhash: "LGK",
    });

    selectVideoFile();
    await settle();

    expect(uploadedPoster()).toBe(PROBE_POSTER);
  });

  it("falls back to the quick frame when the probe found no poster", async () => {
    stubFrameCapture({ decodes: true });
    processToFile.mockResolvedValue({
      file: new File(["out"], "clip.mp4", { type: "video/mp4" }),
      width: 1280,
      height: 720,
      poster: undefined,
      blurhash: undefined,
    });

    selectVideoFile();
    await settle();

    expect(uploadViaSession).toHaveBeenCalledTimes(1);
    expect(uploadedPoster()).toBe(QUICK_POSTER);
  });

  it("uploads without a poster when neither path produced one", async () => {
    stubFrameCapture({ decodes: false });
    processToFile.mockResolvedValue({
      file: new File(["out"], "clip.mp4", { type: "video/mp4" }),
      width: 1280,
      height: 720,
      poster: undefined,
    });

    selectVideoFile();
    await settle();

    expect(uploadViaSession).toHaveBeenCalledTimes(1);
    expect(uploadedPoster()).toBeUndefined();
  });
});
