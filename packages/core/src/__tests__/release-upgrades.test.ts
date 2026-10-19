/**
 * A site upgrades in place from every release.
 *
 * `docs/compatibility.md` promises that a site upgrades in place to any later
 * version. The migration rehearsals start from one 0.3.39 seed, and
 * `release-fixtures.test.ts` restores each release's snapshot into a database
 * already at head, which proves the rows can be read again but not that they
 * upgrade. This starts each release's rows at the schema that release ran, the
 * `schema` its `snapshot/meta.json` records, runs `jant migrate` over them —
 * the remaining schema migrations, then every data backfill — and checks that
 * the site reads the same as the snapshot restored at head.
 *
 * It runs both of `jant migrate`'s SQLite runners: the D1 one, which applies
 * each migration with its tracking row as one batch, and the Node runtime's,
 * Drizzle's migrator, which applies every pending migration in one
 * transaction. Foreign keys stay on, as they are on a site, so a migration's
 * `PRAGMA foreign_keys=OFF` changes nothing inside that batch here either: a
 * migration that rebuilds a table other tables cascade from, which is how
 * drizzle-kit alters an existing column on SQLite, deletes their rows and
 * fails here.
 *
 * After the schema migrations, every row the snapshot carries has to match
 * the restored site's. After the backfills, only `describeSite` is compared:
 * this runs every backfill, while a site has already run the ones its release
 * shipped, and those aren't no-ops over rows written since — 0005 recomputes
 * `thread_updated_at` for a Thread holding only drafts.
 */

import {
  cpSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate as drizzleMigrate } from "drizzle-orm/better-sqlite3/migrator";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_D1_MIGRATIONS_TABLE,
  DEFAULT_DATA_MIGRATION_TABLE,
  listBackfillFiles,
  listSchemaMigrationFiles,
  resolveBundledBackfillsDir,
  resolveBundledSchemaMigrationsDir,
} from "../../bin/lib/migration-artifacts.js";
import {
  applyNodeBackfills,
  applyTrackedSqlFiles,
} from "../../bin/lib/migration-runner.js";
import {
  SNAPSHOT_TABLES,
  getSnapshotSelectSql,
} from "../../bin/lib/site-snapshot.js";
import { migrate as migrateNode } from "../node/runtime.js";
import type { Bindings } from "../types.js";
import { DEFAULT_TEST_SITE_ID, insertTestSite } from "./helpers/db.js";
import {
  RELEASES,
  RELEASES_DIR,
  describeSite,
  readReleaseSnapshot,
  restoreSnapshot,
} from "./helpers/release-fixtures.js";

const MIGRATIONS_DIR = resolveBundledSchemaMigrationsDir("sqlite");
const SCHEMA_MIGRATIONS = listSchemaMigrationFiles(MIGRATIONS_DIR);
const BACKFILLS = listBackfillFiles(resolveBundledBackfillsDir());

/** Open the database file with the foreign-key setting a site runs with. */
function withDatabase<T>(path: string, fn: (sqlite: Database.Database) => T) {
  const sqlite = new Database(path);
  try {
    sqlite.pragma("foreign_keys = ON");
    return fn(sqlite);
  } finally {
    sqlite.close();
  }
}

interface Runner {
  /** Migrate a new database only through `schema`. */
  migrateThrough(path: string, schema: string): void;
  /** `jant migrate`'s first step: every pending schema migration. */
  migrate(path: string): Promise<void>;
  /** Its second step: every data backfill not yet applied. */
  backfill(path: string): void;
}

/**
 * Apply `files` the way `jant migrate`'s D1 runner does, executing on the file
 * instead of through Wrangler. D1 runs each batch it is sent as one
 * transaction.
 */
function applyLikeD1(
  path: string,
  options: {
    files: { name: string; path: string }[];
    headline: string;
    tableName: string;
  },
) {
  withDatabase(path, (sqlite) =>
    applyTrackedSqlFiles(
      {
        execute(sql: string) {
          sqlite.transaction(() => sqlite.exec(sql))();
        },
        query(sql: string) {
          return sqlite.prepare(sql).all();
        },
      },
      options,
    ),
  );
}

