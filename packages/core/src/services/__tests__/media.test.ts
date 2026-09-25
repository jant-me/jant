/* eslint-disable @typescript-eslint/no-non-null-assertion -- Test assertions use ! for readability */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import {
  createTestDatabase,
  DEFAULT_TEST_SITE_ID,
} from "../../__tests__/helpers/db.js";
import { createMediaService } from "../media.js";
import { createPostService } from "../post.js";
import type { Database } from "../../db/index.js";
import { storagePurge } from "../../db/schema.js";
import { MediaQuotaExceededError } from "../../lib/errors.js";
import { now } from "../../lib/time.js";

interface MockStorageFile {
  body: Uint8Array;
  contentType?: string;
  contentDisposition?: string;
  cacheControl?: string;
}

function createMockStorage() {
  const files = new Map<string, MockStorageFile>();

  return {
    files,
    async put(
      key: string,
      body: Uint8Array | ReadableStream,
      opts?: {
        contentType?: string;
        contentDisposition?: string;
        cacheControl?: string;
      },
    ) {
      const bytes =
        body instanceof Uint8Array
          ? body
          : new Uint8Array(await new Response(body).arrayBuffer());
      files.set(key, {
        body: bytes,
        contentType: opts?.contentType,
        contentDisposition: opts?.contentDisposition,
        cacheControl: opts?.cacheControl,
      });
    },
    async get(key: string) {
      const file = files.get(key);
      if (!file) return null;
      return {
        body: new Response(file.body).body as ReadableStream,
        contentType: file.contentType,
        contentDisposition: file.contentDisposition,
        cacheControl: file.cacheControl,
      };
    },
    async delete(key: string) {
      files.delete(key);
    },
    async copy(sourceKey: string, destKey: string) {
      const file = files.get(sourceKey);
      if (file) files.set(destKey, { ...file });
    },
  };
}

/** Storage mock without server-side copy (e.g. R2 Workers binding). */
function createNoCopyStorage() {
  const full = createMockStorage();
  const { copy: _copy, ...rest } = full;
  void _copy;
  return rest;
}

