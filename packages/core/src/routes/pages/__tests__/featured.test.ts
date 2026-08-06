/**
 * Tests for the featured page data logic.
 *
 * Note: These tests stay at the service layer. They avoid rendering the full
 * route JSX tree so vitest does not need the runtime SSR setup for those pages.
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  createTestDatabase,
  DEFAULT_TEST_SITE_ID,
} from "../../../__tests__/helpers/db.js";
import { createPostService } from "../../../services/post.js";
import type { Database } from "../../../db/index.js";

describe("Featured Page - Data Logic", () => {
  let db: Database;
  let postService: ReturnType<typeof createPostService>;

  beforeEach(() => {
    const testDb = createTestDatabase();
    db = testDb.db as unknown as Database;
    postService = createPostService(
      db,
      { slugIdLength: 5 },
      DEFAULT_TEST_SITE_ID,
    );
  });

  it("returns only featured published posts", async () => {
    await postService.create({
      format: "note",
      bodyMarkdown: "Featured post",
      featured: true,
      status: "published",
    });
    await postService.create({
      format: "note",
      bodyMarkdown: "Normal post",
      status: "published",
    });
    // Featuring an unpublished post is refused outright, so the only way a
    // draft carries the flag is by being unpublished after the fact — the
    // case this filter still has to catch.
    const unpublished = await postService.create({
      format: "note",
      bodyMarkdown: "Draft featured",
      featured: true,
      status: "published",
    });
    await postService.update(unpublished.id, { status: "draft" });

    const posts = await postService.list({
      featured: true,
      status: "published",
    });

    expect(posts).toHaveLength(1);
    expect(posts[0]?.bodyText).toBe("Featured post");
  });

  it("returns empty list when no featured posts exist", async () => {
    await postService.create({
      format: "note",
      bodyMarkdown: "Normal post",
      status: "published",
    });

    const posts = await postService.list({
      featured: true,
      status: "published",
    });

    expect(posts).toHaveLength(0);
  });

  it("includes featured reply posts", async () => {
    const root = await postService.create({
      format: "note",
      bodyMarkdown: "Root post",
      status: "published",
    });

    // Create a reply and feature it independently
    const reply = await postService.create({
      format: "note",
      bodyMarkdown: "Reply to root",
      replyToId: root.id,
    });
    await postService.update(reply.id, { featured: true });

    const posts = await postService.list({
      featured: true,
      status: "published",
    });

    expect(posts).toHaveLength(1);
    expect(posts[0]?.bodyText).toBe("Reply to root");
  });

  it("featured root and featured reply both appear", async () => {
    const root = await postService.create({
      format: "note",
      bodyMarkdown: "Featured root",
      featured: true,
      status: "published",
    });

    const reply = await postService.create({
      format: "note",
      bodyMarkdown: "Featured reply",
      replyToId: root.id,
    });
    await postService.update(reply.id, { featured: true });

    const posts = await postService.list({
      featured: true,
      status: "published",
    });

    expect(posts).toHaveLength(2);
  });
});
