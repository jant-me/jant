/**
 * A file sent to the Telegram bot arrives with whatever MIME type the sender's
 * client claimed. Ingesting it must follow the browser upload rules, or an
 * `.html` or `.svg` file forwarded to the bot ends up served inline on the
 * site's own origin.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createTestDatabase,
  DEFAULT_TEST_SITE_ID,
} from "../../__tests__/helpers/db.js";
import type { Database } from "../../db/index.js";
import type { StorageDriver } from "../../lib/storage.js";
import type { MediaService } from "../media.js";
import { createTelegramService } from "../telegram.js";

const PNG_BYTES = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0,
]);
const HTML_BYTES = new TextEncoder().encode("<script>alert(1)</script>");

function stubTelegram(bytes: Uint8Array) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url.endsWith("/getFile")) {
        return Response.json({
          ok: true,
          result: { file_id: "f", file_path: "documents/file" },
        });
      }
      return new Response(bytes);
    }),
  );
}

function ingest(mimeType: string, bytes: Uint8Array) {
  stubTelegram(bytes);
  const { db } = createTestDatabase();
  const service = createTelegramService(
    db as unknown as Database,
    DEFAULT_TEST_SITE_ID,
  );
  const put = vi.fn(async () => {});
  const media = {
    assertCanWriteBytes: vi.fn(async () => {}),
    create: vi.fn(async (input: Record<string, unknown>) => input),
  } as unknown as MediaService;

  const result = service.ingestMediaFile(
    {
      botToken: "1:secret",
      fileId: "f",
      originalName: "file",
      mimeType,
      mediaKind: mimeType.startsWith("image/") ? "image" : "text",
    },
    {
      storage: { put } as unknown as StorageDriver,
      storageDriver: "local",
      maxFileSizeMB: 10,
      media,
    },
  );
  return { result, put };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ingesting a file sent to the Telegram bot", () => {
  it("stores an HTML file as a download", async () => {
    const { result, put } = ingest("text/html", HTML_BYTES);
    await result;

    expect(put).toHaveBeenCalledWith(
      expect.any(String),
      HTML_BYTES,
      expect.objectContaining({ contentDisposition: "attachment" }),
    );
  });

  it("stores an SVG as a download", async () => {
    const { result, put } = ingest("image/svg+xml", HTML_BYTES);
    await result;

    expect(put).toHaveBeenCalledWith(
      expect.any(String),
      HTML_BYTES,
      expect.objectContaining({ contentDisposition: "attachment" }),
    );
  });

  it("shows a real PNG inline", async () => {
    const { result, put } = ingest("image/png", PNG_BYTES);
    await result;

    expect(put).toHaveBeenCalledWith(
      expect.any(String),
      PNG_BYTES,
      expect.objectContaining({ contentDisposition: "inline" }),
    );
  });

  it("refuses a file that claims to be a PNG but isn't", async () => {
    const { result, put } = ingest("image/png", HTML_BYTES);

    await expect(result).rejects.toThrow("PNG");
    expect(put).not.toHaveBeenCalled();
  });
});
