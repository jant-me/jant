/**
 * An export whose post carries an address this release refuses still
 * imports whole.
 *
 * Before paths had to start with a letter or digit, the API stored addresses
 * such as `/~me` as a post's aliases, and exports list them in
 * `root_aliases`. `jant site import` stopped at the first one it couldn't
 * recreate, leaving the target site half imported; it now warns and goes on,
 * as it does for a Collection's aliases.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import {
  importSiteExportIntoTempSite,
  type SiteExportImportResult,
} from "./helpers/site-export-import.js";

const dirs: string[] = [];
const imports: SiteExportImportResult[] = [];

afterEach(() => {
  for (const result of imports.splice(0)) result.cleanup();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true });
});

function writeExport(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "jant-refused-alias-export-"));
  dirs.push(root);
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  return root;
}

describe("site import with a refused alias", () => {
  it(
    "imports the rest and names the alias it skipped",
    { timeout: 120_000 },
    () => {
      const exportDir = writeExport({
        "hugo.toml": 'baseURL = "https://old.example/"\ntitle = "Old site"\n',
        "data/jant.toml": [
          'format = "jant-site"',
          "version = 2",
          'site_name = "Old site"',
          'site_language = "en"',
          "",
        ].join("\n"),
        "content/_index.md": "---\ntitle: Old site\n---\n",
        "content/hello/_index.md": [
          "---",
          'id: "pst_01kn8jv8k1enf98tvpd2d9vqym"',
          'date: "2026-02-05T06:55:00.000Z"',
          'slug: "hello"',
          'type: "post"',
          'format: "note"',
          'status: "published"',
          'visibility: "public"',
          "root_aliases:",
          '  - "/~me/"',
          '  - "/hello-again/"',
          'language: "en"',
          "---",
          "",
          "Hello from the old site.",
          "",
        ].join("\n"),
      });

      const result = importSiteExportIntoTempSite(exportDir);
      imports.push(result);

      expect(result.error).toBeUndefined();
      expect(result.status, result.output).toBe(0);
      expect(result.output).toMatch(/Warning: couldn't add \/~me for "hello"/);
      expect(result.output).toMatch(/Aliases skipped: 1/);

      const sqlite = new Database(result.databasePath, { readonly: true });
      try {
        expect(
          sqlite
            .prepare(
              `SELECT "path" FROM "path_registry" WHERE "path" IN ('hello', 'hello-again', '~me') ORDER BY "path"`,
            )
            .pluck()
            .all(),
        ).toEqual(["hello", "hello-again"]);
      } finally {
        sqlite.close();
      }
    },
  );
});
