import { beforeEach, describe, expect, it } from "vitest";
import {
  createTestDatabase,
  DEFAULT_TEST_SITE_ID,
} from "../../__tests__/helpers/db.js";
import {
  account,
  apiTokens,
  collectionDirectoryItems,
  collections,
  media,
  navItems,
  pathRegistry,
  threadCollections,
  posts,
  session,
  settings as settingsTable,
  siteDomains,
  siteMembers,
  sites,
  user,
  verification,
} from "../../db/schema.js";
import { sql } from "drizzle-orm";
import type { Database } from "../../db/index.js";
import { SETTINGS_KEYS } from "../../lib/constants.js";
import { createAuthService } from "../auth.js";
import { createSettingsService } from "../settings.js";

describe("AuthService", () => {
  let db: Database;

  async function seedAuthData() {
    const timestamp = Math.floor(Date.now() / 1000);
    const createdAt = new Date();
    const userId = "usr_01km9authdelete000000000000";

    await db.insert(user).values({
      id: userId,
      name: "Owner",
      email: "owner@example.com",
      emailVerified: true,
      createdAt,
      updatedAt: createdAt,
    });

    await db.insert(account).values({
      id: "acc_01km9authdelete000000000000",
      accountId: "owner@example.com",
      providerId: "credential",
      userId,
      password: "hashed-password",
      createdAt,
      updatedAt: createdAt,
    });

    await db.insert(session).values({
      id: "ses_01km9authdelete000000000000",
      token: "session-token",
      userId,
      expiresAt: new Date(Date.now() + 60_000),
      createdAt,
      updatedAt: createdAt,
    });

    await db.insert(verification).values({
      id: "ver_01km9authdelete000000000000",
      identifier: "owner@example.com",
      value: "reset-token",
      expiresAt: new Date(Date.now() + 60_000),
      createdAt,
      updatedAt: createdAt,
    });

    await db.insert(siteMembers).values({
      siteId: DEFAULT_TEST_SITE_ID,
      userId,
      role: "owner",
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    await db.insert(settingsTable).values({
      siteId: DEFAULT_TEST_SITE_ID,
      key: SETTINGS_KEYS.SITE_NAME,
      value: "Jant",
      updatedAt: timestamp,
    });
  }

  async function seedSiteContent() {
    const timestamp = Math.floor(Date.now() / 1000);

    await db.insert(siteDomains).values({
      id: "sdm_01km9authdelete00000000000",
      siteId: DEFAULT_TEST_SITE_ID,
      host: "example.test",
      pathPrefix: null,
      kind: "primary",
      redirectToPrimary: true,
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    await db.insert(posts).values({
      id: "pst_01km9authdelete00000000000",
      siteId: DEFAULT_TEST_SITE_ID,
      format: "note",
      status: "published",
      visibility: "public",
      threadId: "pst_01km9authdelete00000000000",
      bodyText: "hello",
      publishedAt: timestamp,
      lastActivityAt: timestamp,
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    await db.insert(media).values({
      id: "med_01km9authdelete00000000000",
      siteId: DEFAULT_TEST_SITE_ID,
      postId: "pst_01km9authdelete00000000000",
      filename: "test.png",
      originalName: "test.png",
      mimeType: "image/png",
      size: 123,
      storageKey: `sites/${DEFAULT_TEST_SITE_ID}/media/test.png`,
      provider: "local",
      position: "a0",
      mediaKind: "image",
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    await db.insert(collections).values({
      id: "col_01km9authdelete00000000000",
      siteId: DEFAULT_TEST_SITE_ID,
      title: "Notes",
      sortOrder: "newest",
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    await db.insert(pathRegistry).values({
      id: "pth_01km9authdelete00000000000",
      siteId: DEFAULT_TEST_SITE_ID,
      path: "hello-world",
      kind: "slug",
      postId: "pst_01km9authdelete00000000000",
      collectionId: null,
      redirectToPath: null,
      redirectType: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    await db.insert(collectionDirectoryItems).values({
      id: "cdi_01km9authdelete00000000000",
      siteId: DEFAULT_TEST_SITE_ID,
      type: "collection",
      collectionId: "col_01km9authdelete00000000000",
      label: null,
      position: "a0",
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    await db.insert(threadCollections).values({
      siteId: DEFAULT_TEST_SITE_ID,
      threadId: "pst_01km9authdelete00000000000",
      collectionId: "col_01km9authdelete00000000000",
      createdAt: timestamp,
    });

    await db.insert(navItems).values({
      id: "nav_01km9authdelete00000000000",
      siteId: DEFAULT_TEST_SITE_ID,
      type: "link",
      systemKey: null,
      label: "Home",
      url: "/",
      position: "a0",
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    await db.insert(apiTokens).values({
      id: "apt_01km9authdelete00000000000",
      siteId: DEFAULT_TEST_SITE_ID,
      name: "CLI",
      tokenHash: "hash-01km9authdelete00000000000",
      prefix: "jant",
      createdAt: timestamp,
      updatedAt: timestamp,
    });
  }

  describe("deleteAllData", () => {
    beforeEach(() => {
      const testDb = createTestDatabase({ fts: true });
      db = testDb.db as unknown as Database;
    });

    it("removes auth rows, settings, and site members for sqlite", async () => {
      await seedAuthData();
      await seedSiteContent();

      const dbWithoutTransaction = db as Database & {
        transaction: () => Promise<never>;
      };
      const originalTransaction = dbWithoutTransaction.transaction.bind(db);
      dbWithoutTransaction.transaction = async () => {
        throw new Error("sqlite deleteAllData should not call transaction()");
      };

      const settingsService = createSettingsService(db, DEFAULT_TEST_SITE_ID);
      const authService = createAuthService(db, settingsService, {
        databaseDialect: "sqlite",
      });

      try {
        await authService.deleteAllData();
      } finally {
        dbWithoutTransaction.transaction = originalTransaction;
      }

      const [remainingUsers] = await db
        .select({ count: sql<number>`count(*)` })
        .from(user);
      const [remainingAccounts] = await db
        .select({ count: sql<number>`count(*)` })
        .from(account);
      const [remainingSessions] = await db
        .select({ count: sql<number>`count(*)` })
        .from(session);
      const [remainingVerifications] = await db
        .select({ count: sql<number>`count(*)` })
        .from(verification);
      const remainingSiteMembers = await db.select().from(siteMembers);
      const remainingSettings = await db.select().from(settingsTable);
      const remainingPosts = await db.select().from(posts);
      const remainingMedia = await db.select().from(media);
      const remainingCollections = await db.select().from(collections);
      const remainingPaths = await db.select().from(pathRegistry);
      const remainingDirectoryItems = await db
        .select()
        .from(collectionDirectoryItems);
      const remainingThreadCollections = await db
        .select()
        .from(threadCollections);
      const remainingNavItems = await db.select().from(navItems);
      const remainingApiTokens = await db.select().from(apiTokens);
      const existingSites = await db.select().from(sites);
      const existingSiteDomains = await db.select().from(siteDomains);

      expect(remainingUsers?.count).toBe(0);
      expect(remainingAccounts?.count).toBe(0);
      expect(remainingSessions?.count).toBe(0);
      expect(remainingVerifications?.count).toBe(0);
      expect(remainingSiteMembers).toHaveLength(0);
      expect(remainingSettings).toHaveLength(0);
      expect(remainingPosts).toHaveLength(0);
      expect(remainingMedia).toHaveLength(0);
      expect(remainingCollections).toHaveLength(0);
      expect(remainingPaths).toHaveLength(0);
      expect(remainingDirectoryItems).toHaveLength(0);
      expect(remainingThreadCollections).toHaveLength(0);
      expect(remainingNavItems).toHaveLength(0);
      expect(remainingApiTokens).toHaveLength(0);
      expect(existingSites).toHaveLength(0);
      expect(existingSiteDomains).toHaveLength(0);
    });

    it("skips sqlite FTS rebuild when running in pg dialect mode", async () => {
      const testDb = createTestDatabase();
      db = testDb.db as unknown as Database;
      await seedAuthData();
      await seedSiteContent();

      const settingsService = createSettingsService(db, DEFAULT_TEST_SITE_ID);
      const authService = createAuthService(db, settingsService, {
        databaseDialect: "pg",
      });

      await expect(authService.deleteAllData()).resolves.toBeUndefined();

      const remainingSiteMembers = await db.select().from(siteMembers);
      const remainingUsers = await db.select().from(user);
      const remainingPosts = await db.select().from(posts);
      const remainingSettings = await db.select().from(settingsTable);
      const existingSites = await db.select().from(sites);
      const existingSiteDomains = await db.select().from(siteDomains);
      expect(remainingSiteMembers).toHaveLength(0);
      expect(remainingUsers).toHaveLength(0);
      expect(remainingPosts).toHaveLength(0);
      expect(remainingSettings).toHaveLength(0);
      expect(existingSites).toHaveLength(0);
      expect(existingSiteDomains).toHaveLength(0);
    });
  });

  describe("token validation", () => {
    beforeEach(() => {
      const testDb = createTestDatabase();
      db = testDb.db as unknown as Database;
    });

    it("validates delete CSRF tokens in Node runtimes", async () => {
      const settingsService = createSettingsService(db, DEFAULT_TEST_SITE_ID);
      const authService = createAuthService(db, settingsService, {
        databaseDialect: "pg",
      });

      const token = await authService.generateDeleteCsrfToken();

      await expect(authService.validateDeleteCsrfToken(token)).resolves.toBe(
        true,
      );
      await expect(
        authService.validateDeleteCsrfToken(`${token}nope`),
      ).resolves.toBe(false);
    });

    it("validates password reset tokens in Node runtimes", async () => {
      const settingsService = createSettingsService(db, DEFAULT_TEST_SITE_ID);
      const authService = createAuthService(db, settingsService, {
        databaseDialect: "pg",
      });
      const token = "reset-token";
      const hashBuffer = await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(token),
      );
      const tokenHash = Array.from(new Uint8Array(hashBuffer))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
      const expiry = Math.floor(Date.now() / 1000) + 15 * 60;

      await settingsService.set(
        SETTINGS_KEYS.PASSWORD_RESET_TOKEN,
        `${tokenHash}:${expiry}`,
      );

      await expect(authService.validateResetToken(token)).resolves.toBe(true);
      await expect(authService.validateResetToken("wrong-token")).resolves.toBe(
        false,
      );
    });
  });
});