const RUNNERS: Record<string, Runner> = {
  // `applyD1SchemaMigrations`, then `applyD1Backfills`.
  d1: {
    migrateThrough(path, schema) {
      const through = SCHEMA_MIGRATIONS.findIndex(
        (file) => file.tag === schema,
      );
      applyLikeD1(path, {
        files: SCHEMA_MIGRATIONS.slice(0, through + 1),
        headline: "Schema migrations",
        tableName: DEFAULT_D1_MIGRATIONS_TABLE,
      });
    },
    async migrate(path) {
      applyLikeD1(path, {
        files: SCHEMA_MIGRATIONS,
        headline: "Schema migrations",
        tableName: DEFAULT_D1_MIGRATIONS_TABLE,
      });
    },
    backfill(path) {
      applyLikeD1(path, {
        files: BACKFILLS,
        headline: "Data backfills",
        tableName: DEFAULT_DATA_MIGRATION_TABLE,
      });
    },
  },
  // `jant migrate --node` on SQLite: the runtime's `migrate`, then
  // `applyNodeBackfills`.
  node: {
    migrateThrough(path, schema) {
      // Drizzle applies every migration its folder's journal lists, so the
      // baseline runs from a copy whose journal stops at `schema`. The later
      // run over the real folder applies only what comes after it.
      const folder = mkdtempSync(join(tmpdir(), "jant-upgrade-migrations-"));
      try {
        cpSync(MIGRATIONS_DIR, folder, { recursive: true });
        const journalPath = join(folder, "meta/_journal.json");
        const journal = JSON.parse(readFileSync(journalPath, "utf8")) as {
          entries: { tag: string }[];
        };
        const through = journal.entries.findIndex(
          (entry) => entry.tag === schema,
        );
        writeFileSync(
          journalPath,
          JSON.stringify({
            ...journal,
            entries: journal.entries.slice(0, through + 1),
          }),
        );
        withDatabase(path, (sqlite) =>
          drizzleMigrate(drizzle(sqlite), { migrationsFolder: folder }),
        );
      } finally {
        rmSync(folder, { recursive: true, force: true });
      }
    },
    async migrate(path) {
      await migrateNode({ DATABASE_URL: `file:${path}` } as Bindings);
    },
    backfill(path) {
      withDatabase(path, (sqlite) => applyNodeBackfills(sqlite));
    },
  },
};

/** Every row a snapshot of the test site would carry. */
function readSnapshotRows(sqlite: Database.Database) {
  return Object.fromEntries(
    SNAPSHOT_TABLES.map((table: string) => [
      table,
      sqlite.prepare(getSnapshotSelectSql(table, DEFAULT_TEST_SITE_ID)).all(),
    ]),
  );
}

describe("release upgrades", () => {
  const tempDirs: string[] = [];

  beforeEach(() => {
    // The runners report each migration they apply.
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  for (const release of RELEASES) {
    const releaseDir = join(RELEASES_DIR, release);
    const snapshot = readReleaseSnapshot(releaseDir);
    const schema = snapshot.schema;
    // 0.7.0 and 0.7.1 wrote their snapshots before `meta.json` recorded the
    // schema, so there is no telling which migration their rows start from.
    if (!schema) continue;

    describe(release, () => {
      for (const [name, runner] of Object.entries(RUNNERS)) {
        it(`upgrades in place from ${schema} through the ${name} runner`, async () => {
          const dir = mkdtempSync(join(tmpdir(), "jant-upgrade-"));
          tempDirs.push(dir);
          const path = join(dir, "jant.sqlite");

          runner.migrateThrough(path, schema);
          withDatabase(path, (sqlite) => {
            insertTestSite(sqlite);
            sqlite.exec(snapshot.sql);
          });

          const restored = restoreSnapshot(releaseDir);
          try {
            await runner.migrate(path);
            withDatabase(path, (upgraded) =>
              expect(readSnapshotRows(upgraded)).toEqual(
                readSnapshotRows(restored),
              ),
            );

            runner.backfill(path);
            withDatabase(path, (upgraded) =>
              expect(describeSite(upgraded)).toEqual(describeSite(restored)),
            );
          } finally {
            restored.close();
          }
        });
      }
    });
  }
});
