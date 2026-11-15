/**
 * An Unlisted Thread on an exported site: its page is built, so its link keeps
 * working, and no list includes it — the same promise Jant makes.
 *
 * Builds the export with the real Hugo binary, because the theme reimplements
 * every list in Go templates and only a real build shows what a reader of the
 * static site gets. Skips when `hugo` is not on PATH, like the other Hugo
 * build tests.
 */

import { readdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDatabase, DEFAULT_TEST_SITE_ID } from "./helpers/db.js";
import { makeSiteConfig } from "./helpers/export-fixtures.js";
import { buildHugoSite, hugoAvailable } from "./helpers/hugo-site.js";
import { createCollectionService } from "../services/collection.js";
import { createExportService, type ExportFile } from "../services/export.js";
import { createMediaService } from "../services/media.js";
import { createPathService } from "../services/path.js";
import { createPostService } from "../services/post.js";
import type { Database } from "../db/index.js";

const SITE_URL = "https://example.com";
const SECRET = "unlisted-thread";

async function exportSite(): Promise<ExportFile[]> {
  const { db: testDb } = createTestDatabase();
  const db = testDb as unknown as Database;
  const siteId = DEFAULT_TEST_SITE_ID;
  const paths = createPathService(db, siteId);
  const posts = createPostService(db, { slugIdLength: 5 }, siteId);
  const collections = createCollectionService(db, siteId, paths);
  const media = createMediaService(db, siteId);

  const reading = await collections.create({ slug: "reading", title: "R" });
  await posts.create({
    slug: "public-thread",
    format: "note",
    bodyMarkdown: "Public words.",
    collectionIds: [reading.id],
    featured: true,
  });
  const root = await posts.create({
    slug: SECRET,
    format: "note",
    bodyMarkdown: "Unlisted words.",
    collectionIds: [reading.id],
    featured: true,
    visibility: "unlisted",
  });
  await posts.create({
    slug: "unlisted-reply",
    format: "note",
    bodyMarkdown: "A reply in the unlisted Thread.",
    replyToId: root.id,
  });

  return createExportService(
    { posts, paths, collections, media },
    makeSiteConfig({ siteUrl: SITE_URL }),
    { storage: null, bundleMedia: false },
  ).generateHugoFiles();
}

/** Every built file's text, keyed by its path under `public/`. */
async function readBuilt(
  dir: string,
  prefix = "",
): Promise<Map<string, string>> {
  const files = new Map<string, string>();
  for (const entry of await readdir(join(dir, prefix), {
    withFileTypes: true,
  })) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      for (const [nested, text] of await readBuilt(dir, path)) {
        files.set(nested, text);
      }
    } else if (/\.(html|xml)$/.test(entry.name)) {
      files.set(path, await readFile(join(dir, path), "utf8"));
    }
  }
  return files;
}

describe("an Unlisted Thread in the export", () => {
  it("is marked so Hugo builds it into no list and no sitemap", async () => {
    const files = await exportSite();
    const root = files.find(
      (file) => file.path === `content/${SECRET}/_index.md`,
    );
    expect(root).toBeDefined();
    const content = String((root as { content: string }).content);
    expect(content).toContain('visibility: "unlisted"');
    expect(content).toMatch(/build:\n\s+list: "never"/);
    expect(content).toMatch(/sitemap:\n\s+disable: true/);
    expect(content).not.toContain("draft: true");
  });
});

describe.skipIf(!hugoAvailable)("an Unlisted Thread on the built site", () => {
  let siteDir: string;
  let built: Map<string, string>;

  beforeAll(async () => {
    siteDir = await buildHugoSite(await exportSite());
    built = await readBuilt(join(siteDir, "public"));
  }, 60_000);

  afterAll(async () => {
    if (siteDir) await rm(siteDir, { recursive: true, force: true });
  });

  it("has a page at its address, kept out of search engines", () => {
    const page = built.get(`${SECRET}/index.html`);
    expect(page).toBeDefined();
    expect(page).toContain("Unlisted words.");
    expect(page).toContain("A reply in the unlisted Thread.");
    expect(page).toContain('<meta name="robots" content="noindex');
  });

  it("is linked from no other page or feed", () => {
    const listing = [...built].filter(
      ([path]) =>
        !path.startsWith(`${SECRET}/`) && !path.startsWith("unlisted-reply/"),
    );
    // The lists were really built: the Public Thread is in them.
    expect(
      listing.filter(([, text]) => text.includes("public-thread")).length,
    ).toBeGreaterThan(3);
    expect(
      listing
        .filter(([, text]) => text.includes(`/${SECRET}/`))
        .map(([path]) => path),
    ).toEqual([]);
  });
});
