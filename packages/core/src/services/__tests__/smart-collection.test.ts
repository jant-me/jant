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

  describe("counts", () => {
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

      const [asReader] = await smartCollections.listWithCounts(anonymous);
      const [asAuthor] = await smartCollections.listWithCounts(author);

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
        smartCollections.listWithCounts(anonymous),
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
      expect(await smartCollections.listWithCounts(anonymous)).toEqual([]);
      expect(await posts.countMany([], {})).toEqual([]);
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
        sort: "updated",
      });

      const filters = smartCollections.toPostFilters(created, anonymous);

      // Membership is not allowed to depend on presentation: ordering by
      // activity must not move a post into or out of a year.
      expect(filters.publishedAfter).toBe(Date.UTC(2024, 0, 1) / 1000);
      expect(filters.publishedBefore).toBe(Date.UTC(2025, 0, 1) / 1000);
      expect(filters.axisAfter).toBeUndefined();
      expect(filters.sortBy).toBe("thread_updated");
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
