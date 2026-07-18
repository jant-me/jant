import Database from "better-sqlite3";
import { describe, expect, it, vi } from "vitest";
import {
  preflightThreadCollectionMigration,
  verifyThreadCollectionMigration,
} from "../../../bin/lib/thread-collection-migration.js";

function createQuery(sqlite: Database.Database) {
  return (sql: string) => sqlite.prepare(sql).all();
}

function createDialectQuery(
  sqlite: Database.Database,
  dialect: "pg" | "sqlite",
) {
  if (dialect === "sqlite") return createQuery(sqlite);

  return (sql: string) => {
    if (sql.includes("to_regclass('public.post_collection')")) {
      const tableExists = (name: string) =>
        sqlite
          .prepare(
            "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?",
          )
          .get(name) !== undefined;
      return [
        {
          legacy_exists: tableExists("post_collection"),
          target_exists: tableExists("thread_collection"),
        },
      ];
    }

    if (sql.includes("information_schema.columns")) {
      return sqlite
        .prepare(`PRAGMA table_info("post")`)
        .all()
        .map((row) => ({
          column_name: String((row as { name: unknown }).name),
        }));
    }

    return sqlite.prepare(sql).all();
  };
}

function createDomainTables(sqlite: Database.Database) {
  sqlite.exec(`
    CREATE TABLE site (
      id TEXT PRIMARY KEY
    );

    CREATE TABLE post (
      id TEXT PRIMARY KEY,
      site_id TEXT NOT NULL,
      reply_to_id TEXT,
      thread_id TEXT NOT NULL
    );

    CREATE TABLE collection (
      id TEXT PRIMARY KEY,
      site_id TEXT NOT NULL
    );
  `);
}

function createLegacyTable(sqlite: Database.Database) {
  sqlite.exec(`
    CREATE TABLE post_collection (
      site_id TEXT NOT NULL,
      post_id TEXT NOT NULL,
      collection_id TEXT NOT NULL
    );
  `);
}

function createTargetTable(sqlite: Database.Database) {
  sqlite.exec(`
    CREATE TABLE thread_collection (
      site_id TEXT NOT NULL,
      thread_id TEXT NOT NULL,
      collection_id TEXT NOT NULL,
      PRIMARY KEY (site_id, thread_id, collection_id)
    );
  `);
}

function seedLegacyThread(sqlite: Database.Database) {
  sqlite.exec(`
    INSERT INTO site (id) VALUES ('site-1');
    INSERT INTO post (id, site_id, reply_to_id, thread_id) VALUES
      ('root', 'site-1', NULL, 'root'),
      ('child-1', 'site-1', 'root', 'root'),
      ('child-2', 'site-1', 'child-1', 'root');
    INSERT INTO collection (id, site_id) VALUES
      ('shared', 'site-1'),
      ('child-only', 'site-1');
    INSERT INTO post_collection (site_id, post_id, collection_id) VALUES
      ('site-1', 'root', 'shared'),
      ('site-1', 'child-1', 'shared'),
      ('site-1', 'child-2', 'shared'),
      ('site-1', 'child-1', 'child-only');
  `);
}

function seedSoftDeletedLegacyMembership(sqlite: Database.Database) {
  sqlite.exec(`
    ALTER TABLE post ADD COLUMN deleted_at INTEGER;
  `);
  seedLegacyThread(sqlite);
  sqlite.exec(`
    INSERT INTO post (id, site_id, reply_to_id, thread_id, deleted_at)
    VALUES ('deleted-root', 'site-1', NULL, 'deleted-root', 100);
    INSERT INTO collection (id, site_id)
    VALUES ('deleted-only', 'site-1');
    INSERT INTO post_collection (site_id, post_id, collection_id)
    VALUES ('site-1', 'deleted-root', 'deleted-only');
  `);
}

function applySoftDeleteAndThreadCollectionCutover(
  sqlite: Database.Database,
  options: { loseChildOnlyMembership?: boolean } = {},
) {
  sqlite.exec(`
    DELETE FROM post_collection
    WHERE post_id IN (
      SELECT id FROM post WHERE deleted_at IS NOT NULL
    );
    DELETE FROM post WHERE deleted_at IS NOT NULL;
  `);
  createTargetTable(sqlite);
  sqlite.exec(`
    INSERT INTO thread_collection (site_id, thread_id, collection_id)
    SELECT membership.site_id, post.thread_id, membership.collection_id
    FROM post_collection AS membership
    INNER JOIN post
      ON post.site_id = membership.site_id
      AND post.id = membership.post_id
    ${options.loseChildOnlyMembership ? "WHERE membership.collection_id <> 'child-only'" : ""}
    GROUP BY membership.site_id, post.thread_id, membership.collection_id;
    DROP TABLE post_collection;
  `);
}

