import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  createTestDatabase,
  DEFAULT_TEST_SITE_ID,
} from "../../__tests__/helpers/db.js";
import {
  collections,
  collectionDirectoryItems as directoryItemsTable,
} from "../../db/schema.js";
import { createCollectionService } from "../collection.js";
import { createPathService } from "../path.js";
import { createPostService } from "../post.js";
import type { Database } from "../../db/index.js";
import { MAX_COLLECTION_SLUG_LENGTH } from "../../types.js";

describe("CollectionService", () => {
  let db: Database;
  let collectionService: ReturnType<typeof createCollectionService>;
  let postService: ReturnType<typeof createPostService>;

  beforeEach(() => {
    const testDb = createTestDatabase();
    db = testDb.db as unknown as Database;
    collectionService = createCollectionService(db, DEFAULT_TEST_SITE_ID);
    postService = createPostService(
      db,
      { slugIdLength: 5 },
      DEFAULT_TEST_SITE_ID,
    );
  });

  describe("create", () => {
    it("creates a collection with required fields", async () => {
      const collection = await collectionService.create({
        slug: "my-collection",
        title: "My Collection",
      });

      expect(typeof collection.id).toBe("string");
      expect(collection.id.length).toBeGreaterThan(0);
      expect(collection.slug).toBe("my-collection");
      expect(collection.title).toBe("My Collection");
      expect(collection.description).toBeNull();
      expect(collection.sortOrder).toBe("newest");
    });

    it("creates a collection with all fields", async () => {
      const collection = await collectionService.create({
        slug: "tech",
        title: "Tech Posts",
        description: "Posts about technology",
        sortOrder: "oldest",
      });

      expect(collection.slug).toBe("tech");
      expect(collection.title).toBe("Tech Posts");
      expect(collection.description).toBe("Posts about technology");
      expect(collection.sortOrder).toBe("oldest");
    });

    it("sets timestamps", async () => {
      const collection = await collectionService.create({
        slug: "test",
        title: "Test",
      });

      expect(collection.createdAt).toBeGreaterThan(0);
      expect(collection.updatedAt).toBeGreaterThan(0);
    });

    it("auto-creates a directory item", async () => {
      const collection = await collectionService.create({
        slug: "test",
        title: "Test",
      });

      const directoryItems = await collectionService.listDirectoryItems();
      expect(directoryItems).toHaveLength(1);
      expect(directoryItems[0]?.type).toBe("collection");
      expect(directoryItems[0]?.collectionId).toBe(collection.id);
      expect(typeof directoryItems[0]?.position).toBe("string");
    });

    it("rolls back the collection insert when slug persistence fails inside the batch", async () => {
      await collectionService.create({
        slug: "race-condition",
        title: "Existing",
      });

      const paths = createPathService(db, DEFAULT_TEST_SITE_ID);
      const raceyPaths = {
        ...paths,
        isPathAvailable: async () => true,
      };
      const raceyCollectionService = createCollectionService(
        db,
        DEFAULT_TEST_SITE_ID,
        raceyPaths,
      );

      await expect(
        raceyCollectionService.create({
          slug: "race-condition",
          title: "Race Condition",
        }),
      ).rejects.toThrow('Slug "race-condition" is already in use');

      const rows = await db.select({ id: collections.id }).from(collections);
      expect(rows).toHaveLength(1);
    });

    it("rejects slugs longer than the maximum length", async () => {
      await expect(
        collectionService.create({
          slug: "a".repeat(MAX_COLLECTION_SLUG_LENGTH + 1),
          title: "Too Long",
        }),
      ).rejects.toThrow();
    });

    it("rejects aggregate syntax in collection slugs", async () => {
      await expect(
        collectionService.create({
          slug: "smart+movies",
          title: "Smart + Movies",
        }),
      ).rejects.toThrow("Use lowercase letters, numbers, and hyphens only.");
    });

    it("allows valid non-reserved collection slugs", async () => {
      await expect(
        collectionService.create({
          slug: "favorites",
          title: "Favorites",
        }),
      ).resolves.toMatchObject({
        slug: "favorites",
        title: "Favorites",
      });
    });

    it("rejects slugs reserved by top-level routes", async () => {
      for (const slug of ["collections", "new", "compose"]) {
        await expect(
          collectionService.create({
            slug,
            title: slug,
          }),
        ).rejects.toThrow("This link is reserved. Choose something else.");
      }
    });
  });

  describe("getById", () => {
    it("returns a collection by ID", async () => {
      const created = await collectionService.create({
        slug: "test",
        title: "Test",
      });

      const found = await collectionService.getById(created.id);
      expect(found).not.toBeNull();
      expect(found?.title).toBe("Test");
      expect(found?.slug).toBe("test");
    });

    it("returns null for non-existent ID", async () => {
      const found = await collectionService.getById(
        "00000000-0000-0000-0000-000000009999",
      );
      expect(found).toBeNull();
    });
  });

  describe("getBySlug", () => {
    it("returns a collection by slug", async () => {
      await collectionService.create({ slug: "tech", title: "Tech" });

      const found = await collectionService.getBySlug("tech");
      expect(found).not.toBeNull();
      expect(found?.title).toBe("Tech");
      expect(found?.slug).toBe("tech");
    });

    it("returns null for non-existent slug", async () => {
      const found = await collectionService.getBySlug("nonexistent");
      expect(found).toBeNull();
    });
  });

  describe("resolveSelection", () => {
    it("resolves, dedupes, and preserves slug order", async () => {
      await collectionService.create({ slug: "smart", title: "Smart" });
      await collectionService.create({ slug: "movies", title: "Movies" });

      const selection =
        await collectionService.resolveSelection("smart+movies+smart");

      expect(selection?.slugs).toEqual(["smart", "movies"]);
      expect(selection?.slugExpression).toBe("smart+movies");
      expect(
        selection?.collections.map((collection) => collection.slug),
      ).toEqual(["smart", "movies"]);
    });

    it("returns null when any slug is missing or the expression is malformed", async () => {
      await collectionService.create({ slug: "smart", title: "Smart" });

      await expect(
        collectionService.resolveSelection("smart++movies"),
      ).resolves.toBeNull();
      await expect(
        collectionService.resolveSelection("smart+missing"),
      ).resolves.toBeNull();
    });
  });

  describe("list", () => {
    it("returns empty array when no collections exist", async () => {
      const list = await collectionService.list();
      expect(list).toEqual([]);
    });

    it("returns all collections", async () => {
      await collectionService.create({ slug: "first", title: "First" });
      await collectionService.create({ slug: "second", title: "Second" });
      await collectionService.create({ slug: "third", title: "Third" });

      const list = await collectionService.list();
      expect(list).toHaveLength(3);
    });
  });

  describe("listByRecentActivity", () => {
    it("breaks recent-added ties by newer collections first", async () => {
      vi.useFakeTimers();

      try {
        vi.setSystemTime(new Date("2024-01-01T00:00:00Z"));
        const older = await collectionService.create({
          slug: "older",
          title: "Older",
        });

        vi.setSystemTime(new Date("2024-01-01T00:00:10Z"));
        const newer = await collectionService.create({
          slug: "newer",
          title: "Newer",
        });

        vi.setSystemTime(new Date("2024-01-01T00:01:00Z"));
        await postService.create({
          format: "note",
          bodyMarkdown: "shared add",
          collectionIds: [older.id, newer.id],
        });

        const collections = await collectionService.listByRecentActivity();
        expect(collections.map((collection) => collection.id)).toEqual([
          newer.id,
          older.id,
        ]);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe("listDirectoryData", () => {
    it("returns collections with recent activity and labeled dividers", async () => {
      const reading = await collectionService.create({
        slug: "reading",
        title: "Reading",
      });
      const divider = await collectionService.createDirectoryItem({
        type: "divider",
        label: "Essays",
      });

      const post = await postService.create({
        format: "note",
        bodyMarkdown: "Book note",
      });
      await collectionService.addThread(reading.id, post.id);

      const directory = await collectionService.listDirectoryData();

      expect(directory.collections).toHaveLength(1);
      expect(directory.collections[0]?.recentActivityAt).toBe(
        post.lastActivityAt,
      );
      expect(
        directory.directoryItems.find((item) => item.id === divider.id)?.label,
      ).toBe("Essays");
      expect(directory.items).toEqual([
        expect.objectContaining({
          type: "collection",
          collection: expect.objectContaining({
            id: reading.id,
            threadCount: 1,
            recentActivityAt: post.lastActivityAt,
          }),
        }),
        expect.objectContaining({
          id: divider.id,
          type: "divider",
          label: "Essays",
        }),
      ]);
    });

    // The directory's "recent activity" uses the same definition as every
    // other surface: the Thread gained a post. Editing one is not activity,
    // or fixing a typo would reshuffle the whole collection directory.
    it("does not treat a later Root edit as recent activity", async () => {
      vi.useFakeTimers();
      try {
        vi.setSystemTime(new Date("2024-01-01T00:00:00Z"));
        const collection = await collectionService.create({
          slug: "edited-thread",
          title: "Edited Thread",
        });
        const root = await postService.create({
          format: "note",
          bodyMarkdown: "before",
        });
        await collectionService.addThread(collection.id, root.id);

        vi.setSystemTime(new Date("2024-01-01T00:01:00Z"));
        await postService.update(root.id, { bodyMarkdown: "after" });

        const directory = await collectionService.listDirectoryData();
        expect(directory.collections[0]?.recentActivityAt).toBe(1704067200);
      } finally {
        vi.useRealTimers();
      }
    });

    it("treats a new reply as recent activity", async () => {
      vi.useFakeTimers();
      try {
        vi.setSystemTime(new Date("2024-01-01T00:00:00Z"));
        const collection = await collectionService.create({
          slug: "growing-thread",
          title: "Growing Thread",
        });
        const root = await postService.create({
          format: "note",
          bodyMarkdown: "root",
        });
        await collectionService.addThread(collection.id, root.id);

        vi.setSystemTime(new Date("2024-01-01T00:01:00Z"));
        await postService.create({
          format: "note",
          bodyMarkdown: "reply",
          replyToId: root.id,
        });

        const directory = await collectionService.listDirectoryData();
        expect(directory.collections[0]?.recentActivityAt).toBe(1704067260);
      } finally {
        vi.useRealTimers();
      }
    });

    it("includes custom links in directory items", async () => {
      const link = await collectionService.createDirectoryItem({
        type: "link",
        label: "Quotes",
        url: "/archive?format=quote",
      });

      const directory = await collectionService.listDirectoryData();

      expect(directory.directoryItems).toContainEqual(
        expect.objectContaining({
          id: link.id,
          type: "link",
          label: "Quotes",
          url: "/archive?format=quote",
        }),
      );
      expect(directory.items).toContainEqual(
        expect.objectContaining({
          id: link.id,
          type: "link",
          label: "Quotes",
          url: "/archive?format=quote",
        }),
      );
    });
  });

  describe("update", () => {
    it("updates collection title", async () => {
      const collection = await collectionService.create({
        slug: "test",
        title: "Old",
      });

      const updated = await collectionService.update(collection.id, {
        title: "New",
      });

      expect(updated?.title).toBe("New");
    });

    it("updates collection slug", async () => {
      const collection = await collectionService.create({
        slug: "old-slug",
        title: "Test",
      });

      const updated = await collectionService.update(collection.id, {
        slug: "new-slug",
      });

      expect(updated?.slug).toBe("new-slug");
    });

    it("updates description", async () => {
      const collection = await collectionService.create({
        slug: "test",
        title: "Test",
        description: "Old description",
      });

      const updated = await collectionService.update(collection.id, {
        description: "New description",
      });

      expect(updated?.description).toBe("New description");
    });

    it("clears nullable fields with null", async () => {
      const collection = await collectionService.create({
        slug: "test",
        title: "Test",
        description: "Some desc",
      });

      const updated = await collectionService.update(collection.id, {
        description: null,
      });

      expect(updated?.description).toBeNull();
    });

    it("updates sortOrder", async () => {
      const collection = await collectionService.create({
        slug: "test",
        title: "Test",
      });

      const updated = await collectionService.update(collection.id, {
        sortOrder: "rating_desc",
      });

      expect(updated?.sortOrder).toBe("rating_desc");
    });

    it("updates updatedAt timestamp", async () => {
      const collection = await collectionService.create({
        slug: "test",
        title: "Test",
      });

      const updated = await collectionService.update(collection.id, {
        title: "Updated",
      });

      expect(updated?.updatedAt).toBeGreaterThanOrEqual(collection.updatedAt);
    });

    it("returns null for non-existent collection", async () => {
      const result = await collectionService.update(
        "00000000-0000-0000-0000-000000009999",
        { title: "X" },
      );
      expect(result).toBeNull();
    });
  });

  describe("delete", () => {
    it("deletes a collection", async () => {
      const collection = await collectionService.create({
        slug: "test",
        title: "Test",
      });

      const result = await collectionService.delete(collection.id);
      expect(result).toBe(true);

      const found = await collectionService.getById(collection.id);
      expect(found).toBeNull();
    });

    it("removes junction table entries on cascade", async () => {
      const collection = await collectionService.create({
        slug: "test",
        title: "Test",
      });
      const post = await postService.create({
        format: "note",
        bodyMarkdown: "test post",
      });

      await collectionService.addThread(collection.id, post.id);

      // Verify association exists
      const before = await collectionService.getCollectionsByPostId(post.id);
      expect(before).toHaveLength(1);

      await collectionService.delete(collection.id);

      // Post should still exist
      const found = await postService.getById(post.id);
      expect(found).not.toBeNull();

      // Association should be gone (cascade delete)
      const after = await collectionService.getCollectionsByPostId(post.id);
      expect(after).toHaveLength(0);
    });

    it("removes the directory item when collection is deleted", async () => {
      const collection = await collectionService.create({
        slug: "test",
        title: "Test",
      });

      // Verify directory item exists
      const before = await collectionService.listDirectoryItems();
      expect(before).toHaveLength(1);

      await collectionService.delete(collection.id);

      // Directory item should be gone
      const after = await collectionService.listDirectoryItems();
      expect(after).toHaveLength(0);
    });

    it("returns false for non-existent collection", async () => {
      const result = await collectionService.delete(
        "00000000-0000-0000-0000-000000009999",
      );
      expect(result).toBe(false);
    });
  });

  describe("listDirectoryItems", () => {
    it("returns empty array when no items exist", async () => {
      const items = await collectionService.listDirectoryItems();
      expect(items).toEqual([]);
    });

    it("returns items ordered by position", async () => {
      await collectionService.create({ slug: "first", title: "First" });
      await collectionService.create({ slug: "second", title: "Second" });

      const items = await collectionService.listDirectoryItems();
      expect(items).toHaveLength(2);
      expect(items[0]?.type).toBe("collection");
      expect(items[1]?.type).toBe("collection");
      // First created should come first (string comparison for fractional indexing)
      const pos0 = items[0]?.position ?? "";
      const pos1 = items[1]?.position ?? "";
      expect(pos0 < pos1).toBe(true);
    });

    it("includes dividers", async () => {
      await collectionService.create({ slug: "a", title: "A" });
      await collectionService.createDirectoryItem({ type: "divider" });
      await collectionService.create({ slug: "b", title: "B" });

      const items = await collectionService.listDirectoryItems();
      expect(items).toHaveLength(3);
      expect(items[0]?.type).toBe("collection");
      expect(items[1]?.type).toBe("divider");
      expect(items[2]?.type).toBe("collection");
    });
  });

  describe("createDirectoryItem", () => {
    it("creates a divider", async () => {
      const item = await collectionService.createDirectoryItem({
        type: "divider",
      });

      expect(item.type).toBe("divider");
      expect(item.collectionId).toBeNull();
      expect(item.label).toBeNull();
      expect(typeof item.position).toBe("string");
      expect(item.createdAt).toBeGreaterThan(0);
    });

    it("creates items with incrementing positions", async () => {
      const first = await collectionService.createDirectoryItem({
        type: "divider",
      });
      const second = await collectionService.createDirectoryItem({
        type: "divider",
      });

      expect(first.position < second.position).toBe(true);
    });

    it("rejects adding the same collection twice", async () => {
      const collection = await collectionService.create({
        slug: "notes",
        title: "Notes",
      });

      await expect(
        collectionService.createDirectoryItem({
          type: "collection",
          collectionId: collection.id,
        }),
      ).rejects.toThrow("Collection is already in the directory.");
    });

    it("creates a custom link", async () => {
      const item = await collectionService.createDirectoryItem({
        type: "link",
        label: "Quotes",
        url: "/archive?format=quote",
      });

      expect(item.type).toBe("link");
      expect(item.collectionId).toBeNull();
      expect(item.label).toBe("Quotes");
      expect(item.url).toBe("/archive?format=quote");
    });

    it("rejects duplicate directory positions at the database layer", async () => {
      const item = await collectionService.createDirectoryItem({
        type: "divider",
      });

      await expect(
        db.insert(directoryItemsTable).values({
          id: "00000000-0000-7000-8000-000000000001",
          type: "divider",
          collectionId: null,
          url: null,
          position: item.position,
          createdAt: item.createdAt,
          updatedAt: item.updatedAt,
        }),
      ).rejects.toThrow();
    });
  });

  describe("updateDirectoryItem", () => {
    it("updates and trims a divider label", async () => {
      const item = await collectionService.createDirectoryItem({
        type: "divider",
      });

      const updated = await collectionService.updateDirectoryItem(item.id, {
        label: "  Writing  ",
      });

      expect(updated?.label).toBe("Writing");
    });

    it("updates a custom link label and url", async () => {
      const item = await collectionService.createDirectoryItem({
        type: "link",
        label: "Quotes",
        url: "/archive?format=quote",
      });

      const updated = await collectionService.updateDirectoryItem(item.id, {
        label: "Quote archive",
        url: "/archive?format=quote&view=list",
      });

      expect(updated?.label).toBe("Quote archive");
      expect(updated?.url).toBe("/archive?format=quote&view=list");
    });
  });

  describe("deleteDirectoryItem", () => {
    it("deletes a directory item", async () => {
      const item = await collectionService.createDirectoryItem({
        type: "divider",
      });
      const result = await collectionService.deleteDirectoryItem(item.id);
      expect(result).toBe(true);

      const items = await collectionService.listDirectoryItems();
      expect(items).toHaveLength(0);
    });

    it("returns false for non-existent item", async () => {
      const result = await collectionService.deleteDirectoryItem(
        "00000000-0000-0000-0000-000000009999",
      );
      expect(result).toBe(false);
    });
  });

  describe("moveDirectoryItem", () => {
    it("moves an item between two others", async () => {
      const col1 = await collectionService.create({ slug: "a", title: "A" });
      const col2 = await collectionService.create({ slug: "b", title: "B" });
      const col3 = await collectionService.create({ slug: "c", title: "C" });

      // Get directory items (A, B, C order)
      const items = await collectionService.listDirectoryItems();
      expect(items).toHaveLength(3);
      const itemA = items.find((i) => i.collectionId === col1.id);
      const itemB = items.find((i) => i.collectionId === col2.id);
      const itemC = items.find((i) => i.collectionId === col3.id);
      expect(itemA).toBeDefined();
      expect(itemB).toBeDefined();
      expect(itemC).toBeDefined();

      // Move C between A and B
      const moved = await collectionService.moveDirectoryItem(
        itemC?.id ?? "",
        itemA?.id ?? "",
        itemB?.id ?? "",
      );

      expect(moved).not.toBeNull();

      // Verify new order: A, C, B
      const reordered = await collectionService.listDirectoryItems();
      expect(reordered[0]?.collectionId).toBe(col1.id);
      expect(reordered[1]?.collectionId).toBe(col3.id);
      expect(reordered[2]?.collectionId).toBe(col2.id);
    });

    it("moves an item to the beginning", async () => {
      const col1 = await collectionService.create({ slug: "a", title: "A" });
      const col2 = await collectionService.create({ slug: "b", title: "B" });
      const col3 = await collectionService.create({ slug: "c", title: "C" });

      const items = await collectionService.listDirectoryItems();
      const itemA = items.find((i) => i.collectionId === col1.id);
      const itemC = items.find((i) => i.collectionId === col3.id);
      expect(itemA).toBeDefined();
      expect(itemC).toBeDefined();

      // Move C to the beginning (before A, no after)
      await collectionService.moveDirectoryItem(
        itemC?.id ?? "",
        null,
        itemA?.id ?? "",
      );

      const reordered = await collectionService.listDirectoryItems();
      expect(reordered[0]?.collectionId).toBe(col3.id);
      expect(reordered[1]?.collectionId).toBe(col1.id);
      expect(reordered[2]?.collectionId).toBe(col2.id);
    });

    it("moves an item to the end", async () => {
      const col1 = await collectionService.create({ slug: "a", title: "A" });
      const col2 = await collectionService.create({ slug: "b", title: "B" });
      const col3 = await collectionService.create({ slug: "c", title: "C" });

      const items = await collectionService.listDirectoryItems();
      const itemA = items.find((i) => i.collectionId === col1.id);
      const itemC = items.find((i) => i.collectionId === col3.id);
      expect(itemA).toBeDefined();
      expect(itemC).toBeDefined();

      // Move A to the end (after C, no before)
      await collectionService.moveDirectoryItem(
        itemA?.id ?? "",
        itemC?.id ?? "",
        null,
      );

      const reordered = await collectionService.listDirectoryItems();
      expect(reordered[0]?.collectionId).toBe(col2.id);
      expect(reordered[1]?.collectionId).toBe(col3.id);
      expect(reordered[2]?.collectionId).toBe(col1.id);
    });

    it("returns null for non-existent item", async () => {
      const result = await collectionService.moveDirectoryItem(
        "00000000-0000-0000-0000-000000009999",
        null,
        null,
      );
      expect(result).toBeNull();
    });
  });

  describe("getThreadCounts", () => {
    it("returns empty map when no posts exist", async () => {
      await collectionService.create({ slug: "empty", title: "Empty" });

      const counts = await collectionService.getThreadCounts();
      expect(counts.size).toBe(0);
    });

    it("returns correct counts for collections with Threads", async () => {
      const col1 = await collectionService.create({
        slug: "col1",
        title: "Col 1",
      });
      const col2 = await collectionService.create({
        slug: "col2",
        title: "Col 2",
      });

      const p1 = await postService.create({
        format: "note",
        bodyMarkdown: "post 1",
      });
      const p2 = await postService.create({
        format: "note",
        bodyMarkdown: "post 2",
      });
      const p3 = await postService.create({
        format: "note",
        bodyMarkdown: "post 3",
      });

      await collectionService.addThread(col1.id, p1.id);
      await collectionService.addThread(col1.id, p2.id);
      await collectionService.addThread(col2.id, p3.id);

      const counts = await collectionService.getThreadCounts();
      expect(counts.get(col1.id)).toBe(2);
      expect(counts.get(col2.id)).toBe(1);
    });

    it("does not count Threads without a collection", async () => {
      const col = await collectionService.create({
        slug: "col",
        title: "Col",
      });

      const p1 = await postService.create({
        format: "note",
        bodyMarkdown: "with collection",
      });
      await postService.create({
        format: "note",
        bodyMarkdown: "no collection",
      });

      await collectionService.addThread(col.id, p1.id);

      const counts = await collectionService.getThreadCounts();
      expect(counts.get(col.id)).toBe(1);
      expect(counts.size).toBe(1);
    });

    it("does not count deleted Threads", async () => {
      const col = await collectionService.create({
        slug: "col",
        title: "Col",
      });

      const post = await postService.create({
        format: "note",
        bodyMarkdown: "will be deleted",
      });
      const post2 = await postService.create({
        format: "note",
        bodyMarkdown: "still alive",
      });

      await collectionService.addThread(col.id, post.id);
      await collectionService.addThread(col.id, post2.id);

      await postService.delete(post.id);

      const counts = await collectionService.getThreadCounts();
      expect(counts.get(col.id)).toBe(1);
    });
  });

  describe("addThread / removeThread", () => {
    it("adds a Thread to a collection", async () => {
      const col = await collectionService.create({
        slug: "test",
        title: "Test",
      });
      const post = await postService.create({
        format: "note",
        bodyMarkdown: "test",
      });

      await collectionService.addThread(col.id, post.id);

      const collections = await collectionService.getCollectionsByPostId(
        post.id,
      );
      expect(collections).toHaveLength(1);
      expect(collections[0]?.id).toBe(col.id);
    });

    it("does not duplicate on re-add", async () => {
      const col = await collectionService.create({
        slug: "test",
        title: "Test",
      });
      const post = await postService.create({
        format: "note",
        bodyMarkdown: "test",
      });

      await collectionService.addThread(col.id, post.id);
      await collectionService.addThread(col.id, post.id); // duplicate

      const threadIds = await collectionService.getThreadIds(col.id);
      expect(threadIds).toHaveLength(1);
    });

    it("removes a Thread from a collection", async () => {
      const col = await collectionService.create({
        slug: "test",
        title: "Test",
      });
      const post = await postService.create({
        format: "note",
        bodyMarkdown: "test",
      });

      await collectionService.addThread(col.id, post.id);
      await collectionService.removeThread(col.id, post.id);

      const collections = await collectionService.getCollectionsByPostId(
        post.id,
      );
      expect(collections).toHaveLength(0);
    });

    it("normalizes Child mutations to the shared Thread root", async () => {
      const collection = await collectionService.create({
        slug: "child-mutation",
        title: "Child Mutation",
      });
      const root = await postService.create({
        format: "note",
        bodyMarkdown: "root",
      });
      const child = await postService.create({
        format: "note",
        bodyMarkdown: "child",
        replyToId: root.id,
      });

      await collectionService.addThread(collection.id, child.id);
      expect(await collectionService.getThreadIds(collection.id)).toEqual([
        root.id,
      ]);
      expect(
        (await collectionService.getCollectionsByPostId(root.id)).map(
          (item) => item.id,
        ),
      ).toEqual([collection.id]);

      await collectionService.removeThread(collection.id, child.id);
      expect(await collectionService.getThreadIds(collection.id)).toEqual([]);
    });
  });

  describe("getCollectionsByPostId", () => {
    it("returns all collections a post belongs to", async () => {
      await collectionService.create({
        slug: "col1",
        title: "Col 1",
      });
      await collectionService.create({
        slug: "col2",
        title: "Col 2",
      });

      const cols = await collectionService.list();
      expect(cols).toHaveLength(2);
      const post = await postService.create({
        format: "note",
        bodyMarkdown: "test",
      });

      await collectionService.addThread(cols[0]?.id ?? "", post.id);
      await collectionService.addThread(cols[1]?.id ?? "", post.id);

      const collections = await collectionService.getCollectionsByPostId(
        post.id,
      );
      expect(collections).toHaveLength(2);
    });

    it("returns empty array for post with no collections", async () => {
      const post = await postService.create({
        format: "note",
        bodyMarkdown: "test",
      });

      const collections = await collectionService.getCollectionsByPostId(
        post.id,
      );
      expect(collections).toHaveLength(0);
    });

    it("projects one shared membership set onto the root and every child", async () => {
      const collection = await collectionService.create({
        slug: "shared-thread",
        title: "Shared Thread",
      });
      const root = await postService.create({
        format: "note",
        bodyMarkdown: "root",
      });
      const child = await postService.create({
        format: "note",
        bodyMarkdown: "child",
        replyToId: root.id,
      });

      await collectionService.addThread(collection.id, root.id);

      const [rootCollections, childCollections, batch] = await Promise.all([
        collectionService.getCollectionsByPostId(root.id),
        collectionService.getCollectionsByPostId(child.id),
        collectionService.getCollectionsByPostIds([root.id, child.id]),
      ]);

      expect(rootCollections.map((item) => item.id)).toEqual([collection.id]);
      expect(childCollections.map((item) => item.id)).toEqual([collection.id]);
      expect(batch.get(root.id)?.map((item) => item.id)).toEqual([
        collection.id,
      ]);
      expect(batch.get(child.id)?.map((item) => item.id)).toEqual([
        collection.id,
      ]);
    });

    it("keeps shared membership when a Child is deleted and removes it with the Root", async () => {
      const collection = await collectionService.create({
        slug: "thread-lifecycle",
        title: "Thread Lifecycle",
      });
      const root = await postService.create({
        format: "note",
        bodyMarkdown: "root",
      });
      const child = await postService.create({
        format: "note",
        bodyMarkdown: "child",
        replyToId: root.id,
      });
      await collectionService.addThread(collection.id, root.id);

      await postService.delete(child.id);
      expect(
        (await collectionService.getCollectionsByPostId(root.id)).map(
          (item) => item.id,
        ),
      ).toEqual([collection.id]);

      await postService.delete(root.id);
      expect(await collectionService.getThreadIds(collection.id)).toEqual([]);
    });
  });

  describe("getThreadIds", () => {
    it("returns all Thread root IDs in a collection", async () => {
      const col = await collectionService.create({
        slug: "test",
        title: "Test",
      });
      const p1 = await postService.create({
        format: "note",
        bodyMarkdown: "one",
      });
      const p2 = await postService.create({
        format: "note",
        bodyMarkdown: "two",
      });

      await collectionService.addThread(col.id, p1.id);
      await collectionService.addThread(col.id, p2.id);

      const ids = await collectionService.getThreadIds(col.id);
      expect(ids).toHaveLength(2);
      expect(ids).toContain(p1.id);
      expect(ids).toContain(p2.id);
    });
  });

  describe("syncThreadCollections", () => {
    it("replaces all collection memberships for a Thread", async () => {
      const col1 = await collectionService.create({
        slug: "col1",
        title: "Col 1",
      });
      const col2 = await collectionService.create({
        slug: "col2",
        title: "Col 2",
      });
      const col3 = await collectionService.create({
        slug: "col3",
        title: "Col 3",
      });

      const post = await postService.create({
        format: "note",
        bodyMarkdown: "test",
      });

      // Initially in col1 and col2
      await collectionService.addThread(col1.id, post.id);
      await collectionService.addThread(col2.id, post.id);

      // Sync to col2 and col3
      await collectionService.syncThreadCollections(post.id, [
        col2.id,
        col3.id,
      ]);

      const collections = await collectionService.getCollectionsByPostId(
        post.id,
      );
      const ids = collections.map((c) => c.id);
      expect(ids).toHaveLength(2);
      expect(ids).toContain(col2.id);
      expect(ids).toContain(col3.id);
      expect(ids).not.toContain(col1.id);
    });

    it("removes all collections when empty array provided", async () => {
      const col = await collectionService.create({
        slug: "test",
        title: "Test",
      });
      const post = await postService.create({
        format: "note",
        bodyMarkdown: "test",
      });

      await collectionService.addThread(col.id, post.id);
      await collectionService.syncThreadCollections(post.id, []);

      const collections = await collectionService.getCollectionsByPostId(
        post.id,
      );
      expect(collections).toHaveLength(0);
    });

    it("does not call transaction() when syncing collections on sqlite-family backends", async () => {
      const col = await collectionService.create({
        slug: "test-sync",
        title: "Test Sync",
      });
      const post = await postService.create({
        format: "note",
        bodyMarkdown: "test",
      });

      const dbWithoutTransaction = db as Database & {
        transaction: () => Promise<never>;
      };
      const originalTransaction = dbWithoutTransaction.transaction.bind(db);
      dbWithoutTransaction.transaction = async () => {
        throw new Error(
          "sqlite syncThreadCollections() should not call transaction()",
        );
      };

      try {
        await expect(
          collectionService.syncThreadCollections(post.id, [col.id]),
        ).resolves.toBeUndefined();
      } finally {
        dbWithoutTransaction.transaction = originalTransaction;
      }
    });
  });
});
