/**
 * A smart collection on an exported site lists what it lists on Jant.
 *
 * The export carries a smart collection's conditions, not its matches, and
 * the theme's `smart-collection-members` partial evaluates them against the
 * posts' front matter. That is a second implementation of every condition and
 * every order, in Go templates, so this builds the export with the real Hugo
 * binary and compares each page with the list Jant's own services produce
 * from the same database.
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
import { createSmartCollectionService } from "../services/smart-collection.js";
import { supportsCollectionRatingSort } from "../lib/collection-sort.js";
import type { Database } from "../db/index.js";
import type { CreatePost } from "../types/operations.js";
import type { MediaKind, SmartCollection } from "../types.js";

const SITE_URL = "https://example.com";

const at = (iso: string) => Math.floor(Date.parse(iso) / 1000);

/** Every condition value and every order, each on its own smart collection. */
const SMART_COLLECTIONS: {
  slug: string;
  selection: SmartCollection["selection"] | "ideas";
  sort?: SmartCollection["sort"];
}[] = [
  { slug: "sc-all-newest", selection: {} },
  { slug: "sc-all-oldest", selection: {}, sort: "oldest" },
  { slug: "sc-all-rated", selection: {}, sort: "rating_desc" },
  { slug: "sc-notes", selection: { format: "note" } },
  // One rated link of two: too few to rank, so the page falls back to newest.
  { slug: "sc-links", selection: { format: "link" }, sort: "rating_desc" },
  { slug: "sc-quotes", selection: { format: "quote" } },
  { slug: "sc-titled", selection: { title: true } },
  { slug: "sc-untitled", selection: { title: false } },
  { slug: "sc-2024", selection: { year: 2024 } },
  { slug: "sc-2025", selection: { year: 2025 } },
  { slug: "sc-media", selection: { media: "any" } },
  { slug: "sc-no-media", selection: { media: "none" } },
  { slug: "sc-images", selection: { media: ["image"] } },
  { slug: "sc-text-or-video", selection: { media: ["text", "video"] } },
  { slug: "sc-replies", selection: { replies: true } },
  { slug: "sc-no-replies", selection: { replies: false } },
  { slug: "sc-public", selection: { visibility: "public" } },
  { slug: "sc-hidden", selection: { visibility: "latest_hidden" } },
  { slug: "sc-featured", selection: { visibility: "featured" } },
  { slug: "sc-ideas", selection: "ideas" },
  {
    slug: "sc-thoughts",
    selection: { format: "note", title: false },
    sort: "oldest",
  },
];

