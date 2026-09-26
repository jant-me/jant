/**
 * An exported site lists Latest and Featured the way Jant does.
 *
 * The theme's `latest-members` and `featured-members` partials restate the
 * order Jant's home page, `/latest/feed`, Featured page, and `/featured/feed`
 * read from the database: pins first on the home page only, Thread activity
 * (which a reply moves and a quiet reply doesn't), the newest featured post in
 * a Thread, and the root ID when times tie. This builds the export with the
 * real Hugo binary and compares every page, page by page, and both feeds with
 * what Jant's services return.
 *
 * Skips when `hugo` is not on PATH, like the other Hugo build tests.
 */

import { rm } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDatabase, DEFAULT_TEST_SITE_ID } from "./helpers/db.js";
import { makeSiteConfig } from "./helpers/export-fixtures.js";
import {
  buildHugoSite,
  hugoAvailable,
  readFeedSlugs,
  readRootSlugsByPage,
} from "./helpers/hugo-site.js";
import { createCollectionService } from "../services/collection.js";
import { createExportService } from "../services/export.js";
import { createMediaService } from "../services/media.js";
import { createPathService } from "../services/path.js";
import { createPostService } from "../services/post.js";
import {
  featuredFeedSelection,
  latestFeedSelection,
} from "../lib/feed-policy.js";
import type { Database } from "../db/index.js";
import type { CreatePost } from "../types/operations.js";

const SITE_URL = "https://example.com";
const PAGE_SIZE = 4;
const FEED_LIMIT = 6;
const at = (iso: string) => Math.floor(Date.parse(iso) / 1000);
/** No RSS delay: the static site has none to apply. */
const NO_DELAY = at("2100-01-01T00:00:00Z");

const chunk = (list: string[], size: number) =>
  Array.from({ length: Math.ceil(list.length / size) }, (_, index) =>
    list.slice(index * size, index * size + size),
  );

