/**
 * A collection on an exported site lists its Threads in Jant's order.
 *
 * The theme's `collection-members` partial restates the order Jant's
 * collection page and feed read from the database: pins in this collection
 * first, then `newest`, `oldest`, or `rating_desc`, which read the whole
 * Thread (its activity, its earliest published post, its highest rating),
 * not only the root. This builds the export with the real Hugo binary and
 * compares every page and feed with what Jant's services return.
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
  readThreadSlugs,
} from "./helpers/hugo-site.js";
import { createCollectionService } from "../services/collection.js";
import { createExportService } from "../services/export.js";
import { createMediaService } from "../services/media.js";
import { createPathService } from "../services/path.js";
import { createPostService } from "../services/post.js";
import {
  resolveCollectionSortOrder,
  supportsCollectionRatingSort,
} from "../lib/collection-sort.js";
import type { Database } from "../db/index.js";
import type { CreatePost } from "../types/operations.js";
import type { CollectionSortOrder } from "../types.js";

const SITE_URL = "https://example.com";
const at = (iso: string) => Math.floor(Date.parse(iso) / 1000);

/** One collection per order, over the same Threads, plus the rating fallback. */
const COLLECTIONS: { slug: string; sortOrder: CollectionSortOrder }[] = [
  { slug: "by-newest", sortOrder: "newest" },
  { slug: "by-oldest", sortOrder: "oldest" },
  { slug: "by-rating", sortOrder: "rating_desc" },
  // One rated Thread: too few to rank, so the page falls back to newest.
  { slug: "few-rated", sortOrder: "rating_desc" },
];

