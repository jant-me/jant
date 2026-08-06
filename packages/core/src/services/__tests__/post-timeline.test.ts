import { eq } from "drizzle-orm";
import { describe, it, expect, beforeEach } from "vitest";
import {
  createTestDatabase,
  DEFAULT_TEST_SITE_ID,
} from "../../__tests__/helpers/db.js";
import { posts, threadCollections } from "../../db/schema.js";
import { createPostService } from "../post.js";
import { createCollectionService } from "../collection.js";
import type { Database } from "../../db/index.js";

describe("PostService - Timeline features", () => {
  let db: Database;
  let postService: ReturnType<typeof createPostService>;
  let collectionService: ReturnType<typeof createCollectionService>;

  beforeEach(() => {
    const testDb = createTestDatabase();
    db = testDb.db as unknown as Database;
    postService = createPostService(
      db,
      { slugIdLength: 5 },
      DEFAULT_TEST_SITE_ID,
    );
    collectionService = createCollectionService(db, DEFAULT_TEST_SITE_ID);
  });

  describe("format filter", () => {
    it("filters by format", async () => {
      await postService.create({ format: "note", bodyMarkdown: "a note" });
      await postService.create({
        format: "link",
        bodyMarkdown: "a link",
        title: "A link",
        url: "https://example.com",
      });
      await postService.create({
        format: "quote",
        bodyMarkdown: "a quote",
        quoteText: "something wise",
      });

      const posts = await postService.list({ format: "note" });
      expect(posts).toHaveLength(1);
      expect(posts[0]?.format).toBe("note");
    });

    it("combines format and status filters", async () => {
      await postService.create({
        format: "note",
        bodyMarkdown: "published note",
        status: "published",
      });
      await postService.create({
        format: "note",
        bodyMarkdown: "draft note",
        status: "draft",
      });
      await postService.create({
        format: "link",
        bodyMarkdown: "published link",
        status: "published",
        title: "Published link",
        url: "https://example.com",
      });

      const posts = await postService.list({
        format: "note",
        status: "published",
      });
      expect(posts).toHaveLength(1);
      expect(posts[0]?.format).toBe("note");
      expect(posts[0]?.status).toBe("published");
    });
  });

  describe("getThreadPreviews", () => {
    it("returns empty map for empty input", async () => {
      const previews = await postService.getThreadPreviews([]);
      expect(previews.size).toBe(0);
    });

    it("returns preview replies for a thread root", async () => {
      const root = await postService.create({
        format: "note",
        bodyMarkdown: "root",
      });
      const reply1 = await postService.create({
        format: "note",
        bodyMarkdown: "reply 1",
        replyToId: root.id,
      });
      await postService.create({
        format: "note",
        bodyMarkdown: "reply 2",
        replyToId: reply1.id,
      });

      const previews = await postService.getThreadPreviews([root.id]);
      const replies = previews.get(root.id);
      expect(replies).toBeDefined();
      expect(replies).toHaveLength(2);
      expect(replies?.[0]?.bodyText).toBe("reply 1");
      expect(replies?.[1]?.bodyText).toBe("reply 2");
    });

    it("limits preview replies to previewCount", async () => {
      const root = await postService.create({
        format: "note",
        bodyMarkdown: "root",
      });
      let prev = root;
      for (let i = 0; i < 5; i++) {
        prev = await postService.create({
          format: "note",
          bodyMarkdown: `reply ${i}`,
          replyToId: prev.id,
        });
      }

      const previews = await postService.getThreadPreviews([root.id], 2);
      const replies = previews.get(root.id);
      expect(replies).toHaveLength(2);
      expect(replies?.[0]?.bodyText).toBe("reply 0");
      expect(replies?.[1]?.bodyText).toBe("reply 1");
    });

    it("defaults to 3 preview replies", async () => {
      const root = await postService.create({
        format: "note",
        bodyMarkdown: "root",
      });
      let prev = root;
      for (let i = 0; i < 5; i++) {
        prev = await postService.create({
          format: "note",
          bodyMarkdown: `reply ${i}`,
          replyToId: prev.id,
        });
      }

      const previews = await postService.getThreadPreviews([root.id]);
      const replies = previews.get(root.id);
      expect(replies).toHaveLength(3);
    });

    it("handles multiple thread roots", async () => {
      const root1 = await postService.create({
        format: "note",
        bodyMarkdown: "root 1",
      });
      const root2 = await postService.create({
        format: "note",
        bodyMarkdown: "root 2",
      });
      await postService.create({
        format: "note",
        bodyMarkdown: "reply to root 1",
        replyToId: root1.id,
      });
      await postService.create({
        format: "note",
        bodyMarkdown: "reply to root 2",
        replyToId: root2.id,
      });

      const previews = await postService.getThreadPreviews([
        root1.id,
        root2.id,
      ]);
      expect(previews.size).toBe(2);
      expect(previews.get(root1.id)).toHaveLength(1);
      expect(previews.get(root2.id)).toHaveLength(1);
    });

    it("excludes deleted replies", async () => {
      const root = await postService.create({
        format: "note",
        bodyMarkdown: "root",
      });
      const reply1 = await postService.create({
        format: "note",
        bodyMarkdown: "reply 1",
        replyToId: root.id,
      });
      await postService.create({
        format: "note",
        bodyMarkdown: "reply 2",
        replyToId: reply1.id,
      });

      await postService.delete(reply1.id);

      const previews = await postService.getThreadPreviews([root.id]);
      const replies = previews.get(root.id);
      expect(replies).toHaveLength(1);
      expect(replies?.[0]?.bodyText).toBe("reply 2");
    });

    it("excludes draft replies", async () => {
      const root = await postService.create({
        format: "note",
        bodyMarkdown: "root",
      });
      const publishedReply = await postService.create({
        format: "note",
        bodyMarkdown: "published reply",
        replyToId: root.id,
      });
      await postService.create({
        format: "note",
        bodyMarkdown: "draft reply",
        replyToId: publishedReply.id,
        status: "draft",
      });

      const previews = await postService.getThreadPreviews([root.id]);
      const replies = previews.get(root.id);
      expect(replies).toHaveLength(1);
      expect(replies?.[0]?.bodyText).toBe("published reply");
    });

    it("returns empty for roots with no replies", async () => {
      const root = await postService.create({
        format: "note",
        bodyMarkdown: "root with no replies",
      });

      const previews = await postService.getThreadPreviews([root.id]);
      expect(previews.get(root.id)).toBeUndefined();
    });
  });

  describe("getThreadTimelineContext", () => {
    it("returns empty map for empty input", async () => {
      const result = await postService.getThreadTimelineContext([]);
      expect(result.size).toBe(0);
    });

    it("returns the only reply as leading and latest context", async () => {
      const root = await postService.create({
        format: "note",
        bodyMarkdown: "root",
      });
      const reply = await postService.create({
        format: "note",
        bodyMarkdown: "only reply",
        replyToId: root.id,
      });

      const result = await postService.getThreadTimelineContext([root.id]);
      const ctx = result.get(root.id);
      expect(ctx).toBeDefined();
      expect(ctx?.leadingReplies.map((post) => post.id)).toEqual([reply.id]);
      expect(ctx?.trailingReplies).toEqual([]);
      expect(ctx?.latestReply.id).toBe(reply.id);
      expect(ctx?.totalReplyCount).toBe(1);
    });

    it("returns overlapping leading and trailing context for short threads", async () => {
      const root = await postService.create({
        format: "note",
        bodyMarkdown: "root",
      });
      const reply1 = await postService.create({
        format: "note",
        bodyMarkdown: "reply 1",
        replyToId: root.id,
      });
      const reply2 = await postService.create({
        format: "note",
        bodyMarkdown: "reply 2",
        replyToId: reply1.id,
      });

      const result = await postService.getThreadTimelineContext([root.id]);
      const ctx = result.get(root.id);
      expect(ctx).toBeDefined();
      expect(ctx?.leadingReplies.map((post) => post.id)).toEqual([
        reply1.id,
        reply2.id,
      ]);
      expect(ctx?.trailingReplies.map((post) => post.id)).toEqual([reply1.id]);
      expect(ctx?.latestReply.id).toBe(reply2.id);
      expect(ctx?.totalReplyCount).toBe(2);
    });

    it("returns the first two and last three reply positions for longer threads", async () => {
      const root = await postService.create({
        format: "note",
        bodyMarkdown: "root",
      });
      let prev = root;
      for (let i = 0; i < 5; i++) {
        prev = await postService.create({
          format: "note",
          bodyMarkdown: `reply ${i}`,
          replyToId: prev.id,
        });
      }

      const result = await postService.getThreadTimelineContext([root.id]);
      const ctx = result.get(root.id);
      expect(ctx).toBeDefined();
      expect(ctx?.leadingReplies.map((post) => post.bodyText)).toEqual([
        "reply 0",
        "reply 1",
      ]);
      expect(ctx?.trailingReplies.map((post) => post.bodyText)).toEqual([
        "reply 2",
        "reply 3",
      ]);
      expect(ctx?.latestReply.bodyText).toBe("reply 4");
      expect(ctx?.totalReplyCount).toBe(5);
    });

    it("excludes deleted replies", async () => {
      const root = await postService.create({
        format: "note",
        bodyMarkdown: "root",
      });
      const reply1 = await postService.create({
        format: "note",
        bodyMarkdown: "reply 1",
        replyToId: root.id,
      });
      const reply2 = await postService.create({
        format: "note",
        bodyMarkdown: "reply 2",
        replyToId: reply1.id,
      });

      // Delete the latest reply — reply1 should become the latest
      await postService.delete(reply2.id);

      const result = await postService.getThreadTimelineContext([root.id]);
      const ctx = result.get(root.id);
      expect(ctx).toBeDefined();
      expect(ctx?.leadingReplies.map((post) => post.id)).toEqual([reply1.id]);
      expect(ctx?.latestReply.id).toBe(reply1.id);
      expect(ctx?.totalReplyCount).toBe(1);
    });

    it("excludes draft replies from thread context", async () => {
      const root = await postService.create({
        format: "note",
        bodyMarkdown: "root",
      });
      const publishedReply = await postService.create({
        format: "note",
        bodyMarkdown: "published reply",
        replyToId: root.id,
      });
      await postService.create({
        format: "note",
        bodyMarkdown: "draft reply",
        replyToId: publishedReply.id,
        status: "draft",
      });

      const result = await postService.getThreadTimelineContext([root.id]);
      const ctx = result.get(root.id);
      expect(ctx).toBeDefined();
      expect(ctx?.leadingReplies.map((post) => post.id)).toEqual([
        publishedReply.id,
      ]);
      expect(ctx?.latestReply.id).toBe(publishedReply.id);
      expect(ctx?.totalReplyCount).toBe(1);
    });

    it("handles multiple roots in batch", async () => {
      const root1 = await postService.create({
        format: "note",
        bodyMarkdown: "root 1",
      });
      const root2 = await postService.create({
        format: "note",
        bodyMarkdown: "root 2",
      });
      const r1Reply = await postService.create({
        format: "note",
        bodyMarkdown: "reply to root 1",
        replyToId: root1.id,
      });
      const r2Reply = await postService.create({
        format: "note",
        bodyMarkdown: "reply to root 2",
        replyToId: root2.id,
      });

      const result = await postService.getThreadTimelineContext([
        root1.id,
        root2.id,
      ]);
      expect(result.size).toBe(2);
      expect(result.get(root1.id)?.leadingReplies[0]?.id).toBe(r1Reply.id);
      expect(result.get(root2.id)?.leadingReplies[0]?.id).toBe(r2Reply.id);
      expect(result.get(root1.id)?.latestReply.id).toBe(r1Reply.id);
      expect(result.get(root2.id)?.latestReply.id).toBe(r2Reply.id);
    });
  });

  describe("getThreadTailIds", () => {
    it("keeps independent root threads separate", async () => {
      const root1 = await postService.create({
        format: "note",
        bodyMarkdown: "root 1",
      });
      const root2 = await postService.create({
        format: "quote",
        bodyMarkdown: "root 2",
        quoteText: "quoted",
      });

      const result = await postService.getThreadTailIds([root1.id, root2.id]);

      expect(result.get(root1.id)).toBe(root1.id);
      expect(result.get(root2.id)).toBe(root2.id);
    });

    it("returns the latest published post within each thread", async () => {
      const root1 = await postService.create({
        format: "note",
        bodyMarkdown: "root 1",
      });
      const root2 = await postService.create({
        format: "note",
        bodyMarkdown: "root 2",
      });
      const reply1 = await postService.create({
        format: "note",
        bodyMarkdown: "reply 1",
        replyToId: root1.id,
      });

      const result = await postService.getThreadTailIds([root1.id, root2.id]);

      expect(result.get(root1.id)).toBe(reply1.id);
      expect(result.get(root2.id)).toBe(root2.id);
    });

    it("skips a trailing draft by default", async () => {
      const root = await postService.create({
        format: "note",
        bodyMarkdown: "root",
      });
      const reply = await postService.create({
        format: "note",
        bodyMarkdown: "published reply",
        replyToId: root.id,
      });
      await postService.create({
        format: "note",
        bodyMarkdown: "unfinished",
        replyToId: reply.id,
        status: "draft",
      });

      const result = await postService.getThreadTailIds([root.id]);

      expect(result.get(root.id)).toBe(reply.id);
    });

    it("returns a trailing draft when drafts are included", async () => {
      const root = await postService.create({
        format: "note",
        bodyMarkdown: "root",
      });
      const reply = await postService.create({
        format: "note",
        bodyMarkdown: "published reply",
        replyToId: root.id,
      });
      const draft = await postService.create({
        format: "note",
        bodyMarkdown: "unfinished",
        replyToId: reply.id,
        status: "draft",
      });

      const result = await postService.getThreadTailIds([root.id], {
        includeDrafts: true,
      });

      expect(result.get(root.id)).toBe(draft.id);
    });
  });

  describe("timeline assembly", () => {
    it("fetches published non-reply posts for the timeline", async () => {
      const root = await postService.create({
        format: "note",
        bodyMarkdown: "a published note",
        status: "published",
      });
      await postService.create({
        format: "note",
        bodyMarkdown: "a reply",
        status: "published",
        replyToId: root.id,
      });
      await postService.create({
        format: "note",
        bodyMarkdown: "a draft",
        status: "draft",
      });

      const posts = await postService.list({
        status: "published",
        excludeReplies: true,
        limit: 21,
      });

      expect(posts).toHaveLength(1);
      expect(posts[0]?.bodyText).toBe("a published note");
    });
  });

  describe("countCollectionThreadRootsForCollections", () => {
    it("counts rated Threads once even when multiple children are rated", async () => {
      const collection = await collectionService.create({
        slug: "rated-threads",
        title: "Rated Threads",
      });
      const ratedRoot = await postService.create({
        format: "note",
        bodyMarkdown: "Rated root",
        rating: 5,
      });
      await postService.create({
        format: "note",
        bodyMarkdown: "Rated child",
        rating: 4,
        replyToId: ratedRoot.id,
      });
      const unratedRoot = await postService.create({
        format: "note",
        bodyMarkdown: "Unrated root",
      });
      await collectionService.addThread(collection.id, ratedRoot.id);
      await collectionService.addThread(collection.id, unratedRoot.id);

      const count = await postService.countCollectionThreadRootsForCollections(
        [collection.id],
        { status: "published", hasRating: true },
      );

      expect(count).toBe(1);
    });
  });

  describe("listCollectionThreadRootIds", () => {
    it("bumps a hidden collection thread when a non-quiet reply is published", async () => {
      const collection = await collectionService.create({
        slug: "thinking",
        title: "Thinking",
      });
      const hiddenRoot = await postService.create({
        format: "note",
        bodyMarkdown: "Hidden root",
        visibility: "latest_hidden",
        publishedAt: 1000,
      });
      const newerRoot = await postService.create({
        format: "note",
        bodyMarkdown: "Newer root",
        publishedAt: 2000,
      });

      await collectionService.addThread(collection.id, hiddenRoot.id);
      await collectionService.addThread(collection.id, newerRoot.id);

      await postService.create({
        format: "note",
        bodyMarkdown: "Normal reply",
        replyToId: hiddenRoot.id,
        publishedAt: 3000,
      });

      const rootIds = await postService.listCollectionThreadRootIds(
        collection.id,
        {
          status: "published",
          sortOrder: "newest",
        },
      );

      expect(rootIds).toEqual([hiddenRoot.id, newerRoot.id]);
    });

    it("does not bump a collection thread when a reply is quiet", async () => {
      const collection = await collectionService.create({
        slug: "quiet",
        title: "Quiet",
      });
      const olderRoot = await postService.create({
        format: "note",
        bodyMarkdown: "Older root",
        publishedAt: 1000,
      });
      const newerRoot = await postService.create({
        format: "note",
        bodyMarkdown: "Newer root",
        publishedAt: 2000,
      });

      await collectionService.addThread(collection.id, olderRoot.id);
      await collectionService.addThread(collection.id, newerRoot.id);

      await postService.create({
        format: "note",
        bodyMarkdown: "Quiet reply",
        replyToId: olderRoot.id,
        publishedAt: 3000,
        quietReply: true,
      });

      const rootIds = await postService.listCollectionThreadRootIds(
        collection.id,
        {
          status: "published",
          sortOrder: "newest",
        },
      );

      expect(rootIds).toEqual([newerRoot.id, olderRoot.id]);
    });

    it("orders a Thread by a newer root edit", async () => {
      const collection = await collectionService.create({
        slug: "edited",
        title: "Edited",
      });
      const editedRoot = await postService.create({
        format: "note",
        bodyMarkdown: "Edited root",
        publishedAt: 1000,
      });
      const newerRoot = await postService.create({
        format: "note",
        bodyMarkdown: "Newer root",
        publishedAt: 2000,
      });

      await collectionService.addThread(collection.id, editedRoot.id);
      await collectionService.addThread(collection.id, newerRoot.id);
      await db
        .update(posts)
        .set({ createdAt: 500, updatedAt: 3000 })
        .where(eq(posts.id, editedRoot.id));

      const rootIds = await postService.listCollectionThreadRootIds(
        collection.id,
        {
          status: "published",
          sortOrder: "newest",
        },
      );

      expect(rootIds).toEqual([editedRoot.id, newerRoot.id]);
    });
  });

  describe("listCollectionFeedEntries", () => {
    it("orders collection feeds by thread activity and returns thread roots", async () => {
      const collection = await collectionService.create({
        slug: "reading",
        title: "Reading",
      });
      const firstRoot = await postService.create({
        format: "note",
        bodyMarkdown: "First root",
      });
      const collectedReply = await postService.create({
        format: "note",
        bodyMarkdown: "Collected reply",
        replyToId: firstRoot.id,
      });
      const secondRoot = await postService.create({
        format: "note",
        bodyMarkdown: "Second root",
      });

      await db.insert(threadCollections).values([
        {
          siteId: DEFAULT_TEST_SITE_ID,
          threadId: firstRoot.id,
          collectionId: collection.id,
          createdAt: 100,
        },
        {
          siteId: DEFAULT_TEST_SITE_ID,
          threadId: secondRoot.id,
          collectionId: collection.id,
          createdAt: 200,
        },
      ]);

      const entries = await postService.listCollectionFeedEntries(
        collection.id,
        {
          status: "published",
        },
      );

      expect(entries).toHaveLength(2);
      expect(entries[0]?.post.id).toBe(secondRoot.id);
      expect(entries[0]?.collectedAt).toBe(200);
      expect(entries[1]?.post.id).toBe(firstRoot.id);
      expect(entries[1]?.collectedAt).toBe(100);
    });

    it("can ignore collection pins for subscription feed ordering", async () => {
      const collection = await collectionService.create({
        slug: "rss",
        title: "RSS",
      });
      const olderRoot = await postService.create({
        format: "note",
        bodyMarkdown: "Older pinned root",
        publishedAt: 1000,
      });
      const newerRoot = await postService.create({
        format: "note",
        bodyMarkdown: "Newer unpinned root",
        publishedAt: 2000,
      });

      await db.insert(threadCollections).values([
        {
          siteId: DEFAULT_TEST_SITE_ID,
          threadId: olderRoot.id,
          collectionId: collection.id,
          createdAt: 100,
          pinnedAt: 5000,
        },
        {
          siteId: DEFAULT_TEST_SITE_ID,
          threadId: newerRoot.id,
          collectionId: collection.id,
          createdAt: 200,
        },
      ]);

      const pageEntries = await postService.listCollectionFeedEntries(
        collection.id,
        {
          status: "published",
        },
      );
      const feedEntries = await postService.listCollectionFeedEntries(
        collection.id,
        {
          status: "published",
          ignoreCollectionPinnedSort: true,
        },
      );

      expect(pageEntries.map((entry) => entry.post.id)).toEqual([
        olderRoot.id,
        newerRoot.id,
      ]);
      expect(feedEntries.map((entry) => entry.post.id)).toEqual([
        newerRoot.id,
        olderRoot.id,
      ]);
    });

    it("dedupes shared threads across multiple collections", async () => {
      const smart = await collectionService.create({
        slug: "smart",
        title: "Smart",
      });
      const movies = await collectionService.create({
        slug: "movies",
        title: "Movies",
      });
      const sharedRoot = await postService.create({
        format: "note",
        bodyMarkdown: "Shared root",
      });
      const sharedReply = await postService.create({
        format: "note",
        bodyMarkdown: "Shared reply",
        replyToId: sharedRoot.id,
      });
      const secondRoot = await postService.create({
        format: "note",
        bodyMarkdown: "Second root",
      });

      await db.insert(threadCollections).values([
        {
          siteId: DEFAULT_TEST_SITE_ID,
          threadId: sharedRoot.id,
          collectionId: smart.id,
          createdAt: 100,
        },
        {
          siteId: DEFAULT_TEST_SITE_ID,
          threadId: sharedRoot.id,
          collectionId: movies.id,
          createdAt: 300,
        },
        {
          siteId: DEFAULT_TEST_SITE_ID,
          threadId: secondRoot.id,
          collectionId: movies.id,
          createdAt: 200,
        },
      ]);

      const entries = await postService.listCollectionFeedEntriesForCollections(
        [smart.id, movies.id],
        {
          status: "published",
        },
      );

      expect(entries).toHaveLength(2);
      expect(entries[0]?.post.id).toBe(secondRoot.id);
      expect(entries[0]?.collectedAt).toBe(200);
      expect(entries[1]?.post.id).toBe(sharedRoot.id);
      expect(entries[1]?.collectedAt).toBe(300);
    });

    it("orders collection feeds by thread activity from non-quiet replies", async () => {
      const collection = await collectionService.create({
        slug: "activity",
        title: "Activity",
      });
      const hiddenRoot = await postService.create({
        format: "note",
        bodyMarkdown: "Hidden root",
        visibility: "latest_hidden",
        publishedAt: 1000,
      });
      const newerRoot = await postService.create({
        format: "note",
        bodyMarkdown: "Newer root",
        publishedAt: 2000,
      });

      await collectionService.addThread(collection.id, hiddenRoot.id);
      await collectionService.addThread(collection.id, newerRoot.id);

      await postService.create({
        format: "note",
        bodyMarkdown: "Normal reply",
        replyToId: hiddenRoot.id,
        publishedAt: 3000,
      });

      const entries = await postService.listCollectionFeedEntries(
        collection.id,
        {
          status: "published",
        },
      );

      expect(entries.map((entry) => entry.post.id)).toEqual([
        hiddenRoot.id,
        newerRoot.id,
      ]);
    });
  });
});
