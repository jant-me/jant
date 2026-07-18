/**
 * Migration Integrity Tests
 *
 * Schema migrations stay append-only and must remain tracked in the Drizzle
 * journal. Most schema changes should be generated from `src/db/schema.ts`
 * via `mise run db-schema-generate`.
 *
 * Rare manual schema exceptions are allowed when Drizzle cannot express the
 * object, such as FTS virtual tables or triggers. Those files still belong in
 * `src/db/migrations/`, must keep canonical numbering, and must update the
 * journal/snapshot metadata in the same change.
 *
 * Historical business-data fixes belong in `src/db/backfills/`.
 */

import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { readdirSync, readFileSync } from "fs";
import { resolve } from "path";
import {
  extractNumberPrefix,
  isCanonicalNumberedSqlFile,
} from "../../../bin/lib/migration-artifacts.js";
import {
  preflightThreadCollectionMigration,
  verifyThreadCollectionMigration,
} from "../../../bin/lib/thread-collection-migration.js";

const MIGRATIONS_DIR = resolve(import.meta.dirname, "../migrations");
const PG_MIGRATIONS_DIR = resolve(import.meta.dirname, "../migrations/pg");
const BACKFILLS_DIR = resolve(import.meta.dirname, "../backfills");
const JOURNAL_PATH = resolve(MIGRATIONS_DIR, "meta/_journal.json");
const PG_JOURNAL_PATH = resolve(PG_MIGRATIONS_DIR, "meta/_journal.json");

interface JournalEntry {
  idx: number;
  version: string;
  when: number;
  tag: string;
  breakpoints: boolean;
}

interface Journal {
  version: string;
  dialect: string;
  entries: JournalEntry[];
}

function readJournal(path = JOURNAL_PATH): Journal {
  return JSON.parse(readFileSync(path, "utf-8"));
}

function listMigrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
}

function listBackfillFiles(): string[] {
  try {
    return readdirSync(BACKFILLS_DIR)
      .filter((f) => f.endsWith(".sql"))
      .sort();
  } catch {
    return [];
  }
}

function applyMigration(sqlite: Database.Database, filename: string) {
  const migration = readFileSync(resolve(MIGRATIONS_DIR, filename), "utf-8");
  for (const sql of migration.split("--> statement-breakpoint")) {
    const trimmed = sql.trim();
    if (!trimmed) continue;
    sqlite.exec(trimmed);
  }
}

function applyMigrationsThrough(
  sqlite: Database.Database,
  finalFilename: string,
) {
  for (const filename of listMigrationFiles()) {
    applyMigration(sqlite, filename);
    if (filename === finalFilename) return;
  }

  throw new Error(`Migration not found: ${finalFilename}`);
}

function applyMigrationsAfter(
  sqlite: Database.Database,
  previousFilename: string,
) {
  let foundPrevious = false;
  for (const filename of listMigrationFiles()) {
    if (foundPrevious) applyMigration(sqlite, filename);
    if (filename === previousFilename) foundPrevious = true;
  }

  if (!foundPrevious) {
    throw new Error(`Migration not found: ${previousFilename}`);
  }
}

function insertRootPost(
  sqlite: Database.Database,
  values: {
    siteId: string;
    id: string;
    title: string;
    bodyText: string;
    createdAt: number;
    visibility?: "public" | "latest_hidden" | "private";
  },
) {
  sqlite
    .prepare(
      `
        INSERT INTO post (
          id,
          site_id,
          format,
          status,
          visibility,
          title,
          body_text,
          thread_id,
          published_at,
          created_at,
          updated_at
        ) VALUES (?, ?, 'note', 'published', ?, ?, ?, ?, ?, ?, ?)
      `,
    )
    .run(
      values.id,
      values.siteId,
      values.visibility ?? "public",
      values.title,
      values.bodyText,
      values.id,
      values.createdAt,
      values.createdAt,
      values.createdAt,
    );
}

