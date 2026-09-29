/**
 * Backups and exports written by a released Jant still load at head.
 *
 * `fixtures/releases/<version>/` freezes what that release wrote: a site
 * snapshot (`snapshot/meta.json` and `snapshot/db.sql`, no objects) and a
 * site export (`site-export/`, without the bundled theme's templates and
 * styles, which import doesn't read). From 0.8.0 on, that release's published
 * package writes both from the canonical demo content at its tag
 * (`scripts/release/freeze-fixtures.mjs`). 0.7.0 and 0.7.1 are copies of the
 * canonical directory at their tags, which earlier versions had written: a
 * July site export and a snapshot without `jant` or `schema`. Fixtures are
 * never edited afterwards.
 *
 * The canonical fixtures under `sites/demo-source/canonical/` are
 * re-exported as the demo changes, so they only prove that head reads what
 * head writes. These prove that head reads what every earlier release wrote,
 * which is what "a backup from 1.x restores on a later 1.x" means. A migration
 * that renames a column, or an importer change that drops an old field,
 * fails here. docs/RELEASING.md adds a directory at each release.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { __test__ as importSite } from "../../bin/commands/site/import.js";
import {
  assertSnapshotMeta,
  assertSnapshotSchemaInstalled,
  buildReplaceSql,
  getSnapshotBootstrapSite,
  normalizeD1Sql,
  rewriteSnapshotSiteIdentifiers,
  upgradeSnapshotSql,
} from "../../bin/lib/site-snapshot.js";
import { DEFAULT_TEST_SITE_ID, createTestDatabase } from "./helpers/db.js";
import {
  importSiteExportIntoTempSite,
  type SiteExportImportResult,
} from "./helpers/site-export-import.js";

const RELEASES_DIR = resolve(import.meta.dirname, "fixtures/releases");
const RELEASES = readdirSync(RELEASES_DIR, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

/**
 * Releases whose snapshot and site export weren't taken from one site: they
 * are copies of files earlier versions wrote at different times, so the two
 * don't describe the same content.
 */
const SEPARATELY_WRITTEN = new Set(["0.7.0", "0.7.1"]);

function count(sqlite: Database.Database, sql: string, ...params: unknown[]) {
  return (sqlite.prepare(sql).get(...params) as { count: number }).count;
}

/** Restore a release's snapshot into a new database migrated to head. */
function restoreSnapshot(releaseDir: string): Database.Database {
  const meta = JSON.parse(
    readFileSync(join(releaseDir, "snapshot/meta.json"), "utf8"),
  );
  assertSnapshotMeta(meta);
  assertSnapshotSchemaInstalled(meta);
  const site = getSnapshotBootstrapSite(meta);
  if (!site) throw new Error(`${releaseDir} snapshot names no site.`);

  const sql = normalizeD1Sql(
    rewriteSnapshotSiteIdentifiers(
      upgradeSnapshotSql(
        readFileSync(join(releaseDir, "snapshot/db.sql"), "utf8"),
        meta.version,
      ),
      site.id,
      DEFAULT_TEST_SITE_ID,
    ),
  );

  const { sqlite } = createTestDatabase();
  sqlite.exec(buildReplaceSql(DEFAULT_TEST_SITE_ID));
  sqlite.exec(sql);
  return sqlite;
}

/**
 * What a site export has to carry, read from a site's database. A release's
 * snapshot and site export come from one site, so the site the export
 * imports into has to read the same as the snapshot restored: every post
 * with its status and visibility, every address and redirect, the
 * collections, smart collections, navigation, and attachments. Archive
 * custom URLs are left out: an export lists them, but import skips them.
 */
function describeSite(sqlite: Database.Database) {
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

describe("release fixtures", () => {
  it("has at least one release to check", () => {
    expect(RELEASES.length).toBeGreaterThan(0);
  });

  for (const release of RELEASES) {
    describe(release, () => {
      const releaseDir = join(RELEASES_DIR, release);
      const imports: SiteExportImportResult[] = [];

      afterEach(() => {
        for (const result of imports.splice(0)) result.cleanup();
      });

      it("restores its snapshot into a database migrated to head", () => {
        const sqlite = restoreSnapshot(releaseDir);
        expect(
          count(
            sqlite,
            `SELECT COUNT(*) AS count FROM "post" WHERE "site_id" = ?`,
            DEFAULT_TEST_SITE_ID,
          ),
        ).toBeGreaterThan(0);
      });

      it(
        "imports its site export through `jant site import` at head",
        { timeout: 150_000 },
        async () => {
          const exportDir = join(releaseDir, "site-export");
          const result = importSiteExportIntoTempSite(exportDir);
          imports.push(result);

          expect(result.error).toBeUndefined();
          expect(result.status, result.output).toBe(0);
          expect(result.output).not.toMatch(/^Warning:/m);

          const { rootBundles, collectionBundles } =
            await importSite.walkHugoContent(exportDir);
          const replyCount = rootBundles.reduce(
            (sum: number, root: { children: unknown[] }) =>
              sum + root.children.length,
            0,
          );
          expect(rootBundles.length).toBeGreaterThan(0);

          const sqlite = new Database(result.databasePath, { readonly: true });
          try {
            expect(count(sqlite, `SELECT COUNT(*) AS count FROM "post"`)).toBe(
              rootBundles.length + replyCount,
            );
            expect(
              count(sqlite, `SELECT COUNT(*) AS count FROM "collection"`),
            ).toBe(collectionBundles.length);

            if (!SEPARATELY_WRITTEN.has(release)) {
              const restored = restoreSnapshot(releaseDir);
              try {
                expect(describeSite(sqlite)).toEqual(describeSite(restored));
              } finally {
                restored.close();
              }
            }
          } finally {
            sqlite.close();
          }
        },
      );
    });
  }
});