describe.skipIf(!hugoAvailable)("smart collections on an exported site", () => {
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
    const smartCollections = createSmartCollectionService(
      db,
      siteId,
      paths,
      posts,
    );
    const collections = createCollectionService(
      db,
      siteId,
      paths,
      undefined,
      undefined,
      smartCollections,
    );
    const media = createMediaService(db, siteId);

    const ideas = await collections.create({ slug: "ideas", title: "Ideas" });

    async function post(
      slug: string,
      data: Omit<CreatePost, "slug" | "bodyMarkdown">,
      attachments: MediaKind[] = [],
    ) {
      const created = await posts.create({
        slug,
        bodyMarkdown: `Body of ${slug}.`,
        status: "published",
        ...data,
        createdAt: data.createdAt ?? data.publishedAt,
      });
      for (const [index, kind] of attachments.entries()) {
        await media.create({
          postId: created.id,
          filename: `${slug}-${index}.bin`,
          originalName: `${slug}-${index}.bin`,
          mimeType: "application/octet-stream",
          size: 1,
          storageKey: `media/${slug}-${index}.bin`,
          mediaKind: kind,
        });
      }
      return created;
    }

    await post("a-2024-note", {
      format: "note",
      publishedAt: at("2024-03-01T00:00:00Z"),
      rating: 5,
    });
    const titled = await post(
      "b-titled-note",
      {
        format: "note",
        title: "Titled note",
        publishedAt: at("2025-01-10T00:00:00Z"),
        collectionIds: [ideas.id],
      },
      ["image"],
    );
    await post("b-reply", {
      format: "note",
      replyToId: titled.id,
      publishedAt: at("2025-06-01T00:00:00Z"),
    });
    await post(
      "c-hidden-link",
      {
        format: "link",
        title: "A link",
        url: "https://example.org/",
        visibility: "latest_hidden",
        publishedAt: at("2025-02-01T00:00:00Z"),
        rating: 3,
      },
      ["video"],
    );
    await post("k-newer-link", {
      format: "link",
      title: "Another link",
      url: "https://example.net/",
      publishedAt: at("2025-05-01T00:00:00Z"),
    });
    await post("d-featured-quote", {
      format: "quote",
      title: "Seneca",
      quoteText: "We suffer more in imagination than in reality.",
      publishedAt: at("2023-05-05T00:00:00Z"),
      featuredAt: at("2023-06-01T00:00:00Z"),
    });
    await post(
      "e-untitled-quote",
      {
        format: "quote",
        quoteText: "Unattributed.",
        publishedAt: at("2025-03-01T00:00:00Z"),
        collectionIds: [ideas.id],
      },
      ["text"],
    );
    await post("f-private", {
      format: "note",
      visibility: "private",
      publishedAt: at("2025-01-01T00:00:00Z"),
    });
    await post("g-draft", { format: "note", status: "draft" });
    // Two roots published in the same second: the ID decides.
    const tied = await post("h-tied", {
      format: "note",
      publishedAt: at("2025-04-01T12:00:00Z"),
      rating: 4,
    });
    await post("h-draft-reply", {
      format: "note",
      replyToId: tied.id,
      status: "draft",
    });
    await post("i-tied", {
      format: "note",
      publishedAt: at("2025-04-01T12:00:00Z"),
    });
    // The last second of 2024 in UTC, whatever the build machine's zone.
    await post(
      "j-new-years-eve",
      { format: "note", publishedAt: at("2024-12-31T23:59:59Z") },
      ["audio"],
    );

    const anonymous = { isAuthenticated: false };
    for (const definition of SMART_COLLECTIONS) {
      const smartCollection = await smartCollections.create({
        slug: definition.slug,
        title: definition.slug,
        selection:
          definition.selection === "ideas"
            ? { collection: [ideas.id] }
            : definition.selection,
        sort: definition.sort,
      });
      // What the page shows: the stored order, unless it ranks by rating
      // and too little is rated for that to mean anything.
      const rated = await posts.countUpTo(
        {
          ...smartCollections.toPostFilters(smartCollection, anonymous),
          hasRating: true,
        },
        2,
      );
      const sort =
        smartCollection.sort === "rating_desc" &&
        !supportsCollectionRatingSort(rated)
          ? "newest"
          : smartCollection.sort;
      const list = await posts.list({
        ...smartCollections.toPostFilters(
          { ...smartCollection, sort },
          anonymous,
        ),
        limit: 1000,
      });
      expected.set(
        definition.slug,
        list.map((item) => item.slug),
      );
      // The feed keeps the stored order, fallback or not.
      const feedList = await posts.list({
        ...smartCollections.toPostFilters(smartCollection, anonymous),
        limit: 50,
      });
      expectedFeed.set(
        definition.slug,
        feedList.map((item) => item.slug),
      );
    }

    // A small page size, so the pages are read across pagination.
    siteDir = await buildHugoSite(
      await createExportService(
        { posts, paths, collections, media },
        makeSiteConfig({ siteUrl: SITE_URL, pageSize: 4 }),
        { storage: null, bundleMedia: false },
      ).generateHugoFiles(),
    );
    for (const { slug } of SMART_COLLECTIONS) {
      built.set(slug, await readThreadSlugs(siteDir, slug));
      builtFeed.set(slug, await readFeedSlugs(siteDir, slug, SITE_URL));
    }
  }, 60_000);

  afterAll(async () => {
    if (siteDir) await rm(siteDir, { recursive: true, force: true });
  });

  it.each(SMART_COLLECTIONS.map(({ slug }) => slug))(
    "%s lists the posts Jant lists, in its order",
    (slug) => {
      expect(built.get(slug)).toEqual(expected.get(slug));
    },
  );

  // Equal lists prove nothing if the fixture leaves them empty or alike.
  it("runs on a fixture that tells the conditions apart", () => {
    expect(expected.get("sc-thoughts")).toEqual([
      "a-2024-note",
      "j-new-years-eve",
      "h-tied",
      "i-tied",
    ]);
    expect(expected.get("sc-all-rated")?.slice(0, 3)).toEqual([
      "a-2024-note",
      "h-tied",
      "c-hidden-link",
    ]);
    expect(expected.get("sc-links")).toEqual(["k-newer-link", "c-hidden-link"]);
    // The page falls back to newest with one rated link; the feed doesn't.
    expect(expectedFeed.get("sc-links")).toEqual([
      "c-hidden-link",
      "k-newer-link",
    ]);
    expect(expected.get("sc-titled")).toEqual([
      "b-titled-note",
      "k-newer-link",
      "c-hidden-link",
      "d-featured-quote",
    ]);
    expect(expected.get("sc-2024")).toEqual(["j-new-years-eve", "a-2024-note"]);
    expect(expected.get("sc-replies")).toEqual(["b-titled-note"]);
    expect(expected.get("sc-text-or-video")).toEqual([
      "e-untitled-quote",
      "c-hidden-link",
    ]);
    expect(expected.get("sc-all-newest")).not.toContain("f-private");
    expect(expected.get("sc-all-newest")).not.toContain("g-draft");
    for (const { slug } of SMART_COLLECTIONS) {
      expect(expected.get(slug)?.length, slug).toBeGreaterThan(0);
    }
  });

  it.each(SMART_COLLECTIONS.map(({ slug }) => slug))(
    "%s feed carries what Jant's feed carries, in its order",
    (slug) => {
      expect(builtFeed.get(slug)).toEqual(expectedFeed.get(slug));
    },
  );
});
