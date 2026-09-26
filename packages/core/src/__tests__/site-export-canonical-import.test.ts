/**
 * Canonical Site-Export Import Guard
 *
 * `sites/demo-source/canonical/site-export/` is a committed `jant site export`.
 * `mise run db-node-load-demo` loads it the portable way: migrate a local Node
 * database, set it up, serve the app on a loopback port, and run
 * `jant site import` against that server.
 *
 * Nothing ran that path, and it broke twice without a sign. From b259f4e3 the
 * task called `site import` without the site URL the command had come to
 * require. From 6c79f0b4 the importer sent boolean settings the settings route
 * rejects, so importing any export stopped before it created a post. This test
 * runs the task's own script against a throwaway SQLite database, so a change
 * to the importer, the API it calls, the fixture, or the task fails here.
 *
 * `JANT_ENV_FILE` is empty for the whole suite (`vitest.config.ts`), and the
 * script honours it, so a developer's `.env.node` is neither read nor
 * rewritten. The script runs through `dev/run-script.mjs`, which starts Vite,
 * hence the timeout.
 */

import { readdirSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { __test__ as importSite } from "../../bin/commands/site/import.js";
import {
  importSiteExportIntoTempSite,
  type SiteExportImportResult,
} from "./helpers/site-export-import.js";

const CORE_DIR = resolve(import.meta.dirname, "../..");
const CANONICAL_DIR = resolve(
  CORE_DIR,
  "../../sites/demo-source/canonical/site-export",
);

function count(sqlite: Database.Database, sql: string): number {
  return (sqlite.prepare(sql).get() as { count: number }).count;
}

describe("canonical demo site-export", () => {
  const imports: SiteExportImportResult[] = [];

  afterEach(() => {
    for (const result of imports.splice(0)) result.cleanup();
  });

  it(
    "imports through `jant site import` into a local Node database at head",
    { timeout: 150_000 },
    async () => {
      const result = importSiteExportIntoTempSite();
      imports.push(result);
      const { databasePath, output } = result;

      expect(result.error).toBeUndefined();
      expect(result.status, output).toBe(0);
      expect(result.stdout).toContain("(none: JANT_ENV_FILE is empty)");
      // The importer reports a step it gave up on as a warning and carries on,
      // the way it once dropped the site avatar.
      expect(output).not.toMatch(/^Warning:/m);

      const { rootBundles, collectionBundles } =
        await importSite.walkHugoContent(CANONICAL_DIR);
      const siteConfig = await importSite.loadSiteConfig(CANONICAL_DIR);
      const replyCount = rootBundles.reduce(
        (sum: number, root: { children: unknown[] }) =>
          sum + root.children.length,
        0,
      );
      // An empty fixture and an import that did nothing would agree on zero.
      expect(rootBundles.length).toBeGreaterThan(0);
      const avatarFile = basename(siteConfig.extra.jant.site_avatar_url);
      const postMediaFiles = readdirSync(
        join(CANONICAL_DIR, "static/media"),
      ).filter((name) => name !== avatarFile);

      const sqlite = new Database(databasePath, { readonly: true });
      try {
        expect(count(sqlite, `SELECT COUNT(*) AS count FROM "user"`)).toBe(1);
        expect(count(sqlite, `SELECT COUNT(*) AS count FROM "post"`)).toBe(
          rootBundles.length + replyCount,
        );
        expect(
          count(sqlite, `SELECT COUNT(*) AS count FROM "collection"`),
        ).toBe(collectionBundles.length);
        expect(
          count(
            sqlite,
            `SELECT COUNT(*) AS count FROM "media" WHERE "storage_key" LIKE '%/files/%'`,
          ),
        ).toBe(postMediaFiles.length);

        const settings = new Map(
          (
            sqlite
              .prepare(`SELECT "key", "value" FROM "site_setting"`)
              .all() as { key: string; value: string }[]
          ).map(({ key, value }) => [key, value]),
        );
        expect(settings.get("SITE_NAME")).toBe(siteConfig.title);
        expect(settings.get("SITE_AVATAR")).toMatch(/\/assets\/avatar\//);
        expect(settings.get("SITE_FAVICON_ICO")).toBeTruthy();
        expect(settings.get("SITE_FAVICON_APPLE_TOUCH")).toMatch(
          /\/assets\/favicon\/apple-touch-icon\.png$/,
        );
      } finally {
        sqlite.close();
      }
    },
  );
});
