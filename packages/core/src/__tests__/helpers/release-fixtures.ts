/**
 * Release Fixture Helpers
 *
 * Reads the frozen release fixtures under `fixtures/releases/<version>/`;
 * `release-fixtures.test.ts` says what they hold and how they are made.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type Database from "better-sqlite3";
import {
  assertSnapshotMeta,
  assertSnapshotSchemaInstalled,
  buildReplaceSql,
  getSnapshotBootstrapSite,
  normalizeD1Sql,
  rewriteSnapshotSiteIdentifiers,
  upgradeSnapshotSql,
} from "../../../bin/lib/site-snapshot.js";
import { DEFAULT_TEST_SITE_ID, createTestDatabase } from "./db.js";

export const RELEASES_DIR = resolve(
  import.meta.dirname,
  "../fixtures/releases",
);

/** The version of every frozen release, sorted by name. */
export const RELEASES = readdirSync(RELEASES_DIR, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

export function count(
  sqlite: Database.Database,
  sql: string,
  ...params: unknown[]
) {
  return (sqlite.prepare(sql).get(...params) as { count: number }).count;
}

/**
 * A release's snapshot, ready to load into the test site.
 *
 * @param releaseDir - `fixtures/releases/<version>`
 * @returns `schema`, the last migration of the release that wrote the
 *   snapshot (absent before 0.8.0), and `sql`, which clears the test site's
 *   content and inserts the snapshot's rows in its place
 * @example
 * ```ts
 * const { sql } = readReleaseSnapshot(join(RELEASES_DIR, "0.8.0"));
 * sqlite.exec(sql);
 * ```
 */
export function readReleaseSnapshot(releaseDir: string) {
  const meta: unknown = JSON.parse(
    readFileSync(join(releaseDir, "snapshot/meta.json"), "utf8"),
  );
  assertSnapshotMeta(meta);
  assertSnapshotSchemaInstalled(meta);
  const site = getSnapshotBootstrapSite(meta);
  if (!site) throw new Error(`${releaseDir} snapshot names no site.`);

  const rows = normalizeD1Sql(
    rewriteSnapshotSiteIdentifiers(
      upgradeSnapshotSql(
        readFileSync(join(releaseDir, "snapshot/db.sql"), "utf8"),
        meta.version,
      ),
      site.id,
      DEFAULT_TEST_SITE_ID,
    ),
  );

  return {
    schema: meta.schema,
    sql: `${buildReplaceSql(DEFAULT_TEST_SITE_ID)}\n${rows}`,
  };
}

/**
 * Restore a release's snapshot into a new database migrated to head.
 *
 * @param releaseDir - `fixtures/releases/<version>`
 * @returns The database, holding the snapshot's rows under the test site
 * @example
 * ```ts
 * const sqlite = restoreSnapshot(join(RELEASES_DIR, "0.8.0"));
 * ```
 */
export function restoreSnapshot(releaseDir: string): Database.Database {
  const { sqlite } = createTestDatabase();
  sqlite.exec(readReleaseSnapshot(releaseDir).sql);
  return sqlite;
}

/**
 * What a release's content reads as in a site's database: every post with
 * its status and visibility, every address and redirect, the collections,
 * smart collections, navigation, and attachments.
 *
 * It counts rather than lists, so two sites compare equal even when their IDs
 * differ, as they do between a snapshot restored and a site export imported.
 * Archive custom URLs are left out: an export lists them, but import skips
 * them.
 *
 * @param sqlite - The site's database
 * @returns A summary to compare with `toEqual`
 * @example
 * ```ts
 * expect(describeSite(imported)).toEqual(describeSite(restored));
 * ```
 */
export function describeSite(sqlite: Database.Database) {
  const rows = (sql: string) => sqlite.prepare(sql).all();
  return {
    posts: rows(
      `SELECT "format", "status", "visibility", COUNT(*) AS "count" FROM "post" GROUP BY 1, 2, 3 ORDER BY 1, 2, 3`,
    ),
    paths: rows(
      `SELECT "path", "kind", "redirect_to_path" AS "to", "redirect_type" AS "type" FROM "path_registry" WHERE "kind" IN ('slug', 'alias', 'redirect') ORDER BY "path"`,
    ),
    tables: Object.fromEntries(
      [
        "collection",
        "smart_collection",
        "nav_item",
        "collection_directory_item",
        "thread_collection",
      ].map((table) => [
        table,
        count(sqlite, `SELECT COUNT(*) AS count FROM "${table}"`),
      ]),
    ),
    attachments: rows(
      `SELECT "media_kind" AS "kind", COUNT(*) AS "count" FROM "media" WHERE "post_id" IS NOT NULL GROUP BY 1 ORDER BY 1`,
    ),
  };
}
