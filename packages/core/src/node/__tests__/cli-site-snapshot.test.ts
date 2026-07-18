import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createLocalDriver } from "../../lib/storage.js";
import { migrate } from "../runtime.js";
import type { Bindings } from "../../types.js";

const SNAPSHOT_SITE_ID = "sit_01jpyy00bc4w2h8r7m3q5t9kda";
const SNAPSHOT_SITE_KEY = "default";
const REMAPPED_TARGET_SITE_ID = "sit_01jpyy9yqv4m7r2k8s5c1t9bdn";
const REMAPPED_TARGET_SITE_KEY = "demo-public";
const SNAPSHOT_COLLECTION_ID = "col_01jpyy08bc4w2h8r7m3q5t9kdn";
const SNAPSHOT_NAV_ID = "nav_01jpyy0gqv4m7r2k8s5c1t9bdh";
const SNAPSHOT_DIRECTORY_ITEM_ID = "cdi_01jpyy0r6s3m8v1k5t9q2b4gcn";
const SNAPSHOT_POST_ID = "pst_01jpyy18fh4w2m7r8k3c5t9qdn";
const SNAPSHOT_REPLY_ID = "pst_01jpyy1e6s4m8v2k5t9c3b7qdh";
const SNAPSHOT_SECOND_COLLECTION_ID = "col_01jpyy0c4s7m8r1k5t9b3q6dgh";
const SNAPSHOT_PATH_ID = "pth_01jpyy1k2v6m4s8r1t5c9b3qgh";
const SNAPSHOT_MEDIA_ID = "med_01jpyy1vxh4m7s2k8r5c9t3qbn";
const SNAPSHOT_AVATAR_MEDIA_ID = "med_01jpyy1zs6m4v8r2k5t9c3b7qh";
const SNAPSHOT_APPLE_TOUCH_MEDIA_ID = "med_01jpyy20kt5n9r3k8t6c4d2qhf";
const SNAPSHOT_MEDIA_KEY = `media/${SNAPSHOT_SITE_ID}/files/${SNAPSHOT_MEDIA_ID}.png`;
const SNAPSHOT_POSTER_KEY = `media/${SNAPSHOT_SITE_ID}/posters/${SNAPSHOT_MEDIA_ID}.webp`;
const SNAPSHOT_AVATAR_KEY = `media/${SNAPSHOT_SITE_ID}/assets/avatar/${SNAPSHOT_AVATAR_MEDIA_ID}.png`;
const SNAPSHOT_APPLE_TOUCH_KEY = `media/${SNAPSHOT_SITE_ID}/assets/favicon/apple-touch-icon.png`;
const SNAPSHOT_OLD_POST_ID = "pst_01jpyy2c4s7m8r1k5t9b3q6dgh";
const SNAPSHOT_OLD_PATH_ID = "pth_01jpyy2pbh4m6s8r1k5t9c3qgn";
const SNAPSHOT_OLD_MEDIA_ID = "med_01jpyy2z6v4m8r1k5t9c3b7qdh";
const SNAPSHOT_OLD_MEDIA_KEY = `media/${SNAPSHOT_SITE_ID}/files/${SNAPSHOT_OLD_MEDIA_ID}.png`;
const REMAPPED_MEDIA_KEY = `media/${REMAPPED_TARGET_SITE_ID}/files/${SNAPSHOT_MEDIA_ID}.png`;
const REMAPPED_POSTER_KEY = `media/${REMAPPED_TARGET_SITE_ID}/posters/${SNAPSHOT_MEDIA_ID}.webp`;
const REMAPPED_AVATAR_KEY = `media/${REMAPPED_TARGET_SITE_ID}/assets/avatar/${SNAPSHOT_AVATAR_MEDIA_ID}.png`;
const REMAPPED_APPLE_TOUCH_KEY = `media/${REMAPPED_TARGET_SITE_ID}/assets/favicon/apple-touch-icon.png`;
const NODE_CLI_ENV_KEYS = [
  "DATABASE_URL",
  "DATA_DIR",
  "LOCAL_STORAGE_PATH",
  "STORAGE_DRIVER",
  "S3_ENDPOINT",
  "S3_BUCKET",
  "S3_REGION",
  "S3_PUBLIC_URL",
  "S3_ACCESS_KEY_ID",
  "S3_SECRET_ACCESS_KEY",
  "SITE_RESOLUTION_MODE",
] as const;

function useLocalSnapshotRuntime(databaseUrl: string, storagePath: string) {
  delete process.env.DATA_DIR;
  process.env.DATABASE_URL = databaseUrl;
  process.env.LOCAL_STORAGE_PATH = storagePath;
  process.env.STORAGE_DRIVER = "local";
}

