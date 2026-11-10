// @vitest-environment happy-dom

/**
 * A video uploaded through the API without a poster shows the reader a frame
 * their browser draws, but share cards and feeds have no still for it. When
 * the author opens its post in the editor, the bridge makes the poster from
 * the stored clip and saves it on the media.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const extractPosterFromUrl = vi.fn();

vi.mock("../video-processor.js", () => ({
  VideoProcessor: {
    isSupported: () => true,
    processToFile: vi.fn(),
    extractPosterFromUrl: (...args: unknown[]) => extractPosterFromUrl(...args),
  },
}));

await import("../compose-bridge.js");

const POSTER = new Blob(["poster"], { type: "image/webp" });

let nextMediaId = 1;

/** An editor holding one attachment, reporting what the bridge tells it. */
function mountEditor() {
  const editor = document.createElement("jant-compose-editor");
  const updateAttachmentPoster = vi.fn();
  Object.assign(editor, {
    updateAttachmentPoster,
    hasAttachment: () => true,
  });
  document.body.appendChild(editor);
  return { editor, updateAttachmentPoster };
}

function reportMissing(editor: globalThis.Element, mediaId: string) {
  editor.dispatchEvent(
    new CustomEvent("jant:video-posters-missing", {
      bubbles: true,
      detail: {
        attachments: [
          {
            clientId: "attachment-1",
            mediaId,
            url: "https://media.example/clip.mp4",
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

describe("compose bridge poster backfill", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    document.body.innerHTML = "";
    extractPosterFromUrl.mockReset();
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("makes the poster from the stored clip, saves it, and shows it", async () => {
    extractPosterFromUrl.mockResolvedValue(POSTER);
    const { editor, updateAttachmentPoster } = mountEditor();
    const mediaId = `med_${nextMediaId++}`;

    reportMissing(editor, mediaId);
    await settle();

    expect(extractPosterFromUrl).toHaveBeenCalledWith(
      "https://media.example/clip.mp4",
    );
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/media/${mediaId}/poster`,
      expect.objectContaining({ method: "PUT", body: POSTER }),
    );
    expect(updateAttachmentPoster).toHaveBeenCalledWith("attachment-1", POSTER);
  });

  it("tries each clip once per page", async () => {
    extractPosterFromUrl.mockResolvedValue(POSTER);
    const { editor } = mountEditor();
    const mediaId = `med_${nextMediaId++}`;

    reportMissing(editor, mediaId);
    reportMissing(editor, mediaId);
    await settle();

    expect(extractPosterFromUrl).toHaveBeenCalledTimes(1);
  });

  it("leaves the card alone when the poster could not be saved", async () => {
    extractPosterFromUrl.mockResolvedValue(POSTER);
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: "Nope", code: "VALIDATION" }), {
        status: 400,
      }),
    );
    const { editor, updateAttachmentPoster } = mountEditor();

    reportMissing(editor, `med_${nextMediaId++}`);
    await settle();

    expect(updateAttachmentPoster).not.toHaveBeenCalled();
  });

  it("stores nothing when the browser could not make a poster", async () => {
    extractPosterFromUrl.mockResolvedValue(undefined);
    const { editor, updateAttachmentPoster } = mountEditor();

    reportMissing(editor, `med_${nextMediaId++}`);
    await settle();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(updateAttachmentPoster).not.toHaveBeenCalled();
  });
});