describe("MediaService", () => {
  let db: Database;
  let mediaService: ReturnType<typeof createMediaService>;
  let postService: ReturnType<typeof createPostService>;

  beforeEach(() => {
    const testDb = createTestDatabase();
    db = testDb.db as unknown as Database;
    mediaService = createMediaService(db, DEFAULT_TEST_SITE_ID);
    postService = createPostService(
      db,
      { slugIdLength: 5 },
      DEFAULT_TEST_SITE_ID,
    );
  });

  const sampleMedia = {
    filename: "0192a9f1-a2b7-7c3d-8e4f-5a6b7c8d9e0f.jpg",
    originalName: "photo.jpg",
    mimeType: "image/jpeg",
    size: 102400,
    storageKey: "media/0192a9f1-a2b7-7c3d-8e4f-5a6b7c8d9e0f.jpg",
    width: 1920,
    height: 1080,
  };

  describe("assertCanWriteBytes", () => {
    it("is a no-op when hosted quota enforcement is disabled", async () => {
      await expect(
        mediaService.assertCanWriteBytes(1024),
      ).resolves.toBeUndefined();
    });

    it("delegates hosted quota checks to the control plane when enabled", async () => {
      const checkMediaWriteQuota = vi.fn(async () => ({
        allowed: true,
        limitBytes: 50_000,
        remainingBytes: 40_000,
        usedBytes: 10_000,
      }));
      const hostedQuotaService = createMediaService(
        db,
        DEFAULT_TEST_SITE_ID,
        undefined,
        undefined,
        {
          enforceHostedQuota: true,
          hostedControlPlane: {
            checkMediaWriteQuota,
            async syncSiteMetadata() {},
          },
        },
      );

      await expect(
        hostedQuotaService.assertCanWriteBytes(2048),
      ).resolves.toBeUndefined();
      expect(checkMediaWriteQuota).toHaveBeenCalledWith({
        additionalBytes: 2048,
        coreSiteId: DEFAULT_TEST_SITE_ID,
      });
    });

    it("throws when a hosted upload would exceed the shared quota", async () => {
      const hostedQuotaService = createMediaService(
        db,
        DEFAULT_TEST_SITE_ID,
        undefined,
        undefined,
        {
          enforceHostedQuota: true,
          hostedControlPlane: {
            async checkMediaWriteQuota() {
              return {
                allowed: false,
                limitBytes: 50_000,
                remainingBytes: 0,
                usedBytes: 50_000,
              };
            },
            async syncSiteMetadata() {},
          },
        },
      );

      await expect(
        hostedQuotaService.assertCanWriteBytes(2048),
      ).rejects.toBeInstanceOf(MediaQuotaExceededError);
    });
  });

  describe("create", () => {
    it("creates a media record with all fields", async () => {
      const media = await mediaService.create(sampleMedia);

      expect(media.id).toBeTruthy(); // TypeID
      expect(media.filename).toBe("0192a9f1-a2b7-7c3d-8e4f-5a6b7c8d9e0f.jpg");
      expect(media.originalName).toBe("photo.jpg");
      expect(media.mimeType).toBe("image/jpeg");
      expect(media.size).toBe(102400);
      expect(media.storageKey).toBe(
        "media/0192a9f1-a2b7-7c3d-8e4f-5a6b7c8d9e0f.jpg",
      );
      expect(media.provider).toBe("r2");
      expect(media.width).toBe(1920);
      expect(media.height).toBe(1080);
      expect(media.postId).toBeNull();
      expect(media.alt).toBeNull();
      expect(media.position).toBe("a0");
      expect(media.blurhash).toBeNull();
      expect(media.posterKey).toBeNull();
    });

    it("creates media with posterKey", async () => {
      const media = await mediaService.create({
        ...sampleMedia,
        storageKey: "media/video.mp4",
        posterKey: "media/video.poster.webp",
      });

      expect(media.posterKey).toBe("media/video.poster.webp");
    });

    it("creates media with optional alt text", async () => {
      const media = await mediaService.create({
        ...sampleMedia,
        alt: "A beautiful sunset",
      });

      expect(media.alt).toBe("A beautiful sunset");
    });

    it("defaults provider to 'r2'", async () => {
      const media = await mediaService.create(sampleMedia);
      expect(media.provider).toBe("r2");
    });

    it("accepts provider 's3'", async () => {
      const media = await mediaService.create({
        ...sampleMedia,
        storageKey: "media/s3-upload.jpg",
        provider: "s3",
      });
      expect(media.provider).toBe("s3");
    });

    it("rejects unsupported storage providers", async () => {
      await expect(
        mediaService.create({
          ...sampleMedia,
          storageKey: "media/bad-provider.jpg",
          provider: "gcs" as never,
        }),
      ).rejects.toThrow("Storage provider must be r2, s3, or local.");
    });

    it("rejects unsupported media kinds", async () => {
      await expect(
        mediaService.create({
          ...sampleMedia,
          storageKey: "media/bad-kind.jpg",
          mediaKind: "binary" as never,
        }),
      ).rejects.toThrow(
        "Media kind must be image, video, audio, text, or document.",
      );
    });

    it("creates media with position and blurhash", async () => {
      const media = await mediaService.create({
        ...sampleMedia,
        position: "a3",
        blurhash: "LKO2?U%2Tw=w]~RBVZRi};RPxuwH",
      });

      expect(media.position).toBe("a3");
      expect(media.blurhash).toBe("LKO2?U%2Tw=w]~RBVZRi};RPxuwH");
    });

    it("appends position when creating media already attached to a post", async () => {
      const post = await postService.create({
        format: "note",
        bodyMarkdown: "test",
      });

      const media1 = await mediaService.create({
        ...sampleMedia,
        postId: post.id,
      });
      const media2 = await mediaService.create({
        ...sampleMedia,
        postId: post.id,
        storageKey: "media/second.jpg",
      });

      expect(media1.position).toBe("a0");
      expect(media2.position).toBe("a1");
    });

    it("generates sortable TypeIDs", async () => {
      const media1 = await mediaService.create(sampleMedia);
      const media2 = await mediaService.create({
        ...sampleMedia,
        storageKey: "media/other.jpg",
      });

      expect(media1.id).not.toBe(media2.id);
      // TypeIDs remain lexicographically sortable because they preserve time ordering.
      expect(media2.id > media1.id).toBe(true);
    });

    it("uses provided id when given", async () => {
      const customId = "med_01jpyxdk1m7w4v8s2r5c9b3qfh";
      const media = await mediaService.create({
        ...sampleMedia,
        id: customId,
      });

      expect(media.id).toBe(customId);
    });

    it("auto-generates id when not provided", async () => {
      const media = await mediaService.create({
        ...sampleMedia,
        storageKey: "media/auto.jpg",
      });

      expect(media.id).toBeTruthy();
      expect(media.id).toMatch(/^med_[a-z0-9]{26}$/);
    });

    it("rejects non-positive sizes at the database layer", async () => {
      await expect(
        mediaService.create({
          ...sampleMedia,
          storageKey: "media/invalid-size.jpg",
          size: 0,
        }),
      ).rejects.toThrow();
    });

    it("rejects blank positions at the database layer", async () => {
      await expect(
        mediaService.create({
          ...sampleMedia,
          storageKey: "media/invalid-position.jpg",
          position: "   ",
        }),
      ).rejects.toThrow();
    });

    it("rejects non-positive dimensions at the database layer", async () => {
      await expect(
        mediaService.create({
          ...sampleMedia,
          storageKey: "media/invalid-dimensions.jpg",
          width: 0,
        }),
      ).rejects.toThrow();
    });

    it("rejects negative extracted text length at the database layer", async () => {
      await expect(
        mediaService.create({
          ...sampleMedia,
          storageKey: "media/invalid-chars.jpg",
          chars: -1,
        }),
      ).rejects.toThrow();
    });
  });

  describe("createTextAttachment", () => {
    it("writes a single .md file with the right mime, cache, and disposition", async () => {
      const storage = createMockStorage();

      const media = await mediaService.createTextAttachment(
        {
          contentFormat: "markdown",
          content: "# Heading\n\nBody text",
        },
        {
          storage,
          storageDriver: "local",
          maxFileSizeMB: 1,
        },
      );

      expect(media.mimeType).toBe("text/markdown; charset=utf-8");
      expect(media.mediaKind).toBe("text");
      expect(media.provider).toBe("local");
      expect(media.summary).toBe("Heading Body text");
      expect(media.chars).toBe(17);
      expect(media.originalName).toBe("attached-text.md");
      expect(media.storageKey.endsWith(".md")).toBe(true);

      // Exactly one storage object — no sibling, no rendered HTML copy.
      expect(storage.files.size).toBe(1);

      const file = storage.files.get(media.storageKey);
      expect(file).toBeDefined();
      expect(file!.contentType).toBe("text/markdown; charset=utf-8");
      expect(file!.cacheControl).toBe("public, max-age=31536000, immutable");
      expect(file!.contentDisposition).toBe("inline");

      // Stored bytes are the raw markdown, identical to input.
      expect(new TextDecoder().decode(file!.body)).toBe(
        "# Heading\n\nBody text",
      );
    });

    it("sets media.size to the markdown byte length", async () => {
      const storage = createMockStorage();
      const media = await mediaService.createTextAttachment(
        {
          contentFormat: "markdown",
          content: "# Heading\n\nBody text",
        },
        {
          storage,
          storageDriver: "local",
          maxFileSizeMB: 1,
        },
      );
      const file = storage.files.get(media.storageKey);
      expect(media.size).toBe(file!.body.byteLength);
    });

    it("rejects non-markdown input formats", async () => {
      const storage = createMockStorage();
      await expect(
        mediaService.createTextAttachment(
          {
            contentFormat: "html" as never,
            content: "<p>hi</p>",
          },
          {
            storage,
            storageDriver: "local",
            maxFileSizeMB: 1,
          },
        ),
      ).rejects.toThrow("Unsupported text attachment format");
    });
  });

  describe("getTextAttachmentContent", () => {
    it("returns the markdown source straight from storage", async () => {
      const storage = createMockStorage();
      const media = await mediaService.createTextAttachment(
        {
          contentFormat: "markdown",
          content: "# Heading\n\nBody text",
        },
        {
          storage,
          storageDriver: "local",
          maxFileSizeMB: 1,
        },
      );

      const content = await mediaService.getTextAttachmentContent(
        media.id,
        storage,
      );

      expect(content).toEqual({
        id: media.id,
        type: "text",
        contentFormat: "markdown",
        content: "# Heading\n\nBody text",
        summary: "Heading Body text",
        chars: 17,
      });
    });

    it("returns null when the storage object is missing", async () => {
      const storage = createMockStorage();
      const media = await mediaService.createTextAttachment(
        {
          contentFormat: "markdown",
          content: "hello",
        },
        {
          storage,
          storageDriver: "local",
          maxFileSizeMB: 1,
        },
      );

      await storage.delete(media.storageKey);

      await expect(
        mediaService.getTextAttachmentContent(media.id, storage),
      ).resolves.toBeNull();
    });

    it("returns null for non-text attachments", async () => {
      const media = await mediaService.create(sampleMedia);
      const storage = createMockStorage();

      await expect(
        mediaService.getTextAttachmentContent(media.id, storage),
      ).resolves.toBeNull();
    });
  });

  describe("getTextAttachmentHtml", () => {
    it("renders HTML from the stored markdown on the fly", async () => {
      const storage = createMockStorage();
      const media = await mediaService.createTextAttachment(
        {
          contentFormat: "markdown",
          content: "# Heading\n\nBody text",
        },
        {
          storage,
          storageDriver: "local",
          maxFileSizeMB: 1,
        },
      );

      const result = await mediaService.getTextAttachmentHtml(
        media.id,
        storage,
      );

      expect(result).not.toBeNull();
      expect(result!.id).toBe(media.id);
      expect(result!.html).toContain("<h1");
      expect(result!.html).toContain("Heading");
      expect(result!.summary).toBe("Heading Body text");
      expect(result!.chars).toBe(17);
    });

    it("returns null for non-text attachments", async () => {
      const storage = createMockStorage();
      const media = await mediaService.create(sampleMedia);

      await expect(
        mediaService.getTextAttachmentHtml(media.id, storage),
      ).resolves.toBeNull();
    });
  });

  describe("delete for text attachments", () => {
    it("moves the .md object to trash and frees the original key", async () => {
      const storage = createMockStorage();
      const media = await mediaService.createTextAttachment(
        {
          contentFormat: "markdown",
          content: "goodbye",
        },
        {
          storage,
          storageDriver: "local",
          maxFileSizeMB: 1,
        },
      );

      expect(storage.files.size).toBe(1);

      await mediaService.delete(media.id, storage);

      // Row gone and the original (public) key freed immediately; the bytes
      // live on under a trash/ key, recoverable until purge.
      expect(await mediaService.getById(media.id)).toBeNull();
      expect(storage.files.has(media.storageKey)).toBe(false);
      expect(
        [...storage.files.keys()].some((k) => k.startsWith("trash/")),
      ).toBe(true);
    });
  });

  describe("deleteByIds for text attachments", () => {
    it("moves every .md object in the batch to trash", async () => {
      const storage = createMockStorage();
      const a = await mediaService.createTextAttachment(
        { contentFormat: "markdown", content: "first" },
        { storage, storageDriver: "local", maxFileSizeMB: 1 },
      );
      const b = await mediaService.createTextAttachment(
        { contentFormat: "markdown", content: "second" },
        { storage, storageDriver: "local", maxFileSizeMB: 1 },
      );

      expect(storage.files.size).toBe(2);

      await mediaService.deleteByIds([a.id, b.id], storage);

      expect(await mediaService.getById(a.id)).toBeNull();
      expect(await mediaService.getById(b.id)).toBeNull();
      // Originals freed; two trash copies remain until the purge sweep.
      expect(storage.files.has(a.storageKey)).toBe(false);
      expect(storage.files.has(b.storageKey)).toBe(false);
      expect(
        [...storage.files.keys()].filter((k) => k.startsWith("trash/")).length,
      ).toBe(2);
    });
  });

  describe("migrateLegacyTextAttachments", () => {
    /**
     * Seed a row representing the envelope-era format (single JSON blob with
     * `{ json, html }`), bypassing the current service APIs.
     */
    async function seedEnvelopeRow(
      storage: ReturnType<typeof createMockStorage>,
      key: string,
      envelope: { json: unknown; html: string },
    ) {
      const bytes = new TextEncoder().encode(JSON.stringify(envelope));
      await storage.put(key, bytes, { contentType: "text/x-tiptap+json" });
      return mediaService.create({
        filename: key.split("/").pop() ?? "attached-text.md",
        originalName: "attached-text.md",
        mimeType: "text/x-tiptap+json",
        size: bytes.byteLength,
        storageKey: key,
        provider: "local",
        mediaKind: "text",
        summary: "Legacy envelope",
        chars: 10,
      });
    }

    /**
     * Seed a row representing the split-era format (`.html` primary object
     * with a `.json` sibling at the swapped suffix), bypassing current APIs.
     */
    async function seedSplitRow(
      storage: ReturnType<typeof createMockStorage>,
      htmlKey: string,
      json: unknown,
      html: string,
    ) {
      const jsonKey = htmlKey.replace(/\.html$/, ".json");
      const htmlBytes = new TextEncoder().encode(html);
      const jsonBytes = new TextEncoder().encode(JSON.stringify(json));
      await storage.put(jsonKey, jsonBytes, {
        contentType: "application/json",
      });
      await storage.put(htmlKey, htmlBytes, {
        contentType: "text/html; charset=utf-8",
      });
      return mediaService.create({
        filename: htmlKey.split("/").pop() ?? "attached-text.html",
        originalName: "attached-text.html",
        mimeType: "text/html; charset=utf-8",
        size: htmlBytes.byteLength,
        storageKey: htmlKey,
        provider: "local",
        mediaKind: "text",
        summary: "Legacy split",
        chars: 10,
      });
    }

    it("converts an envelope row into a single .md file", async () => {
      const storage = createMockStorage();
      // Real legacy envelopes were named `attached-text.md` — so their
      // storageKey already ends in `.md`. Migration overwrites the same
      // key with markdown bytes rather than writing a new file; this is
      // fine because the DB row still points at the same key and the old
      // envelope contents are gone.
      const legacyKey = "media/legacy-env.md";
      const envelope = {
        json: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "Hello" }],
            },
          ],
        },
        html: "<p>Hello</p>",
      };
      const row = await seedEnvelopeRow(storage, legacyKey, envelope);

      const result = await mediaService.migrateLegacyTextAttachments({
        storage,
        storageDriver: "local",
      });

      expect(result).toEqual({
        migrated: 1,
        failed: 0,
        remaining: 0,
        errors: [],
      });

      // Exactly one storage object — the same key, now with markdown bytes
      // and markdown metadata. The old envelope JSON is gone (overwritten).
      expect(storage.files.size).toBe(1);
      const file = storage.files.get(legacyKey)!;
      expect(file.contentType).toBe("text/markdown; charset=utf-8");
      expect(file.cacheControl).toBe("public, max-age=31536000, immutable");
      expect(file.contentDisposition).toBe("inline");
      const mdText = new TextDecoder().decode(file.body);
      expect(mdText).toContain("Hello");
      // Sanity check: no trace of the envelope JSON structure.
      expect(mdText.trim().startsWith("{")).toBe(false);

      const updated = await mediaService.getById(row.id);
      expect(updated?.storageKey).toBe(legacyKey);
      expect(updated?.mimeType).toBe("text/markdown; charset=utf-8");
      expect(updated?.originalName).toBe("attached-text.md");
      expect(updated?.size).toBe(file.body.byteLength);
      expect(updated?.filename).toBe("legacy-env.md");
    });

    it("converts a split (.html + .json) row into a single .md file", async () => {
      const storage = createMockStorage();
      const htmlKey = "media/legacy-split.html";
      const jsonKey = "media/legacy-split.json";
      const row = await seedSplitRow(
        storage,
        htmlKey,
        {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "split world" }],
            },
          ],
        },
        "<p>split world</p>",
      );

      const result = await mediaService.migrateLegacyTextAttachments({
        storage,
        storageDriver: "local",
      });

      expect(result.migrated).toBe(1);
      expect(result.failed).toBe(0);
      expect(result.remaining).toBe(0);

      // Both old siblings gone; single .md written.
      expect(storage.files.has(htmlKey)).toBe(false);
      expect(storage.files.has(jsonKey)).toBe(false);
      const mdKey = "media/legacy-split.md";
      expect(storage.files.has(mdKey)).toBe(true);

      const file = storage.files.get(mdKey)!;
      const mdText = new TextDecoder().decode(file.body);
      expect(mdText).toContain("split world");

      const updated = await mediaService.getById(row.id);
      expect(updated?.storageKey).toBe(mdKey);
      expect(updated?.mimeType).toBe("text/markdown; charset=utf-8");
    });

    it("is idempotent: current markdown rows are skipped", async () => {
      const storage = createMockStorage();
      await seedEnvelopeRow(storage, "media/legacy-idemp.md", {
        json: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "hello" }],
            },
          ],
        },
        html: "<p>hello</p>",
      });

      const first = await mediaService.migrateLegacyTextAttachments({
        storage,
        storageDriver: "local",
      });
      expect(first.migrated).toBe(1);

      const second = await mediaService.migrateLegacyTextAttachments({
        storage,
        storageDriver: "local",
      });
      expect(second).toEqual({
        migrated: 0,
        failed: 0,
        remaining: 0,
        errors: [],
      });
    });

    it("respects the batch limit and reports remaining count accurately", async () => {
      const storage = createMockStorage();
      for (let i = 0; i < 3; i += 1) {
        await seedEnvelopeRow(storage, `media/legacy-batch-${i}.md`, {
          json: {
            type: "doc",
            content: [
              {
                type: "paragraph",
                content: [{ type: "text", text: `batch ${i}` }],
              },
            ],
          },
          html: `<p>batch ${i}</p>`,
        });
      }

      const first = await mediaService.migrateLegacyTextAttachments({
        storage,
        storageDriver: "local",
        limit: 2,
      });
      expect(first.migrated).toBe(2);
      expect(first.remaining).toBeGreaterThan(0);

      const second = await mediaService.migrateLegacyTextAttachments({
        storage,
        storageDriver: "local",
        limit: 2,
      });
      expect(second.migrated).toBe(1);
      expect(second.remaining).toBe(0);
    });

    it("continues processing the batch when one record fails", async () => {
      const storage = createMockStorage();
      await seedEnvelopeRow(storage, "media/legacy-good.md", {
        json: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "good" }],
            },
          ],
        },
        html: "<p>good</p>",
      });
      // Broken envelope — missing json field.
      const brokenKey = "media/legacy-broken.md";
      const brokenBytes = new TextEncoder().encode(
        JSON.stringify({ html: "<p>broken</p>" }),
      );
      await storage.put(brokenKey, brokenBytes, {
        contentType: "text/x-tiptap+json",
      });
      const brokenRow = await mediaService.create({
        filename: "legacy-broken.md",
        originalName: "attached-text.md",
        mimeType: "text/x-tiptap+json",
        size: brokenBytes.byteLength,
        storageKey: brokenKey,
        provider: "local",
        mediaKind: "text",
        summary: "Broken",
        chars: 1,
      });

      const result = await mediaService.migrateLegacyTextAttachments({
        storage,
        storageDriver: "local",
      });

      expect(result.migrated).toBe(1);
      expect(result.failed).toBe(1);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].mediaId).toBe(brokenRow.id);

      // Broken record is untouched and still flagged as legacy for later retry.
      const stillBroken = await mediaService.getById(brokenRow.id);
      expect(stillBroken?.mimeType).toBe("text/x-tiptap+json");
    });
  });

  describe("getById", () => {
    it("returns media by ID", async () => {
      const created = await mediaService.create(sampleMedia);

      const found = await mediaService.getById(created.id);
      expect(found).not.toBeNull();
      expect(found?.filename).toBe("0192a9f1-a2b7-7c3d-8e4f-5a6b7c8d9e0f.jpg");
    });

    it("returns null for non-existent ID", async () => {
      const found = await mediaService.getById("nonexistent-id");
      expect(found).toBeNull();
    });
  });

  describe("getByIds", () => {
    it("returns media for valid IDs", async () => {
      const m1 = await mediaService.create({
        ...sampleMedia,
        storageKey: "media/a.jpg",
      });
      const m2 = await mediaService.create({
        ...sampleMedia,
        storageKey: "media/b.jpg",
      });

      const results = await mediaService.getByIds([m1.id, m2.id]);
      expect(results).toHaveLength(2);
      expect(results.map((r) => r.id).sort()).toEqual([m1.id, m2.id].sort());
    });

    it("returns empty array for empty input", async () => {
      const results = await mediaService.getByIds([]);
      expect(results).toEqual([]);
    });

    it("ignores non-existent IDs", async () => {
      const m1 = await mediaService.create(sampleMedia);

      const results = await mediaService.getByIds([m1.id, "nonexistent"]);
      expect(results).toHaveLength(1);
      expect(results[0]!.id).toBe(m1.id);
    });
  });

  describe("getByPostId", () => {
    it("returns media ordered by position", async () => {
      const post = await postService.create({
        format: "note",
        bodyMarkdown: "test",
      });

      const m1 = await mediaService.create({
        ...sampleMedia,
        storageKey: "media/a.jpg",
      });
      const m2 = await mediaService.create({
        ...sampleMedia,
        storageKey: "media/b.jpg",
      });

      await mediaService.attachToPost(post.id, [m2.id, m1.id]);

      const results = await mediaService.getByPostId(post.id);
      expect(results).toHaveLength(2);
      expect(results[0]!.id).toBe(m2.id);
      expect(results[0]!.position).toBe("a0");
      expect(results[1]!.id).toBe(m1.id);
      expect(results[1]!.position).toBe("a1");
    });

    it("returns empty array for post with no media", async () => {
      const post = await postService.create({
        format: "note",
        bodyMarkdown: "test",
      });

      const results = await mediaService.getByPostId(post.id);
      expect(results).toEqual([]);
    });
  });

  describe("getByPostIds", () => {
    it("returns Map grouped by postId", async () => {
      const post1 = await postService.create({
        format: "note",
        bodyMarkdown: "post 1",
      });
      const post2 = await postService.create({
        format: "note",
        bodyMarkdown: "post 2",
      });

      const m1 = await mediaService.create({
        ...sampleMedia,
        storageKey: "media/a.jpg",
      });
      const m2 = await mediaService.create({
        ...sampleMedia,
        storageKey: "media/b.jpg",
      });
      const m3 = await mediaService.create({
        ...sampleMedia,
        storageKey: "media/c.jpg",
      });

      await mediaService.attachToPost(post1.id, [m1.id, m2.id]);
      await mediaService.attachToPost(post2.id, [m3.id]);

      const results = await mediaService.getByPostIds([post1.id, post2.id]);
      expect(results.size).toBe(2);
      expect(results.get(post1.id)).toHaveLength(2);
      expect(results.get(post2.id)).toHaveLength(1);
    });

    it("returns empty Map for empty input", async () => {
      const results = await mediaService.getByPostIds([]);
      expect(results.size).toBe(0);
    });

    it("returns ordered by position within each post", async () => {
      const post = await postService.create({
        format: "note",
        bodyMarkdown: "test",
      });

      const m1 = await mediaService.create({
        ...sampleMedia,
        storageKey: "media/a.jpg",
      });
      const m2 = await mediaService.create({
        ...sampleMedia,
        storageKey: "media/b.jpg",
      });

      await mediaService.attachToPost(post.id, [m2.id, m1.id]);

      const results = await mediaService.getByPostIds([post.id]);
      const postMedia = results.get(post.id)!;
      expect(postMedia[0]!.id).toBe(m2.id);
      expect(postMedia[1]!.id).toBe(m1.id);
    });
  });

  describe("listOrphanedMediaIds", () => {
    it("returns unattached media created before the cutoff", async () => {
      const m1 = await mediaService.create({
        ...sampleMedia,
        storageKey: "media/a.jpg",
      });
      const m2 = await mediaService.create({
        ...sampleMedia,
        storageKey: "media/b.jpg",
      });

      const ids = await mediaService.listOrphanedMediaIds({
        before: now() + 1,
        limit: 10,
      });

      expect(ids).toHaveLength(2);
      expect(ids).toContain(m1.id);
      expect(ids).toContain(m2.id);
    });

    it("excludes media attached to a post", async () => {
      const post = await postService.create({
        format: "note",
        bodyMarkdown: "p",
      });
      const attached = await mediaService.create({
        ...sampleMedia,
        storageKey: "media/a.jpg",
      });
      const orphan = await mediaService.create({
        ...sampleMedia,
        storageKey: "media/b.jpg",
      });
      await mediaService.attachToPost(post.id, [attached.id]);

      const ids = await mediaService.listOrphanedMediaIds({
        before: now() + 1,
        limit: 10,
      });

      expect(ids).toEqual([orphan.id]);
    });

    it("excludes site asset media (avatars, favicons) referenced by settings", async () => {
      const orphan = await mediaService.create({
        ...sampleMedia,
        storageKey: "media/site/files/orphan.jpg",
      });
      const avatar = await mediaService.create({
        ...sampleMedia,
        storageKey: "media/site/assets/avatar/avatar.png",
      });
      const favicon = await mediaService.create({
        ...sampleMedia,
        storageKey: "media/site/assets/favicon/apple-touch-icon.png",
      });

      const ids = await mediaService.listOrphanedMediaIds({
        before: now() + 1,
        limit: 10,
      });

      expect(ids).toEqual([orphan.id]);
      expect(ids).not.toContain(avatar.id);
      expect(ids).not.toContain(favicon.id);
    });

    it("excludes media created at or after the cutoff", async () => {
      await mediaService.create({
        ...sampleMedia,
        storageKey: "media/a.jpg",
      });

      const ids = await mediaService.listOrphanedMediaIds({
        before: 1,
        limit: 10,
      });

      expect(ids).toEqual([]);
    });

    it("respects the batch limit", async () => {
      await mediaService.create({ ...sampleMedia, storageKey: "media/a.jpg" });
      await mediaService.create({ ...sampleMedia, storageKey: "media/b.jpg" });

      const ids = await mediaService.listOrphanedMediaIds({
        before: now() + 1,
        limit: 1,
      });

      expect(ids).toHaveLength(1);
    });

    it("returns no IDs when the limit is zero", async () => {
      await mediaService.create({ ...sampleMedia, storageKey: "media/a.jpg" });

      const ids = await mediaService.listOrphanedMediaIds({
        before: now() + 1,
        limit: 0,
      });

      expect(ids).toEqual([]);
    });
  });

  describe("validateIds", () => {
    it("passes for valid IDs", async () => {
      const m1 = await mediaService.create({
        ...sampleMedia,
        storageKey: "media/a.jpg",
      });
      const m2 = await mediaService.create({
        ...sampleMedia,
        storageKey: "media/b.jpg",
      });

      await expect(
        mediaService.validateIds([m1.id, m2.id]),
      ).resolves.not.toThrow();
    });

    it("is a no-op for empty array", async () => {
      await expect(mediaService.validateIds([])).resolves.not.toThrow();
    });

    it("throws ValidationError when count exceeds limit", async () => {
      const ids = Array.from({ length: 21 }, (_, i) => `fake-id-${i}`);
      await expect(mediaService.validateIds(ids)).rejects.toThrow(
        "at most 20 attachments",
      );
    });

    it("throws ValidationError when IDs do not exist", async () => {
      const m1 = await mediaService.create({
        ...sampleMedia,
        storageKey: "media/a.jpg",
      });

      await expect(
        mediaService.validateIds([m1.id, "nonexistent-id"]),
      ).rejects.toThrow("invalid media IDs");
    });

    it("throws ValidationError for all nonexistent IDs", async () => {
      await expect(
        mediaService.validateIds(["fake-1", "fake-2"]),
      ).rejects.toThrow("invalid media IDs");
    });
  });

  describe("getByStorageKey", () => {
    it("returns media by R2 key", async () => {
      await mediaService.create(sampleMedia);

      const found = await mediaService.getByStorageKey(
        "media/0192a9f1-a2b7-7c3d-8e4f-5a6b7c8d9e0f.jpg",
        "r2",
      );
      expect(found).not.toBeNull();
      expect(found?.originalName).toBe("photo.jpg");
    });

    it("returns null for non-existent R2 key", async () => {
      const found = await mediaService.getByStorageKey("nonexistent", "r2");
      expect(found).toBeNull();
    });

    it("allows the same storage key on different providers", async () => {
      await mediaService.create(sampleMedia);
      await mediaService.create({
        ...sampleMedia,
        id: "0192a9f1-a2b7-7c3d-8e4f-5a6b7c8d9e10",
        provider: "s3",
      });

      const r2Media = await mediaService.getByStorageKey(
        sampleMedia.storageKey,
        "r2",
      );
      const s3Media = await mediaService.getByStorageKey(
        sampleMedia.storageKey,
        "s3",
      );

      expect(r2Media?.provider).toBe("r2");
      expect(s3Media?.provider).toBe("s3");
    });
  });

  describe("list", () => {
    it("returns empty array when no media exists", async () => {
      const list = await mediaService.list();
      expect(list).toEqual([]);
    });

    it("returns media ordered by createdAt desc", async () => {
      await mediaService.create({ ...sampleMedia, storageKey: "a.jpg" });
      await mediaService.create({ ...sampleMedia, storageKey: "b.jpg" });

      const list = await mediaService.list();
      expect(list).toHaveLength(2);
    });

    it("respects limit parameter", async () => {
      for (let i = 0; i < 5; i++) {
        await mediaService.create({
          ...sampleMedia,
          storageKey: `img${i}.jpg`,
        });
      }

      const list = await mediaService.list({ limit: 2 });
      expect(list).toHaveLength(2);
    });

    // The API used to stop at 200 items with no way to ask for the rest.
    it("pages through every item with an ID cursor", async () => {
      const created = [];
      for (let i = 0; i < 5; i++) {
        created.push(
          await mediaService.create({
            ...sampleMedia,
            storageKey: `page${i}.jpg`,
          }),
        );
      }
      const newestFirst = created
        .map((media) => media.id)
        .sort()
        .reverse();

      const first = await mediaService.list({ limit: 2 });
      const second = await mediaService.list({
        limit: 2,
        cursor: first.at(-1)?.id,
      });
      const third = await mediaService.list({
        limit: 2,
        cursor: second.at(-1)?.id,
      });

      expect([...first, ...second, ...third].map((media) => media.id)).toEqual(
        newestFirst,
      );
    });
  });

  describe("attachToPost", () => {
    it("sets postId and position for each media", async () => {
      const post = await postService.create({
        format: "note",
        bodyMarkdown: "test",
      });

      const m1 = await mediaService.create({
        ...sampleMedia,
        storageKey: "media/a.jpg",
      });
      const m2 = await mediaService.create({
        ...sampleMedia,
        storageKey: "media/b.jpg",
      });

      await mediaService.attachToPost(post.id, [m1.id, m2.id]);

      const attached = await mediaService.getByPostId(post.id);
      expect(attached).toHaveLength(2);
      expect(attached[0]!.id).toBe(m1.id);
      expect(attached[0]!.position).toBe("a0");
      expect(attached[1]!.id).toBe(m2.id);
      expect(attached[1]!.position).toBe("a1");
    });

    it("replaces existing attachments", async () => {
      const post = await postService.create({
        format: "note",
        bodyMarkdown: "test",
      });

      const m1 = await mediaService.create({
        ...sampleMedia,
        storageKey: "media/a.jpg",
      });
      const m2 = await mediaService.create({
        ...sampleMedia,
        storageKey: "media/b.jpg",
      });
      const m3 = await mediaService.create({
        ...sampleMedia,
        storageKey: "media/c.jpg",
      });

      await mediaService.attachToPost(post.id, [m1.id, m2.id]);
      await mediaService.attachToPost(post.id, [m3.id]);

      const attached = await mediaService.getByPostId(post.id);
      expect(attached).toHaveLength(1);
      expect(attached[0]!.id).toBe(m3.id);
      expect(attached[0]!.position).toBe("a0");

      // Verify old media is detached
      const old1 = await mediaService.getById(m1.id);
      expect(old1!.postId).toBeNull();
      expect(old1!.position).toBe("a0");
    });

    it("handles empty array by clearing all attachments", async () => {
      const post = await postService.create({
        format: "note",
        bodyMarkdown: "test",
      });

      const m1 = await mediaService.create({
        ...sampleMedia,
        storageKey: "media/a.jpg",
      });

      await mediaService.attachToPost(post.id, [m1.id]);
      await mediaService.attachToPost(post.id, []);

      const attached = await mediaService.getByPostId(post.id);
      expect(attached).toHaveLength(0);
    });

    it("does not call transaction() when reordering attachments on sqlite-family backends", async () => {
      const post = await postService.create({
        format: "note",
        bodyMarkdown: "test",
      });

      const m1 = await mediaService.create({
        ...sampleMedia,
        storageKey: "media/sqlite-a.jpg",
      });
      const m2 = await mediaService.create({
        ...sampleMedia,
        storageKey: "media/sqlite-b.jpg",
      });

      const dbWithoutTransaction = db as Database & {
        transaction: () => Promise<never>;
      };
      const originalTransaction = dbWithoutTransaction.transaction.bind(db);
      dbWithoutTransaction.transaction = async () => {
        throw new Error("sqlite attachToPost() should not call transaction()");
      };

      try {
        await expect(
          mediaService.attachToPost(post.id, [m1.id, m2.id]),
        ).resolves.toBeUndefined();
      } finally {
        dbWithoutTransaction.transaction = originalTransaction;
      }
    });
  });

  describe("detachFromPost", () => {
    it("clears postId and resets position", async () => {
      const post = await postService.create({
        format: "note",
        bodyMarkdown: "test",
      });

      const m1 = await mediaService.create({
        ...sampleMedia,
        storageKey: "media/a.jpg",
      });

      await mediaService.attachToPost(post.id, [m1.id]);
      await mediaService.detachFromPost(post.id);

      const attached = await mediaService.getByPostId(post.id);
      expect(attached).toHaveLength(0);

      const detached = await mediaService.getById(m1.id);
      expect(detached!.postId).toBeNull();
      expect(detached!.position).toBe("a0");
    });
  });

  describe("delete", () => {
    it("deletes a media record", async () => {
      const media = await mediaService.create(sampleMedia);

      const result = await mediaService.delete(media.id);
      expect(result).toBe(true);

      const found = await mediaService.getById(media.id);
      expect(found).toBeNull();
    });

    it("returns false for non-existent ID", async () => {
      const result = await mediaService.delete("nonexistent");
      expect(result).toBe(false);
    });

    it("moves storage objects to trash and frees the original keys", async () => {
      const storage = createMockStorage();
      await storage.put("media/vid.mp4", new Uint8Array([1]));
      await storage.put("media/vid.poster.webp", new Uint8Array([2]));
      const media = await mediaService.create({
        ...sampleMedia,
        storageKey: "media/vid.mp4",
        posterKey: "media/vid.poster.webp",
      });

      await mediaService.delete(media.id, storage);

      // Originals freed immediately; both objects moved under trash/.
      expect(storage.files.has("media/vid.mp4")).toBe(false);
      expect(storage.files.has("media/vid.poster.webp")).toBe(false);
      expect(
        [...storage.files.keys()].filter((k) => k.startsWith("trash/")).length,
      ).toBe(2);
    });
  });

  describe("deleteByIds", () => {
    it("deletes multiple media records", async () => {
      const m1 = await mediaService.create({
        ...sampleMedia,
        storageKey: "media/a.jpg",
      });
      const m2 = await mediaService.create({
        ...sampleMedia,
        storageKey: "media/b.jpg",
      });
      const m3 = await mediaService.create({
        ...sampleMedia,
        storageKey: "media/c.jpg",
      });

      await mediaService.deleteByIds([m1.id, m2.id]);

      expect(await mediaService.getById(m1.id)).toBeNull();
      expect(await mediaService.getById(m2.id)).toBeNull();
      expect(await mediaService.getById(m3.id)).not.toBeNull();
    });

    it("handles empty array gracefully", async () => {
      const m1 = await mediaService.create(sampleMedia);

      await mediaService.deleteByIds([]);

      expect(await mediaService.getById(m1.id)).not.toBeNull();
    });

    it("moves storage objects to trash and frees the original keys", async () => {
      const storage = createMockStorage();
      await storage.put("media/a.mp4", new Uint8Array([1]));
      await storage.put("media/a-poster.webp", new Uint8Array([2]));
      await storage.put("media/b.jpg", new Uint8Array([3]));
      const m1 = await mediaService.create({
        ...sampleMedia,
        storageKey: "media/a.mp4",
        posterKey: "media/a-poster.webp",
      });
      const m2 = await mediaService.create({
        ...sampleMedia,
        storageKey: "media/b.jpg",
      });

      await mediaService.deleteByIds([m1.id, m2.id], storage);

      // Three originals freed, three trash copies remain.
      expect(storage.files.has("media/a.mp4")).toBe(false);
      expect(storage.files.has("media/a-poster.webp")).toBe(false);
      expect(storage.files.has("media/b.jpg")).toBe(false);
      expect(
        [...storage.files.keys()].filter((k) => k.startsWith("trash/")).length,
      ).toBe(3);
    });
  });

  describe("storage purge (recycle window)", () => {
    const FAR_FUTURE = () => now() + 365 * 24 * 60 * 60;

    it("moves a deleted object to trash with a recorded original_key", async () => {
      const storage = createMockStorage();
      await storage.put("media/x.jpg", new Uint8Array([1]));
      const m = await mediaService.create({
        ...sampleMedia,
        storageKey: "media/x.jpg",
      });

      await mediaService.delete(m.id, storage);

      const rows = await db
        .select()
        .from(storagePurge)
        .where(eq(storagePurge.siteId, DEFAULT_TEST_SITE_ID));
      expect(rows).toHaveLength(1);
      expect(rows[0]!.originalKey).toBe("media/x.jpg");
      expect(rows[0]!.storageKey.startsWith("trash/")).toBe(true);
      expect(storage.files.has(rows[0]!.storageKey)).toBe(true);
      expect(storage.files.has("media/x.jpg")).toBe(false);
    });

    it("purges trashed objects once due (storageKey + posterKey)", async () => {
      const storage = createMockStorage();
      await storage.put("media/v.mp4", new Uint8Array([1]));
      await storage.put("media/v-poster.webp", new Uint8Array([2]));
      const m = await mediaService.create({
        ...sampleMedia,
        storageKey: "media/v.mp4",
        posterKey: "media/v-poster.webp",
      });
      await mediaService.delete(m.id, storage);

      const purged = await mediaService.purgeDueStorageObjects(
        { before: FAR_FUTURE(), limit: 50, provider: "r2" },
        storage,
      );

      expect(purged).toBe(2);
      expect(storage.files.size).toBe(0);
    });

    it("retains trash whose recycle window has not elapsed", async () => {
      const storage = createMockStorage();
      await storage.put("media/keep.jpg", new Uint8Array([1]));
      const m = await mediaService.create({
        ...sampleMedia,
        storageKey: "media/keep.jpg",
      });
      await mediaService.delete(m.id, storage);

      // before = now → the 30-day-out purge_after is not yet due.
      const purged = await mediaService.purgeDueStorageObjects(
        { before: now(), limit: 50, provider: "r2" },
        storage,
      );

      expect(purged).toBe(0);
      // Original freed, but the trash copy is retained.
      expect(storage.files.has("media/keep.jpg")).toBe(false);
      expect(
        [...storage.files.keys()].some((k) => k.startsWith("trash/")),
      ).toBe(true);
    });

    it("deletes immediately with no recycle when the driver lacks copy", async () => {
      const storage = createNoCopyStorage();
      await storage.put("media/nocopy.jpg", new Uint8Array([1]));
      const m = await mediaService.create({
        ...sampleMedia,
        storageKey: "media/nocopy.jpg",
      });

      await mediaService.delete(m.id, storage);

      // Deleted outright; nothing in trash, nothing queued.
      expect(storage.files.size).toBe(0);
      const rows = await db
        .select()
        .from(storagePurge)
        .where(eq(storagePurge.siteId, DEFAULT_TEST_SITE_ID));
      expect(rows).toHaveLength(0);
    });

    it("respects the batch limit", async () => {
      const storage = createMockStorage();
      await storage.put("media/p1.jpg", new Uint8Array([1]));
      await storage.put("media/p2.jpg", new Uint8Array([2]));
      const m1 = await mediaService.create({
        ...sampleMedia,
        storageKey: "media/p1.jpg",
      });
      const m2 = await mediaService.create({
        ...sampleMedia,
        storageKey: "media/p2.jpg",
      });
      await mediaService.deleteByIds([m1.id, m2.id], storage);

      const purged = await mediaService.purgeDueStorageObjects(
        { before: FAR_FUTURE(), limit: 1, provider: "r2" },
        storage,
      );

      expect(purged).toBe(1);
      // One trash object purged, one remains.
      expect(
        [...storage.files.keys()].filter((k) => k.startsWith("trash/")).length,
      ).toBe(1);
    });
  });
});