describe.skipIf(!hugoAvailable)(
  "Latest and Featured on an exported site",
  () => {
    let siteDir: string;
    const roots = new Set<string>();
    const expected: Record<string, string[]> = {};
    const built: Record<string, string[]> = {};
    const expectedPages: Record<string, string[][]> = {};
    const builtPages: Record<string, string[][]> = {};

    beforeAll(async () => {
      const { db: testDb } = createTestDatabase();
      const db = testDb as unknown as Database;
      const siteId = DEFAULT_TEST_SITE_ID;
      const paths = createPathService(db, siteId);
      const posts = createPostService(db, { slugIdLength: 5 }, siteId);
      const collections = createCollectionService(db, siteId, paths);
      const media = createMediaService(db, siteId);

      const slugById = new Map<string, string>();
      async function post(slug: string, data: Omit<CreatePost, "slug">) {
        const created = await posts.create({
          slug,
          format: "note",
          bodyMarkdown: `Body of ${slug}.`,
          status: "published",
          ...data,
          createdAt: data.createdAt ?? data.publishedAt,
        });
        slugById.set(created.id, slug);
        if (!data.replyToId) roots.add(slug);
        return created;
      }
      const reply = (
        root: { id: string },
        slug: string,
        data: Omit<CreatePost, "slug" | "replyToId" | "format">,
      ) => post(slug, { format: "note", replyToId: root.id, ...data });

      // Older posts, so the feeds and pages run past their limits.
      for (const [index, month] of ["02", "03", "04", "05"].entries()) {
        await post(`k${index}-filler`, {
          format: "note",
          publishedAt: at(`2024-${month}-01T00:00:00Z`),
        });
      }

      // A reply brings an old Thread back to the top of Latest.
      const bumped = await post("a-bumped-by-reply", {
        format: "note",
        publishedAt: at("2025-01-01T00:00:00Z"),
      });
      await reply(bumped, "a-reply", {
        publishedAt: at("2025-08-01T00:00:00Z"),
      });

      // A quiet reply doesn't.
      const quiet = await post("b-quiet-reply", {
        format: "note",
        publishedAt: at("2025-02-01T00:00:00Z"),
      });
      await reply(quiet, "b-reply", {
        publishedAt: at("2025-09-01T00:00:00Z"),
        quietReply: true,
      });

      await post("c-featured", {
        format: "note",
        publishedAt: at("2025-03-01T00:00:00Z"),
        featuredAt: at("2025-03-02T00:00:00Z"),
      });

      // Published in the same second, and both featured: the ID decides.
      await post("d-tied", {
        format: "note",
        publishedAt: at("2025-04-01T12:00:00Z"),
        featuredAt: at("2025-04-02T00:00:00Z"),
      });
      await post("e-tied", {
        format: "note",
        publishedAt: at("2025-04-01T12:00:00Z"),
        featuredAt: at("2025-04-02T00:00:00Z"),
      });

      // Featured, but Hidden from Latest: on Featured, not on Latest.
      await post("f-hidden-featured", {
        format: "note",
        visibility: "latest_hidden",
        publishedAt: at("2025-05-01T00:00:00Z"),
        featuredAt: at("2025-05-02T00:00:00Z"),
      });

      // An old root whose featured post is a recent reply.
      const replyFeatured = await post("g-reply-featured", {
        format: "note",
        publishedAt: at("2024-01-01T00:00:00Z"),
      });
      await reply(replyFeatured, "g-featured-reply", {
        publishedAt: at("2025-06-15T00:00:00Z"),
        featuredAt: at("2025-06-16T00:00:00Z"),
        quietReply: true,
      });

      // Pinned: first on the home page, most recent pin first; not in the feed.
      await post("p-pinned-early", {
        format: "note",
        publishedAt: at("2024-06-01T00:00:00Z"),
        pinnedAt: at("2025-06-01T00:00:00Z"),
      });
      await post("q-pinned-late", {
        format: "note",
        publishedAt: at("2024-07-01T00:00:00Z"),
        pinnedAt: at("2025-07-01T00:00:00Z"),
      });
      // Pinned but Hidden from Latest: not on the home page at all.
      await post("r-hidden-pinned", {
        format: "note",
        visibility: "latest_hidden",
        publishedAt: at("2024-08-01T00:00:00Z"),
        pinnedAt: at("2025-07-15T00:00:00Z"),
      });

      // On none of them.
      await post("s-private-featured", {
        format: "note",
        visibility: "private",
        publishedAt: at("2025-05-15T00:00:00Z"),
        featuredAt: at("2025-05-16T00:00:00Z"),
      });
      await post("t-draft", { format: "note", status: "draft" });

      const slugs = (ids: string[]) =>
        ids.map((id) => slugById.get(id) as string);

      // The home page, as `assembleTimeline` asks for it.
      const home = await posts.list({
        status: "published",
        excludeReplies: true,
        excludeLatestHidden: true,
        excludePrivate: true,
        limit: 1000,
      });
      expected.home = slugs(home.map((item) => item.id));
      expectedPages.home = chunk(expected.home, PAGE_SIZE);

      // `/latest/feed`, as `buildLatestFeedData` asks for it.
      const latestFeed = await posts.list({
        ...latestFeedSelection({ publishedBefore: NO_DELAY }),
        ignorePinnedSort: true,
        limit: FEED_LIMIT,
      });
      expected.latestFeed = slugs(latestFeed.map((item) => item.id));

      // The Featured page, as `assembleFeaturedTimeline` asks for it.
      expected.featured = slugs(
        await posts.listFeaturedThreadRootIds({
          status: "published",
          excludePrivate: true,
        }),
      );
      expectedPages.featured = chunk(expected.featured, PAGE_SIZE);

      // `/featured/feed`, as `buildFeaturedFeedData` asks for it.
      expected.featuredFeed = slugs(
        await posts.listFeaturedThreadRootIds({
          ...featuredFeedSelection({ publishedBefore: NO_DELAY }),
          limit: FEED_LIMIT,
        }),
      );

      siteDir = await buildHugoSite(
        await createExportService(
          { posts, paths, collections, media },
          makeSiteConfig({
            siteUrl: SITE_URL,
            pageSize: PAGE_SIZE,
            rssFeedLimit: FEED_LIMIT,
          }),
          { storage: null, bundleMedia: false },
        ).generateHugoFiles(),
      );
      builtPages.home = await readRootSlugsByPage(siteDir, "", roots);
      builtPages.featured = await readRootSlugsByPage(
        siteDir,
        "featured",
        roots,
      );
      built.latestFeed = await readFeedSlugs(siteDir, "", SITE_URL);
      built.featuredFeed = await readFeedSlugs(siteDir, "featured", SITE_URL);
    }, 60_000);

    afterAll(async () => {
      if (siteDir) await rm(siteDir, { recursive: true, force: true });
    });

    it("lists the home page as Jant does, page by page", () => {
      expect(builtPages.home).toEqual(expectedPages.home);
    });

    it("carries Jant's Latest feed", () => {
      expect(built.latestFeed).toEqual(expected.latestFeed);
    });

    it("lists the Featured page as Jant does, page by page", () => {
      expect(builtPages.featured).toEqual(expectedPages.featured);
    });

    it("carries Jant's Featured feed", () => {
      expect(built.featuredFeed).toEqual(expected.featuredFeed);
    });

    // Equal lists prove nothing if the fixture can't tell the rules apart.
    it("runs on a fixture where each rule changes the order", () => {
      // Pins lead the home page, most recent first; Hidden from Latest stays
      // off it even when pinned.
      expect(expected.home?.slice(0, 3)).toEqual([
        "q-pinned-late",
        "p-pinned-early",
        "a-bumped-by-reply",
      ]);
      expect(expected.home).not.toContain("r-hidden-pinned");
      expect(expected.home).not.toContain("f-hidden-featured");
      // A reply moves its Thread up; a quiet one doesn't. The feed ignores
      // pins and stops at its limit.
      expect(expected.latestFeed).toEqual([
        "a-bumped-by-reply",
        "e-tied",
        "d-tied",
        "c-featured",
        "b-quiet-reply",
        "q-pinned-late",
      ]);
      // A featured reply dates its Thread; same-second Threads go by ID;
      // Hidden from Latest is on Featured, private isn't.
      expect(expected.featured).toEqual([
        "g-reply-featured",
        "f-hidden-featured",
        "e-tied",
        "d-tied",
        "c-featured",
      ]);
      // Enough roots to run past a page and the feed limit.
      expect(expectedPages.home?.length).toBeGreaterThan(2);
    });
  },
);
