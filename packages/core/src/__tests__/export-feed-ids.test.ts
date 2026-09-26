/**
 * An exported site's feeds keep the entry IDs Jant's feeds served.
 *
 * A feed reader recognises an entry it has already shown by its `<id>` alone.
 * The Hugo page a post moves to has a different URL — a trailing slash
 * always, and the slug where Jant used a custom path — so a feed that took
 * `<id>` from the page URL would show every post again to every subscriber
 * after a site moves to its export. This serves Jant's feed and builds the
 * export with the real Hugo binary from the same database, and compares the
 * IDs.
 *
 * Skips when `hugo` is not on PATH, like the other Hugo build tests.
 */

import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { Hono } from "hono";
import { afterAll, describe, expect, it } from "vitest";
import { createTestDatabase, DEFAULT_TEST_SITE_ID } from "./helpers/db.js";
import { makeSiteConfig } from "./helpers/export-fixtures.js";
import { buildHugoSite, hugoAvailable } from "./helpers/hugo-site.js";
import { resolveConfig } from "../lib/resolve-config.js";
import { latestRoutes } from "../routes/pages/latest.js";
import { createCollectionService } from "../services/collection.js";
import { createExportService } from "../services/export.js";
import { createMediaService } from "../services/media.js";
import { createPathService } from "../services/path.js";
import { createPostService } from "../services/post.js";
import { createSettingsService } from "../services/settings.js";
import type { Database } from "../db/index.js";
import type { Bindings } from "../types.js";
import type { AppVariables } from "../types/app-context.js";

type Env = { Bindings: Bindings; Variables: AppVariables };

const ORIGIN = "https://example.com";
const CUSTOM_PATH = "/blog/links/2024-06-09-4";
const CUSTOM_SLUG = "blog-links-2024-06-09-4";
const at = (iso: string) => Math.floor(Date.parse(iso) / 1000);

interface Entry {
  id: string;
  alternate: string;
}

/** Each entry's `<id>` and `<link rel="alternate">`, in document order. */
function readEntries(xml: string): Entry[] {
  return [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map(([, body]) => ({
    id: body?.match(/<id>([^<]*)<\/id>/)?.[1] ?? "",
    alternate:
      body?.match(/<link href="([^"]*)" rel="alternate"\/>/)?.[1] ?? "",
  }));
}

const ids = (entries: Entry[]) => entries.map((entry) => entry.id).sort();

describe.skipIf(!hugoAvailable)("feed entry IDs on an exported site", () => {
  const siteDirs: string[] = [];

  afterAll(async () => {
    for (const dir of siteDirs) await rm(dir, { recursive: true, force: true });
  });

  it.each([
    { where: "at the domain root", prefix: "" },
    { where: "under a site path prefix", prefix: "/journal" },
  ])(
    "match what Jant's feed served, $where",
    async ({ prefix }) => {
      const { db: testDb } = createTestDatabase();
      const db = testDb as unknown as Database;
      const siteId = DEFAULT_TEST_SITE_ID;
      const paths = createPathService(db, siteId);
      const posts = createPostService(db, { slugIdLength: 5 }, siteId, paths);
      const collections = createCollectionService(db, siteId, paths);
      const media = createMediaService(db, siteId);
      const settings = createSettingsService(db, siteId);

      // Served at its random slug, which is what an untitled note gets.
      const plain = await posts.create({
        format: "note",
        bodyMarkdown: "A plain note.",
        status: "published",
        publishedAt: at("2024-06-01T00:00:00Z"),
      });
      // Served at a custom path, which its entry is named by. Its slug is
      // where the Hugo page goes.
      const custom = await posts.create({
        format: "link",
        slug: CUSTOM_SLUG,
        title: "A link",
        url: "https://other.example/article",
        status: "published",
        publishedAt: at("2024-06-09T00:00:00Z"),
      });
      await paths.create({
        path: CUSTOM_PATH,
        kind: "alias",
        postId: custom.id,
      });

      const env = {
        SITE_ORIGIN: ORIGIN,
        SITE_PATH_PREFIX: prefix,
        RSS_PUBLISH_DELAY_SECONDS: 0,
      } as Bindings;
      const appConfig = resolveConfig(env, await settings.getAll());
      const app = new Hono<Env>();
      app.use("*", async (c, next) => {
        c.env = env;
        c.set("services", {
          posts,
          paths,
          media,
          settings,
        } as unknown as AppVariables["services"]);
        c.set("appConfig", appConfig);
        c.set("i18n", {
          _(value: string | { message?: string }) {
            return typeof value === "string" ? value : (value.message ?? "");
          },
        } as AppVariables["i18n"]);
        await next();
      });
      app.route("/latest", latestRoutes);
      const served = readEntries(
        await (await app.request("/latest/feed")).text(),
      );

      const siteDir = await buildHugoSite(
        await createExportService(
          { posts, paths, collections, media },
          makeSiteConfig({
            siteUrl: appConfig.siteUrl,
            sitePathPrefix: appConfig.sitePathPrefix,
          }),
          { storage: null, bundleMedia: false },
        ).generateHugoFiles(),
      );
      siteDirs.push(siteDir);
      const readFeed = async (path: string) =>
        readEntries(await readFile(join(siteDir, "public", path), "utf8"));
      const exportedLatest = await readFeed("index.xml");
      const exportedArchive = await readFeed("archive/index.xml");

      // What Jant serves: the random slug, and the custom path in place of
      // the slug, neither with a trailing slash.
      const base = `${ORIGIN}${prefix}`;
      expect(ids(served)).toEqual(
        [`${base}/${plain.slug}`, `${base}${CUSTOM_PATH}`].sort(),
      );

      expect(ids(exportedLatest)).toEqual(ids(served));
      expect(ids(exportedArchive)).toEqual(ids(served));

      // The entry still links to the page the post now lives on, not to the
      // alias page that redirects there.
      const exportedCustom = exportedLatest.find(
        (entry) => entry.id === `${base}${CUSTOM_PATH}`,
      );
      expect(exportedCustom?.alternate).toBe("https://other.example/article");
      const exportedFeed = await readFile(
        join(siteDir, "public", "index.xml"),
        "utf8",
      );
      expect(exportedFeed).toContain(
        `<link href="${base}/${CUSTOM_SLUG}/" rel="related"/>`,
      );
      expect(
        exportedLatest.find((entry) => entry.id === `${base}/${plain.slug}`)
          ?.alternate,
      ).toBe(`${base}/${plain.slug}/`);
      // The ID still resolves: the custom path is an alias page that sends
      // its visitor on to the post.
      expect(
        await readFile(
          join(siteDir, "public", CUSTOM_PATH, "index.html"),
          "utf8",
        ),
      ).toContain(`${base}/${CUSTOM_SLUG}/`);
    },
    60_000,
  );
});