describe("jant site snapshot export/import", () => {
  const tempDirs: string[] = [];
  const originalEnv = Object.fromEntries(
    NODE_CLI_ENV_KEYS.map((key) => [key, process.env[key]]),
  ) as Record<(typeof NODE_CLI_ENV_KEYS)[number], string | undefined>;

  afterEach(async () => {
    for (const key of NODE_CLI_ENV_KEYS) {
      const value = originalEnv[key];
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }

    await Promise.all(
      tempDirs.map((dir) => rm(dir, { recursive: true, force: true })),
    );
    tempDirs.length = 0;
    vi.restoreAllMocks();
  });

  it("round-trips a content snapshot while preserving ids and storage keys", async () => {
    const root = await mkdtemp(join(tmpdir(), "jant-site-snapshot-"));
    tempDirs.push(root);

    const sourceDbPath = join(root, "source.sqlite");
    const sourceStoragePath = join(root, "source-media");
    const targetDbPath = join(root, "target.sqlite");
    const targetStoragePath = join(root, "target-media");
    const snapshotPath = join(root, "snapshot");

    await migrate({ DATABASE_URL: `file:${sourceDbPath}` } as Bindings);
    await migrate({ DATABASE_URL: `file:${targetDbPath}` } as Bindings);

    const sourceStorage = createLocalDriver({ rootPath: sourceStoragePath });
    const targetStorage = createLocalDriver({ rootPath: targetStoragePath });

    await sourceStorage.put(SNAPSHOT_MEDIA_KEY, new Uint8Array([1, 2, 3, 4]), {
      contentType: "image/png",
    });
    await sourceStorage.put(SNAPSHOT_POSTER_KEY, new Uint8Array([9, 8, 7, 6]), {
      contentType: "image/webp",
    });
    await sourceStorage.put(SNAPSHOT_AVATAR_KEY, new Uint8Array([3, 3, 3]), {
      contentType: "image/png",
    });
    await sourceStorage.put(
      SNAPSHOT_APPLE_TOUCH_KEY,
      new Uint8Array([4, 4, 4]),
      {
        contentType: "image/png",
      },
    );

    const sourceSqlite = new Database(sourceDbPath);
    const targetSqlite = new Database(targetDbPath);

    try {
      sourceSqlite.exec(`
        INSERT INTO "site" ("id", "key", "status", "created_at", "updated_at")
        VALUES ('${SNAPSHOT_SITE_ID}', '${SNAPSHOT_SITE_KEY}', 'active', 1774009100, 1774009100);

        INSERT INTO "site_setting" ("site_id", "key", "value", "updated_at") VALUES
          ('${SNAPSHOT_SITE_ID}', 'SITE_NAME', 'Snapshot Source', 1774009200),
          ('${SNAPSHOT_SITE_ID}', 'CUSTOM_CSS', 'body { color: red; }', 1774009201),
          ('${SNAPSHOT_SITE_ID}', 'SITE_AVATAR', '${SNAPSHOT_AVATAR_KEY}', 1774009202),
          ('${SNAPSHOT_SITE_ID}', 'SITE_FAVICON_APPLE_TOUCH', '${SNAPSHOT_APPLE_TOUCH_KEY}', 1774009203),
          ('${SNAPSHOT_SITE_ID}', 'SITE_FAVICON_ICO', 'ZmFrZS1pY28=', 1774009204),
          ('${SNAPSHOT_SITE_ID}', 'SITE_FAVICON_VERSION', '20260321010101', 1774009205),
          ('${SNAPSHOT_SITE_ID}', 'ONBOARDING_STATUS', 'pending', 1774009206),
          ('${SNAPSHOT_SITE_ID}', 'PASSWORD_RESET_TOKEN', 'source-reset-token', 1774009207);

        INSERT INTO "collection" ("id", "site_id", "title", "description", "sort_order", "created_at", "updated_at")
        VALUES ('${SNAPSHOT_COLLECTION_ID}', '${SNAPSHOT_SITE_ID}', 'Walks', 'Morning routes', 'newest', 1774009200, 1774009200);

        INSERT INTO "nav_item" ("id", "site_id", "type", "system_key", "label", "url", "position", "created_at", "updated_at")
        VALUES ('${SNAPSHOT_NAV_ID}', '${SNAPSHOT_SITE_ID}', 'link', NULL, 'Archive', '/archive', 'a0', 1774009200, 1774009200);

        INSERT INTO "collection_directory_item" ("id", "site_id", "type", "collection_id", "label", "position", "created_at", "updated_at")
        VALUES ('${SNAPSHOT_DIRECTORY_ITEM_ID}', '${SNAPSHOT_SITE_ID}', 'collection', '${SNAPSHOT_COLLECTION_ID}', NULL, 'a0', 1774009200, 1774009200);

        INSERT INTO "post" (
          "id", "site_id", "format", "status", "visibility", "title", "body", "body_html", "body_text",
          "thread_id", "published_at", "last_activity_at", "created_at", "updated_at"
        ) VALUES (
          '${SNAPSHOT_POST_ID}', '${SNAPSHOT_SITE_ID}', 'note', 'published', 'public',
          'Snapshot post', 'Hello snapshot', '<p>Hello snapshot</p>', 'Hello snapshot',
          '${SNAPSHOT_POST_ID}', 1774009200, 1774009200, 1774009200, 1774009200
        );

        INSERT INTO "thread_collection" ("site_id", "thread_id", "collection_id", "created_at")
        VALUES ('${SNAPSHOT_SITE_ID}', '${SNAPSHOT_POST_ID}', '${SNAPSHOT_COLLECTION_ID}', 1774009200);

        INSERT INTO "path_registry" (
          "id", "site_id", "path", "kind", "post_id", "collection_id", "redirect_to_path", "redirect_type", "created_at", "updated_at"
        ) VALUES (
          '${SNAPSHOT_PATH_ID}', '${SNAPSHOT_SITE_ID}', 'snapshot-post', 'slug',
          '${SNAPSHOT_POST_ID}', NULL, NULL, NULL, 1774009200, 1774009200
        );

        INSERT INTO "media" (
          "id", "site_id", "post_id", "filename", "original_name", "mime_type", "size", "storage_key",
          "provider", "width", "height", "alt", "position", "poster_key", "media_kind",
          "created_at", "updated_at"
        ) VALUES (
          '${SNAPSHOT_MEDIA_ID}', '${SNAPSHOT_SITE_ID}', '${SNAPSHOT_POST_ID}',
          '${SNAPSHOT_MEDIA_ID}.png', 'sample.png', 'image/png', 4, '${SNAPSHOT_MEDIA_KEY}',
          'local', 1, 1, 'Sample alt', 'a0', '${SNAPSHOT_POSTER_KEY}', 'image',
          1774009200, 1774009200
        );

        INSERT INTO "media" (
          "id", "site_id", "post_id", "filename", "original_name", "mime_type", "size", "storage_key",
          "provider", "position", "media_kind", "created_at", "updated_at"
        ) VALUES (
          '${SNAPSHOT_AVATAR_MEDIA_ID}', '${SNAPSHOT_SITE_ID}', NULL,
          '${SNAPSHOT_AVATAR_MEDIA_ID}.png', 'avatar.png', 'image/png', 3, '${SNAPSHOT_AVATAR_KEY}',
          'local', 'a0', 'image', 1774009202, 1774009202
        );

        INSERT INTO "media" (
          "id", "site_id", "post_id", "filename", "original_name", "mime_type", "size", "storage_key",
          "provider", "position", "media_kind", "created_at", "updated_at"
        ) VALUES (
          '${SNAPSHOT_APPLE_TOUCH_MEDIA_ID}', '${SNAPSHOT_SITE_ID}', NULL,
          'apple-touch-icon.png', 'apple-touch-icon.png', 'image/png', 3, '${SNAPSHOT_APPLE_TOUCH_KEY}',
          'local', 'a0', 'image', 1774009203, 1774009203
        );
      `);

      targetSqlite.exec(`
        INSERT INTO "site" ("id", "key", "status", "created_at", "updated_at")
        VALUES ('${SNAPSHOT_SITE_ID}', '${SNAPSHOT_SITE_KEY}', 'active', 1774009000, 1774009000);

        INSERT INTO "site_setting" ("site_id", "key", "value", "updated_at") VALUES
          ('${SNAPSHOT_SITE_ID}', 'SITE_NAME', 'Old Target', 1774009100),
          ('${SNAPSHOT_SITE_ID}', 'ONBOARDING_STATUS', 'completed', 1774009101),
          ('${SNAPSHOT_SITE_ID}', 'PASSWORD_RESET_TOKEN', 'target-reset-token', 1774009102);

        INSERT INTO "post" (
          "id", "site_id", "format", "status", "visibility", "title", "body", "body_html", "body_text",
          "thread_id", "published_at", "last_activity_at", "created_at", "updated_at"
        ) VALUES (
          '${SNAPSHOT_OLD_POST_ID}', '${SNAPSHOT_SITE_ID}', 'note', 'published', 'public',
          'Old post', 'Old body', '<p>Old body</p>', 'Old body',
          '${SNAPSHOT_OLD_POST_ID}', 1774009100, 1774009100, 1774009100, 1774009100
        );

        INSERT INTO "path_registry" (
          "id", "site_id", "path", "kind", "post_id", "collection_id", "redirect_to_path", "redirect_type", "created_at", "updated_at"
        ) VALUES (
          '${SNAPSHOT_OLD_PATH_ID}', '${SNAPSHOT_SITE_ID}', 'old-post', 'slug',
          '${SNAPSHOT_OLD_POST_ID}', NULL, NULL, NULL, 1774009100, 1774009100
        );

        INSERT INTO "media" (
          "id", "site_id", "post_id", "filename", "original_name", "mime_type", "size", "storage_key",
          "provider", "position", "media_kind", "created_at", "updated_at"
        ) VALUES (
          '${SNAPSHOT_OLD_MEDIA_ID}', '${SNAPSHOT_SITE_ID}', '${SNAPSHOT_OLD_POST_ID}',
          '${SNAPSHOT_OLD_MEDIA_ID}.png', 'old.png', 'image/png', 3, '${SNAPSHOT_OLD_MEDIA_KEY}',
          'local', 'a0', 'image', 1774009100, 1774009100
        );
      `);
    } finally {
      sourceSqlite.close();
      targetSqlite.close();
    }

    await targetStorage.put(SNAPSHOT_OLD_MEDIA_KEY, new Uint8Array([7, 7, 7]), {
      contentType: "image/png",
    });

    useLocalSnapshotRuntime(`file:${sourceDbPath}`, sourceStoragePath);

    const exportLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const { run: runExport } =
      await import("../../../bin/commands/site/snapshot/export.js");
    await runExport(["--output", snapshotPath]);

    const meta = JSON.parse(
      await readFile(join(snapshotPath, "meta.json"), "utf-8"),
    );
    expect(meta).toEqual({
      format: "jant-site-snapshot",
      version: 2,
      dialect: "sqlite",
      site: { id: SNAPSHOT_SITE_ID, key: SNAPSHOT_SITE_KEY },
    });
    expect(existsSync(join(snapshotPath, "storage-manifest.json"))).toBe(false);
    expect(exportLogSpy).toHaveBeenCalledWith(
      `Exported Node database snapshot to ${snapshotPath}`,
    );

    useLocalSnapshotRuntime(`file:${targetDbPath}`, targetStoragePath);

    const importLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const { run: runImport } =
      await import("../../../bin/commands/site/snapshot/import.js");
    await runImport(["--path", snapshotPath, "--replace"]);

    const verifySqlite = new Database(targetDbPath, { readonly: true });
    try {
      const mediaRow = verifySqlite
        .prepare(
          `
            SELECT "id", "post_id", "storage_key", "poster_key"
            FROM "media"
            WHERE "id" = '${SNAPSHOT_MEDIA_ID}'
          `,
        )
        .get() as
        | {
            id: string;
            post_id: string;
            poster_key: string;
            storage_key: string;
          }
        | undefined;
      expect(mediaRow).toEqual({
        id: SNAPSHOT_MEDIA_ID,
        post_id: SNAPSHOT_POST_ID,
        storage_key: SNAPSHOT_MEDIA_KEY,
        poster_key: SNAPSHOT_POSTER_KEY,
      });

      const collectionMembership = verifySqlite
        .prepare(
          `SELECT "thread_id", "collection_id" FROM "thread_collection" WHERE "site_id" = '${SNAPSHOT_SITE_ID}'`,
        )
        .get();
      expect(collectionMembership).toEqual({
        thread_id: SNAPSHOT_POST_ID,
        collection_id: SNAPSHOT_COLLECTION_ID,
      });

      const siteName = verifySqlite
        .prepare(
          `SELECT "value" FROM "site_setting" WHERE "site_id" = '${SNAPSHOT_SITE_ID}' AND "key" = 'SITE_NAME'`,
        )
        .pluck()
        .get();
      expect(siteName).toBe("Snapshot Source");

      const onboardingStatus = verifySqlite
        .prepare(
          `SELECT "value" FROM "site_setting" WHERE "site_id" = '${SNAPSHOT_SITE_ID}' AND "key" = 'ONBOARDING_STATUS'`,
        )
        .pluck()
        .get();
      expect(onboardingStatus).toBe("completed");

      const resetToken = verifySqlite
        .prepare(
          `SELECT "value" FROM "site_setting" WHERE "site_id" = '${SNAPSHOT_SITE_ID}' AND "key" = 'PASSWORD_RESET_TOKEN'`,
        )
        .pluck()
        .get();
      expect(resetToken).toBe("target-reset-token");

      const oldMediaCount = verifySqlite
        .prepare(
          `SELECT COUNT(*) FROM "media" WHERE "id" = '${SNAPSHOT_OLD_MEDIA_ID}'`,
        )
        .pluck()
        .get();
      expect(oldMediaCount).toBe(0);
    } finally {
      verifySqlite.close();
    }

    const importedMedia = await targetStorage.get(SNAPSHOT_MEDIA_KEY);
    expect(importedMedia?.size).toBe(4);
    expect(importedMedia?.contentType).toBe("image/png");

    const importedPoster = await targetStorage.get(SNAPSHOT_POSTER_KEY);
    expect(importedPoster?.contentType).toBe("image/webp");

    const importedAvatar = await targetStorage.get(SNAPSHOT_AVATAR_KEY);
    expect(importedAvatar?.contentType).toBe("image/png");

    const importedAppleTouch = await targetStorage.get(
      SNAPSHOT_APPLE_TOUCH_KEY,
    );
    expect(importedAppleTouch?.contentType).toBe("image/png");

    const removedOldObject = await targetStorage.get(SNAPSHOT_OLD_MEDIA_KEY);
    expect(removedOldObject).toBeNull();

    expect(importLogSpy).toHaveBeenCalledWith(
      `Imported snapshot from ${snapshotPath}`,
    );
  });

  it("imports v1 per-post Collection rows as a Thread union", async () => {
    const root = await mkdtemp(join(tmpdir(), "jant-site-snapshot-v1-"));
    tempDirs.push(root);
    const targetDbPath = join(root, "target.sqlite");
    const snapshotPath = join(root, "snapshot");
    await migrate({ DATABASE_URL: `file:${targetDbPath}` } as Bindings);

    const sqlite = new Database(targetDbPath);
    try {
      sqlite.exec(`
        INSERT INTO "site" ("id", "key", "status", "created_at", "updated_at")
        VALUES ('${SNAPSHOT_SITE_ID}', '${SNAPSHOT_SITE_KEY}', 'active', 1, 1);
      `);
    } finally {
      sqlite.close();
    }

    await mkdir(snapshotPath, { recursive: true });
    await writeFile(
      join(snapshotPath, "meta.json"),
      JSON.stringify({
        format: "jant-site-snapshot",
        version: 1,
        dialect: "sqlite",
        site: { id: SNAPSHOT_SITE_ID, key: SNAPSHOT_SITE_KEY },
      }),
    );
    await writeFile(
      join(snapshotPath, "db.sql"),
      `
        INSERT INTO "collection" ("id", "site_id", "title", "sort_order", "created_at", "updated_at") VALUES('${SNAPSHOT_COLLECTION_ID}', '${SNAPSHOT_SITE_ID}', 'Ideas', 'newest', 10, 10);
        INSERT INTO "collection" ("id", "site_id", "title", "sort_order", "created_at", "updated_at") VALUES('${SNAPSHOT_SECOND_COLLECTION_ID}', '${SNAPSHOT_SITE_ID}', 'Walks', 'newest', 10, 10);
        INSERT INTO "post" ("id", "site_id", "format", "status", "visibility", "reply_to_id", "thread_id", "created_at", "updated_at") VALUES('${SNAPSHOT_POST_ID}', '${SNAPSHOT_SITE_ID}', 'note', 'published', 'public', NULL, '${SNAPSHOT_POST_ID}', 10, 10);
        INSERT INTO "post" ("id", "site_id", "format", "status", "visibility", "reply_to_id", "thread_id", "created_at", "updated_at") VALUES('${SNAPSHOT_REPLY_ID}', '${SNAPSHOT_SITE_ID}', 'note', 'published', 'public', '${SNAPSHOT_POST_ID}', '${SNAPSHOT_POST_ID}', 11, 11);
        INSERT INTO "post_collection" ("site_id", "post_id", "collection_id", "created_at", "position", "pinned_at") VALUES('${SNAPSHOT_SITE_ID}', '${SNAPSHOT_POST_ID}', '${SNAPSHOT_COLLECTION_ID}', 20, 5, 30);
        INSERT INTO "post_collection" ("site_id", "post_id", "collection_id", "created_at", "position", "pinned_at") VALUES('${SNAPSHOT_SITE_ID}', '${SNAPSHOT_REPLY_ID}', '${SNAPSHOT_COLLECTION_ID}', 40, 2, 35);
        INSERT INTO "post_collection" ("site_id", "post_id", "collection_id", "created_at", "position", "pinned_at") VALUES('${SNAPSHOT_SITE_ID}', '${SNAPSHOT_REPLY_ID}', '${SNAPSHOT_SECOND_COLLECTION_ID}', 25, 7, NULL);
      `,
    );

    useLocalSnapshotRuntime(`file:${targetDbPath}`, join(root, "target-media"));
    vi.spyOn(console, "log").mockImplementation(() => {});
    const { run: runImport } =
      await import("../../../bin/commands/site/snapshot/import.js");
    await runImport(["--path", snapshotPath, "--replace"]);

    const verifySqlite = new Database(targetDbPath, { readonly: true });
    try {
      const rows = verifySqlite
        .prepare(
          `SELECT "thread_id", "collection_id", "created_at", "position", "pinned_at" FROM "thread_collection" ORDER BY "collection_id"`,
        )
        .all();
      expect(rows).toEqual([
        {
          thread_id: SNAPSHOT_POST_ID,
          collection_id: SNAPSHOT_COLLECTION_ID,
          created_at: 40,
          position: 2,
          pinned_at: 35,
        },
        {
          thread_id: SNAPSHOT_POST_ID,
          collection_id: SNAPSHOT_SECOND_COLLECTION_ID,
          created_at: 25,
          position: 7,
          pinned_at: null,
        },
      ]);
    } finally {
      verifySqlite.close();
    }
  });

  it("rejects malformed v1 memberships before clearing target content", async () => {
    const root = await mkdtemp(
      join(tmpdir(), "jant-site-snapshot-v1-preflight-"),
    );
    tempDirs.push(root);
    const targetDbPath = join(root, "target.sqlite");
    const snapshotPath = join(root, "snapshot");
    await migrate({ DATABASE_URL: `file:${targetDbPath}` } as Bindings);

    const sqlite = new Database(targetDbPath);
    try {
      sqlite.exec(`
        INSERT INTO "site" ("id", "key", "status", "created_at", "updated_at")
        VALUES ('${SNAPSHOT_SITE_ID}', '${SNAPSHOT_SITE_KEY}', 'active', 1, 1);
        INSERT INTO "post" ("id", "site_id", "format", "status", "visibility", "thread_id", "created_at", "updated_at")
        VALUES ('${SNAPSHOT_OLD_POST_ID}', '${SNAPSHOT_SITE_ID}', 'note', 'published', 'public', '${SNAPSHOT_OLD_POST_ID}', 1, 1);
      `);
    } finally {
      sqlite.close();
    }

    await mkdir(snapshotPath, { recursive: true });
    await writeFile(
      join(snapshotPath, "meta.json"),
      JSON.stringify({
        format: "jant-site-snapshot",
        version: 1,
        dialect: "sqlite",
        site: { id: SNAPSHOT_SITE_ID, key: SNAPSHOT_SITE_KEY },
      }),
    );
    await writeFile(
      join(snapshotPath, "db.sql"),
      `INSERT INTO "post_collection" ("site_id", "post_id", "collection_id", "created_at", "position", "pinned_at") VALUES('${SNAPSHOT_SITE_ID}', 'pst_missing', '${SNAPSHOT_COLLECTION_ID}', 10, 0, NULL);`,
    );

    useLocalSnapshotRuntime(`file:${targetDbPath}`, join(root, "target-media"));
    const { run: runImport } =
      await import("../../../bin/commands/site/snapshot/import.js");
    await expect(
      runImport(["--path", snapshotPath, "--replace"]),
    ).rejects.toThrow(/references missing post pst_missing/);

    const verifySqlite = new Database(targetDbPath, { readonly: true });
    try {
      expect(
        verifySqlite
          .prepare(
            `SELECT COUNT(*) FROM "post" WHERE "id" = '${SNAPSHOT_OLD_POST_ID}'`,
          )
          .pluck()
          .get(),
      ).toBe(1);
    } finally {
      verifySqlite.close();
    }
  });

  it("skips downloading storage objects when --skip-objects is passed", async () => {
    const root = await mkdtemp(
      join(tmpdir(), "jant-site-snapshot-skip-objects-"),
    );
    tempDirs.push(root);

    const sourceDbPath = join(root, "source.sqlite");
    const sourceStoragePath = join(root, "source-media");
    const snapshotPath = join(root, "snapshot");

    await migrate({ DATABASE_URL: `file:${sourceDbPath}` } as Bindings);
    const sourceStorage = createLocalDriver({ rootPath: sourceStoragePath });
    await sourceStorage.put(SNAPSHOT_MEDIA_KEY, new Uint8Array([1, 2, 3, 4]), {
      contentType: "image/png",
    });

    const sourceSqlite = new Database(sourceDbPath);
    try {
      sourceSqlite.exec(`
        INSERT INTO "site" ("id", "key", "status", "created_at", "updated_at")
        VALUES ('${SNAPSHOT_SITE_ID}', '${SNAPSHOT_SITE_KEY}', 'active', 1774009100, 1774009100);

        INSERT INTO "site_setting" ("site_id", "key", "value", "updated_at") VALUES
          ('${SNAPSHOT_SITE_ID}', 'SITE_NAME', 'Skip Objects Source', 1774009200);

        INSERT INTO "post" (
          "id", "site_id", "format", "status", "visibility", "title", "body", "body_html", "body_text",
          "thread_id", "published_at", "last_activity_at", "created_at", "updated_at"
        ) VALUES (
          '${SNAPSHOT_POST_ID}', '${SNAPSHOT_SITE_ID}', 'note', 'published', 'public',
          'Snapshot post', 'Hello snapshot', '<p>Hello snapshot</p>', 'Hello snapshot',
          '${SNAPSHOT_POST_ID}', 1774009200, 1774009200, 1774009200, 1774009200
        );

        INSERT INTO "media" (
          "id", "site_id", "post_id", "filename", "original_name", "mime_type", "size", "storage_key",
          "provider", "position", "media_kind", "created_at", "updated_at"
        ) VALUES (
          '${SNAPSHOT_MEDIA_ID}', '${SNAPSHOT_SITE_ID}', '${SNAPSHOT_POST_ID}',
          '${SNAPSHOT_MEDIA_ID}.png', 'sample.png', 'image/png', 4, '${SNAPSHOT_MEDIA_KEY}',
          'local', 'a0', 'image', 1774009200, 1774009200
        );
      `);
    } finally {
      sourceSqlite.close();
    }

    useLocalSnapshotRuntime(`file:${sourceDbPath}`, sourceStoragePath);

    vi.spyOn(console, "log").mockImplementation(() => {});
    const { run: runExport } =
      await import("../../../bin/commands/site/snapshot/export.js");
    await runExport(["--output", snapshotPath, "--skip-objects"]);

    expect(existsSync(join(snapshotPath, "meta.json"))).toBe(true);
    expect(existsSync(join(snapshotPath, "db.sql"))).toBe(true);
    expect(existsSync(join(snapshotPath, "objects"))).toBe(false);

    const dbSql = await readFile(join(snapshotPath, "db.sql"), "utf-8");
    expect(dbSql).toContain(SNAPSHOT_MEDIA_KEY);
  });

  it("aborts import when objects/ is missing keys referenced by db.sql", async () => {
    const root = await mkdtemp(
      join(tmpdir(), "jant-site-snapshot-missing-objects-"),
    );
    tempDirs.push(root);

    const sourceDbPath = join(root, "source.sqlite");
    const sourceStoragePath = join(root, "source-media");
    const targetDbPath = join(root, "target.sqlite");
    const targetStoragePath = join(root, "target-media");
    const snapshotPath = join(root, "snapshot");

    await migrate({ DATABASE_URL: `file:${sourceDbPath}` } as Bindings);
    await migrate({ DATABASE_URL: `file:${targetDbPath}` } as Bindings);

    const sourceStorage = createLocalDriver({ rootPath: sourceStoragePath });
    await sourceStorage.put(SNAPSHOT_MEDIA_KEY, new Uint8Array([1, 2, 3, 4]), {
      contentType: "image/png",
    });

    const sourceSqlite = new Database(sourceDbPath);
    const targetSqlite = new Database(targetDbPath);
    try {
      sourceSqlite.exec(`
        INSERT INTO "site" ("id", "key", "status", "created_at", "updated_at")
        VALUES ('${SNAPSHOT_SITE_ID}', '${SNAPSHOT_SITE_KEY}', 'active', 1774009100, 1774009100);

        INSERT INTO "site_setting" ("site_id", "key", "value", "updated_at") VALUES
          ('${SNAPSHOT_SITE_ID}', 'SITE_NAME', 'Source', 1774009200);

        INSERT INTO "post" (
          "id", "site_id", "format", "status", "visibility", "title", "body", "body_html", "body_text",
          "thread_id", "published_at", "last_activity_at", "created_at", "updated_at"
        ) VALUES (
          '${SNAPSHOT_POST_ID}', '${SNAPSHOT_SITE_ID}', 'note', 'published', 'public',
          'Snapshot post', 'Hello snapshot', '<p>Hello snapshot</p>', 'Hello snapshot',
          '${SNAPSHOT_POST_ID}', 1774009200, 1774009200, 1774009200, 1774009200
        );

        INSERT INTO "media" (
          "id", "site_id", "post_id", "filename", "original_name", "mime_type", "size", "storage_key",
          "provider", "position", "media_kind", "created_at", "updated_at"
        ) VALUES (
          '${SNAPSHOT_MEDIA_ID}', '${SNAPSHOT_SITE_ID}', '${SNAPSHOT_POST_ID}',
          '${SNAPSHOT_MEDIA_ID}.png', 'sample.png', 'image/png', 4, '${SNAPSHOT_MEDIA_KEY}',
          'local', 'a0', 'image', 1774009200, 1774009200
        );
      `);

      targetSqlite.exec(`
        INSERT INTO "site" ("id", "key", "status", "created_at", "updated_at")
        VALUES ('${SNAPSHOT_SITE_ID}', '${SNAPSHOT_SITE_KEY}', 'active', 1774009000, 1774009000);
      `);
    } finally {
      sourceSqlite.close();
      targetSqlite.close();
    }

    useLocalSnapshotRuntime(`file:${sourceDbPath}`, sourceStoragePath);

    vi.spyOn(console, "log").mockImplementation(() => {});
    const { run: runExport } =
      await import("../../../bin/commands/site/snapshot/export.js");
    await runExport(["--output", snapshotPath, "--skip-objects"]);

    useLocalSnapshotRuntime(`file:${targetDbPath}`, targetStoragePath);

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { run: runImport } =
      await import("../../../bin/commands/site/snapshot/import.js");

    await expect(
      runImport(["--path", snapshotPath, "--replace"]),
    ).rejects.toThrow(/missing storage objects/);

    expect(warnSpy.mock.calls.flat().join("\n")).toContain(SNAPSHOT_MEDIA_KEY);
  });

  it("imports a --skip-objects snapshot when --allow-missing-objects is passed", async () => {
    const root = await mkdtemp(
      join(tmpdir(), "jant-site-snapshot-allow-missing-"),
    );
    tempDirs.push(root);

    const sourceDbPath = join(root, "source.sqlite");
    const sourceStoragePath = join(root, "source-media");
    const targetDbPath = join(root, "target.sqlite");
    const targetStoragePath = join(root, "target-media");
    const snapshotPath = join(root, "snapshot");

    await migrate({ DATABASE_URL: `file:${sourceDbPath}` } as Bindings);
    await migrate({ DATABASE_URL: `file:${targetDbPath}` } as Bindings);

    const sourceStorage = createLocalDriver({ rootPath: sourceStoragePath });
    const targetStorage = createLocalDriver({ rootPath: targetStoragePath });
    await sourceStorage.put(SNAPSHOT_MEDIA_KEY, new Uint8Array([1, 2, 3, 4]), {
      contentType: "image/png",
    });
    // Simulate a shared bucket: target already has the file.
    await targetStorage.put(SNAPSHOT_MEDIA_KEY, new Uint8Array([1, 2, 3, 4]), {
      contentType: "image/png",
    });

    const sourceSqlite = new Database(sourceDbPath);
    const targetSqlite = new Database(targetDbPath);
    try {
      sourceSqlite.exec(`
        INSERT INTO "site" ("id", "key", "status", "created_at", "updated_at")
        VALUES ('${SNAPSHOT_SITE_ID}', '${SNAPSHOT_SITE_KEY}', 'active', 1774009100, 1774009100);

        INSERT INTO "site_setting" ("site_id", "key", "value", "updated_at") VALUES
          ('${SNAPSHOT_SITE_ID}', 'SITE_NAME', 'Source', 1774009200);

        INSERT INTO "post" (
          "id", "site_id", "format", "status", "visibility", "title", "body", "body_html", "body_text",
          "thread_id", "published_at", "last_activity_at", "created_at", "updated_at"
        ) VALUES (
          '${SNAPSHOT_POST_ID}', '${SNAPSHOT_SITE_ID}', 'note', 'published', 'public',
          'Snapshot post', 'Hello snapshot', '<p>Hello snapshot</p>', 'Hello snapshot',
          '${SNAPSHOT_POST_ID}', 1774009200, 1774009200, 1774009200, 1774009200
        );

        INSERT INTO "media" (
          "id", "site_id", "post_id", "filename", "original_name", "mime_type", "size", "storage_key",
          "provider", "position", "media_kind", "created_at", "updated_at"
        ) VALUES (
          '${SNAPSHOT_MEDIA_ID}', '${SNAPSHOT_SITE_ID}', '${SNAPSHOT_POST_ID}',
          '${SNAPSHOT_MEDIA_ID}.png', 'sample.png', 'image/png', 4, '${SNAPSHOT_MEDIA_KEY}',
          'local', 'a0', 'image', 1774009200, 1774009200
        );
      `);

      targetSqlite.exec(`
        INSERT INTO "site" ("id", "key", "status", "created_at", "updated_at")
        VALUES ('${SNAPSHOT_SITE_ID}', '${SNAPSHOT_SITE_KEY}', 'active', 1774009000, 1774009000);
      `);
    } finally {
      sourceSqlite.close();
      targetSqlite.close();
    }

    useLocalSnapshotRuntime(`file:${sourceDbPath}`, sourceStoragePath);

    vi.spyOn(console, "log").mockImplementation(() => {});
    const { run: runExport } =
      await import("../../../bin/commands/site/snapshot/export.js");
    await runExport(["--output", snapshotPath, "--skip-objects"]);

    useLocalSnapshotRuntime(`file:${targetDbPath}`, targetStoragePath);

    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { run: runImport } =
      await import("../../../bin/commands/site/snapshot/import.js");
    await runImport([
      "--path",
      snapshotPath,
      "--replace",
      "--allow-missing-objects",
    ]);

    const verifySqlite = new Database(targetDbPath, { readonly: true });
    try {
      const mediaRow = verifySqlite
        .prepare(
          `SELECT "storage_key" FROM "media" WHERE "id" = '${SNAPSHOT_MEDIA_ID}'`,
        )
        .get() as { storage_key: string } | undefined;
      expect(mediaRow?.storage_key).toBe(SNAPSHOT_MEDIA_KEY);
    } finally {
      verifySqlite.close();
    }

    // Target storage still has the pre-existing file (we didn't try to upload).
    expect(await targetStorage.get(SNAPSHOT_MEDIA_KEY)).not.toBeNull();
  });

  it("requires --replace for snapshot import", async () => {
    const root = await mkdtemp(join(tmpdir(), "jant-site-snapshot-replace-"));
    tempDirs.push(root);

    const snapshotPath = join(root, "snapshot");
    useLocalSnapshotRuntime(
      `file:${join(root, "jant.sqlite")}`,
      join(root, "media"),
    );

    await rm(snapshotPath, { recursive: true, force: true });
    await mkdir(snapshotPath, { recursive: true });
    await Promise.all([
      writeFile(
        join(snapshotPath, "meta.json"),
        JSON.stringify(
          {
            format: "jant-site-snapshot",
            version: 1,
          },
          null,
          2,
        ),
      ),
      writeFile(join(snapshotPath, "db.sql"), ""),
    ]);

    const { run: runImport } =
      await import("../../../bin/commands/site/snapshot/import.js");

    await expect(runImport(["--path", snapshotPath])).rejects.toThrow(
      "Snapshot import currently requires --replace to avoid partial merge semantics.",
    );
  });

  it("can remap a content snapshot into a different existing target site", async () => {
    const root = await mkdtemp(join(tmpdir(), "jant-site-snapshot-remap-"));
    tempDirs.push(root);

    const sourceDbPath = join(root, "source.sqlite");
    const sourceStoragePath = join(root, "source-media");
    const targetDbPath = join(root, "target.sqlite");
    const targetStoragePath = join(root, "target-media");
    const snapshotPath = join(root, "snapshot");

    await migrate({ DATABASE_URL: `file:${sourceDbPath}` } as Bindings);
    await migrate({ DATABASE_URL: `file:${targetDbPath}` } as Bindings);

    const sourceStorage = createLocalDriver({ rootPath: sourceStoragePath });
    const targetStorage = createLocalDriver({ rootPath: targetStoragePath });

    await sourceStorage.put(SNAPSHOT_MEDIA_KEY, new Uint8Array([1, 2, 3, 4]), {
      contentType: "image/png",
    });
    await sourceStorage.put(SNAPSHOT_POSTER_KEY, new Uint8Array([9, 8, 7, 6]), {
      contentType: "image/webp",
    });
    await sourceStorage.put(SNAPSHOT_AVATAR_KEY, new Uint8Array([3, 3, 3]), {
      contentType: "image/png",
    });
    await sourceStorage.put(
      SNAPSHOT_APPLE_TOUCH_KEY,
      new Uint8Array([4, 4, 4]),
      {
        contentType: "image/png",
      },
    );

    const sourceSqlite = new Database(sourceDbPath);
    const targetSqlite = new Database(targetDbPath);

    try {
      sourceSqlite.exec(`
        INSERT INTO "site" ("id", "key", "status", "created_at", "updated_at")
        VALUES ('${SNAPSHOT_SITE_ID}', '${SNAPSHOT_SITE_KEY}', 'active', 1774009100, 1774009100);

        INSERT INTO "site_setting" ("site_id", "key", "value", "updated_at") VALUES
          ('${SNAPSHOT_SITE_ID}', 'SITE_NAME', 'Snapshot Source', 1774009200),
          ('${SNAPSHOT_SITE_ID}', 'SITE_AVATAR', '${SNAPSHOT_AVATAR_KEY}', 1774009202),
          ('${SNAPSHOT_SITE_ID}', 'SITE_FAVICON_APPLE_TOUCH', '${SNAPSHOT_APPLE_TOUCH_KEY}', 1774009203);

        INSERT INTO "post" (
          "id", "site_id", "format", "status", "visibility", "title", "body", "body_html", "body_text",
          "thread_id", "published_at", "last_activity_at", "created_at", "updated_at"
        ) VALUES (
          '${SNAPSHOT_POST_ID}', '${SNAPSHOT_SITE_ID}', 'note', 'published', 'public',
          'Snapshot post', 'Hello snapshot', '<p>Hello snapshot</p>', 'Hello snapshot',
          '${SNAPSHOT_POST_ID}', 1774009200, 1774009200, 1774009200, 1774009200
        );

        INSERT INTO "media" (
          "id", "site_id", "post_id", "filename", "original_name", "mime_type", "size", "storage_key",
          "provider", "width", "height", "alt", "position", "poster_key", "media_kind",
          "created_at", "updated_at"
        ) VALUES (
          '${SNAPSHOT_MEDIA_ID}', '${SNAPSHOT_SITE_ID}', '${SNAPSHOT_POST_ID}',
          '${SNAPSHOT_MEDIA_ID}.png', 'sample.png', 'image/png', 4, '${SNAPSHOT_MEDIA_KEY}',
          'local', 1, 1, 'Sample alt', 'a0', '${SNAPSHOT_POSTER_KEY}', 'image',
          1774009200, 1774009200
        );

        INSERT INTO "media" (
          "id", "site_id", "post_id", "filename", "original_name", "mime_type", "size", "storage_key",
          "provider", "position", "media_kind", "created_at", "updated_at"
        ) VALUES (
          '${SNAPSHOT_AVATAR_MEDIA_ID}', '${SNAPSHOT_SITE_ID}', NULL,
          '${SNAPSHOT_AVATAR_MEDIA_ID}.png', 'avatar.png', 'image/png', 3, '${SNAPSHOT_AVATAR_KEY}',
          'local', 'a0', 'image', 1774009202, 1774009202
        );

        INSERT INTO "media" (
          "id", "site_id", "post_id", "filename", "original_name", "mime_type", "size", "storage_key",
          "provider", "position", "media_kind", "created_at", "updated_at"
        ) VALUES (
          '${SNAPSHOT_APPLE_TOUCH_MEDIA_ID}', '${SNAPSHOT_SITE_ID}', NULL,
          'apple-touch-icon.png', 'apple-touch-icon.png', 'image/png', 3, '${SNAPSHOT_APPLE_TOUCH_KEY}',
          'local', 'a0', 'image', 1774009203, 1774009203
        );
      `);

      targetSqlite.exec(`
        INSERT INTO "site" ("id", "key", "status", "created_at", "updated_at")
        VALUES ('${REMAPPED_TARGET_SITE_ID}', '${REMAPPED_TARGET_SITE_KEY}', 'active', 1774009000, 1774009000);
      `);
    } finally {
      sourceSqlite.close();
      targetSqlite.close();
    }

    useLocalSnapshotRuntime(`file:${sourceDbPath}`, sourceStoragePath);

    const { run: runExport } =
      await import("../../../bin/commands/site/snapshot/export.js");
    await runExport(["--output", snapshotPath]);

    useLocalSnapshotRuntime(`file:${targetDbPath}`, targetStoragePath);

    const { run: runImport } =
      await import("../../../bin/commands/site/snapshot/import.js");
    await runImport([
      "--path",
      snapshotPath,
      "--replace",
      "--site",
      REMAPPED_TARGET_SITE_ID,
      "--remap-site",
    ]);

    const verifySqlite = new Database(targetDbPath, { readonly: true });
    try {
      const siteName = verifySqlite
        .prepare(
          `SELECT "value" FROM "site_setting" WHERE "site_id" = '${REMAPPED_TARGET_SITE_ID}' AND "key" = 'SITE_NAME'`,
        )
        .pluck()
        .get();
      expect(siteName).toBe("Snapshot Source");

      const avatarKey = verifySqlite
        .prepare(
          `SELECT "value" FROM "site_setting" WHERE "site_id" = '${REMAPPED_TARGET_SITE_ID}' AND "key" = 'SITE_AVATAR'`,
        )
        .pluck()
        .get();
      expect(avatarKey).toBe(REMAPPED_AVATAR_KEY);

      const mediaRow = verifySqlite
        .prepare(
          `
            SELECT "site_id", "storage_key", "poster_key"
            FROM "media"
            WHERE "id" = '${SNAPSHOT_MEDIA_ID}'
          `,
        )
        .get() as
        | {
            poster_key: string;
            site_id: string;
            storage_key: string;
          }
        | undefined;
      expect(mediaRow).toEqual({
        site_id: REMAPPED_TARGET_SITE_ID,
        storage_key: REMAPPED_MEDIA_KEY,
        poster_key: REMAPPED_POSTER_KEY,
      });
    } finally {
      verifySqlite.close();
    }

    expect(await targetStorage.get(REMAPPED_MEDIA_KEY)).not.toBeNull();
    expect(await targetStorage.get(REMAPPED_POSTER_KEY)).not.toBeNull();
    expect(await targetStorage.get(REMAPPED_AVATAR_KEY)).not.toBeNull();
    expect(await targetStorage.get(REMAPPED_APPLE_TOUCH_KEY)).not.toBeNull();
    expect(await targetStorage.get(SNAPSHOT_MEDIA_KEY)).toBeNull();
  });

  it("auto-remaps a snapshot into the only initialized site in single-site mode", async () => {
    const root = await mkdtemp(
      join(tmpdir(), "jant-site-snapshot-single-site-remap-"),
    );
    tempDirs.push(root);

    const sourceDbPath = join(root, "source.sqlite");
    const sourceStoragePath = join(root, "source-media");
    const targetDbPath = join(root, "target.sqlite");
    const targetStoragePath = join(root, "target-media");
    const snapshotPath = join(root, "snapshot");

    await migrate({ DATABASE_URL: `file:${sourceDbPath}` } as Bindings);
    await migrate({ DATABASE_URL: `file:${targetDbPath}` } as Bindings);

    const sourceStorage = createLocalDriver({ rootPath: sourceStoragePath });
    const targetStorage = createLocalDriver({ rootPath: targetStoragePath });

    await sourceStorage.put(SNAPSHOT_MEDIA_KEY, new Uint8Array([1, 2, 3, 4]), {
      contentType: "image/png",
    });
    await sourceStorage.put(SNAPSHOT_POSTER_KEY, new Uint8Array([9, 8, 7, 6]), {
      contentType: "image/webp",
    });
    await sourceStorage.put(SNAPSHOT_AVATAR_KEY, new Uint8Array([3, 3, 3]), {
      contentType: "image/png",
    });
    await sourceStorage.put(
      SNAPSHOT_APPLE_TOUCH_KEY,
      new Uint8Array([4, 4, 4]),
      {
        contentType: "image/png",
      },
    );

    const sourceSqlite = new Database(sourceDbPath);
    const targetSqlite = new Database(targetDbPath);

    try {
      sourceSqlite.exec(`
        INSERT INTO "site" ("id", "key", "status", "created_at", "updated_at")
        VALUES ('${SNAPSHOT_SITE_ID}', '${SNAPSHOT_SITE_KEY}', 'active', 1774009100, 1774009100);

        INSERT INTO "site_setting" ("site_id", "key", "value", "updated_at") VALUES
          ('${SNAPSHOT_SITE_ID}', 'SITE_NAME', 'Snapshot Source', 1774009200),
          ('${SNAPSHOT_SITE_ID}', 'SITE_AVATAR', '${SNAPSHOT_AVATAR_KEY}', 1774009202),
          ('${SNAPSHOT_SITE_ID}', 'SITE_FAVICON_APPLE_TOUCH', '${SNAPSHOT_APPLE_TOUCH_KEY}', 1774009203);

        INSERT INTO "post" (
          "id", "site_id", "format", "status", "visibility", "title", "body", "body_html", "body_text",
          "thread_id", "published_at", "last_activity_at", "created_at", "updated_at"
        ) VALUES (
          '${SNAPSHOT_POST_ID}', '${SNAPSHOT_SITE_ID}', 'note', 'published', 'public',
          'Snapshot post', 'Hello snapshot', '<p>Hello snapshot</p>', 'Hello snapshot',
          '${SNAPSHOT_POST_ID}', 1774009200, 1774009200, 1774009200, 1774009200
        );

        INSERT INTO "media" (
          "id", "site_id", "post_id", "filename", "original_name", "mime_type", "size", "storage_key",
          "provider", "width", "height", "alt", "position", "poster_key", "media_kind",
          "created_at", "updated_at"
        ) VALUES (
          '${SNAPSHOT_MEDIA_ID}', '${SNAPSHOT_SITE_ID}', '${SNAPSHOT_POST_ID}',
          '${SNAPSHOT_MEDIA_ID}.png', 'sample.png', 'image/png', 4, '${SNAPSHOT_MEDIA_KEY}',
          'local', 1, 1, 'Sample alt', 'a0', '${SNAPSHOT_POSTER_KEY}', 'image',
          1774009200, 1774009200
        );

        INSERT INTO "media" (
          "id", "site_id", "post_id", "filename", "original_name", "mime_type", "size", "storage_key",
          "provider", "position", "media_kind", "created_at", "updated_at"
        ) VALUES (
          '${SNAPSHOT_AVATAR_MEDIA_ID}', '${SNAPSHOT_SITE_ID}', NULL,
          '${SNAPSHOT_AVATAR_MEDIA_ID}.png', 'avatar.png', 'image/png', 3, '${SNAPSHOT_AVATAR_KEY}',
          'local', 'a0', 'image', 1774009202, 1774009202
        );

        INSERT INTO "media" (
          "id", "site_id", "post_id", "filename", "original_name", "mime_type", "size", "storage_key",
          "provider", "position", "media_kind", "created_at", "updated_at"
        ) VALUES (
          '${SNAPSHOT_APPLE_TOUCH_MEDIA_ID}', '${SNAPSHOT_SITE_ID}', NULL,
          'apple-touch-icon.png', 'apple-touch-icon.png', 'image/png', 3, '${SNAPSHOT_APPLE_TOUCH_KEY}',
          'local', 'a0', 'image', 1774009203, 1774009203
        );
      `);

      targetSqlite.exec(`
        INSERT INTO "site" ("id", "key", "status", "created_at", "updated_at")
        VALUES ('${REMAPPED_TARGET_SITE_ID}', '${REMAPPED_TARGET_SITE_KEY}', 'active', 1774009000, 1774009000);
      `);
    } finally {
      sourceSqlite.close();
      targetSqlite.close();
    }

    useLocalSnapshotRuntime(`file:${sourceDbPath}`, sourceStoragePath);
    delete process.env.SITE_RESOLUTION_MODE;

    const { run: runExport } =
      await import("../../../bin/commands/site/snapshot/export.js");
    await runExport(["--output", snapshotPath]);

    useLocalSnapshotRuntime(`file:${targetDbPath}`, targetStoragePath);
    delete process.env.SITE_RESOLUTION_MODE;

    const importLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const { run: runImport } =
      await import("../../../bin/commands/site/snapshot/import.js");
    await runImport(["--path", snapshotPath, "--replace"]);

    const verifySqlite = new Database(targetDbPath, { readonly: true });
    try {
      const siteName = verifySqlite
        .prepare(
          `SELECT "value" FROM "site_setting" WHERE "site_id" = '${REMAPPED_TARGET_SITE_ID}' AND "key" = 'SITE_NAME'`,
        )
        .pluck()
        .get();
      expect(siteName).toBe("Snapshot Source");

      const mediaRow = verifySqlite
        .prepare(
          `
            SELECT "site_id", "storage_key", "poster_key"
            FROM "media"
            WHERE "id" = '${SNAPSHOT_MEDIA_ID}'
          `,
        )
        .get() as
        | {
            poster_key: string;
            site_id: string;
            storage_key: string;
          }
        | undefined;
      expect(mediaRow).toEqual({
        site_id: REMAPPED_TARGET_SITE_ID,
        storage_key: REMAPPED_MEDIA_KEY,
        poster_key: REMAPPED_POSTER_KEY,
      });
    } finally {
      verifySqlite.close();
    }

    expect(importLogSpy).toHaveBeenCalledWith(
      `single-site mode detected. Remapping snapshot site ${SNAPSHOT_SITE_ID} to ${REMAPPED_TARGET_SITE_ID}.`,
    );
    expect(await targetStorage.get(REMAPPED_MEDIA_KEY)).not.toBeNull();
    expect(await targetStorage.get(REMAPPED_POSTER_KEY)).not.toBeNull();
    expect(await targetStorage.get(REMAPPED_AVATAR_KEY)).not.toBeNull();
    expect(await targetStorage.get(REMAPPED_APPLE_TOUCH_KEY)).not.toBeNull();
    expect(await targetStorage.get(SNAPSHOT_MEDIA_KEY)).toBeNull();
  });
});
