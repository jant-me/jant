/**
 * Timeline Data Assembly Tests
 *
 * Tests the timeline data assembly logic via the service layer.
 * The actual route handler renders JSX components which require the Lingui SWC
 * plugin (not available in vitest). We test the underlying service operations
 * that power the timeline instead.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import type { Context } from "hono";
import {
  createTestDatabase,
  DEFAULT_TEST_SITE_ID,
} from "../../__tests__/helpers/db.js";
import { createPostService } from "../../services/post.js";
import { createMediaService } from "../../services/media.js";
import { createPathService } from "../../services/path.js";
import { createCollectionService } from "../../services/collection.js";
import { posts as postTable, sites } from "../../db/schema.js";
import { buildMediaMap } from "../media-helpers.js";
import {
  assembleCollectionTimeline,
  assembleFeaturedTimeline,
  assembleTimelineItem,
} from "../timeline.js";
import type { Database } from "../../db/index.js";
import type { AppConfig, Bindings, PostWithMedia } from "../../types.js";
import type { AppVariables } from "../../types/app-context.js";

type Env = { Bindings: Bindings; Variables: AppVariables };

describe("Timeline data assembly", () => {
  let db: Database;
  let postService: ReturnType<typeof createPostService>;
  let mediaService: ReturnType<typeof createMediaService>;
  let collectionService: ReturnType<typeof createCollectionService>;
  let pathService: ReturnType<typeof createPathService>;

  beforeEach(() => {
    const testDb = createTestDatabase();
    db = testDb.db as unknown as Database;
    pathService = createPathService(db, DEFAULT_TEST_SITE_ID);
    postService = createPostService(
      db,
      { slugIdLength: 5 },
      DEFAULT_TEST_SITE_ID,
      pathService,
    );
    mediaService = createMediaService(db, DEFAULT_TEST_SITE_ID);
    collectionService = createCollectionService(
      db,
      DEFAULT_TEST_SITE_ID,
      pathService,
    );
  });

  function createTimelineContext(): Context<Env> {
    return {
      var: {
        services: {
          posts: postService,
          media: mediaService,
          collections: collectionService,
          paths: pathService,
        },
        appConfig: {
          pageSize: 20,
        } as unknown as AppConfig,
      },
    } as unknown as Context<Env>;
  }

  it("assembles timeline items with media attachments", async () => {
    const post = await postService.create({
      format: "note",
      bodyMarkdown: "Hello",
    });

    const posts = await postService.list({
      status: "published",
      excludeReplies: true,
      limit: 21,
    });

    expect(posts).toHaveLength(1);
    expect(posts[0]?.id).toBe(post.id);

    // Build media map
    const postIds = posts.map((p) => p.id);
    const rawMediaMap = await mediaService.getByPostIds(postIds);
    const mediaMap = buildMediaMap(rawMediaMap);

    // Assemble items
    const items = posts.map((p) => ({
      post: { ...p, mediaAttachments: mediaMap.get(p.id) ?? [] },
    }));

    expect(items).toHaveLength(1);
    expect(items[0]?.post.mediaAttachments).toEqual([]);
  });

  it("identifies thread roots and builds thread context", async () => {
    const root = await postService.create({
      format: "note",
      bodyMarkdown: "Thread root",
    });
    const reply1 = await postService.create({
      format: "note",
      bodyMarkdown: "Reply 1",
      replyToId: root.id,
    });
    await postService.create({
      format: "note",
      bodyMarkdown: "Reply 2",
      replyToId: reply1.id,
    });

    const posts = await postService.list({
      status: "published",
      excludeReplies: true,
      limit: 21,
    });

    expect(posts).toHaveLength(1);

    const postIds = posts.map((p) => p.id);
    const replyCounts = await postService.getReplyCounts(postIds);
    const threadRootIds = postIds.filter(
      (id) => (replyCounts.get(id) ?? 0) > 0,
    );

    expect(threadRootIds).toEqual([root.id]);
    expect(replyCounts.get(root.id)).toBe(2);

    const threadContexts =
      await postService.getThreadTimelineContext(threadRootIds);
    const ctx = threadContexts.get(root.id);
    expect(ctx).toBeDefined();
    expect(ctx?.latestReply.bodyText).toBe("Reply 2");
    expect(ctx?.totalReplyCount).toBe(2);

    // Assemble items
    const rawMediaMap = await mediaService.getByPostIds(postIds);
    const mediaMap = buildMediaMap(rawMediaMap);

    const items = posts.map((post) => {
      const postWithMedia: PostWithMedia = {
        ...post,
        mediaAttachments: mediaMap.get(post.id) ?? [],
      };

      const threadCtx = threadContexts.get(post.id);

      if (threadCtx) {
        return {
          post: postWithMedia,
          threadPreview: {
            leadingReplies: threadCtx.leadingReplies.map((reply) => ({
              ...reply,
              mediaAttachments: [],
            })),
            trailingReplies: threadCtx.trailingReplies.map((reply) => ({
              ...reply,
              mediaAttachments: [],
            })),
            latestReply: {
              ...threadCtx.latestReply,
              mediaAttachments: [],
            },
            totalReplyCount: threadCtx.totalReplyCount,
          },
        };
      }

      return { post: postWithMedia };
    });

    expect(items).toHaveLength(1);
    expect(items[0]?.threadPreview).toBeDefined();
    expect(items[0]?.threadPreview?.leadingReplies[0]?.bodyText).toBe(
      "Reply 1",
    );
    expect(items[0]?.threadPreview?.latestReply.bodyText).toBe("Reply 2");
    expect(items[0]?.threadPreview?.totalReplyCount).toBe(2);
  });

  it("excludes replies from top-level list", async () => {
    const root = await postService.create({
      format: "note",
      bodyMarkdown: "Root",
    });
    await postService.create({
      format: "note",
      bodyMarkdown: "Reply",
      replyToId: root.id,
    });

    const posts = await postService.list({
      status: "published",
      excludeReplies: true,
      limit: 21,
    });

    expect(posts).toHaveLength(1);
    expect(posts[0]?.bodyText).toBe("Root");
  });

  it("supports cursor pagination for load more", async () => {
    const posts = [];
    for (let i = 0; i < 5; i++) {
      posts.push(
        await postService.create({
          format: "note",
          bodyMarkdown: `Post ${i}`,
          publishedAt: 1000 + i,
        }),
      );
    }

    // First page
    const page1 = await postService.list({
      status: "published",
      excludeReplies: true,
      limit: 3,
    });
    expect(page1).toHaveLength(3);

    // Second page using cursor
    const lastPost = page1[page1.length - 1];
    expect(lastPost).toBeDefined();
    const page2 = await postService.list({
      status: "published",
      excludeReplies: true,
      limit: 3,
      cursor: lastPost?.id,
    });
    expect(page2).toHaveLength(2);
    expect(page2.every((p) => p.id < (lastPost?.id ?? 0))).toBe(true);
  });

  it("supports offset-based pagination for page navigation", async () => {
    for (let i = 0; i < 5; i++) {
      await postService.create({
        format: "note",
        bodyMarkdown: `Post ${i}`,
        publishedAt: 1000 + i,
      });
    }

    const pageSize = 2;

    // Page 1
    const page1 = await postService.list({
      status: "published",
      excludeReplies: true,
      limit: pageSize,
      offset: 0,
    });
    expect(page1).toHaveLength(2);
    expect(page1[0]?.bodyText).toBe("Post 4");
    expect(page1[1]?.bodyText).toBe("Post 3");

    // Page 2
    const page2 = await postService.list({
      status: "published",
      excludeReplies: true,
      limit: pageSize,
      offset: 2,
    });
    expect(page2).toHaveLength(2);
    expect(page2[0]?.bodyText).toBe("Post 2");
    expect(page2[1]?.bodyText).toBe("Post 1");

    // Page 3 (partial)
    const page3 = await postService.list({
      status: "published",
      excludeReplies: true,
      limit: pageSize,
      offset: 4,
    });
    expect(page3).toHaveLength(1);
    expect(page3[0]?.bodyText).toBe("Post 0");
  });

  it("computes total pages from count", async () => {
    for (let i = 0; i < 5; i++) {
      await postService.create({
        format: "note",
        bodyMarkdown: `Post ${i}`,
      });
    }

    const pageSize = 2;
    const totalCount = await postService.count({
      status: "published",
      excludeReplies: true,
    });

    expect(totalCount).toBe(5);
    const totalPages = Math.ceil(totalCount / pageSize);
    expect(totalPages).toBe(3);
  });

  it("assembles a single timeline item for in-place thread refreshes", async () => {
    const root = await postService.create({
      format: "note",
      bodyMarkdown: "Thread root",
    });
    const reply1 = await postService.create({
      format: "note",
      bodyMarkdown: "Reply 1",
      replyToId: root.id,
    });
    const latestReply = await postService.create({
      format: "note",
      bodyMarkdown: "Reply 2",
      replyToId: reply1.id,
    });

    const item = await assembleTimelineItem(createTimelineContext(), root.id);

    expect(item?.post.id).toBe(root.id);
    expect(item?.post.isLastInThread).toBe(false);
    expect(item?.threadPreview?.latestReply.id).toBe(latestReply.id);
    expect(item?.threadPreview?.totalReplyCount).toBe(2);
  });

  it("keeps featured root posts with replies in curated thread mode", async () => {
    const root = await postService.create({
      format: "note",
      bodyMarkdown: "Featured root",
      featured: true,
    });
    const reply = await postService.create({
      format: "note",
      bodyMarkdown: "Reply",
      replyToId: root.id,
    });

    const result = await assembleFeaturedTimeline(createTimelineContext(), {
      isAuthenticated: true,
    });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.post.id).toBe(root.id);
    expect(result.items[0]?.curatedThread?.segments).toEqual([
      expect.objectContaining({
        post: expect.objectContaining({ id: root.id }),
        hiddenBeforeCount: 0,
        highlighted: true,
      }),
      expect.objectContaining({
        post: expect.objectContaining({ id: reply.id }),
        hiddenBeforeCount: 0,
        highlighted: false,
      }),
    ]);
  });

  it("renders a standalone featured root without curated thread chrome", async () => {
    const root = await postService.create({
      format: "note",
      bodyMarkdown: "Featured solo root",
      featured: true,
    });

    const result = await assembleFeaturedTimeline(createTimelineContext(), {
      isAuthenticated: true,
    });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.post.id).toBe(root.id);
    expect(result.items[0]?.curatedThread).toBeUndefined();
  });

  it("scopes featured count and list to the current site", async () => {
    // The current site has a single featured post.
    const ownRoot = await postService.create({
      format: "note",
      bodyMarkdown: "Our featured post",
      featured: true,
    });

    // Another tenant sharing the same database has its own featured posts.
    const otherSiteId = "sit_test00000000000000000000001";
    await db.insert(sites).values({
      id: otherSiteId,
      key: "other",
      status: "active",
      createdAt: 1,
      updatedAt: 1,
    });
    const otherPathService = createPathService(db, otherSiteId);
    const otherPostService = createPostService(
      db,
      { slugIdLength: 5 },
      otherSiteId,
      otherPathService,
    );
    await otherPostService.create({
      format: "note",
      bodyMarkdown: "Other tenant featured A",
      featured: true,
    });
    await otherPostService.create({
      format: "note",
      bodyMarkdown: "Other tenant featured B",
      featured: true,
    });

    const result = await assembleFeaturedTimeline(createTimelineContext(), {
      isAuthenticated: true,
    });

    // Count, pages, and items must reflect only the current site — the other
    // tenant's featured posts must not inflate the total or appear in the feed.
    expect(result.totalCount).toBe(1);
    expect(result.totalPages).toBe(1);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.post.id).toBe(ownRoot.id);
  });

  it("groups featured replies under their thread root with hidden gaps", async () => {
    const root = await postService.create({
      format: "note",
      bodyMarkdown: "Root",
    });
    const reply1 = await postService.create({
      format: "note",
      bodyMarkdown: "Reply 1",
      replyToId: root.id,
    });
    const featuredReplyA = await postService.create({
      format: "note",
      bodyMarkdown: "Featured reply A",
      replyToId: reply1.id,
    });
    const reply3 = await postService.create({
      format: "note",
      bodyMarkdown: "Reply 3",
      replyToId: featuredReplyA.id,
    });
    const featuredReplyB = await postService.create({
      format: "note",
      bodyMarkdown: "Featured reply B",
      replyToId: reply3.id,
    });

    await db
      .update(postTable)
      .set({ featuredAt: 100 })
      .where(eq(postTable.id, featuredReplyA.id));
    await db
      .update(postTable)
      .set({ featuredAt: 200 })
      .where(eq(postTable.id, featuredReplyB.id));

    const result = await assembleFeaturedTimeline(createTimelineContext(), {
      isAuthenticated: true,
    });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.post.id).toBe(root.id);
    expect(result.items[0]?.curatedThread?.rootPost.id).toBe(root.id);
    expect(result.items[0]?.curatedThread?.segments).toEqual([
      expect.objectContaining({
        post: expect.objectContaining({ id: root.id }),
        hiddenBeforeCount: 0,
        highlighted: false,
      }),
      expect.objectContaining({
        post: expect.objectContaining({ id: featuredReplyA.id }),
        hiddenBeforeCount: 1,
        highlighted: true,
      }),
      expect.objectContaining({
        post: expect.objectContaining({ id: featuredReplyB.id }),
        hiddenBeforeCount: 1,
        highlighted: true,
      }),
    ]);
  });

  it("keeps the last post visible around a featured middle reply", async () => {
    const root = await postService.create({
      format: "note",
      bodyMarkdown: "Root",
    });
    const featuredMiddle = await postService.create({
      format: "note",
      bodyMarkdown: "Featured middle",
      replyToId: root.id,
      featured: true,
    });
    const lastReply = await postService.create({
      format: "note",
      bodyMarkdown: "Last reply",
      replyToId: featuredMiddle.id,
    });

    const result = await assembleFeaturedTimeline(createTimelineContext(), {
      isAuthenticated: true,
    });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.curatedThread?.segments).toEqual([
      expect.objectContaining({
        post: expect.objectContaining({ id: root.id }),
        hiddenBeforeCount: 0,
        highlighted: false,
      }),
      expect.objectContaining({
        post: expect.objectContaining({ id: featuredMiddle.id }),
        hiddenBeforeCount: 0,
        highlighted: true,
      }),
      expect.objectContaining({
        post: expect.objectContaining({ id: lastReply.id }),
        hiddenBeforeCount: 0,
        highlighted: false,
      }),
    ]);
  });

  it("orders Featured Threads by the latest selected Post publication time", async () => {
    const olderFeaturedRoot = await postService.create({
      format: "note",
      bodyMarkdown: "Older featured root",
      publishedAt: 1000,
    });
    const olderFeaturedReply = await postService.create({
      format: "note",
      bodyMarkdown: "Older featured reply",
      replyToId: olderFeaturedRoot.id,
      publishedAt: 3000,
    });
    const newerFeaturedRoot = await postService.create({
      format: "note",
      bodyMarkdown: "Newer featured root",
      featured: true,
      publishedAt: 2000,
    });

    // Featured timestamps deliberately disagree with publication order.
    await db
      .update(postTable)
      .set({ featuredAt: 100 })
      .where(eq(postTable.id, olderFeaturedReply.id));
    await db
      .update(postTable)
      .set({ featuredAt: 200 })
      .where(eq(postTable.id, newerFeaturedRoot.id));

    await postService.create({
      format: "note",
      bodyMarkdown: "Later non-featured reply",
      replyToId: olderFeaturedReply.id,
      publishedAt: 4000,
    });

    const result = await assembleFeaturedTimeline(createTimelineContext(), {
      isAuthenticated: true,
    });

    expect(result.items).toHaveLength(2);
    expect(result.items[0]?.post.id).toBe(olderFeaturedRoot.id);
    expect(result.items[1]?.post.id).toBe(newerFeaturedRoot.id);
  });

  it("loads only the Root, Featured Posts, and final Post for curated display", async () => {
    const root = await postService.create({
      format: "note",
      bodyMarkdown: "Root",
      publishedAt: 1000,
    });
    const hiddenReplyA = await postService.create({
      format: "note",
      bodyMarkdown: "Hidden reply A",
      replyToId: root.id,
      publishedAt: 2000,
    });
    const featuredReply = await postService.create({
      format: "note",
      bodyMarkdown: "Featured reply",
      replyToId: hiddenReplyA.id,
      featured: true,
      publishedAt: 3000,
    });
    const hiddenReplyB = await postService.create({
      format: "note",
      bodyMarkdown: "Hidden reply B",
      replyToId: featuredReply.id,
      publishedAt: 4000,
    });
    const finalReply = await postService.create({
      format: "note",
      bodyMarkdown: "Final reply",
      replyToId: hiddenReplyB.id,
      publishedAt: 5000,
    });

    const result = await postService.getFeaturedThreadTimelineData([root.id]);
    const thread = result.get(root.id);

    expect(thread?.posts).toEqual([
      expect.objectContaining({
        post: expect.objectContaining({ id: root.id }),
        position: 0,
      }),
      expect.objectContaining({
        post: expect.objectContaining({ id: featuredReply.id }),
        position: 2,
      }),
      expect.objectContaining({
        post: expect.objectContaining({ id: finalReply.id }),
        position: 4,
      }),
    ]);
    expect(thread?.featuredPostIds).toEqual([featuredReply.id]);
  });

  it("renders every post in each collected Thread and sorts by Thread activity", async () => {
    const collection = await collectionService.create({
      slug: "reading",
      title: "Reading",
    });
    const firstRoot = await postService.create({
      format: "note",
      bodyMarkdown: "Thread root",
    });
    const collectedReplyA = await postService.create({
      format: "note",
      bodyMarkdown: "Collected reply A",
      replyToId: firstRoot.id,
    });
    const hiddenMiddleReply = await postService.create({
      format: "note",
      bodyMarkdown: "Hidden middle reply",
      replyToId: collectedReplyA.id,
    });
    const collectedReplyB = await postService.create({
      format: "note",
      bodyMarkdown: "Collected reply B",
      replyToId: hiddenMiddleReply.id,
    });
    const secondRoot = await postService.create({
      format: "note",
      bodyMarkdown: "Second thread root",
    });

    await collectionService.addThread(collection.id, firstRoot.id, {
      createdAt: 200,
    });
    await collectionService.addThread(collection.id, secondRoot.id, {
      createdAt: 300,
    });

    const result = await assembleCollectionTimeline(createTimelineContext(), {
      collectionIds: [collection.id],
      isAuthenticated: true,
      sortOrder: "newest",
    });

    expect(result.items).toHaveLength(2);
    expect(result.items[0]?.post.id).toBe(secondRoot.id);
    expect(result.items[1]?.post.id).toBe(firstRoot.id);
    expect(result.items[1]?.curatedThread?.segments).toEqual([
      expect.objectContaining({
        post: expect.objectContaining({ id: firstRoot.id }),
        hiddenBeforeCount: 0,
        highlighted: false,
      }),
      expect.objectContaining({
        post: expect.objectContaining({ id: collectedReplyA.id }),
        hiddenBeforeCount: 0,
        highlighted: false,
      }),
      expect.objectContaining({
        post: expect.objectContaining({ id: hiddenMiddleReply.id }),
        hiddenBeforeCount: 0,
        highlighted: false,
      }),
      expect.objectContaining({
        post: expect.objectContaining({ id: collectedReplyB.id }),
        hiddenBeforeCount: 0,
        highlighted: false,
      }),
    ]);
  });

  it("renders the complete Thread when its root belongs to a collection", async () => {
    const collection = await collectionService.create({
      slug: "root-only",
      title: "Root only",
    });
    const root = await postService.create({
      format: "note",
      bodyMarkdown: "Collected root",
    });
    const uncollectedReply = await postService.create({
      format: "note",
      bodyMarkdown: "Uncollected reply",
      replyToId: root.id,
    });

    await collectionService.addThread(collection.id, root.id, {
      createdAt: 100,
    });

    const result = await assembleCollectionTimeline(createTimelineContext(), {
      collectionIds: [collection.id],
      isAuthenticated: true,
      sortOrder: "newest",
    });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.post.id).toBe(root.id);
    expect(result.items[0]?.curatedThread?.segments).toEqual([
      expect.objectContaining({
        post: expect.objectContaining({ id: root.id }),
        hiddenBeforeCount: 0,
        highlighted: false,
      }),
      expect.objectContaining({
        post: expect.objectContaining({ id: uncollectedReply.id }),
        hiddenBeforeCount: 0,
        highlighted: false,
      }),
    ]);
  });

  it("deduplicates Threads selected through multiple collections", async () => {
    const smart = await collectionService.create({
      slug: "smart",
      title: "Smart",
    });
    const movies = await collectionService.create({
      slug: "movies",
      title: "Movies",
    });
    const firstRoot = await postService.create({
      format: "note",
      bodyMarkdown: "Thread root",
    });
    const smartReply = await postService.create({
      format: "note",
      bodyMarkdown: "Smart reply",
      replyToId: firstRoot.id,
    });
    const hiddenMiddleReply = await postService.create({
      format: "note",
      bodyMarkdown: "Hidden middle reply",
      replyToId: smartReply.id,
    });
    const movieReply = await postService.create({
      format: "note",
      bodyMarkdown: "Movie reply",
      replyToId: hiddenMiddleReply.id,
    });
    const secondRoot = await postService.create({
      format: "note",
      bodyMarkdown: "Second thread root",
    });

    await collectionService.addThread(smart.id, firstRoot.id, {
      createdAt: 100,
    });
    await collectionService.addThread(movies.id, firstRoot.id, {
      createdAt: 200,
    });
    await collectionService.addThread(movies.id, secondRoot.id, {
      createdAt: 300,
    });

    const result = await assembleCollectionTimeline(createTimelineContext(), {
      collectionIds: [smart.id, movies.id],
      isAuthenticated: true,
      sortOrder: "newest",
    });

    expect(result.items).toHaveLength(2);
    expect(result.items[0]?.post.id).toBe(secondRoot.id);
    expect(result.items[1]?.post.id).toBe(firstRoot.id);
    expect(result.items[1]?.curatedThread?.segments).toEqual([
      expect.objectContaining({
        post: expect.objectContaining({ id: firstRoot.id }),
        hiddenBeforeCount: 0,
        highlighted: false,
      }),
      expect.objectContaining({
        post: expect.objectContaining({ id: smartReply.id }),
        hiddenBeforeCount: 0,
        highlighted: false,
      }),
      expect.objectContaining({
        post: expect.objectContaining({ id: hiddenMiddleReply.id }),
        hiddenBeforeCount: 0,
        highlighted: false,
      }),
      expect.objectContaining({
        post: expect.objectContaining({ id: movieReply.id }),
        hiddenBeforeCount: 0,
        highlighted: false,
      }),
    ]);
  });

  it("omits private timeline items from unauthenticated partial refreshes", async () => {
    const root = await postService.create({
      format: "note",
      bodyMarkdown: "Private root",
      visibility: "private",
    });

    const unauthenticatedItem = await assembleTimelineItem(
      createTimelineContext(),
      root.id,
    );
    const authenticatedItem = await assembleTimelineItem(
      createTimelineContext(),
      root.id,
      { isAuthenticated: true },
    );

    expect(unauthenticatedItem).toBeNull();
    expect(authenticatedItem?.post.id).toBe(root.id);
  });
});
