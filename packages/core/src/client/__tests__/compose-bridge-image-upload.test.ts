// @vitest-environment happy-dom

/**
 * Selecting a photo used to fetch the 3MB HEIC decoder and read the whole
 * file into memory just to check four bytes of it, then decode the processed
 * image a second time for its blurhash. The bridge now sniffs the header
 * itself, imports `heic-to` only for a real HEIC, and takes the blurhash the
 * processor already sampled.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const processToFile = vi.fn();
const uploadViaSession = vi.fn();
const heicTo = vi.fn();
const heicToImports = { count: 0 };

vi.mock("../image-processor.js", () => ({
  ImageProcessor: {
    processToFile: (...args: unknown[]) => processToFile(...args),
  },
}));

vi.mock("../upload-session.js", () => ({
  uploadViaSession: (...args: unknown[]) => uploadViaSession(...args),
}));

vi.mock("heic-to", () => {
  heicToImports.count += 1;
  return { heicTo: (...args: unknown[]) => heicTo(...args) };
});

await import("../compose-bridge.js");

const PROCESSED = new File(["webp"], "photo.webp", { type: "image/webp" });
const BLURHASH = "LEHV6nWB2yk8pyo0adR*.7kCMdnj";

function jpegFile() {
  return new File(
    [new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0])],
    "photo.jpg",
    {
      type: "image/jpeg",
    },
  );
}

function heicFile() {
  const bytes = new Uint8Array(16);
  bytes.set([...new TextEncoder().encode("ftyp")], 4);
  bytes.set([...new TextEncoder().encode("heic")], 8);
  return new File([bytes], "IMG_0001.HEIC", { type: "image/heic" });
}

function selectFile(file: File) {
  document.dispatchEvent(
    new CustomEvent("jant:files-selected", {
      detail: { files: [{ file, clientId: "attachment-1" }] },
    }),
  );
}

async function settle() {
  for (let i = 0; i < 10; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

describe("compose bridge image upload", () => {
  beforeEach(() => {
    processToFile.mockReset().mockResolvedValue({
      file: PROCESSED,
      width: 1200,
      height: 900,
      blurhash: BLURHASH,
    });
    uploadViaSession.mockReset().mockResolvedValue({
      id: "med_1",
      filename: "photo.webp",
      url: "/media/photo.webp",
      mimeType: "image/webp",
      size: 4,
    });
    heicTo
      .mockReset()
      .mockResolvedValue(new Blob(["jpeg"], { type: "image/jpeg" }));
  });

  it("uploads a JPEG with the processor's blurhash and never loads heic-to", async () => {
    const file = jpegFile();

    selectFile(file);
    await settle();

    expect(heicToImports.count).toBe(0);
    expect(heicTo).not.toHaveBeenCalled();
    expect(processToFile).toHaveBeenCalledWith(file);
    expect(uploadViaSession).toHaveBeenCalledTimes(1);
    expect(uploadViaSession.mock.calls[0][0]).toBe(PROCESSED);
    expect(uploadViaSession.mock.calls[0][1]).toMatchObject({
      width: 1200,
      height: 900,
      blurhash: BLURHASH,
    });
  });

  it("converts a file whose bytes say HEIC before processing it", async () => {
    selectFile(heicFile());
    await settle();

    expect(heicToImports.count).toBe(1);
    expect(heicTo).toHaveBeenCalledWith(
      expect.objectContaining({ type: "image/jpeg" }),
    );
    const converted = processToFile.mock.calls[0][0] as File;
    expect(converted.name).toBe("IMG_0001.jpg");
    expect(converted.type).toBe("image/jpeg");
    expect(uploadViaSession.mock.calls[0][1]).toMatchObject({
      blurhash: BLURHASH,
    });
  });
});
