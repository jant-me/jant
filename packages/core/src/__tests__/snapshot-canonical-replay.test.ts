/**
 * Canonical Snapshot Replay Guard
 *
 * `sites/demo-source/canonical/snapshot/` is a committed SQL dump. The nightly
 * demo rebuild migrates demo.jant.me's database to whatever `main` says, then
 * replays that dump into it — so the dump has to stay loadable against head,
 * however long ago it was exported.
 *
 * Nothing checked that. A migration that renamed a column, added a NOT NULL
 * without a default, or reordered the snapshot registries would leave the
 * committed dump unloadable, and the first sign of it would be the reset job
 * failing at ~03:00 UTC — which nothing reports either. This test moves that
 * failure to the pull request that causes it.
 *
 * `createTestDatabase()` applies every migration in order and enables foreign
 * keys, so the replay here is checked at least as strictly as the real target.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DEFER_FOREIGN_KEYS_SQL,
  SNAPSHOT_TABLES,
  assertSnapshotMeta,
  buildReplaceSql,
  getSnapshotBootstrapSite,
  getSnapshotSelectSql,
  normalizeD1Sql,
  rewriteSnapshotSiteIdentifiers,
} from "../../bin/lib/site-snapshot.js";
import { DEFAULT_TEST_SITE_ID, createTestDatabase } from "./helpers/db.js";

const CANONICAL_DIR = resolve(
  import.meta.dirname,
  "../../../../sites/demo-source/canonical/snapshot",
);

function readCanonicalSql(): string {
  const meta = JSON.parse(
    readFileSync(resolve(CANONICAL_DIR, "meta.json"), "utf8"),
  );
  assertSnapshotMeta(meta);

  const snapshotSite = getSnapshotBootstrapSite(meta);
  if (!snapshotSite) {
    throw new Error("Canonical snapshot has no embedded site metadata.");
  }

  const rawDbSql = readFileSync(resolve(CANONICAL_DIR, "db.sql"), "utf8");
  return normalizeD1Sql(
    rewriteSnapshotSiteIdentifiers(
      rawDbSql,
      snapshotSite.id,
      DEFAULT_TEST_SITE_ID,
    ),
  );
}

describe("canonical demo snapshot", () => {
  it("replays into a database migrated to head", () => {
    const { sqlite } = createTestDatabase();
    const dbSql = readCanonicalSql();

    expect(() => {
      sqlite.exec(buildReplaceSql(DEFAULT_TEST_SITE_ID));
      sqlite.exec(dbSql);
    }).not.toThrow();

    // Guard against a vacuous pass: an empty dump would also "not throw".
    const posts = sqlite
      .prepare(`SELECT COUNT(*) AS count FROM "post" WHERE "site_id" = ?`)
      .get(DEFAULT_TEST_SITE_ID) as { count: number };
    expect(posts.count).toBeGreaterThan(0);
  });

  it("restores the language setup its posts are stamped for", () => {
    // The demo publishes in two languages. When the snapshot carried each
    // post's `language` but not `MULTILINGUAL_ENABLED`, every rebuild left
    // demo.jant.me serving no per-language views at all, and the Chinese side
    // of the demo disappeared at ~00:00 UTC each night.
    const { sqlite } = createTestDatabase();

    sqlite.exec(buildReplaceSql(DEFAULT_TEST_SITE_ID));
    sqlite.exec(readCanonicalSql());

    const languages = sqlite
      .prepare(
        `SELECT DISTINCT "language" FROM "post" WHERE "site_id" = ? AND "language" IS NOT NULL`,
      )
      .all(DEFAULT_TEST_SITE_ID) as { language: string }[];
    if (languages.length < 2) return;

    const settings = sqlite
      .prepare(
        `SELECT "key", "value" FROM "site_setting" WHERE "site_id" = ? AND "key" IN ('SITE_LANGUAGE', 'MULTILINGUAL_ENABLED', 'ADDITIONAL_LANGUAGES')`,
      )
      .all(DEFAULT_TEST_SITE_ID) as { key: string; value: string }[];
    const value = (key: string) =>
      settings.find((row) => row.key === key)?.value ?? "";

    expect(value("MULTILINGUAL_ENABLED")).toBe("true");

    const served = new Set([
      value("SITE_LANGUAGE"),
      ...value("ADDITIONAL_LANGUAGES").split(",").filter(Boolean),
    ]);
    expect(
      languages.map((row) => row.language).filter((tag) => !served.has(tag)),
    ).toEqual([]);
  });

  it("replays twice, the way a nightly rebuild does", () => {
    // `--replace` runs against a site that already holds the previous rebuild's
    // rows, so the delete order matters as much as the insert order. A first
    // load into an empty database would never exercise it.
    const { sqlite } = createTestDatabase();
    const dbSql = readCanonicalSql();

    sqlite.exec(buildReplaceSql(DEFAULT_TEST_SITE_ID));
    sqlite.exec(dbSql);

    expect(() => {
      sqlite.exec(buildReplaceSql(DEFAULT_TEST_SITE_ID));
      sqlite.exec(dbSql);
    }).not.toThrow();
  });
});

describe("snapshot export queries", () => {
  it("runs every content table's export query against head", () => {
    // The registry, the SELECT statement and the schema have to agree on
    // column names, not just table names. A stale `ORDER BY` column would
    // otherwise only surface the next time someone exported a snapshot.
    const { sqlite } = createTestDatabase();

    for (const table of SNAPSHOT_TABLES) {
      expect(() =>
        sqlite.prepare(getSnapshotSelectSql(table, DEFAULT_TEST_SITE_ID)).all(),
      ).not.toThrow();
    }
  });

  // Snapshots written before posts were ordered parents-first put a reply
  // older than its root ahead of the root. The import checks foreign keys at
  // commit on SQLite and D1, so those snapshots still load.
  it("loads a snapshot that lists a reply before its root", () => {
    const { sqlite } = createTestDatabase();
    const post = (id: string, threadId: string, replyToId: string | null) =>
      `INSERT INTO "post" ("id", "site_id", "format", "status", "visibility", "reply_to_id", "thread_id", "published_at", "last_activity_at", "created_at", "updated_at", "thread_updated_at") VALUES ('${id}', '${DEFAULT_TEST_SITE_ID}', 'note', 'published', 'public', ${replyToId ? `'${replyToId}'` : "NULL"}, '${threadId}', 1, 1, 1, 1, 1);`;
    const dump = [
      post(
        "pst_01aaaaaaaaaaaaaaaaaaaaaaab",
        "pst_01aaaaaaaaaaaaaaaaaaaaaaaa",
        "pst_01aaaaaaaaaaaaaaaaaaaaaaaa",
      ),
      post(
        "pst_01aaaaaaaaaaaaaaaaaaaaaaaa",
        "pst_01aaaaaaaaaaaaaaaaaaaaaaaa",
        null,
      ),
    ].join("\n");

    expect(() =>
      sqlite.transaction(() => {
        sqlite.exec(buildReplaceSql(DEFAULT_TEST_SITE_ID));
        sqlite.exec(dump);
      })(),
    ).toThrow(/FOREIGN KEY/);

    expect(() =>
      sqlite.transaction(() => {
        sqlite.exec(DEFER_FOREIGN_KEYS_SQL);
        sqlite.exec(buildReplaceSql(DEFAULT_TEST_SITE_ID));
        sqlite.exec(dump);
      })(),
    ).not.toThrow();
  });
});
