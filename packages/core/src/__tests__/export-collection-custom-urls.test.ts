/**
 * A custom URL that names a Collection travels with the export: the
 * Collection's page lists it under `aliases`, and `jant site import`
 * registers it again. It used to stay behind, so the address answered 404 on
 * the imported site.
 */

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { parseFrontMatter } from "../lib/hugo-markdown.js";
import { createExportService } from "../services/export.js";
import { createTestApp } from "./helpers/app.js";
import { makeSiteConfig } from "./helpers/export-fixtures.js";
import {
  importSiteExportIntoTempSite,
  type SiteExportImportResult,
} from "./helpers/site-export-import.js";

describe("collection custom URLs in a site export", () => {
  const cleanups: Array<() => Promise<void> | void> = [];

  afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) await cleanup();
  });

  it("exports them on the Collection's page and imports them again", async () => {
    const { services } = createTestApp();
    const collection = await services.collections.create({
      title: "Ideas",
      slug: "ideas",
    });
    await services.customUrls.create({
      path: "/thoughts",
      targetType: "collection",
      targetId: collection.id,
    });

    const files = await createExportService(services, makeSiteConfig(), {
      bundleMedia: false,
    }).generateHugoFiles();
    const page = files.find((file) => file.path === "content/ideas/_index.md");
    const { frontMatter } = await parseFrontMatter(String(page?.content));
    expect(frontMatter.aliases).toEqual(["/thoughts"]);

    const dir = await mkdtemp(join(tmpdir(), "jant-collection-urls-"));
    cleanups.push(() => rm(dir, { recursive: true, force: true }));
    for (const file of files) {
      const path = join(dir, file.path);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, file.content);
    }

    const result: SiteExportImportResult = importSiteExportIntoTempSite(dir);
    cleanups.push(() => result.cleanup());
    expect(result.status, result.output).toBe(0);

    const sqlite = new Database(result.databasePath, { readonly: true });
    cleanups.push(() => sqlite.close());
    const row = sqlite
      .prepare(
        "SELECT collection_id FROM path_registry WHERE path = 'thoughts'",
      )
      .get() as { collection_id: string | null } | undefined;
    expect(row?.collection_id).toBeTruthy();
  }, 120_000);
});
