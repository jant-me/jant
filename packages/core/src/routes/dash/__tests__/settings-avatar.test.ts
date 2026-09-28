/**
 * Tests for avatar upload/removal service methods.
 *
 * Note: These tests stay at the service layer. They avoid rendering the full
 * route JSX tree so vitest does not need the runtime SSR setup for those pages.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  createTestDatabase,
  DEFAULT_TEST_SITE_ID,
} from "../../../__tests__/helpers/db.js";
import {
  createSettingsService,
  type AvatarUploadData,
} from "../../../services/settings.js";
import { createMediaService } from "../../../services/media.js";
import {
  arrayBufferToBase64,
  base64ToUint8Array,
} from "../../../lib/favicon.js";
import type { Database } from "../../../db/index.js";
import type { StorageDriver } from "../../../lib/storage.js";

function createMockStorage(): StorageDriver {
  return {
    put: vi.fn().mockResolvedValue(undefined),
    get: vi.fn().mockResolvedValue(null),
    delete: vi.fn().mockResolvedValue(undefined),
  };
}

const PNG_SIGNATURE = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

function createMockFile(
  name: string,
  type: string,
  size: number,
  head: Uint8Array = PNG_SIGNATURE,
): AvatarUploadData["file"] {
  return {
    name,
    type,
    size,
    stream: () => new ReadableStream(),
    slice: () => new Blob([head]),
  };
}

describe("Settings - Avatar Upload Logic", () => {
  let db: Database;
  let settingsService: ReturnType<typeof createSettingsService>;
  let mediaService: ReturnType<typeof createMediaService>;

  beforeEach(() => {
    const testDb = createTestDatabase();
    db = testDb.db as unknown as Database;
    settingsService = createSettingsService(db, DEFAULT_TEST_SITE_ID);
    mediaService = createMediaService(db, DEFAULT_TEST_SITE_ID);
  });

  describe("uploadAvatar", () => {
    it("stores avatar media and sets SITE_AVATAR to storageKey", async () => {
      const storage = createMockStorage();
      const file = createMockFile("logo.png", "image/png", 5000);

      await settingsService.uploadAvatar(
        { file },
        {
          media: mediaService,
          storage,
          storageProvider: "r2",
          maxFileSizeMB: 500,
        },
      );

      const avatarKey = await settingsService.get("SITE_AVATAR");
      expect(avatarKey).not.toBeNull();
      expect(avatarKey).toContain(
        `media/${DEFAULT_TEST_SITE_ID}/assets/avatar/`,
      );
      expect(storage.put).toHaveBeenCalled();
    });

    it("creates media record for the avatar", async () => {
      const storage = createMockStorage();
      const file = createMockFile("logo.png", "image/png", 5000);

      await settingsService.uploadAvatar(
        { file },
        {
          media: mediaService,
          storage,
          storageProvider: "r2",
          maxFileSizeMB: 500,
        },
      );

      const mediaList = (await mediaService.listPage({ limit: 10 })).media;
      expect(mediaList).toHaveLength(1);
      expect(mediaList[0].originalName).toBe("logo.png");
      expect(mediaList[0].mimeType).toBe("image/png");
      expect(mediaList[0].provider).toBe("r2");
    });

    it("stores favicon ICO as base64 in settings", async () => {
      const storage = createMockStorage();
      const file = createMockFile("logo.png", "image/png", 5000);
      const fakeIcoData = new Uint8Array([0, 0, 1, 0, 1, 0, 32, 32]);

      await settingsService.uploadAvatar(
        { file, faviconIco: fakeIcoData.buffer },
        {
          media: mediaService,
          storage,
          storageProvider: "r2",
          maxFileSizeMB: 500,
        },
      );

      const stored = await settingsService.get("SITE_FAVICON_ICO");
      expect(stored).not.toBeNull();
      const decoded = base64ToUint8Array(stored as string);
      expect(Array.from(decoded)).toEqual(Array.from(fakeIcoData));
    });

    it("stores apple-touch-icon in storage and sets key in settings", async () => {
      const storage = createMockStorage();
      const file = createMockFile("logo.png", "image/png", 5000);
      const appleTouchData = PNG_SIGNATURE.slice().buffer;

      await settingsService.uploadAvatar(
        { file, appleTouchIcon: appleTouchData },
        {
          media: mediaService,
          storage,
          storageProvider: "r2",
          maxFileSizeMB: 500,
        },
      );

      const stored = await settingsService.get("SITE_FAVICON_APPLE_TOUCH");
      expect(stored).toBe(
        `media/${DEFAULT_TEST_SITE_ID}/assets/favicon/apple-touch-icon.png`,
      );
      // storage.put should be called twice: avatar file + apple-touch-icon
      expect(storage.put).toHaveBeenCalledTimes(2);
    });

    it("sets SITE_FAVICON_VERSION on upload", async () => {
      const storage = createMockStorage();
      const file = createMockFile("logo.png", "image/png", 5000);

      await settingsService.uploadAvatar(
        { file },
        {
          media: mediaService,
          storage,
          storageProvider: "r2",
          maxFileSizeMB: 500,
        },
      );

      const stored = await settingsService.get("SITE_FAVICON_VERSION");
      expect(stored).not.toBeNull();
      expect(stored).toMatch(/^\d{12}$/);
    });

    it("throws ValidationError for disallowed file type", async () => {
      const storage = createMockStorage();
      const file = createMockFile("doc.pdf", "application/pdf", 5000);

      await expect(
        settingsService.uploadAvatar(
          { file },
          {
            media: mediaService,
            storage,
            storageProvider: "r2",
            maxFileSizeMB: 500,
          },
        ),
      ).rejects.toThrow("File type not allowed");
    });

    it("refuses an SVG, which can carry script", async () => {
      const storage = createMockStorage();
      const file = createMockFile(
        "logo.svg",
        "image/svg+xml",
        500,
        new TextEncoder().encode("<svg onload=alert(1)>"),
      );

      await expect(
        settingsService.uploadAvatar(
          { file },
          {
            media: mediaService,
            storage,
            storageProvider: "r2",
            maxFileSizeMB: 500,
          },
        ),
      ).rejects.toThrow("Upload a PNG, JPEG, or WebP image.");
      expect(storage.put).not.toHaveBeenCalled();
    });

    it("refuses a file whose bytes aren't the image type it claims", async () => {
      const storage = createMockStorage();
      const file = createMockFile(
        "logo.png",
        "image/png",
        500,
        new TextEncoder().encode("<html>"),
      );

      await expect(
        settingsService.uploadAvatar(
          { file },
          {
            media: mediaService,
            storage,
            storageProvider: "r2",
            maxFileSizeMB: 500,
          },
        ),
      ).rejects.toThrow("PNG");
      expect(storage.put).not.toHaveBeenCalled();
    });

    it("throws ValidationError for oversized file", async () => {
      const storage = createMockStorage();
      const file = createMockFile("big.png", "image/png", 501 * 1024 * 1024);

      await expect(
        settingsService.uploadAvatar(
          { file },
          {
            media: mediaService,
            storage,
            storageProvider: "r2",
            maxFileSizeMB: 500,
          },
        ),
      ).rejects.toThrow("File too large");
    });
  });

  describe("removeAvatar", () => {
    it("removes all favicon-related settings", async () => {
      await settingsService.set(
        "SITE_AVATAR",
        `media/${DEFAULT_TEST_SITE_ID}/assets/avatar/some-id.png`,
      );
      await settingsService.set("SITE_FAVICON_ICO", "base64data");
      await settingsService.set(
        "SITE_FAVICON_APPLE_TOUCH",
        `media/${DEFAULT_TEST_SITE_ID}/assets/favicon/apple-touch-icon.png`,
      );
      await settingsService.set("SITE_FAVICON_VERSION", "202602191430");

      await settingsService.removeAvatar();

      expect(await settingsService.get("SITE_AVATAR")).toBeNull();
      expect(await settingsService.get("SITE_FAVICON_ICO")).toBeNull();
      expect(await settingsService.get("SITE_FAVICON_APPLE_TOUCH")).toBeNull();
      expect(await settingsService.get("SITE_FAVICON_VERSION")).toBeNull();
    });

    it("removes the apple-touch-icon media row and retires its object", async () => {
      const storage = createMockStorage();
      const appleTouchKey = `media/${DEFAULT_TEST_SITE_ID}/assets/favicon/apple-touch-icon.png`;
      const media = await mediaService.create({
        filename: "apple-touch-icon.png",
        originalName: "apple-touch-icon.png",
        mimeType: "image/png",
        size: 1234,
        storageKey: appleTouchKey,
        provider: "r2",
      });
      await settingsService.set("SITE_FAVICON_APPLE_TOUCH", appleTouchKey);

      await settingsService.removeAvatar({
        storage,
        media: mediaService,
        storageProvider: "r2",
      });

      // Row removed and setting cleared; the object is retired via storage
      // (this mock has no server-side copy, so it's deleted outright).
      expect(await mediaService.getById(media.id)).toBeNull();
      expect(await settingsService.get("SITE_FAVICON_APPLE_TOUCH")).toBeNull();
      expect(storage.delete).toHaveBeenCalledWith(appleTouchKey);
    });

    it("is a no-op for media when no apple-touch-icon key exists", async () => {
      await settingsService.set(
        "SITE_AVATAR",
        `media/${DEFAULT_TEST_SITE_ID}/assets/avatar/some-id.png`,
      );

      await settingsService.removeAvatar({
        media: mediaService,
        storageProvider: "r2",
      });

      expect(await settingsService.get("SITE_AVATAR")).toBeNull();
    });

    it("clears settings even without a media service", async () => {
      await settingsService.set(
        "SITE_AVATAR",
        `media/${DEFAULT_TEST_SITE_ID}/assets/avatar/some-id.png`,
      );
      await settingsService.set(
        "SITE_FAVICON_APPLE_TOUCH",
        `media/${DEFAULT_TEST_SITE_ID}/assets/favicon/apple-touch-icon.png`,
      );

      await settingsService.removeAvatar();

      expect(await settingsService.get("SITE_AVATAR")).toBeNull();
      expect(await settingsService.get("SITE_FAVICON_APPLE_TOUCH")).toBeNull();
    });
  });

  describe("arrayBufferToBase64 / base64ToUint8Array roundtrip", () => {
    it("encodes and decodes correctly", () => {
      const original = new Uint8Array([0, 0, 1, 0, 1, 0, 32, 32]);
      const b64 = arrayBufferToBase64(original.buffer);
      const decoded = base64ToUint8Array(b64);
      expect(Array.from(decoded)).toEqual(Array.from(original));
    });
  });
});