function searchPostFts(sqlite: Database.Database, query: string) {
  return sqlite
    .prepare(
      "SELECT rowid, title, body_text AS bodyText FROM post_fts WHERE post_fts MATCH ? ORDER BY rowid",
    )
    .all(query);
}

function insertSite(
  sqlite: Database.Database,
  values: { id: string; key: string; createdAt: number },
) {
  sqlite
    .prepare(
      `
        INSERT INTO site (id, key, status, created_at, updated_at)
        VALUES (?, ?, 'active', ?, ?)
      `,
    )
    .run(values.id, values.key, values.createdAt, values.createdAt);
}

describe("migration integrity", () => {
  it("every SQL file has a corresponding journal entry", () => {
    const journal = readJournal();
    const tags = new Set(journal.entries.map((e) => e.tag));
    const sqlFiles = listMigrationFiles();

    const untracked = sqlFiles
      .map((f) => f.replace(".sql", ""))
      .filter((tag) => !tags.has(tag));

    expect(
      untracked,
      [
        "These migration files are not tracked in meta/_journal.json.",
        "This usually means the file was added without matching Drizzle metadata.",
        "Default flow: update src/db/schema.ts first, then run `mise run db-schema-generate`.",
        "Manual schema exceptions must add the matching journal and snapshot files in the same change.",
        `Untracked files: ${untracked.map((t) => `${t}.sql`).join(", ")}`,
      ].join("\n"),
    ).toEqual([]);
  });

  it("every journal entry has a corresponding SQL file", () => {
    const journal = readJournal();
    const sqlFiles = new Set(
      listMigrationFiles().map((f) => f.replace(".sql", "")),
    );

    const missing = journal.entries
      .map((e) => e.tag)
      .filter((tag) => !sqlFiles.has(tag));

    expect(
      missing,
      [
        "These journal entries have no matching SQL file.",
        `Missing files: ${missing.map((t) => `${t}.sql`).join(", ")}`,
      ].join("\n"),
    ).toEqual([]);
  });

  it("journal entries have sequential idx values", () => {
    const journal = readJournal();
    for (let i = 0; i < journal.entries.length; i++) {
      const entry = journal.entries[i];
      if (entry) expect(entry.idx).toBe(i);
    }
  });

  it("journal entry timestamps stay in nondecreasing order", () => {
    const journals = [
      { label: "sqlite", path: JOURNAL_PATH },
      { label: "postgres", path: PG_JOURNAL_PATH },
    ];

    for (const { label, path } of journals) {
      const journal = readJournal(path);
      for (let i = 1; i < journal.entries.length; i++) {
        const previous = journal.entries[i - 1];
        const current = journal.entries[i];
        if (!previous || !current) continue;

        expect(
          current.when,
          `${label} migration journal must keep entries ordered by increasing "when" values: ${previous.tag} (${previous.when}) -> ${current.tag} (${current.when}).`,
        ).toBeGreaterThanOrEqual(previous.when);
      }
    }
  });

  it("latest migration has a snapshot file", () => {
    const journal = readJournal();
    const lastEntry = journal.entries[journal.entries.length - 1];
    if (!lastEntry) return;

    const prefix = lastEntry.tag.split("_")[0];
    const snapshotPath = resolve(
      MIGRATIONS_DIR,
      `meta/${prefix}_snapshot.json`,
    );

    let exists = false;
    try {
      readFileSync(snapshotPath);
      exists = true;
    } catch {
      // file doesn't exist
    }

    expect(
      exists,
      [
        `Missing snapshot for latest migration: meta/${prefix}_snapshot.json`,
        "This means the migration metadata is incomplete.",
        "Fix: run `mise run db-schema-generate`, or add the matching snapshot for a manual schema exception.",
      ].join("\n"),
    ).toBe(true);
  });

  it("schema migration files use canonical numbered filenames", () => {
    const invalid = listMigrationFiles().filter(
      (file) => !isCanonicalNumberedSqlFile(file),
    );

    expect(
      invalid,
      [
        "Schema migrations must use the `0000_name.sql` format.",
        "Generated and manual schema migrations share the same numbering rules.",
        "Use `src/db/backfills/` for historical data fixes instead.",
        `Invalid files: ${invalid.join(", ")}`,
      ].join("\n"),
    ).toEqual([]);
  });

  it("canonical schema migration number prefixes are unique", () => {
    const seen = new Map<string, string>();
    const duplicates: string[] = [];

    for (const file of listMigrationFiles()) {
      if (!isCanonicalNumberedSqlFile(file)) {
        continue;
      }

      const prefix = extractNumberPrefix(file);
      if (!prefix) {
        continue;
      }

      const previous = seen.get(prefix);
      if (previous) {
        duplicates.push(`${previous}, ${file}`);
        continue;
      }
      seen.set(prefix, file);
    }

    expect(
      duplicates,
      [
        "Canonical schema migrations must not share the same numeric prefix.",
        "Equal prefixes let external runners apply files in filesystem order.",
        `Duplicates: ${duplicates.join(" | ")}`,
      ].join("\n"),
    ).toEqual([]);
  });

  it("data backfills use canonical numbered filenames", () => {
    const files = listBackfillFiles();
    const invalid = files.filter((file) => !isCanonicalNumberedSqlFile(file));

    expect(
      invalid,
      [
        "Data backfills must use the `0000_name.sql` format.",
        "Backfills are append-only and tracked separately from schema migrations.",
        `Invalid files: ${invalid.join(", ")}`,
      ].join("\n"),
    ).toEqual([]);

    const seen = new Map<string, string>();
    const duplicates: string[] = [];
    for (const file of files) {
      const prefix = extractNumberPrefix(file);
      if (!prefix) {
        continue;
      }
      const previous = seen.get(prefix);
      if (previous) {
        duplicates.push(`${previous}, ${file}`);
        continue;
      }
      seen.set(prefix, file);
    }

    expect(
      duplicates,
      [
        "Data backfill number prefixes must be unique.",
        `Duplicates: ${duplicates.join(" | ")}`,
      ].join("\n"),
    ).toEqual([]);
  });

  it("migrates post collections into a lossless thread-level union", () => {
    const sqlite = new Database(":memory:");
    sqlite.pragma("foreign_keys = ON");

    applyMigrationsThrough(sqlite, "0026_absent_rhodey.sql");

    const siteId = "sit_test00000000000000000000000";
    const rootId = "post-root";
    const firstReplyId = "post-reply-1";
    const secondReplyId = "post-reply-2";
    const sharedCollectionId = "collection-shared";
    const childOnlyCollectionId = "collection-child-only";

    insertSite(sqlite, {
      id: siteId,
      key: "default",
      createdAt: 1,
    });

    sqlite
      .prepare(
        `
          INSERT INTO collection (
            id,
            site_id,
            title,
            description,
            sort_order,
            created_at,
            updated_at
          ) VALUES
            (?, ?, 'Shared', NULL, 'newest', 1, 1),
            (?, ?, 'Child only', NULL, 'newest', 2, 2)
        `,
      )
      .run(sharedCollectionId, siteId, childOnlyCollectionId, siteId);

    insertRootPost(sqlite, {
      siteId,
      id: rootId,
      title: "Root",
      bodyText: "Root body",
      createdAt: 10,
    });

    const insertReply = sqlite.prepare(
      `
        INSERT INTO post (
          id,
          site_id,
          format,
          status,
          visibility,
          title,
          body_text,
          reply_to_id,
          thread_id,
          published_at,
          last_activity_at,
          created_at,
          updated_at
        ) VALUES (?, ?, 'note', 'published', NULL, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    );
    insertReply.run(
      firstReplyId,
      siteId,
      "First reply",
      "First reply body",
      rootId,
      rootId,
      20,
      20,
      20,
      20,
    );
    insertReply.run(
      secondReplyId,
      siteId,
      "Second reply",
      "Second reply body",
      firstReplyId,
      rootId,
      30,
      30,
      30,
      30,
    );

    const insertMembership = sqlite.prepare(
      `
        INSERT INTO post_collection (
          site_id,
          post_id,
          collection_id,
          created_at,
          position,
          pinned_at
        ) VALUES (?, ?, ?, ?, ?, ?)
      `,
    );
    insertMembership.run(siteId, rootId, sharedCollectionId, 100, 7, 300);
    insertMembership.run(
      siteId,
      firstReplyId,
      sharedCollectionId,
      400,
      5,
      null,
    );
    insertMembership.run(
      siteId,
      secondReplyId,
      sharedCollectionId,
      250,
      1,
      900,
    );
    insertMembership.run(
      siteId,
      firstReplyId,
      childOnlyCollectionId,
      500,
      4,
      700,
    );

    expect(
      sqlite.prepare("SELECT COUNT(*) AS count FROM post_collection").get(),
    ).toEqual({ count: 4 });

    applyMigration(sqlite, "0027_old_blue_blade.sql");

    expect(
      sqlite
        .prepare(
          `
            SELECT
              site_id AS siteId,
              thread_id AS threadId,
              collection_id AS collectionId,
              created_at AS createdAt,
              position,
              pinned_at AS pinnedAt
            FROM thread_collection
            ORDER BY collection_id
          `,
        )
        .all(),
    ).toEqual([
      {
        siteId,
        threadId: rootId,
        collectionId: childOnlyCollectionId,
        createdAt: 500,
        position: 4,
        pinnedAt: 700,
      },
      {
        siteId,
        threadId: rootId,
        collectionId: sharedCollectionId,
        createdAt: 400,
        position: 1,
        pinnedAt: 900,
      },
    ]);

    expect(
      sqlite
        .prepare(
          `
            SELECT COUNT(*) AS count
            FROM thread_collection tc
            INNER JOIN post root
              ON root.site_id = tc.site_id
              AND root.id = tc.thread_id
            WHERE root.reply_to_id IS NOT NULL
              OR root.thread_id <> root.id
          `,
        )
        .get(),
    ).toEqual({ count: 0 });
    expect(
      sqlite
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'post_collection'",
        )
        .get(),
    ).toBeUndefined();
    expect(sqlite.pragma("foreign_key_check")).toEqual([]);
  });

  it("verifies an upgrade from 0020 with a collected soft-deleted post", async () => {
    const sqlite = new Database(":memory:");
    sqlite.pragma("foreign_keys = ON");
    applyMigrationsThrough(sqlite, "0020_free_zaladane.sql");

    const siteId = "sit_soft_delete_upgrade";
    const collectionId = "collection-upgrade";
    insertSite(sqlite, { id: siteId, key: "default", createdAt: 1 });
    sqlite
      .prepare(
        `
          INSERT INTO collection (
            id,
            site_id,
            title,
            description,
            sort_order,
            created_at,
            updated_at
          ) VALUES (?, ?, 'Upgrade', NULL, 'newest', 1, 1)
        `,
      )
      .run(collectionId, siteId);
    insertRootPost(sqlite, {
      siteId,
      id: "post-live",
      title: "Live",
      bodyText: "Live post",
      createdAt: 10,
    });
    insertRootPost(sqlite, {
      siteId,
      id: "post-soft-deleted",
      title: "Deleted",
      bodyText: "Deleted post",
      createdAt: 20,
    });
    sqlite
      .prepare("UPDATE post SET deleted_at = ? WHERE id = ?")
      .run(30, "post-soft-deleted");
    sqlite.exec(`
      INSERT INTO post_collection (
        site_id,
        post_id,
        collection_id,
        created_at,
        position,
        pinned_at
      ) VALUES
        ('${siteId}', 'post-live', '${collectionId}', 10, 0, NULL),
        ('${siteId}', 'post-soft-deleted', '${collectionId}', 20, 0, NULL);
    `);

    const query = (sql: string) => sqlite.prepare(sql).all();
    const preflight = await preflightThreadCollectionMigration({
      dialect: "sqlite",
      log: () => undefined,
      query,
    });
    expect(preflight).toEqual({
      expectedCount: 1,
      phase: "legacy",
      sourceCount: 2,
    });

    applyMigrationsAfter(sqlite, "0020_free_zaladane.sql");

    await expect(
      verifyThreadCollectionMigration(
        { dialect: "sqlite", log: () => undefined, query },
        preflight,
      ),
    ).resolves.toBeUndefined();
    expect(
      sqlite
        .prepare(
          "SELECT thread_id AS threadId FROM thread_collection ORDER BY thread_id",
        )
        .all(),
    ).toEqual([{ threadId: "post-live" }]);
    expect(sqlite.pragma("foreign_key_check")).toEqual([]);

    sqlite.close();
  });

  it("indexes Featured Thread ordering by publication time in both dialects", () => {
    const sqlite = new Database(":memory:");
    sqlite.pragma("foreign_keys = ON");

    applyMigrationsThrough(sqlite, "0027_old_blue_blade.sql");
    applyMigration(sqlite, "0028_superb_post.sql");

    const indexes = sqlite
      .prepare(
        `
          SELECT name
          FROM sqlite_master
          WHERE type = 'index'
            AND name IN (
              'idx_post_site_featured_featured_at',
              'idx_post_site_featured_thread_published'
            )
          ORDER BY name
        `,
      )
      .all();
    expect(indexes).toEqual([
      { name: "idx_post_site_featured_thread_published" },
    ]);
    expect(
      sqlite
        .prepare(
          "SELECT name FROM pragma_index_info('idx_post_site_featured_thread_published') ORDER BY seqno",
        )
        .all(),
    ).toEqual([
      { name: "site_id" },
      { name: "thread_id" },
      { name: "published_at" },
      { name: "id" },
    ]);

    insertSite(sqlite, {
      id: "sit_test00000000000000000000000",
      key: "default",
      createdAt: 1,
    });
    sqlite.exec(`
      WITH RECURSIVE sequence(value) AS (
        VALUES (1)
        UNION ALL
        SELECT value + 1 FROM sequence WHERE value < 1000
      )
      INSERT INTO post (
        id,
        site_id,
        format,
        status,
        visibility,
        title,
        body_text,
        thread_id,
        published_at,
        featured_at,
        created_at,
        updated_at
      )
      SELECT
        printf('post-%04d', value),
        'sit_test00000000000000000000000',
        'note',
        'published',
        'public',
        printf('Post %d', value),
        '',
        printf('post-%04d', value),
        value,
        CASE WHEN value % 20 = 0 THEN value + 1000 ELSE NULL END,
        value,
        value
      FROM sequence
    `);
    sqlite.exec("ANALYZE");

    const queryPlan = sqlite
      .prepare(
        `
          EXPLAIN QUERY PLAN
          SELECT
            thread_id,
            MAX(published_at) AS latest_featured_published_at
          FROM post
          WHERE site_id = ?
            AND status = 'published'
            AND featured_at IS NOT NULL
          GROUP BY thread_id
          ORDER BY latest_featured_published_at DESC, thread_id DESC
          LIMIT 20
        `,
      )
      .all("sit_test00000000000000000000000") as Array<{
      detail: string;
    }>;
    expect(
      queryPlan.some(({ detail }) =>
        detail.includes("idx_post_site_featured_thread_published"),
      ),
      JSON.stringify(queryPlan),
    ).toBe(true);
    expect(
      queryPlan.some(({ detail }) => detail.includes("FOR GROUP BY")),
    ).toBe(false);

    const postgresMigration = readFileSync(
      resolve(PG_MIGRATIONS_DIR, "0026_talented_killer_shrike.sql"),
      "utf-8",
    );
    expect(postgresMigration).toContain(
      'DROP INDEX "idx_post_site_featured_featured_at"',
    );
    expect(postgresMigration).toContain(
      'CREATE INDEX "idx_post_site_featured_thread_published" ON "post" USING btree ("site_id","thread_id","published_at","id")',
    );
  });

  it("fts schema migration rebuilds and maintains the post_fts index", () => {
    const sqlite = new Database(":memory:");
    sqlite.pragma("foreign_keys = ON");

    applyMigration(sqlite, "0000_baseline.sql");
    applyMigration(sqlite, "0001_fts_setup.sql");
    applyMigration(sqlite, "0002_site_aware_core.sql");
    insertSite(sqlite, {
      id: "sit_test00000000000000000000000",
      key: "default",
      createdAt: 1,
    });
    applyMigration(sqlite, "0003_fts_site_aware.sql");

    insertRootPost(sqlite, {
      siteId: "sit_test00000000000000000000000",
      id: "post-1",
      title: "Alpha note",
      bodyText: "alpha beta",
      createdAt: 1,
    });

    expect(searchPostFts(sqlite, "alpha")).toEqual([
      {
        rowid: 1,
        title: "Alpha note",
        bodyText: "alpha beta",
      },
    ]);

    insertRootPost(sqlite, {
      siteId: "sit_test00000000000000000000000",
      id: "post-2",
      title: "Beta note",
      bodyText: "delta epsilon",
      createdAt: 2,
    });

    expect(searchPostFts(sqlite, "delta")).toEqual([
      {
        rowid: 2,
        title: "Beta note",
        bodyText: "delta epsilon",
      },
    ]);

    sqlite
      .prepare(
        "UPDATE post SET title = ?, body_text = ?, updated_at = ? WHERE id = ?",
      )
      .run("Gamma note", "gamma theta", 3, "post-2");

    expect(searchPostFts(sqlite, "delta")).toEqual([]);
    expect(searchPostFts(sqlite, "gamma")).toEqual([
      {
        rowid: 2,
        title: "Gamma note",
        bodyText: "gamma theta",
      },
    ]);

    sqlite.prepare("DELETE FROM post WHERE id = ?").run("post-1");
    expect(searchPostFts(sqlite, "alpha")).toEqual([]);
  });

  it("baseline schema stores latest_hidden visibility and keeps FTS working", () => {
    const sqlite = new Database(":memory:");
    sqlite.pragma("foreign_keys = ON");

    applyMigration(sqlite, "0000_baseline.sql");
    applyMigration(sqlite, "0001_fts_setup.sql");
    applyMigration(sqlite, "0002_site_aware_core.sql");
    insertSite(sqlite, {
      id: "sit_test00000000000000000000000",
      key: "default",
      createdAt: 1,
    });
    applyMigration(sqlite, "0003_fts_site_aware.sql");

    insertRootPost(sqlite, {
      siteId: "sit_test00000000000000000000000",
      id: "latest-hidden-post",
      title: "Latest hidden note",
      bodyText: "latest hidden body",
      createdAt: 1,
      visibility: "latest_hidden",
    });

    expect(searchPostFts(sqlite, "latest")).toEqual([
      {
        rowid: 1,
        title: "Latest hidden note",
        bodyText: "latest hidden body",
      },
    ]);

    const rows = sqlite
      .prepare("SELECT id, visibility FROM post WHERE id = ?")
      .all("latest-hidden-post");

    expect(rows).toEqual([
      { id: "latest-hidden-post", visibility: "latest_hidden" },
    ]);
  });
});
