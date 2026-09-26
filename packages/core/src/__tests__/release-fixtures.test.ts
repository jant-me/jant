/**
 * Backups and exports written by a released Jant still load at head.
 *
 * `fixtures/releases/<version>/` freezes what that release wrote: a site
 * snapshot (`snapshot/meta.json` and `snapshot/db.sql`, no objects) and a
 * site export (`site-export/`, without the bundled theme's templates and
 * styles, which import doesn't read). Both come from the canonical demo
 * content at that release's tag and are never edited afterwards.
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

function count(sqlite: Database.Database, sql: string, ...params: unknown[]) {
  return (sqlite.prepare(sql).get(...params) as { count: number }).count;
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
        const meta = JSON.parse(
          readFileSync(join(releaseDir, "snapshot/meta.json"), "utf8"),
        );
        assertSnapshotMeta(meta);
        assertSnapshotSchemaInstalled(meta);
        const site = getSnapshotBootstrapSite(meta);
        if (!site) throw new Error(`${release} snapshot names no site.`);

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
        expect(() => {
          sqlite.exec(buildReplaceSql(DEFAULT_TEST_SITE_ID));
          sqlite.exec(sql);
        }).not.toThrow();
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
          } finally {
            sqlite.close();
          }
        },
      );
    });
  }
});