describe.skipIf(!hugoAvailable)("collection order on an exported site", () => {
  let siteDir: string;
  const expected = new Map<string, string[]>();
  const built = new Map<string, string[]>();
  const expectedFeed = new Map<string, string[]>();
  const builtFeed = new Map<string, string[]>();

  beforeAll(async () => {
    const { db: testDb } = createTestDatabase();
    const db = testDb as unknown as Database;
    const siteId = DEFAULT_TEST_SITE_ID;
    const paths = createPathService(db, siteId);
    const posts = createPostService(db, { slugIdLength: 5 }, siteId);
    const collections = createCollectionService(db, siteId, paths);
    const media = createMediaService(db, siteId);

    const collectionIds = new Map<string, string>();
    for (const { slug, sortOrder } of COLLECTIONS) {
      const created = await collections.create({
        slug,
        title: slug,
        sortOrder,
      });
      collectionIds.set(slug, created.id);
    }
    const inCollections = (slugs: string[], pinnedAt: number | null = null) =>
      slugs.map((slug) => ({
        collectionId: collectionIds.get(slug) as string,
        pinnedAt,
      }));
    const ordered = ["by-newest", "by-oldest", "by-rating"];

    const slugById = new Map<string, string>();
    async function post(slug: string, data: Omit<CreatePost, "slug">) {
      const created = await posts.create({
        slug,
        bodyMarkdown: `Body of ${slug}.`,
        status: "published",
        ...data,
        createdAt: data.createdAt ?? data.publishedAt,
      });
      slugById.set(created.id, slug);
      return created;
    }
    const reply = (
      root: { id: string },
      slug: string,
      data: Omit<CreatePost, "slug" | "replyToId" | "format"> = {},
    ) => post(slug, { format: "note", replyToId: root.id, ...data });

    // A reply moves the Thread's activity to June.
    const replied = await post("a-replied", {
      format: "note",
      publishedAt: at("2025-01-01T00:00:00Z"),
      collectionEntries: inCollections([...ordered, "few-rated"]),
    });
    await reply(replied, "a-reply", {
      publishedAt: at("2025-06-01T00:00:00Z"),
    });

    // Pinned in every ordered collection, rated on the root.
    await post("b-pinned-rated", {
      format: "note",
      publishedAt: at("2025-02-01T00:00:00Z"),
      rating: 3,
      collectionEntries: [
        ...inCollections(ordered, at("2025-07-01T00:00:00Z")),
        ...inCollections(["few-rated"]),
      ],
    });

    // Rated only on a reply: the Thread's rating is its highest.
    const replyRated = await post("c-reply-rated", {
      format: "note",
      publishedAt: at("2025-03-01T00:00:00Z"),
      collectionEntries: inCollections(ordered),
    });
    await reply(replyRated, "c-rated-reply", {
      publishedAt: at("2025-03-02T00:00:00Z"),
      rating: 5,
    });

    // Two Threads published in the same second: the ID decides.
    await post("d-tied", {
      format: "note",
      publishedAt: at("2025-04-01T12:00:00Z"),
      rating: 4,
      collectionEntries: inCollections(ordered),
    });
    await post("e-tied", {
      format: "note",
      publishedAt: at("2025-04-01T12:00:00Z"),
      collectionEntries: inCollections([...ordered, "few-rated"]),
    });

    // A reply dated before every other post: `oldest` reads the Thread's
    // earliest published post, so this Thread comes first though its root
    // is one of the later ones.
    const early = await post("f-early-reply", {
      format: "note",
      publishedAt: at("2025-03-15T00:00:00Z"),
      collectionEntries: inCollections(ordered),
    });
    await reply(early, "f-reply-before-root", {
      publishedAt: at("2024-11-01T00:00:00Z"),
    });

    // Pinned more recently than b, with a quiet reply that doesn't move the
    // Thread's activity.
    const quiet = await post("g-pinned-quiet", {
      format: "note",
      publishedAt: at("2025-05-01T00:00:00Z"),
      collectionEntries: inCollections(ordered, at("2025-08-01T00:00:00Z")),
    });
    await reply(quiet, "g-quiet-reply", {
      publishedAt: at("2025-09-01T00:00:00Z"),
      quietReply: true,
    });

    // Neither is on the page.
    await post("h-private", {
      format: "note",
      visibility: "private",
      publishedAt: at("2025-01-15T00:00:00Z"),
      collectionEntries: inCollections(ordered),
    });
    await post("i-draft", {
      format: "note",
      status: "draft",
      collectionEntries: inCollections(ordered),
    });

    const reader = { status: "published" as const, excludePrivate: true };
    for (const { slug, sortOrder } of COLLECTIONS) {
      const ids = [collectionIds.get(slug) as string];
      // What the page shows, as the collection page route decides it.
      const rated = await posts.countCollectionThreadRootsUpToForCollections(
        ids,
        { ...reader, hasRating: true },
        2,
      );
      const pageOrder = resolveCollectionSortOrder(
        undefined,
        sortOrder,
        supportsCollectionRatingSort(rated),
      );
      const rootIds = await posts.listCollectionThreadRootIdsForCollections(
        ids,
        { ...reader, sortOrder: pageOrder },
      );
      expected.set(
        slug,
        rootIds.map((id) => slugById.get(id) as string),
      );
      // What the feed carries, as the collection feed route asks for it.
      const entries = await posts.listCollectionFeedEntriesForCollections(ids, {
        ...reader,
        ignoreCollectionPinnedSort: true,
        limit: 50,
      });
      expectedFeed.set(
        slug,
        entries.map((entry) => slugById.get(entry.post.id) as string),
      );
    }

    // A small page size, so the pages are read across pagination.
    siteDir = await buildHugoSite(
      await createExportService(
        { posts, paths, collections, media },
        makeSiteConfig({ siteUrl: SITE_URL, pageSize: 3 }),
        { storage: null, bundleMedia: false },
      ).generateHugoFiles(),
    );
    for (const { slug } of COLLECTIONS) {
      built.set(slug, await readThreadSlugs(siteDir, slug));
      builtFeed.set(slug, await readFeedSlugs(siteDir, slug, SITE_URL));
    }
  }, 60_000);

  afterAll(async () => {
    if (siteDir) await rm(siteDir, { recursive: true, force: true });
  });

  it.each(COLLECTIONS.map(({ slug }) => slug))(
    "%s lists its Threads in Jant's order",
    (slug) => {
      expect(built.get(slug)).toEqual(expected.get(slug));
    },
  );

  it.each(COLLECTIONS.map(({ slug }) => slug))(
    "%s feed carries Jant's feed order",
    (slug) => {
      expect(builtFeed.get(slug)).toEqual(expectedFeed.get(slug));
    },
  );

  // Equal lists prove nothing if the fixture can't tell the orders apart.
  it("runs on a fixture where each rule changes the order", () => {
    // Pins first, most recent first.
    expect(expected.get("by-newest")?.slice(0, 2)).toEqual([
      "g-pinned-quiet",
      "b-pinned-rated",
    ]);
    // The reply dated before every other post puts its Thread first.
    expect(expected.get("by-oldest")?.slice(2, 4)).toEqual([
      "f-early-reply",
      "a-replied",
    ]);
    // The rating on a reply ranks its Thread above a root rated lower.
    expect(expected.get("by-rating")?.slice(2, 4)).toEqual([
      "c-reply-rated",
      "d-tied",
    ]);
    // One rated Thread: the page falls back to newest.
    expect(expected.get("few-rated")).toEqual([
      "a-replied",
      "e-tied",
      "b-pinned-rated",
    ]);
    // The feed ignores pins, and a quiet reply doesn't move its Thread up.
    expect(expectedFeed.get("by-oldest")?.slice(0, 2)).toEqual([
      "a-replied",
      "g-pinned-quiet",
    ]);
  });
});