describe("Thread Collection migration guard", () => {
  it("verifies a fresh database after schema migration", async () => {
    const sqlite = new Database(":memory:");
    const query = createQuery(sqlite);

    await expect(
      preflightThreadCollectionMigration({
        dialect: "sqlite",
        log: vi.fn(),
        query,
      }),
    ).resolves.toEqual({ phase: "fresh" });

    createDomainTables(sqlite);
    createTargetTable(sqlite);

    await expect(
      verifyThreadCollectionMigration(
        { dialect: "sqlite", log: vi.fn(), query },
        { phase: "fresh" },
      ),
    ).resolves.toBeUndefined();

    sqlite.close();
  });

  it("records and verifies the lossless union before allowing repeat runs", async () => {
    const sqlite = new Database(":memory:");
    createDomainTables(sqlite);
    createLegacyTable(sqlite);
    seedLegacyThread(sqlite);
    const query = createQuery(sqlite);

    const preflight = await preflightThreadCollectionMigration({
      dialect: "sqlite",
      log: vi.fn(),
      query,
    });

    expect(preflight).toEqual({
      expectedCount: 2,
      phase: "legacy",
      sourceCount: 4,
    });

    createTargetTable(sqlite);
    sqlite.exec(`
      INSERT INTO thread_collection (site_id, thread_id, collection_id)
      SELECT membership.site_id, post.thread_id, membership.collection_id
      FROM post_collection AS membership
      INNER JOIN post
        ON post.site_id = membership.site_id
        AND post.id = membership.post_id
      GROUP BY membership.site_id, post.thread_id, membership.collection_id;
      DROP TABLE post_collection;
    `);

    await expect(
      verifyThreadCollectionMigration(
        { dialect: "sqlite", log: vi.fn(), query },
        preflight,
      ),
    ).resolves.toBeUndefined();

    const repeatPreflight = await preflightThreadCollectionMigration({
      dialect: "sqlite",
      log: vi.fn(),
      query,
    });
    expect(repeatPreflight).toEqual({ phase: "already-migrated" });
    await expect(
      verifyThreadCollectionMigration(
        { dialect: "sqlite", log: vi.fn(), query },
        repeatPreflight,
      ),
    ).resolves.toBeUndefined();

    sqlite.close();
  });

  it("stops before mutation when legacy memberships reference missing data", async () => {
    const sqlite = new Database(":memory:");
    createDomainTables(sqlite);
    createLegacyTable(sqlite);
    sqlite.exec(`
      INSERT INTO site (id) VALUES ('site-1');
      INSERT INTO collection (id, site_id) VALUES ('collection-1', 'site-1');
      INSERT INTO post_collection (site_id, post_id, collection_id)
      VALUES ('site-1', 'missing-post', 'collection-1');
    `);

    await expect(
      preflightThreadCollectionMigration({
        dialect: "sqlite",
        log: vi.fn(),
        query: createQuery(sqlite),
      }),
    ).rejects.toThrow("missing posts=1");
    expect(
      sqlite
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'post_collection'",
        )
        .get(),
    ).toEqual({ name: "post_collection" });

    sqlite.close();
  });

  it("rejects ambiguous and count-mismatched cutover states", async () => {
    const sqlite = new Database(":memory:");
    createDomainTables(sqlite);
    createLegacyTable(sqlite);
    seedLegacyThread(sqlite);
    createTargetTable(sqlite);
    const query = createQuery(sqlite);

    await expect(
      preflightThreadCollectionMigration({
        dialect: "sqlite",
        log: vi.fn(),
        query,
      }),
    ).rejects.toThrow("both post_collection and thread_collection");

    sqlite.exec(`
      DROP TABLE thread_collection;
    `);
    const preflight = await preflightThreadCollectionMigration({
      dialect: "sqlite",
      log: vi.fn(),
      query,
    });
    createTargetTable(sqlite);
    sqlite.exec(`
      INSERT INTO thread_collection (site_id, thread_id, collection_id)
      VALUES ('site-1', 'root', 'shared');
      DROP TABLE post_collection;
    `);

    await expect(
      verifyThreadCollectionMigration(
        { dialect: "sqlite", log: vi.fn(), query },
        preflight,
      ),
    ).rejects.toThrow("expected rows=2, actual rows=1");

    sqlite.close();
  });

  it.each(["sqlite", "pg"] as const)(
    "allows a %s legacy upgrade to discard collected soft-deleted posts",
    async (dialect) => {
      const sqlite = new Database(":memory:");
      createDomainTables(sqlite);
      createLegacyTable(sqlite);
      seedSoftDeletedLegacyMembership(sqlite);
      const query = createDialectQuery(sqlite, dialect);
      const log = vi.fn();

      const preflight = await preflightThreadCollectionMigration({
        dialect,
        log,
        query,
      });

      expect(preflight).toEqual({
        expectedCount: 2,
        phase: "legacy",
        sourceCount: 5,
      });
      expect(log).toHaveBeenCalledWith(
        expect.stringContaining(
          "1 soft-deleted post membership will be removed",
        ),
      );

      applySoftDeleteAndThreadCollectionCutover(sqlite);

      await expect(
        verifyThreadCollectionMigration(
          { dialect, log: vi.fn(), query },
          preflight,
        ),
      ).resolves.toBeUndefined();

      sqlite.close();
    },
  );

  it.each(["sqlite", "pg"] as const)(
    "still detects a real %s membership loss after anticipated soft deletes",
    async (dialect) => {
      const sqlite = new Database(":memory:");
      createDomainTables(sqlite);
      createLegacyTable(sqlite);
      seedSoftDeletedLegacyMembership(sqlite);
      const query = createDialectQuery(sqlite, dialect);
      const preflight = await preflightThreadCollectionMigration({
        dialect,
        log: vi.fn(),
        query,
      });

      applySoftDeleteAndThreadCollectionCutover(sqlite, {
        loseChildOnlyMembership: true,
      });

      await expect(
        verifyThreadCollectionMigration(
          { dialect, log: vi.fn(), query },
          preflight,
        ),
      ).rejects.toThrow("expected rows=2, actual rows=1");

      sqlite.close();
    },
  );
});