/** Minimal valid PNG header (signature + IHDR with width 4, height 6). */
function createPngBytes(): Uint8Array {
  return new Uint8Array([
    0x89,
    0x50,
    0x4e,
    0x47,
    0x0d,
    0x0a,
    0x1a,
    0x0a, // signature
    0x00,
    0x00,
    0x00,
    0x0d, // IHDR length (13)
    0x49,
    0x48,
    0x44,
    0x52, // "IHDR"
    0x00,
    0x00,
    0x00,
    0x04, // width = 4
    0x00,
    0x00,
    0x00,
    0x06, // height = 6
    0x08,
    0x06,
    0x00,
    0x00,
    0x00, // bit depth, color type, ...
  ]);
}

describe("MediaService.ingestFromUrl", () => {
  let db: Database;
  let mediaService: ReturnType<typeof createMediaService>;

  beforeEach(() => {
    const testDb = createTestDatabase();
    db = testDb.db as unknown as Database;
    mediaService = createMediaService(db, DEFAULT_TEST_SITE_ID);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const deps = () => ({
    storage: createMockStorage(),
    storageDriver: "local",
    maxFileSizeMB: 25,
  });

  it("fetches a remote image, stores it, and creates a media row", async () => {
    const bytes = createPngBytes();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(bytes, { headers: { "content-type": "image/png" } }),
      ),
    );

    const d = deps();
    const media = await mediaService.ingestFromUrl(
      { url: "https://example.com/photo.png", alt: "A photo" },
      d,
    );

    expect(media.mimeType).toBe("image/png");
    expect(media.mediaKind).toBe("image");
    expect(media.width).toBe(4);
    expect(media.height).toBe(6);
    expect(media.alt).toBe("A photo");
    expect(media.postId).toBeNull();

    const stored = d.storage.files.get(media.storageKey);
    expect(stored).toBeDefined();
    expect(stored?.contentType).toBe("image/png");
    expect(stored?.contentDisposition).toBe("inline");
  });

  it("stores SVG with attachment disposition (XSS-safe direct navigation)", async () => {
    const svg = new TextEncoder().encode(
      '<svg xmlns="http://www.w3.org/2000/svg"></svg>',
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(svg, {
            headers: { "content-type": "image/svg+xml" },
          }),
      ),
    );

    const d = deps();
    const media = await mediaService.ingestFromUrl(
      { url: "https://example.com/icon.svg" },
      d,
    );

    expect(media.mimeType).toBe("image/svg+xml");
    const stored = d.storage.files.get(media.storageKey);
    expect(stored?.contentDisposition).toBe("attachment");
  });

  it("rejects content that isn't a real image (content-type spoofing)", async () => {
    const html = new TextEncoder().encode(
      "<!doctype html><script>alert(1)</script>",
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(
        // Server lies: claims PNG, returns HTML.
        async () =>
          new Response(html, { headers: { "content-type": "image/png" } }),
      ),
    );

    await expect(
      mediaService.ingestFromUrl(
        { url: "https://example.com/evil.png" },
        deps(),
      ),
    ).rejects.toThrow(/supported image/i);
  });

  it("rejects an oversize image", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(2 * 1024 * 1024));
        controller.close();
      },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(stream, { headers: { "content-type": "image/png" } }),
      ),
    );

    await expect(
      mediaService.ingestFromUrl(
        { url: "https://example.com/huge.png" },
        { ...deps(), maxFileSizeMB: 1 },
      ),
    ).rejects.toThrow(/too large/i);
  });

  it("rejects a private/SSRF URL before fetching", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      mediaService.ingestFromUrl(
        { url: "http://169.254.169.254/latest/meta-data" },
        deps(),
      ),
    ).rejects.toThrow(/private address/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
