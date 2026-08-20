/**
 * Tests for the collections listing page data logic.
 *
 * Note: These tests stay at the service layer. They avoid rendering the full
 * route JSX tree so vitest does not need the runtime SSR setup for those pages.
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  createTestDatabase,
  DEFAULT_TEST_SITE_ID,
} from "../../../__tests__/helpers/db.js";
import { createCollectionService } from "../../../services/collection.js";
import { createPostService } from "../../../services/post.js";
import type { Database } from "../../../db/index.js";

describe("Collections Listing Page - Data Logic", () => {
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

  it("returns collections with Thread counts and recent activity", async () => {
    const recipes = await collectionService.create({
      slug: "recipes",
      title: "Recipes",
    });
    await collectionService.create({
      slug: "travel",
      title: "Travel",
    });

    // Add Threads to the recipes Collection.
    const p1 = await postService.create({
      format: "note",
      bodyMarkdown: "Recipe 1",
    });
    const p2 = await postService.create({
      format: "note",
      bodyMarkdown: "Recipe 2",
    });
    await collectionService.addThread(recipes.id, p1.id);
    await collectionService.addThread(recipes.id, p2.id);

    const directory = await collectionService.listDirectoryData({
      isAuthenticated: false,
    });

    expect(directory.collections).toHaveLength(2);
    const recipesResult = directory.collections.find(
      (c) => c.slug === "recipes",
    );
    const travelResult = directory.collections.find((c) => c.slug === "travel");
    expect(recipesResult?.threadCount).toBe(2);
    expect(recipesResult?.recentActivityAt).toBe(p2.lastActivityAt);
    expect(travelResult?.threadCount).toBe(0);
    expect(travelResult?.recentActivityAt).toBeGreaterThan(0);
  });

  it("returns empty list when no collections exist", async () => {
    const directory = await collectionService.listDirectoryData({
      isAuthenticated: false,
    });
    expect(directory.collections).toHaveLength(0);
    expect(directory.items).toHaveLength(0);
  });

  it("does not count soft-deleted posts", async () => {
    const col = await collectionService.create({
      slug: "test",
      title: "Test",
    });

    const post = await postService.create({
      format: "note",
      bodyMarkdown: "Will be deleted",
    });
    const post2 = await postService.create({
      format: "note",
      bodyMarkdown: "Will remain",
    });

    await collectionService.addThread(col.id, post.id);
    await collectionService.addThread(col.id, post2.id);

    await postService.delete(post.id);

    const directory = await collectionService.listDirectoryData({
      isAuthenticated: false,
    });
    expect(directory.collections[0]?.threadCount).toBe(1);
    expect(directory.collections[0]?.recentActivityAt).toBe(
      post2.lastActivityAt,
    );
  });
});
