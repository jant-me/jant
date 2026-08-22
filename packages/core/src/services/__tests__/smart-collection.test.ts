import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createTestDatabase,
  DEFAULT_TEST_SITE_ID,
} from "../../__tests__/helpers/db.js";
import { createCollectionService } from "../collection.js";
import { createPathService } from "../path.js";
import { createPostService } from "../post.js";
import { createSmartCollectionService } from "../smart-collection.js";
import type { Database } from "../../db/index.js";
import type { SmartCollectionSortOrder } from "../../types.js";

describe("SmartCollectionService", () => {
  let db: Database;
  let sqlite: ReturnType<typeof createTestDatabase>["sqlite"];
  let paths: ReturnType<typeof createPathService>;
  let posts: ReturnType<typeof createPostService>;
  let collections: ReturnType<typeof createCollectionService>;
  let smartCollections: ReturnType<typeof createSmartCollectionService>;

  /**
   * Count the statements that scan `post`, while `run` executes.
   *
   * The directory's promise is one round trip however many smart collections a
   * site has — on Workers that is the cost that actually matters, and it is the
   * kind of property that regresses into a `Promise.all` without any test
   * noticing.
   */
  async function countPostQueries<T>(
    run: () => Promise<T>,
  ): Promise<[T, number]> {
    const original = sqlite.prepare.bind(sqlite);
    let scans = 0;
    const spy = vi.spyOn(sqlite, "prepare").mockImplementation(((
      source: string,
    ) => {
      if (/from\s+"?post"?/i.test(source)) scans += 1;
      return original(source);
    }) as typeof sqlite.prepare);
    try {
      const value = await run();
      return [value, scans];
    } finally {
      spy.mockRestore();
    }
  }

  beforeEach(() => {
    const testDb = createTestDatabase();
    db = testDb.db as unknown as Database;
    sqlite = testDb.sqlite;
    paths = createPathService(db, DEFAULT_TEST_SITE_ID);
    posts = createPostService(db, { slugIdLength: 5 }, DEFAULT_TEST_SITE_ID);
    smartCollections = createSmartCollectionService(
      db,
      DEFAULT_TEST_SITE_ID,
      paths,
      posts,
    );
    collections = createCollectionService(
      db,
      DEFAULT_TEST_SITE_ID,
      paths,
      undefined,
      undefined,
      smartCollections,
    );
  });

  const anonymous = { isAuthenticated: false };
  const author = { isAuthenticated: true };

  describe("create", () => {
    it("stores conditions and reads them back in the shared vocabulary", async () => {
      const created = await smartCollections.create({
        slug: "quotes",
        title: "Quotes",
        description: "Things worth keeping.",
        selection: { format: "quote", media: "any", title: false },
        sort: "oldest",
        layout: "grid",
      });

      expect(created.slug).toBe("quotes");
      expect(created.selection).toEqual({
        format: "quote",
        media: "any",
        title: false,
      });
      expect(created.sort).toBe("oldest");
      expect(created.layout).toBe("grid");

      const reread = await smartCollections.getBySlug("quotes");
      expect(reread?.selection).toEqual(created.selection);
    });

    it("accepts no conditions at all, which means every post", async () => {
      const created = await smartCollections.create({
        slug: "everything",
        title: "Everything",
      });
      expect(created.selection).toEqual({});
    });

    it("shares the root address space with posts and collections", async () => {
      await collections.create({ slug: "books", title: "Books" });

      await expect(
        smartCollections.create({ slug: "books", title: "Quotes" }),
      ).rejects.toThrow(/already in use/);
    });

    it("leaves no path behind when the row cannot be written", async () => {
      // A condition naming a collection that does not exist is refused before
      // anything is written, so the address stays free.
      await expect(
        smartCollections.create({
          slug: "quotes",
          title: "Quotes",
          selection: { collection: ["col_01m0f291t3fzvte3vj2g8d611z"] },
        }),
      ).rejects.toThrow();

      expect(await paths.isPathAvailable("quotes")).toBe(true);
    });

    it("refuses a private condition, which a published page can never name", async () => {
      await expect(
        smartCollections.create({
          slug: "secrets",
          title: "Secrets",
          // @ts-expect-error — the type rules this out; the check is that the
          // runtime does too, for anything reaching the service untyped.
          selection: { visibility: "private" },
        }),
      ).rejects.toThrow();
    });
  });

  describe("directory placement", () => {
    it("takes a place in the directory, after what is already there", async () => {
      const books = await collections.create({ slug: "books", title: "Books" });
      const quotes = await smartCollections.create({
        slug: "quotes",
        title: "Quotes",
      });

      const items = await collections.listDirectoryItems();
      expect(
        items.map((item) => [
          item.type,
          item.collectionId ?? item.smartCollectionId,
        ]),
      ).toEqual([
        ["collection", books.id],
        ["smart_collection", quotes.id],
      ]);
    });

    it("leaves no directory row behind when the address is taken", async () => {
      await collections.create({ slug: "books", title: "Books" });

      await expect(
        smartCollections.create({ slug: "books", title: "Quotes" }),
      ).rejects.toThrow(/already in use/);

      const items = await collections.listDirectoryItems();
      expect(items.filter((item) => item.type === "smart_collection")).toEqual(
        [],
      );
    });

    it("drags by its own id, which is how the directory names it", async () => {
      const first = await collections.create({ slug: "books", title: "Books" });
      const last = await collections.create({ slug: "notes", title: "Notes" });
      const quotes = await smartCollections.create({
        slug: "quotes",
        title: "Quotes",
      });

      const placed = await collections.listDirectoryItems();
      const [firstRow, lastRow] = placed;

      // The drag surface sends the smart collection's own id, not its row's.
      const moved = await collections.moveDirectoryItem(
        quotes.id,
        firstRow?.id ?? null,
        lastRow?.id ?? null,
      );
      expect(moved?.smartCollectionId).toBe(quotes.id);

      const reordered = await collections.listDirectoryItems();
      expect(
        reordered.map((item) => item.collectionId ?? item.smartCollectionId),
      ).toEqual([first.id, quotes.id, last.id]);
    });

    it("places a smart collection that never had a row, then moves it", async () => {
      const first = await collections.create({ slug: "books", title: "Books" });
      const last = await collections.create({ slug: "notes", title: "Notes" });
      const quotes = await smartCollections.create({
        slug: "quotes",
        title: "Quotes",
      });

      // A smart collection from before placement existed: the directory shows
      // it appended at the end, with no row of its own.
      sqlite
        .prepare(
          `DELETE FROM collection_directory_item WHERE smart_collection_id = ?`,
        )
        .run(quotes.id);
      const unplaced = await collections.listDirectoryItems();
      expect(unplaced).toHaveLength(2);

      const [firstRow, lastRow] = unplaced;
      await collections.moveDirectoryItem(
        quotes.id,
        firstRow?.id ?? null,
        lastRow?.id ?? null,
      );

      const reordered = await collections.listDirectoryItems();
      expect(
        reordered.map((item) => item.collectionId ?? item.smartCollectionId),
      ).toEqual([first.id, quotes.id, last.id]);
    });

    it("names an unplaced neighbour, without reshuffling what was on screen", async () => {
      const books = await collections.create({ slug: "books", title: "Books" });
      const quotes = await smartCollections.create({
        slug: "quotes",
        title: "Quotes",
      });
      sqlite
        .prepare(
          `DELETE FROM collection_directory_item WHERE smart_collection_id = ?`,
        )
        .run(quotes.id);

      const divider = await collections.createDirectoryItem({
        type: "divider",
        label: "Reading",
      });

      // Dropping the divider between a placed collection and an unplaced smart
      // collection: the smart collection has to become a row for the position
      // to be computable, and it must land where the author already saw it.
      await collections.moveDirectoryItem(divider.id, books.id, quotes.id);

      const reordered = await collections.listDirectoryItems();
      expect(
        reordered.map(
          (item) => item.collectionId ?? item.smartCollectionId ?? item.id,
        ),
      ).toEqual([books.id, divider.id, quotes.id]);
    });
  });

  describe("update", () => {
    it("clears a condition that was removed, rather than leaving it behind", async () => {
      const created = await smartCollections.create({
        slug: "quotes",
        title: "Quotes",
        selection: { format: "quote", year: 2024 },
      });

      const updated = await smartCollections.update(created.id, {
        selection: { format: "quote" },
      });

      expect(updated?.selection).toEqual({ format: "quote" });
    });

    it("moves the address, and the navigation link with it", async () => {
      const created = await smartCollections.create({
        slug: "quotes",
        title: "Quotes",
      });

      await smartCollections.update(created.id, { slug: "citations" });

      expect(await smartCollections.getBySlug("quotes")).toBeNull();
      const moved = await smartCollections.getBySlug("citations");
      expect(moved?.id).toBe(created.id);
    });
  });

  describe("directory entries", () => {
    async function seed() {
      await posts.create({
        format: "quote",
        quoteText: "A public quote",
        bodyMarkdown: "public quote body",
        status: "published",
      });
      await posts.create({
        format: "quote",
        quoteText: "A private quote",
        bodyMarkdown: "private quote body",
        status: "published",
        visibility: "private",
      });
      await posts.create({
        format: "note",
        bodyMarkdown: "a note",
        status: "published",
      });
      await posts.create({
        format: "quote",
        quoteText: "A draft quote",
        bodyMarkdown: "draft quote body",
        status: "draft",
      });
    }

    it("counts what each reader can actually see", async () => {
      await seed();
      await smartCollections.create({
        slug: "quotes",
        title: "Quotes",
        selection: { format: "quote" },
      });

      const [asReader] = await smartCollections.listDirectoryEntries(anonymous);
      const [asAuthor] = await smartCollections.listDirectoryEntries(author);

      // Drafts never count. The private quote counts only for the author —
      // the same rule a manual collection's directory entry follows.
      expect(asReader?.threadCount).toBe(1);
      expect(asAuthor?.threadCount).toBe(2);
    });

    it("counts every smart collection in one query", async () => {
      await seed();
      await smartCollections.create({
        slug: "quotes",
        title: "Quotes",
        selection: { format: "quote" },
      });
      await smartCollections.create({
        slug: "notes",
        title: "Notes",
        selection: { format: "note" },
      });
      await smartCollections.create({
        slug: "everything",
        title: "Everything",
      });

      const [entries, postScans] = await countPostQueries(() =>
        smartCollections.listDirectoryEntries(anonymous),
      );

      expect(entries.map((entry) => [entry.slug, entry.threadCount])).toEqual([
        ["quotes", 1],
        ["notes", 1],
        ["everything", 2],
      ]);
      // Three smart collections, one scan of `post`. Not three.
      expect(postScans).toBe(1);
    });

    it("returns nothing to count when there is nothing to count", async () => {
      expect(await smartCollections.listDirectoryEntries(anonymous)).toEqual(
        [],
      );
      expect(await posts.aggregateMany([], {})).toEqual([]);
    });

    // The directory prints a count and a date on every row, and the two kinds
    // of row sit one above the other. A date that meant something different on
    // a smart collection would be worse than no date at all.
    it("dates each smart collection by the newest thread it matches", async () => {
      vi.useFakeTimers();
      try {
        vi.setSystemTime(new Date("2024-01-01T00:00:00Z"));
        await posts.create({
          format: "quote",
          quoteText: "An old quote",
          status: "published",
        });

        vi.setSystemTime(new Date("2024-01-02T00:00:00Z"));
        await posts.create({
          format: "note",
          bodyMarkdown: "a note",
          status: "published",
        });

        vi.setSystemTime(new Date("2024-01-03T00:00:00Z"));
        await posts.create({
          format: "quote",
          quoteText: "A new quote",
          status: "published",
        });

        await smartCollections.create({
          slug: "quotes",
          title: "Quotes",
          selection: { format: "quote" },
        });
        await smartCollections.create({
          slug: "notes",
          title: "Notes",
          selection: { format: "note" },
        });

        const entries = await smartCollections.listDirectoryEntries(anonymous);

        // Per filter, not one date for the whole page.
        expect(
          entries.map((entry) => [entry.slug, entry.recentActivityAt]),
        ).toEqual([
          ["quotes", 1704240000],
          ["notes", 1704153600],
        ]);
      } finally {
        vi.useRealTimers();
      }
    });

    it("dates it by what the viewer can see, as it counts by it", async () => {
      vi.useFakeTimers();
      try {
        vi.setSystemTime(new Date("2024-01-01T00:00:00Z"));
        await posts.create({
          format: "quote",
          quoteText: "A public quote",
          status: "published",
        });

        vi.setSystemTime(new Date("2024-01-02T00:00:00Z"));
        await posts.create({
          format: "quote",
          quoteText: "A private quote",
          status: "published",
          visibility: "private",
        });

        await smartCollections.create({
          slug: "quotes",
          title: "Quotes",
          selection: { format: "quote" },
        });

        const [asReader] =
          await smartCollections.listDirectoryEntries(anonymous);
        const [asAuthor] = await smartCollections.listDirectoryEntries(author);

        // A reader is never told that something they cannot read just moved.
        expect(asReader?.recentActivityAt).toBe(1704067200);
        expect(asAuthor?.recentActivityAt).toBe(1704153600);
      } finally {
        vi.useRealTimers();
      }
    });

    // Same definition as everywhere else: a Thread's activity is when it
    // gained a post, so fixing a typo does not drag a collection to the top.
    it("counts a reply as activity and a later edit as none", async () => {
      vi.useFakeTimers();
      try {
        vi.setSystemTime(new Date("2024-01-01T00:00:00Z"));
        const root = await posts.create({
          format: "note",
          bodyMarkdown: "root",
          status: "published",
        });
        await smartCollections.create({
          slug: "notes",
          title: "Notes",
          selection: { format: "note" },
        });

        vi.setSystemTime(new Date("2024-01-01T00:01:00Z"));
        await posts.update(root.id, { bodyMarkdown: "edited" });

        const [afterEdit] =
          await smartCollections.listDirectoryEntries(anonymous);
        expect(afterEdit?.recentActivityAt).toBe(1704067200);

        vi.setSystemTime(new Date("2024-01-01T00:02:00Z"));
        await posts.create({
          format: "note",
          bodyMarkdown: "reply",
          replyToId: root.id,
          status: "published",
        });

        const [afterReply] =
          await smartCollections.listDirectoryEntries(anonymous);
        expect(afterReply?.recentActivityAt).toBe(1704067320);
      } finally {
        vi.useRealTimers();
      }
    });

    it("dates an empty smart collection by itself", async () => {
      const created = await smartCollections.create({
        slug: "quotes",
        title: "Quotes",
        selection: { format: "quote" },
      });

      const [entry] = await smartCollections.listDirectoryEntries(anonymous);

      // Nothing matched, so there is no thread to date it by — the same
      // fallback an empty manual collection takes.
      expect(entry?.threadCount).toBe(0);
      expect(entry?.recentActivityAt).toBe(created.updatedAt);
    });
  });

  describe("referential integrity", () => {
    it("refuses to delete a collection a smart collection filters by, by name", async () => {
      const books = await collections.create({ slug: "books", title: "Books" });
      await smartCollections.create({
        slug: "quotes",
        title: "Quotes",
        selection: { collection: [books.id] },
      });

      await expect(collections.delete(books.id)).rejects.toThrow(/Quotes/);
    });

    it("names every smart collection in the way, not just a count", async () => {
      const books = await collections.create({ slug: "books", title: "Books" });
      await smartCollections.create({
        slug: "quotes",
        title: "Quotes",
        selection: { collection: [books.id] },
      });
      await smartCollections.create({
        slug: "book-notes",
        title: "Book Notes",
        selection: { collection: [books.id] },
      });

      await expect(collections.delete(books.id)).rejects.toThrow(
        /Quotes.*Book Notes/,
      );
    });

    it("deletes a collection nothing depends on", async () => {
      const books = await collections.create({ slug: "books", title: "Books" });
      expect(await collections.delete(books.id)).toBe(true);
    });

    it("gathers nothing, not everything, when a condition is left dangling", async () => {
      // `smart_collection.collection_id` carries no foreign key: no ON DELETE
      // action was the right one, and RESTRICT would only turn every bulk
      // delete into an ordering rule that fails anonymously. What makes that
      // safe is this — the refusal above is the normal path, and the state it
      // guards against degrades to an empty page rather than to the whole
      // archive under someone's curated name.
      const books = await collections.create({ slug: "books", title: "Books" });
      const created = await smartCollections.create({
        slug: "book-notes",
        title: "Book Notes",
        selection: { collection: [books.id] },
      });
      await posts.create({
        format: "note",
        bodyMarkdown: "a note in no collection",
        status: "published",
      });

      // Straight past the service, the way an import or a hand-run statement
      // would reach it.
      sqlite.prepare('DELETE FROM "collection" WHERE "id" = ?').run(books.id);

      const reread = await smartCollections.getById(created.id);
      expect(reread?.selection).toEqual({ collection: [books.id] });
      expect(
        await posts.count(smartCollections.toPostFilters(reread!, author)),
      ).toBe(0);
    });

    it("releases the address when the smart collection is deleted", async () => {
      const created = await smartCollections.create({
        slug: "quotes",
        title: "Quotes",
      });

      expect(await smartCollections.delete(created.id)).toBe(true);
      expect(await smartCollections.getBySlug("quotes")).toBeNull();
    });
  });

  describe("toPostFilters", () => {
    it("pins the year condition to publication, whatever the chosen order", async () => {
      const created = await smartCollections.create({
        slug: "twenty-four",
        title: "2024",
        selection: { year: 2024 },
        sort: "newest",
      });

      const filters = smartCollections.toPostFilters(created, anonymous);

      // Membership is not allowed to depend on presentation: ordering by
      // activity must not move a post into or out of a year.
      expect(filters.publishedAfter).toBe(Date.UTC(2024, 0, 1) / 1000);
      expect(filters.publishedBefore).toBe(Date.UTC(2025, 0, 1) / 1000);
      expect(filters.axisAfter).toBeUndefined();
      expect(filters.sortBy).toBe("activity");
    });

    it("orders on the same axes a manual collection does", async () => {
      const axisFor = async (sort: SmartCollectionSortOrder, slug: string) => {
        const created = await smartCollections.create({
          slug,
          title: slug,
          sort,
        });
        const filters = smartCollections.toPostFilters(created, anonymous);
        return { sortBy: filters.sortBy, sortOrder: filters.sortOrder };
      };

      // `newest` and the rating tie-break follow the Thread; only `oldest`
      // reads publication, because a reply must not make a Thread older.
      expect(await axisFor("newest", "recent")).toEqual({
        sortBy: "activity",
        sortOrder: "newest",
      });
      expect(await axisFor("rating_desc", "best")).toEqual({
        sortBy: "activity",
        sortOrder: "rating_desc",
      });
      expect(await axisFor("oldest", "first")).toEqual({
        sortBy: "published",
        sortOrder: "oldest",
      });
    });

    it("holds the private floor for a signed-out reader", async () => {
      const created = await smartCollections.create({
        slug: "quotes",
        title: "Quotes",
      });

      expect(
        smartCollections.toPostFilters(created, anonymous).excludePrivate,
      ).toBe(true);
      expect(
        smartCollections.toPostFilters(created, author).excludePrivate,
      ).toBe(false);
    });
  });
});
