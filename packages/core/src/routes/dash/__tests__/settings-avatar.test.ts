/**
 * Tests for avatar upload with favicon variant storage.
 *
 * Note: Route handlers that import JSX components with @lingui/react/macro
 * cannot run in vitest (requires SWC plugin). These tests verify the
 * service-layer and storage operations that the routes orchestrate.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { createTestDatabase } from "../../../__tests__/helpers/db.js";
import { createSettingsService } from "../../../services/settings.js";
import { createMediaService } from "../../../services/media.js";
import { FAVICON_STORAGE_KEYS } from "../../../lib/favicon.js";
import type { Database } from "../../../db/index.js";

describe("Dashboard Settings - Avatar Upload Logic", () => {
  let db: Database;
  let settingsService: ReturnType<typeof createSettingsService>;
  let mediaService: ReturnType<typeof createMediaService>;

  beforeEach(() => {
    const testDb = createTestDatabase();
    db = testDb.db as unknown as Database;
    settingsService = createSettingsService(db);
    mediaService = createMediaService(db);
  });

  describe("avatar upload with favicon variants", () => {
    it("stores avatar media and sets SITE_AVATAR setting", async () => {
      const media = await mediaService.create({
        id: "test-avatar-id",
        filename: "test-avatar-id.png",
        originalName: "logo.png",
        mimeType: "image/png",
        size: 5000,
        storageKey: "media/2026/02/test-avatar-id.png",
        provider: "r2",
      });

      await settingsService.set("SITE_AVATAR", media.id);

      const avatarId = await settingsService.get("SITE_AVATAR");
      expect(avatarId).toBe("test-avatar-id");

      const stored = await mediaService.getById(avatarId!);
      expect(stored).not.toBeNull();
      expect(stored!.mimeType).toBe("image/png");
    });
  });

  describe("avatar removal with favicon cleanup", () => {
    it("removes SITE_AVATAR setting", async () => {
      await settingsService.set("SITE_AVATAR", "some-id");
      expect(await settingsService.get("SITE_AVATAR")).toBe("some-id");

      await settingsService.remove("SITE_AVATAR");
      expect(await settingsService.get("SITE_AVATAR")).toBeNull();
    });
  });

  describe("favicon storage keys", () => {
    it("has correct ICO storage key path", () => {
      expect(FAVICON_STORAGE_KEYS.ICO).toBe("favicons/favicon.ico");
    });

    it("has correct apple-touch-icon storage key path", () => {
      expect(FAVICON_STORAGE_KEYS.APPLE_TOUCH).toBe(
        "favicons/apple-touch-icon.png",
      );
    });

    it("storage keys do not conflict with media paths", () => {
      // Media files are stored at media/{year}/{month}/{id}.{ext}
      // Favicon files are stored at favicons/{filename}
      expect(FAVICON_STORAGE_KEYS.ICO).toMatch(/^favicons\//);
      expect(FAVICON_STORAGE_KEYS.APPLE_TOUCH).toMatch(/^favicons\//);
    });
  });
});
