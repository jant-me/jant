import { describe, it, expect, beforeEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import {
  createTestDatabase,
  DEFAULT_TEST_SITE_ID,
} from "../../__tests__/helpers/db.js";
import { threadCollections, posts, sites } from "../../db/schema.js";
import { createPostService } from "../post.js";
import { createMediaService } from "../media.js";
import { createCollectionService } from "../collection.js";
import { createNavItemService } from "../navigation.js";
import type { Database } from "../../db/index.js";
import { createPathService } from "../path.js";
import type { MediaService } from "../media.js";
import { POST_BODY_HTML_VERSION } from "../../lib/post-body-html.js";
import type BetterSqlite3 from "better-sqlite3";

function createMockStorage() {
  const files = new Map<string, { body: Uint8Array; contentType?: string }>();

  return {
    files,
    async put(
      key: string,
      body: Uint8Array | ReadableStream,
      opts?: { contentType?: string },
    ) {
      const bytes =
        body instanceof Uint8Array
          ? body
          : new Uint8Array(await new Response(body).arrayBuffer());
      files.set(key, { body: bytes, contentType: opts?.contentType });
    },
    async get(key: string) {
      const file = files.get(key);
      if (!file) return null;
      return {
        body: new Response(file.body).body as ReadableStream,
        contentType: file.contentType,
      };
    },
    async delete(key: string) {
      files.delete(key);
    },
  };
}

describe("PostService", () => {
  let db: Database;
  let sqlite: BetterSqlite3.Database;
  let postService: ReturnType<typeof createPostService>;
  let collectionService: ReturnType<typeof createCollectionService>;

  beforeEach(() => {
    const testDb = createTestDatabase();
    db = testDb.db as unknown as Database;
    sqlite = testDb.sqlite;
    postService = createPostService(
      db,
      { slugIdLength: 5 },
      DEFAULT_TEST_SITE_ID,
    );
    collectionService = createCollectionService(db, DEFAULT_TEST_SITE_ID);
  });

  describe("create", () => {
    it("creates a note post with required fields", async () => {
      const body = JSON.stringify({
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "Hello world" }],
          },
        ],
      });
      const post = await postService.create({
        format: "note",
        body,
      });

      expect(typeof post.id).toBe("string");
      expect(post.id).toMatch(/^pst_[a-z0-9]{26}$/);
      expect(post.format).toBe("note");
      expect(post.body).toBe(body);
      expect(post.status).toBe("published"); // default
      expect(post.visibility).toBe("public");
      expect(post.pinnedAt).toBeNull();
      expect(post.bodyHtml).toContain("<p>Hello world</p>");
      expect(post.threadId).toBe(post.id);
    });

    it("creates a link post with commentary", async () => {
      const body = JSON.stringify({
        type: "doc",
        content: [
          {
            type: "heading",
            attrs: { level: 1 },
            content: [{ type: "text", text: "Introduction" }],
          },
          {
            type: "paragraph",
            content: [{ type: "text", text: "Some content." }],
          },
        ],
      });
      const post = await postService.create({
        format: "link",
        title: "My Link",
        body,
        status: "published",
        visibility: "public",
        featured: true,
        pinned: true,
        slug: "my-link",
        url: "https://example.com/source",
        rating: 5,
      });

      expect(post.format).toBe("link");
      expect(post.title).toBe("My Link");
      expect(post.status).toBe("published");
      expect(post.visibility).toBe("public");
      expect(post.featuredAt).toBeTypeOf("number");
      expect(post.pinnedAt).toBeTypeOf("number");
      expect(post.slug).toBe("my-link");
      expect(post.url).toBe("https://example.com/source");
      expect(post.quoteText).toBeNull();
      expect(post.rating).toBe(5);
      expect(post.bodyHtml).toContain("<h1>");
    });

    it("renders Tiptap JSON body to HTML", async () => {
      const body = JSON.stringify({
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              { type: "text", text: "This is " },
              {
                type: "text",
                marks: [{ type: "bold" }],
                text: "bold",
              },
              { type: "text", text: " text" },
            ],
          },
        ],
      });
      const post = await postService.create({
        format: "note",
        body,
      });

      expect(post.bodyHtml).toContain("<strong>bold</strong>");
    });

    it("writes current namespaced body HTML projection metadata", async () => {
      const post = await postService.create({
        format: "note",
        bodyMarkdown: "Body[^1]\n\n[^1]: Definition",
      });
      const row = await db
        .select({
          bodyHtml: posts.bodyHtml,
          bodyHtmlVersion: posts.bodyHtmlVersion,
        })
        .from(posts)
        .where(eq(posts.id, post.id))
        .limit(1);

      expect(row[0]?.bodyHtmlVersion).toBe(POST_BODY_HTML_VERSION);
      expect(row[0]?.bodyHtml).toMatch(/id="fn-[a-z0-9]{13}-1"/);
      expect(row[0]?.bodyHtml).not.toContain(post.id);
      expect(post.bodyHtml).toContain('role="doc-endnotes"');
    });

    it("sets publishedAt and timestamps", async () => {
      const post = await postService.create({
        format: "note",
        bodyMarkdown: "test",
      });

      expect(post.publishedAt).toBeGreaterThan(0);
      expect(post.createdAt).toBeGreaterThan(0);
      expect(post.updatedAt).toBeGreaterThan(0);
    });

    it("allows custom publishedAt", async () => {
      const customTime = 1706745600;
      const post = await postService.create({
        format: "note",
        bodyMarkdown: "test",
        publishedAt: customTime,
      });

      expect(post.publishedAt).toBe(customTime);
    });

    it("creates unique post TypeIDs that sort chronologically", async () => {
      const post1 = await postService.create({
        format: "note",
        bodyMarkdown: "first",
      });
      const post2 = await postService.create({
        format: "note",
        bodyMarkdown: "second",
      });

      expect(post1.id).not.toBe(post2.id);
      expect(post2.id > post1.id).toBe(true);
    });

    it("creates a quote post", async () => {
      const post = await postService.create({
        format: "quote",
        quoteText: "To be or not to be",
        bodyMarkdown: "Shakespeare's famous line",
        url: "https://example.com/hamlet",
      });

      expect(post.format).toBe("quote");
      expect(post.quoteText).toBe("To be or not to be");
      expect(post.url).toBe("https://example.com/hamlet");
    });

    it("does not derive quote slugs from the source attribution title", async () => {
      // Quote `title` stores the source/author name, not a real title. Two
      // quotes from the same source must not fight over the same slug.
      const first = await postService.create({
        format: "quote",
        title: "Basho",
        quoteText: "An old silent pond...",
      });
      const second = await postService.create({
        format: "quote",
        title: "Basho",
        quoteText: "The light of a candle...",
      });

      expect(first.title).toBe("Basho");
      expect(second.title).toBe("Basho");
      expect(first.slug).not.toBe("basho");
      expect(second.slug).not.toBe("basho");
      expect(first.slug).not.toBe(second.slug);
    });

    it("creates a draft post", async () => {
      const post = await postService.create({
        format: "note",
        bodyMarkdown: "draft content",
        status: "draft",
      });

      expect(post.status).toBe("draft");
      expect(post.publishedAt).toBeNull();
    });

    it("rejects ratings outside the supported range", async () => {
      await expect(
        postService.create({
          format: "note",
          bodyMarkdown: "test",
          rating: 6,
        }),
      ).rejects.toThrow("Rating must be an integer between 1 and 5.");
    });

    it("rejects unsupported post formats", async () => {
      await expect(
        postService.create({
          format: "essay" as never,
          bodyMarkdown: "test",
        }),
      ).rejects.toThrow("Format must be note, link, or quote.");
    });

    it("rejects unsupported post statuses", async () => {
      await expect(
        postService.create({
          format: "note",
          bodyMarkdown: "test",
          status: "scheduled" as never,
        }),
      ).rejects.toThrow("Status must be draft or published.");
    });

    it("rejects unsupported visibilities", async () => {
      await expect(
        postService.create({
          format: "note",
          bodyMarkdown: "test",
          visibility: "friends_only" as never,
        }),
      ).rejects.toThrow(
        "Visibility must be public, hidden from Latest, or private.",
      );
    });

    it("rejects draft posts with an explicit publish time", async () => {
      await expect(
        postService.create({
          format: "note",
          bodyMarkdown: "draft content",
          status: "draft",
          publishedAt: 1706745600,
        }),
      ).rejects.toThrow("Drafts can't set a publish time.");
    });

    it("rejects note posts with a URL", async () => {
      await expect(
        postService.create({
          format: "note",
          url: "https://example.com",
        }),
      ).rejects.toThrow("Notes can't include a URL.");
    });

    it("rejects link posts without a URL", async () => {
      await expect(
        postService.create({
          format: "link",
          title: "A link",
          bodyMarkdown: "commentary",
        }),
      ).rejects.toThrow("Link posts need a URL.");
    });

    it("rejects link posts without a title", async () => {
      await expect(
        postService.create({
          format: "link",
          url: "https://example.com",
          bodyMarkdown: "commentary",
        }),
      ).rejects.toThrow("Link posts need a title.");
    });

    it("rejects link posts with quoted text", async () => {
      await expect(
        postService.create({
          format: "link",
          title: "A link",
          url: "https://example.com",
          quoteText: "A notable quote",
        }),
      ).rejects.toThrow("Link posts can't include quoted text.");
    });

    it("rejects quote posts without quoted text", async () => {
      await expect(
        postService.create({
          format: "quote",
          bodyMarkdown: "commentary",
        }),
      ).rejects.toThrow("Quote posts need quoted text.");
    });

    it("rejects replies to missing posts", async () => {
      await expect(
        postService.create({
          format: "note",
          bodyMarkdown: "reply",
          replyToId: "00000000-0000-0000-0000-000000009999",
        }),
      ).rejects.toThrow("Parent post not found");
    });

    it("rejects reserved paths that would otherwise become aliases", async () => {
      await expect(
        postService.create({
          format: "note",
          bodyMarkdown: "reserved path",
          path: "skill.md",
        }),
      ).rejects.toThrow('Path "skill.md" is reserved and cannot be used');
    });

    it("rolls back the post insert when slug persistence fails inside the batch", async () => {
      await postService.create({
        format: "note",
        bodyMarkdown: "existing",
        slug: "race-condition",
      });

      const paths = createPathService(db, DEFAULT_TEST_SITE_ID);
      const raceyPaths = {
        ...paths,
        isPathAvailable: async () => true,
      };
      const raceyPostService = createPostService(
        db,
        { slugIdLength: 5 },
        DEFAULT_TEST_SITE_ID,
        raceyPaths,
      );

      await expect(
        raceyPostService.create({
          format: "note",
          bodyMarkdown: "test",
          slug: "race-condition",
        }),
      ).rejects.toThrow('Slug "race-condition" is already in use');

      const rows = await db.select({ id: posts.id }).from(posts);
      expect(rows).toHaveLength(1);
    });

    it("does not call transaction() when creating posts on sqlite-family backends", async () => {
      const dbWithoutTransaction = db as Database & {
        transaction: () => Promise<never>;
      };
      const originalTransaction = dbWithoutTransaction.transaction.bind(db);
      dbWithoutTransaction.transaction = async () => {
        throw new Error("sqlite create() should not call transaction()");
      };

      try {
        await expect(
          postService.create({
            format: "note",
            bodyMarkdown: "no transaction",
          }),
        ).resolves.toMatchObject({
          format: "note",
          bodyText: "no transaction",
        });
      } finally {
        dbWithoutTransaction.transaction = originalTransaction;
      }
    });
  });

  describe("getById", () => {
    it("returns a post by ID", async () => {
      const created = await postService.create({
        format: "note",
        bodyMarkdown: "test",
      });

      const found = await postService.getById(created.id);
      expect(found).not.toBeNull();
      expect(found?.id).toBe(created.id);
      expect(found?.bodyText).toBe("test");
    });

    it("returns null for non-existent ID", async () => {
      const found = await postService.getById(9999);
      expect(found).toBeNull();
    });

    it("excludes soft-deleted posts", async () => {
      const post = await postService.create({
        format: "note",
        bodyMarkdown: "test",
      });
      await postService.delete(post.id);

      const found = await postService.getById(post.id);
      expect(found).toBeNull();
    });
  });

  describe("getBySlug", () => {
    it("returns a post by slug", async () => {
      await postService.create({
        format: "note",
        bodyMarkdown: "About page",
        slug: "about",
      });

      const found = await postService.getBySlug("about");
      expect(found).not.toBeNull();
      expect(found?.slug).toBe("about");
    });

    it("returns null for non-existent slug", async () => {
      const found = await postService.getBySlug("nonexistent");
      expect(found).toBeNull();
    });

    it("excludes soft-deleted posts", async () => {
      const post = await postService.create({
        format: "note",
        bodyMarkdown: "test",
        slug: "test-page",
      });
      await postService.delete(post.id);

      const found = await postService.getBySlug("test-page");
      expect(found).toBeNull();
    });
  });

  describe("list", () => {
    it("returns empty array when no posts exist", async () => {
      const posts = await postService.list();
      expect(posts).toEqual([]);
    });

    it("returns all non-deleted posts", async () => {
      await postService.create({ format: "note", bodyMarkdown: "first" });
      await postService.create({ format: "note", bodyMarkdown: "second" });
      await postService.create({ format: "note", bodyMarkdown: "third" });

      const posts = await postService.list();
      expect(posts).toHaveLength(3);
    });

    it("orders by publishedAt descending", async () => {
      await postService.create({
        format: "note",
        bodyMarkdown: "old",
        publishedAt: 1000,
      });
      await postService.create({
        format: "note",
        bodyMarkdown: "new",
        publishedAt: 2000,
      });

      const posts = await postService.list();
      expect(posts[0]?.bodyText).toBe("new");
      expect(posts[1]?.bodyText).toBe("old");
    });

    it("supports oldest-first sorting", async () => {
      await postService.create({
        format: "note",
        bodyMarkdown: "oldest",
        publishedAt: 1000,
      });
      await postService.create({
        format: "note",
        bodyMarkdown: "newest",
        publishedAt: 2000,
      });

      const posts = await postService.list({
        sortOrder: "oldest",
      });

      expect(posts[0]?.bodyText).toBe("oldest");
      expect(posts[1]?.bodyText).toBe("newest");
    });

    it("supports rating-based sorting with unrated posts last", async () => {
      await postService.create({
        format: "note",
        bodyMarkdown: "five stars",
        publishedAt: 1000,
        rating: 5,
      });
      await postService.create({
        format: "note",
        bodyMarkdown: "three stars",
        publishedAt: 3000,
        rating: 3,
      });
      await postService.create({
        format: "note",
        bodyMarkdown: "unrated newest",
        publishedAt: 4000,
      });

      const descending = await postService.list({
        sortOrder: "rating_desc",
      });

      expect(descending.map((post) => post.bodyText)).toEqual([
        "five stars",
        "three stars",
        "unrated newest",
      ]);
    });

    it("orders by time for an explicit newest, ratings and all", async () => {
      // `newest` used to have no branch of its own in the ORDER BY and fell
      // into the one written for the ascending rating order, so anything that
      // named it — a smart collection page, most visibly — got its posts
      // grouped by rating instead of dated. Rated rows here on purpose.
      await postService.create({
        format: "note",
        bodyMarkdown: "oldest, best",
        publishedAt: 1000,
        rating: 5,
      });
      await postService.create({
        format: "note",
        bodyMarkdown: "middle, worst",
        publishedAt: 2000,
        rating: 1,
      });
      await postService.create({
        format: "note",
        bodyMarkdown: "newest, unrated",
        publishedAt: 3000,
      });

      const ordered = await postService.list({ sortOrder: "newest" });
      expect(ordered.map((post) => post.bodyText)).toEqual([
        "newest, unrated",
        "middle, worst",
        "oldest, best",
      ]);

      // The keyset cursor reads the same keys or pagination skips rows.
      expect(
        (
          await postService.list({
            sortOrder: "newest",
            cursor: ordered[0]?.id,
          })
        ).map((post) => post.bodyText),
      ).toEqual(["middle, worst", "oldest, best"]);
    });

    it("orders drafts by updatedAt descending", async () => {
      const older = await postService.create({
        format: "note",
        bodyMarkdown: "older draft",
        status: "draft",
      });

      await new Promise((r) => setTimeout(r, 1100));

      const newer = await postService.create({
        format: "note",
        bodyMarkdown: "newer draft",
        status: "draft",
      });

      await new Promise((r) => setTimeout(r, 1100));
      await postService.update(older.id, {
        bodyMarkdown: "older draft edited",
      });

      const drafts = await postService.list({ status: "draft" });
      expect(drafts[0]?.id).toBe(older.id);
      expect(drafts[1]?.id).toBe(newer.id);
    });

    it("filters by format", async () => {
      await postService.create({ format: "note", bodyMarkdown: "a note" });
      await postService.create({
        format: "link",
        bodyMarkdown: "a link",
        title: "Link",
        url: "https://example.com",
      });

      const notes = await postService.list({ format: "note" });
      expect(notes).toHaveLength(1);
      expect(notes[0]?.format).toBe("note");
    });

    it("filters by rating presence", async () => {
      await postService.create({
        format: "note",
        bodyMarkdown: "rated post",
        rating: 4,
      });
      await postService.create({
        format: "note",
        bodyMarkdown: "unrated post",
      });

      const rated = await postService.list({ hasRating: true });
      const unrated = await postService.list({ hasRating: false });

      expect(rated).toHaveLength(1);
      expect(rated[0]?.bodyText).toBe("rated post");
      expect(unrated).toHaveLength(1);
      expect(unrated[0]?.bodyText).toBe("unrated post");
    });

    it("filters by status", async () => {
      await postService.create({
        format: "note",
        bodyMarkdown: "published post",
        status: "published",
      });
      await postService.create({
        format: "note",
        bodyMarkdown: "draft post",
        status: "draft",
      });

      const published = await postService.list({ status: "published" });
      expect(published).toHaveLength(1);
      expect(published[0]?.status).toBe("published");
    });

    it("filters by visibility", async () => {
      await postService.create({
        format: "note",
        bodyMarkdown: "public post",
      });
      await postService.create({
        format: "note",
        bodyMarkdown: "latest_hidden post",
        visibility: "latest_hidden",
      });
      await postService.create({
        format: "note",
        bodyMarkdown: "private post",
        visibility: "private",
      });

      const publicPosts = await postService.list({ visibility: "public" });
      expect(publicPosts).toHaveLength(1);
      expect(publicPosts[0]?.visibility).toBe("public");
      expect(publicPosts[0]?.bodyText).toBe("public post");

      const latestHidden = await postService.list({
        visibility: "latest_hidden",
      });
      expect(latestHidden).toHaveLength(1);
      expect(latestHidden[0]?.visibility).toBe("latest_hidden");
      expect(latestHidden[0]?.bodyText).toBe("latest_hidden post");

      const privatePosts = await postService.list({ visibility: "private" });
      expect(privatePosts).toHaveLength(1);
      expect(privatePosts[0]?.visibility).toBe("private");
      expect(privatePosts[0]?.bodyText).toBe("private post");
    });

    it("filters by featured", async () => {
      await postService.create({
        format: "note",
        bodyMarkdown: "featured post",
        featured: true,
      });
      await postService.create({
        format: "note",
        bodyMarkdown: "normal post",
      });

      const featured = await postService.list({ featured: true });
      expect(featured).toHaveLength(1);
      expect(featured[0]?.featuredAt).toBeTypeOf("number");
      expect(featured[0]?.bodyText).toBe("featured post");

      const notFeatured = await postService.list({ featured: false });
      expect(notFeatured).toHaveLength(1);
      expect(notFeatured[0]?.featuredAt).toBeNull();
      expect(notFeatured[0]?.bodyText).toBe("normal post");
    });

    it("orders Featured Post lists and cursors by publishedAt", async () => {
      const oldest = await postService.create({
        format: "note",
        bodyMarkdown: "oldest",
        featured: true,
        publishedAt: 1000,
      });
      const middle = await postService.create({
        format: "note",
        bodyMarkdown: "middle",
        featured: true,
        publishedAt: 2000,
      });
      const newest = await postService.create({
        format: "note",
        bodyMarkdown: "newest",
        featured: true,
        publishedAt: 3000,
      });

      await db
        .update(posts)
        .set({ featuredAt: 9000 })
        .where(eq(posts.id, oldest.id));
      await db
        .update(posts)
        .set({ featuredAt: 8000 })
        .where(eq(posts.id, middle.id));
      await db
        .update(posts)
        .set({ featuredAt: 7000 })
        .where(eq(posts.id, newest.id));

      const firstPage = await postService.list({
        featured: true,
        ignorePinnedSort: true,
        limit: 2,
      });
      const secondPage = await postService.list({
        featured: true,
        ignorePinnedSort: true,
        cursor: middle.id,
        limit: 2,
      });

      expect(firstPage.map((post) => post.id)).toEqual([newest.id, middle.id]);
      expect(secondPage.map((post) => post.id)).toEqual([oldest.id]);
    });

    it("excludes posts hidden from Latest when requested", async () => {
      await postService.create({
        format: "note",
        bodyMarkdown: "public post",
      });
      await postService.create({
        format: "note",
        bodyMarkdown: "latest_hidden post",
        visibility: "latest_hidden",
      });
      await postService.create({
        format: "note",
        bodyMarkdown: "featured post",
        featured: true,
      });

      const posts = await postService.list({ excludeLatestHidden: true });
      expect(posts).toHaveLength(2);
      // Featured posts have visibility "public", so both public and featured appear
      expect(posts.map((p) => p.bodyText).sort()).toEqual([
        "featured post",
        "public post",
      ]);
    });

    it("excludes private posts when excludePrivate is set", async () => {
      await postService.create({
        format: "note",
        bodyMarkdown: "public post",
      });
      await postService.create({
        format: "note",
        bodyMarkdown: "private post",
        visibility: "private",
      });
      await postService.create({
        format: "note",
        bodyMarkdown: "featured post",
        featured: true,
      });

      const posts = await postService.list({ excludePrivate: true });
      expect(posts).toHaveLength(2);
      // Featured posts have visibility "public", so both public and featured appear
      expect(posts.map((p) => p.bodyText).sort()).toEqual([
        "featured post",
        "public post",
      ]);
    });

    it("filters by pinned", async () => {
      await postService.create({
        format: "note",
        bodyMarkdown: "pinned post",
        pinned: true,
      });
      await postService.create({
        format: "note",
        bodyMarkdown: "normal post",
      });

      const pinned = await postService.list({ pinned: true });
      expect(pinned).toHaveLength(1);
      expect(pinned[0]?.pinnedAt).toBeTypeOf("number");
      expect(pinned[0]?.bodyText).toBe("pinned post");

      const notPinned = await postService.list({ pinned: false });
      expect(notPinned).toHaveLength(1);
      expect(notPinned[0]?.pinnedAt).toBeNull();
      expect(notPinned[0]?.bodyText).toBe("normal post");
    });

    // Regression: the list orderBy relies on NULL-handling that differs
    // between SQLite (NULLs last for DESC) and Postgres (NULLs first for
    // DESC). Pin must rise to the top under both engines. See
    // coding-standards.md "Nullable sort keys".
    it("sorts pinned posts ahead of unpinned (portable NULL order)", async () => {
      // Newest first — an older pinned post must still beat a newer unpinned.
      await postService.create({
        format: "note",
        bodyMarkdown: "older pinned",
        pinned: true,
        status: "published",
      });
      await postService.create({
        format: "note",
        bodyMarkdown: "newer unpinned",
        status: "published",
      });
      await postService.create({
        format: "note",
        bodyMarkdown: "newest unpinned",
        status: "published",
      });

      const results = await postService.list({ status: "published" });
      expect(results.map((p) => p.bodyText)).toEqual([
        "older pinned",
        "newest unpinned",
        "newer unpinned",
      ]);
    });

    it("can ignore pinned sort for subscription feed queries", async () => {
      await postService.create({
        format: "note",
        bodyMarkdown: "older pinned",
        pinned: true,
        status: "published",
        publishedAt: 1000,
      });
      await postService.create({
        format: "note",
        bodyMarkdown: "newer unpinned",
        status: "published",
        publishedAt: 2000,
      });
      await postService.create({
        format: "note",
        bodyMarkdown: "newest unpinned",
        status: "published",
        publishedAt: 3000,
      });

      const results = await postService.list({
        status: "published",
        ignorePinnedSort: true,
        limit: 2,
      });

      expect(results.map((p) => p.bodyText)).toEqual([
        "newest unpinned",
        "newer unpinned",
      ]);
    });

    it("excludes deleted posts", async () => {
      const post = await postService.create({
        format: "note",
        bodyMarkdown: "test",
      });
      await postService.create({ format: "note", bodyMarkdown: "kept" });
      await postService.delete(post.id);

      const posts = await postService.list();
      expect(posts).toHaveLength(1);
      expect(posts[0]?.bodyText).toBe("kept");
    });

    it("supports limit", async () => {
      for (let i = 0; i < 5; i++) {
        await postService.create({ format: "note", bodyMarkdown: `post ${i}` });
      }

      const posts = await postService.list({ limit: 2 });
      expect(posts).toHaveLength(2);
    });

    it("supports cursor pagination", async () => {
      const created = [];
      for (let i = 0; i < 5; i++) {
        created.push(
          await postService.create({
            format: "note",
            bodyMarkdown: `post ${i}`,
            publishedAt: 1000 + i,
          }),
        );
      }

      // Get posts with ID less than the 3rd post
      const thirdPostId = created[2]?.id ?? 0;
      const posts = await postService.list({ cursor: thirdPostId });
      expect(posts.every((p) => p.id < thirdPostId)).toBe(true);
    });

    it("excludes replies when requested", async () => {
      const root = await postService.create({
        format: "note",
        bodyMarkdown: "root post",
      });
      await postService.create({
        format: "note",
        bodyMarkdown: "reply",
        replyToId: root.id,
      });

      const posts = await postService.list({ excludeReplies: true });
      expect(posts).toHaveLength(1);
      expect(posts[0]?.bodyText).toBe("root post");
    });

    it("filters thread roots by reply presence", async () => {
      const threadRoot = await postService.create({
        format: "note",
        bodyMarkdown: "thread root",
      });
      await postService.create({
        format: "note",
        bodyMarkdown: "reply",
        replyToId: threadRoot.id,
      });
      await postService.create({
        format: "note",
        bodyMarkdown: "standalone",
      });

      const threads = await postService.list({
        excludeReplies: true,
        hasReplies: true,
      });
      expect(threads.map((p) => p.bodyText)).toEqual(["thread root"]);

      const singles = await postService.list({
        excludeReplies: true,
        hasReplies: false,
      });
      expect(singles.map((p) => p.bodyText)).toEqual(["standalone"]);
    });

    it("ignores draft replies when filtering by reply presence", async () => {
      const root = await postService.create({
        format: "note",
        bodyMarkdown: "root with draft reply",
      });
      await postService.create({
        format: "note",
        bodyMarkdown: "draft reply",
        replyToId: root.id,
        status: "draft",
      });

      const threads = await postService.list({
        excludeReplies: true,
        hasReplies: true,
      });
      expect(threads).toHaveLength(0);

      const singles = await postService.list({
        excludeReplies: true,
        hasReplies: false,
      });
      expect(singles.map((p) => p.bodyText)).toEqual(["root with draft reply"]);
    });

    it("supports offset pagination", async () => {
      for (let i = 0; i < 5; i++) {
        await postService.create({
          format: "note",
          bodyMarkdown: `post ${i}`,
          publishedAt: 1000 + i,
        });
      }

      // Skip the first 2 posts (newest), get 2 more
      const posts = await postService.list({ limit: 2, offset: 2 });
      expect(posts).toHaveLength(2);
      expect(posts[0]?.bodyText).toBe("post 2");
      expect(posts[1]?.bodyText).toBe("post 1");
    });
  });

  describe("count", () => {
    it("returns 0 when no posts exist", async () => {
      const count = await postService.count();
      expect(count).toBe(0);
    });

    it("counts all non-deleted posts", async () => {
      await postService.create({ format: "note", bodyMarkdown: "first" });
      await postService.create({ format: "note", bodyMarkdown: "second" });
      await postService.create({ format: "note", bodyMarkdown: "third" });

      const count = await postService.count();
      expect(count).toBe(3);
    });

    it("filters by status", async () => {
      await postService.create({
        format: "note",
        bodyMarkdown: "published",
        status: "published",
      });
      await postService.create({
        format: "note",
        bodyMarkdown: "draft",
        status: "draft",
      });

      const count = await postService.count({ status: "published" });
      expect(count).toBe(1);
    });

    it("filters by visibility", async () => {
      await postService.create({
        format: "note",
        bodyMarkdown: "latest_hidden",
        visibility: "latest_hidden",
      });
      await postService.create({ format: "note", bodyMarkdown: "normal" });

      const count = await postService.count({ visibility: "latest_hidden" });
      expect(count).toBe(1);
    });

    it("filters by featured", async () => {
      await postService.create({
        format: "note",
        bodyMarkdown: "featured",
        featured: true,
      });
      await postService.create({ format: "note", bodyMarkdown: "normal" });

      const featuredCount = await postService.count({ featured: true });
      expect(featuredCount).toBe(1);

      const notFeaturedCount = await postService.count({ featured: false });
      expect(notFeaturedCount).toBe(1);
    });

    it("excludes deleted posts by default", async () => {
      const post = await postService.create({
        format: "note",
        bodyMarkdown: "to delete",
      });
      await postService.create({ format: "note", bodyMarkdown: "keep" });
      await postService.delete(post.id);

      const count = await postService.count();
      expect(count).toBe(1);
    });

    it("excludes replies when requested", async () => {
      const root = await postService.create({
        format: "note",
        bodyMarkdown: "root",
      });
      await postService.create({
        format: "note",
        bodyMarkdown: "reply",
        replyToId: root.id,
      });

      const count = await postService.count({ excludeReplies: true });
      expect(count).toBe(1);
    });

    it("counts thread roots by reply presence", async () => {
      const threadRoot = await postService.create({
        format: "note",
        bodyMarkdown: "thread root",
      });
      await postService.create({
        format: "note",
        bodyMarkdown: "reply",
        replyToId: threadRoot.id,
      });
      await postService.create({
        format: "note",
        bodyMarkdown: "standalone",
      });

      const threadCount = await postService.count({
        excludeReplies: true,
        hasReplies: true,
      });
      expect(threadCount).toBe(1);

      const singleCount = await postService.count({
        excludeReplies: true,
        hasReplies: false,
      });
      expect(singleCount).toBe(1);
    });

    it("can stop counting after a small limit", async () => {
      const collection = await collectionService.create({
        slug: "rated",
        title: "Rated",
      });

      for (let i = 0; i < 3; i++) {
        const post = await postService.create({
          format: "link",
          title: `rated ${i}`,
          url: `https://example.com/${i}`,
          rating: i + 1,
        });

        await db.insert(threadCollections).values({
          siteId: DEFAULT_TEST_SITE_ID,
          threadId: post.id,
          collectionId: collection.id,
          createdAt: 100 + i,
        });
      }

      const count = await postService.countUpTo(
        {
          collectionIds: [collection.id],
          status: "published",
          hasRating: true,
        },
        2,
      );

      expect(count).toBe(2);
    });
  });

  describe("countByYearMonth", () => {
    it("returns grouped month totals for the full filtered result set", async () => {
      await postService.create({
        format: "note",
        bodyMarkdown: "jan a",
        publishedAt: 1704067200, // Jan 1, 2024
      });
      await postService.create({
        format: "note",
        bodyMarkdown: "jan b",
        publishedAt: 1705276800, // Jan 15, 2024
      });
      await postService.create({
        format: "note",
        bodyMarkdown: "feb",
        publishedAt: 1706745600, // Feb 1, 2024
      });

      const counts = await postService.countByYearMonth({
        status: "published",
        excludeReplies: true,
      });

      expect(counts).toEqual([
        { yearMonth: "2024-02", count: 1 },
        { yearMonth: "2024-01", count: 2 },
      ]);
    });

    it("respects the same archive filters as list and count", async () => {
      await postService.create({
        format: "note",
        bodyMarkdown: "public jan",
        publishedAt: 1704067200,
      });
      await postService.create({
        format: "note",
        bodyMarkdown: "private jan",
        visibility: "private",
        publishedAt: 1704153600,
      });
      await postService.create({
        format: "link",
        title: "feb link",
        url: "https://example.com",
        publishedAt: 1706745600,
      });

      const counts = await postService.countByYearMonth({
        format: "note",
        visibility: "private",
      });

      expect(counts).toEqual([{ yearMonth: "2024-01", count: 1 }]);
    });
  });

  describe("update", () => {
    it("updates post body", async () => {
      const post = await postService.create({
        format: "note",
        body: JSON.stringify({
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "original" }],
            },
          ],
        }),
      });

      const updatedBody = JSON.stringify({
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "updated content" }],
          },
        ],
      });
      const updated = await postService.update(post.id, {
        body: updatedBody,
      });

      expect(updated).not.toBeNull();
      expect(updated?.body).toBe(updatedBody);
      expect(updated?.bodyHtml).toContain("updated content");
    });

    it("updates post title", async () => {
      const post = await postService.create({
        format: "link",
        bodyMarkdown: "body",
        title: "Original Title",
        url: "https://example.com",
      });

      const updated = await postService.update(post.id, {
        title: "New Title",
      });

      expect(updated?.title).toBe("New Title");
    });

    it("updates post url", async () => {
      const post = await postService.create({
        format: "link",
        bodyMarkdown: "link post",
        title: "Old title",
        url: "https://old.com",
      });

      const updated = await postService.update(post.id, {
        url: "https://new-source.com/path",
      });

      expect(updated?.url).toBe("https://new-source.com/path");
    });

    it("rejects clearing url from a link post", async () => {
      const post = await postService.create({
        format: "link",
        bodyMarkdown: "test",
        title: "A link",
        url: "https://example.com",
      });

      await expect(
        postService.update(post.id, {
          url: null,
        }),
      ).rejects.toThrow("Link posts need a URL.");
    });

    it("returns null for non-existent post", async () => {
      const result = await postService.update(9999, { bodyMarkdown: "test" });
      expect(result).toBeNull();
    });

    it("updates updatedAt timestamp", async () => {
      const post = await postService.create({
        format: "note",
        bodyMarkdown: "test",
      });
      const originalUpdatedAt = post.updatedAt;

      // Small delay to ensure different timestamp
      await new Promise((r) => setTimeout(r, 1100));

      const updated = await postService.update(post.id, {
        bodyMarkdown: "modified",
      });

      expect(updated?.updatedAt).toBeGreaterThanOrEqual(originalUpdatedAt);
    });

    it("does not refresh recent-added ordering when collection memberships stay the same", async () => {
      vi.useFakeTimers();

      try {
        vi.setSystemTime(new Date("2024-01-01T00:00:00Z"));
        const olderCollection = await collectionService.create({
          slug: "older",
          title: "Older",
        });
        const firstPost = await postService.create({
          format: "note",
          bodyMarkdown: "first",
          collectionIds: [olderCollection.id],
        });

        vi.setSystemTime(new Date("2024-01-01T00:01:00Z"));
        const newerCollection = await collectionService.create({
          slug: "newer",
          title: "Newer",
        });
        await postService.create({
          format: "note",
          bodyMarkdown: "second",
          collectionIds: [newerCollection.id],
        });

        expect(
          (await collectionService.listByRecentActivity()).map(
            (collection) => collection.id,
          ),
        ).toEqual([newerCollection.id, olderCollection.id]);

        vi.setSystemTime(new Date("2024-01-01T00:02:00Z"));
        await postService.update(firstPost.id, {
          bodyMarkdown: "first updated",
          collectionIds: [olderCollection.id],
        });

        expect(
          (await collectionService.listByRecentActivity()).map(
            (collection) => collection.id,
          ),
        ).toEqual([newerCollection.id, olderCollection.id]);
      } finally {
        vi.useRealTimers();
      }
    });

    it("updates the shared Thread collections when editing a child", async () => {
      const firstCollection = await collectionService.create({
        slug: "first-thread-collection",
        title: "First",
      });
      const secondCollection = await collectionService.create({
        slug: "second-thread-collection",
        title: "Second",
      });
      const root = await postService.create({
        format: "note",
        bodyMarkdown: "root",
        collectionIds: [firstCollection.id],
      });
      const child = await postService.create({
        format: "note",
        bodyMarkdown: "child",
        replyToId: root.id,
      });

      expect(
        (await collectionService.getCollectionsByPostId(child.id)).map(
          (collection) => collection.id,
        ),
      ).toEqual([firstCollection.id]);

      await postService.update(child.id, {
        collectionIds: [secondCollection.id],
      });

      const [rootCollections, childCollections, rows] = await Promise.all([
        collectionService.getCollectionsByPostId(root.id),
        collectionService.getCollectionsByPostId(child.id),
        db.select().from(threadCollections),
      ]);
      expect(rootCollections.map((collection) => collection.id)).toEqual([
        secondCollection.id,
      ]);
      expect(childCollections.map((collection) => collection.id)).toEqual([
        secondCollection.id,
      ]);
      expect(rows).toEqual([
        expect.objectContaining({
          threadId: root.id,
          collectionId: secondCollection.id,
        }),
      ]);
    });

    it("rejects Collection membership while creating a child", async () => {
      const collection = await collectionService.create({
        slug: "reply-create-collection",
        title: "Reply Create Collection",
      });
      const root = await postService.create({
        format: "note",
        bodyMarkdown: "root",
      });

      await expect(
        postService.create({
          format: "note",
          bodyMarkdown: "child",
          replyToId: root.id,
          collectionIds: [collection.id],
        }),
      ).rejects.toThrow("Cannot set Collections while creating a Thread reply");
      expect(await collectionService.getThreadIds(collection.id)).toEqual([]);
    });

    it("sets publishedAt when publishing a draft", async () => {
      const post = await postService.create({
        format: "note",
        bodyMarkdown: "draft",
        status: "draft",
      });

      expect(post.publishedAt).toBeNull();

      await new Promise((r) => setTimeout(r, 1100));

      const published = await postService.update(post.id, {
        status: "published",
      });

      expect(published?.status).toBe("published");
      expect(published?.publishedAt).toBeTypeOf("number");
      expect((published?.publishedAt ?? 0) >= post.updatedAt).toBe(true);
      expect(
        (await postService.list({ status: "draft" })).map((draft) => draft.id),
      ).not.toContain(post.id);
    });

    it("clears publishedAt when converting a published post back to draft", async () => {
      const post = await postService.create({
        format: "note",
        bodyMarkdown: "published",
        publishedAt: 1706745600,
      });

      const draft = await postService.update(post.id, {
        status: "draft",
      });

      expect(draft?.status).toBe("draft");
      expect(draft?.publishedAt).toBeNull();
    });

    it("rejects setting publishedAt while remaining a draft", async () => {
      const post = await postService.create({
        format: "note",
        bodyMarkdown: "draft",
        status: "draft",
      });

      await expect(
        postService.update(post.id, {
          publishedAt: 1706745600,
        }),
      ).rejects.toThrow("Drafts can't set a publish time.");
    });

    it("updates visibility", async () => {
      const post = await postService.create({
        format: "note",
        bodyMarkdown: "test",
      });

      expect(post.visibility).toBe("public");

      const updated = await postService.update(post.id, {
        visibility: "latest_hidden",
      });

      expect(updated?.visibility).toBe("latest_hidden");
    });

    it("rejects unsupported visibility updates", async () => {
      const post = await postService.create({
        format: "note",
        bodyMarkdown: "test",
      });

      await expect(
        postService.update(post.id, {
          visibility: "friends_only" as never,
        }),
      ).rejects.toThrow(
        "Visibility must be public, hidden from Latest, or private.",
      );
    });

    it("updates featured flag", async () => {
      const post = await postService.create({
        format: "note",
        bodyMarkdown: "test",
      });

      expect(post.featuredAt).toBeNull();

      const featured = await postService.update(post.id, {
        featured: true,
      });

      expect(featured?.featuredAt).toBeTypeOf("number");

      const unfeatured = await postService.update(post.id, {
        featured: false,
      });

      expect(unfeatured?.featuredAt).toBeNull();
    });

    it("updates pinned flag", async () => {
      const post = await postService.create({
        format: "note",
        bodyMarkdown: "test",
      });

      expect(post.pinnedAt).toBeNull();

      const updated = await postService.update(post.id, {
        pinned: true,
      });

      expect(updated?.pinnedAt).toBeTypeOf("number");
    });

    it("updates slug and title on its page navigation entry", async () => {
      const post = await postService.create({
        format: "note",
        title: "Test page",
        slug: "old-slug",
        visibility: "latest_hidden",
      });
      const navItemService = createNavItemService(db, DEFAULT_TEST_SITE_ID);
      const navItem = await navItemService.create({
        type: "page",
        postId: post.id,
      });

      const updated = await postService.update(post.id, {
        slug: "new-slug",
        title: "Renamed page",
      });

      expect(updated?.slug).toBe("new-slug");
      // The URL is synced on write; the title is read through, so renaming the
      // page carries its navigation entry along with no sync step at all.
      expect(await navItemService.getById(navItem.id)).toMatchObject({
        label: "",
        targetTitle: "Renamed page",
        url: "/new-slug",
      });
    });

    it("removes page navigation when the page becomes a draft", async () => {
      const post = await postService.create({
        format: "note",
        title: "Temporary page",
        slug: "temporary-page",
        visibility: "latest_hidden",
      });
      const navItemService = createNavItemService(db, DEFAULT_TEST_SITE_ID);
      await navItemService.create({ type: "page", postId: post.id });

      await postService.update(post.id, { status: "draft" });

      expect(await navItemService.list()).toEqual([]);
    });

    it("updates quoteText and rating", async () => {
      const post = await postService.create({
        format: "quote",
        quoteText: "Original quote",
        rating: 3,
      });

      const updated = await postService.update(post.id, {
        quoteText: "Updated quote",
        rating: 5,
      });

      expect(updated?.quoteText).toBe("Updated quote");
      expect(updated?.rating).toBe(5);
    });

    it("rejects switching a note to link without adding a URL", async () => {
      const post = await postService.create({
        format: "note",
        bodyMarkdown: "test",
      });

      await expect(
        postService.update(post.id, {
          format: "link",
          title: "A link",
        }),
      ).rejects.toThrow("Link posts need a URL.");
    });

    it("rejects switching a note to link without adding a title", async () => {
      const post = await postService.create({
        format: "note",
        bodyMarkdown: "test",
      });

      await expect(
        postService.update(post.id, {
          format: "link",
          url: "https://example.com",
        }),
      ).rejects.toThrow("Link posts need a title.");
    });

    it("rejects switching a link to note without clearing the URL", async () => {
      const post = await postService.create({
        format: "link",
        bodyMarkdown: "test",
        title: "A link",
        url: "https://example.com",
      });

      await expect(
        postService.update(post.id, {
          format: "note",
        }),
      ).rejects.toThrow("Notes can't include a URL.");
    });

    it("rolls back post fields when attachment replacement fails", async () => {
      const mediaService = createMediaService(db, DEFAULT_TEST_SITE_ID);
      const storage = createMockStorage();
      const post = await postService.create({
        format: "note",
        bodyMarkdown: "before",
      });
      const originalAttachment = await mediaService.create({
        filename: "original.jpg",
        originalName: "original.jpg",
        mimeType: "image/jpeg",
        size: 1024,
        storageKey: "media/original.jpg",
        alt: "original alt",
      });
      const replacementAttachment = await mediaService.create({
        filename: "replacement.jpg",
        originalName: "replacement.jpg",
        mimeType: "image/jpeg",
        size: 2048,
        storageKey: "media/replacement.jpg",
      });
      await mediaService.attachToPost(post.id, [originalAttachment.id]);

      const failingMediaService: MediaService = {
        ...mediaService,
        async updateAlt() {
          throw new Error("boom");
        },
      };

      await expect(
        postService.updateWithAttachments(
          post.id,
          {
            bodyMarkdown: "after",
            title: "Updated title",
          },
          [
            {
              type: "media",
              mediaId: replacementAttachment.id,
              alt: "replacement alt",
            },
          ],
          {
            media: failingMediaService,
            storage,
            storageDriver: "local",
            maxFileSizeMB: 1,
          },
        ),
      ).rejects.toThrow("boom");

      const rolledBack = await postService.getById(post.id);
      expect(rolledBack?.bodyText).toBe("before");
      expect(rolledBack?.title).toBeNull();

      const restoredAttachments = await mediaService.getByPostId(post.id);
      expect(restoredAttachments.map((attachment) => attachment.id)).toEqual([
        originalAttachment.id,
      ]);
      expect(restoredAttachments[0]?.alt).toBe("original alt");
      expect(
        await mediaService.getById(replacementAttachment.id),
      ).toMatchObject({
        id: replacementAttachment.id,
        postId: null,
      });
    });

    it("does not call transaction() when cascading threaded updates on sqlite-family backends", async () => {
      const root = await postService.create({
        format: "note",
        bodyMarkdown: "root",
      });
      await postService.create({
        format: "note",
        bodyMarkdown: "reply",
        replyToId: root.id,
      });

      const dbWithoutTransaction = db as Database & {
        transaction: () => Promise<never>;
      };
      const originalTransaction = dbWithoutTransaction.transaction.bind(db);
      dbWithoutTransaction.transaction = async () => {
        throw new Error("sqlite update() should not call transaction()");
      };

      try {
        const updated = await postService.update(root.id, {
          visibility: "latest_hidden",
        });
        expect(updated?.visibility).toBe("latest_hidden");
      } finally {
        dbWithoutTransaction.transaction = originalTransaction;
      }
    });
  });

  describe("delete", () => {
    it("removes a post", async () => {
      const post = await postService.create({
        format: "note",
        bodyMarkdown: "test",
      });

      const result = await postService.delete(post.id);
      expect(result).toBe(true);

      const found = await postService.getById(post.id);
      expect(found).toBeNull();
    });

    it("cascade deletes the post's page navigation item", async () => {
      const post = await postService.create({
        format: "note",
        title: "Disposable page",
        slug: "disposable-page",
        visibility: "latest_hidden",
      });
      const navItemService = createNavItemService(db, DEFAULT_TEST_SITE_ID);
      await navItemService.create({ type: "page", postId: post.id });

      await postService.delete(post.id);

      expect(await navItemService.list()).toEqual([]);
    });

    it("returns false for non-existent post", async () => {
      const result = await postService.delete(9999);
      expect(result).toBe(false);
    });

    it("cascade deletes thread when deleting root post", async () => {
      const root = await postService.create({
        format: "note",
        bodyMarkdown: "root",
      });
      const reply = await postService.create({
        format: "note",
        bodyMarkdown: "reply",
        replyToId: root.id,
      });

      await postService.delete(root.id);

      expect(await postService.getById(root.id)).toBeNull();
      expect(await postService.getById(reply.id)).toBeNull();
    });

    it("only deletes single post when deleting a reply", async () => {
      const root = await postService.create({
        format: "note",
        bodyMarkdown: "root",
      });
      const reply1 = await postService.create({
        format: "note",
        bodyMarkdown: "reply1",
        replyToId: root.id,
      });
      await postService.create({
        format: "note",
        bodyMarkdown: "reply2",
        replyToId: reply1.id,
      });

      await postService.delete(reply1.id);

      expect(await postService.getById(root.id)).not.toBeNull();
      expect(await postService.getById(reply1.id)).toBeNull();
    });

    it("frees the slug for reuse after deletion", async () => {
      const post = await postService.create({
        format: "note",
        bodyMarkdown: "first",
        title: "Same Title",
      });
      await postService.delete(post.id);

      const reused = await postService.create({
        format: "note",
        bodyMarkdown: "second",
        title: "Same Title",
      });
      expect(reused.slug).toBe(post.slug);
    });
  });

  describe("createThreadWithAttachments", () => {
    // No attachments in these cases, so only the up-front id check is reached.
    const deps = {
      media: { validateIds: async () => [] },
    } as unknown as Parameters<
      typeof postService.createThreadWithAttachments
    >[1];

    it("dates every reply from the root when the root is backdated", async () => {
      const backdated = 1710000000; // 2024-03-09

      const created = await postService.createThreadWithAttachments(
        [
          {
            data: {
              format: "note",
              bodyMarkdown: "root",
              publishedAt: backdated,
            },
            attachments: [],
          },
          { data: { format: "note", bodyMarkdown: "second" }, attachments: [] },
          { data: { format: "note", bodyMarkdown: "third" }, attachments: [] },
        ],
        deps,
        undefined,
      );

      // Without inheritance the replies would land on today and the thread
      // would read as if it spanned two years.
      expect(created.map((p) => p.publishedAt)).toEqual([
        backdated,
        backdated,
        backdated,
      ]);
      // Order still comes from createdAt/id, so the chain is intact.
      expect(created[1].replyToId).toBe(created[0].id);
      expect(created[2].replyToId).toBe(created[1].id);
    });

    it("keeps a reply's own date when one is given", async () => {
      const rootAt = 1710000000;
      const replyAt = 1720000000;

      const created = await postService.createThreadWithAttachments(
        [
          {
            data: { format: "note", bodyMarkdown: "root", publishedAt: rootAt },
            attachments: [],
          },
          {
            data: {
              format: "note",
              bodyMarkdown: "second",
              publishedAt: replyAt,
            },
            attachments: [],
          },
        ],
        deps,
        undefined,
      );

      expect(created.map((p) => p.publishedAt)).toEqual([rootAt, replyAt]);
    });

    it("leaves draft threads undated", async () => {
      const created = await postService.createThreadWithAttachments(
        [
          {
            data: { format: "note", bodyMarkdown: "root", status: "draft" },
            attachments: [],
          },
          {
            data: { format: "note", bodyMarkdown: "second", status: "draft" },
            attachments: [],
          },
        ],
        deps,
        undefined,
      );

      expect(created.map((p) => p.publishedAt)).toEqual([null, null]);
    });
  });

  describe("threads", () => {
    it("sets threadId on reply to a root post", async () => {
      const root = await postService.create({
        format: "note",
        bodyMarkdown: "root",
      });
      const reply = await postService.create({
        format: "note",
        bodyMarkdown: "reply",
        replyToId: root.id,
      });

      expect(reply.threadId).toBe(root.id);
      expect(reply.replyToId).toBe(root.id);
    });

    it("inherits threadId from parent in nested replies", async () => {
      const root = await postService.create({
        format: "note",
        bodyMarkdown: "root",
      });
      const reply1 = await postService.create({
        format: "note",
        bodyMarkdown: "reply1",
        replyToId: root.id,
      });
      const reply2 = await postService.create({
        format: "note",
        bodyMarkdown: "reply2",
        replyToId: reply1.id,
      });

      // Both replies point to the root's thread
      expect(reply1.threadId).toBe(root.id);
      expect(reply2.threadId).toBe(root.id);
    });

    it("rejects replies to posts that are no longer the thread tail", async () => {
      const root = await postService.create({
        format: "note",
        bodyMarkdown: "root",
      });
      await postService.create({
        format: "note",
        bodyMarkdown: "reply1",
        replyToId: root.id,
      });

      await expect(
        postService.create({
          format: "note",
          bodyMarkdown: "reply2",
          replyToId: root.id,
        }),
      ).rejects.toThrow(
        "This post is no longer the end of the thread. Reply to the latest post instead.",
      );
    });

    it("refuses to feature an unpublished post", async () => {
      await expect(
        postService.create({
          format: "note",
          bodyMarkdown: "not ready",
          status: "draft",
          featured: true,
        }),
      ).rejects.toThrow("Publish this post before featuring it.");

      const draft = await postService.create({
        format: "note",
        bodyMarkdown: "not ready",
        status: "draft",
      });
      await expect(
        postService.update(draft.id, { featured: true }),
      ).rejects.toThrow("Publish this post before featuring it.");
    });

    it("keeps a featured flag through a trip back to draft", async () => {
      const post = await postService.create({
        format: "note",
        bodyMarkdown: "published",
        featured: true,
      });

      const unpublished = await postService.update(post.id, {
        status: "draft",
      });

      expect(unpublished?.status).toBe("draft");
      expect(unpublished?.featuredAt).not.toBeNull();
    });

    it("publishes a reply whose parent is still a draft", async () => {
      const root = await postService.create({
        format: "note",
        bodyMarkdown: "root",
      });
      const draft = await postService.create({
        format: "note",
        bodyMarkdown: "unfinished",
        replyToId: root.id,
        status: "draft",
      });

      const next = await postService.create({
        format: "note",
        bodyMarkdown: "continues past the draft",
        replyToId: draft.id,
      });

      // Readers never saw the draft, so publishing past it reads as
      // continuous. The draft stays parked until it is dealt with on its own.
      expect(next.status).toBe("published");
      expect(draft.status).toBe("draft");
    });

    it("publishes only the post asked for, leaving other drafts alone", async () => {
      const root = await postService.create({
        format: "note",
        bodyMarkdown: "root",
      });
      const first = await postService.create({
        format: "note",
        bodyMarkdown: "first draft",
        replyToId: root.id,
        status: "draft",
      });
      const second = await postService.create({
        format: "note",
        bodyMarkdown: "second draft",
        replyToId: first.id,
        status: "draft",
      });

      await postService.update(second.id, { status: "published" });

      const statusById = new Map(
        (await postService.getThread(root.id)).map((p) => [p.id, p.status]),
      );
      expect(statusById.get(first.id)).toBe("draft");
      expect(statusById.get(second.id)).toBe("published");
    });

    it("keeps a draft between two published replies", async () => {
      const root = await postService.create({
        format: "note",
        bodyMarkdown: "root",
      });
      const middle = await postService.create({
        format: "note",
        bodyMarkdown: "middle",
        replyToId: root.id,
      });
      const last = await postService.create({
        format: "note",
        bodyMarkdown: "last",
        replyToId: middle.id,
      });

      await postService.update(middle.id, { status: "draft" });

      const statusById = new Map(
        (await postService.getThread(root.id)).map((p) => [p.id, p.status]),
      );
      // Unpublishing one post touches only that post. The public thread simply
      // skips it; nothing else in the chain changes.
      expect(statusById.get(root.id)).toBe("published");
      expect(statusById.get(middle.id)).toBe("draft");
      expect(statusById.get(last.id)).toBe("published");
    });

    it("names the draft when an unpublished reply holds the thread tail", async () => {
      const root = await postService.create({
        format: "note",
        bodyMarkdown: "root",
      });
      await postService.create({
        format: "note",
        bodyMarkdown: "unfinished",
        replyToId: root.id,
        status: "draft",
      });

      await expect(
        postService.create({
          format: "note",
          bodyMarkdown: "reply",
          replyToId: root.id,
        }),
      ).rejects.toThrow(
        "This thread ends with an unpublished draft. Finish that draft or discard it, then reply.",
      );
    });

    it("inherits status from root post", async () => {
      const root = await postService.create({
        format: "note",
        bodyMarkdown: "root",
        status: "draft",
      });
      const reply = await postService.create({
        format: "note",
        bodyMarkdown: "reply",
        replyToId: root.id,
      });

      expect(reply.status).toBe("draft");
    });

    it("preserves draft status when reply explicitly requests it", async () => {
      const root = await postService.create({
        format: "note",
        bodyMarkdown: "root",
        status: "published",
      });
      const reply = await postService.create({
        format: "note",
        bodyMarkdown: "reply",
        status: "draft",
        replyToId: root.id,
      });

      expect(reply.status).toBe("draft");
      expect(reply.threadId).toBe(root.id);
    });

    it("inherits visibility from root post", async () => {
      const root = await postService.create({
        format: "note",
        bodyMarkdown: "root",
        visibility: "latest_hidden",
      });
      const reply = await postService.create({
        format: "note",
        bodyMarkdown: "reply",
        replyToId: root.id,
      });

      expect(reply.visibility).toBe("latest_hidden");
    });

    it("stores reply visibility as null and resolves it from the root", async () => {
      const root = await postService.create({
        format: "note",
        bodyMarkdown: "root",
        visibility: "private",
      });
      const reply = await postService.create({
        format: "note",
        bodyMarkdown: "reply",
        replyToId: root.id,
      });

      const rows = await db
        .select({ visibility: posts.visibility })
        .from(posts)
        .where(eq(posts.id, reply.id))
        .limit(1);

      expect(rows[0]?.visibility).toBeNull();
      expect(reply.visibility).toBe("private");
    });

    it("does not inherit featuredAt from root post", async () => {
      const root = await postService.create({
        format: "note",
        bodyMarkdown: "root",
        featured: true,
      });

      expect(root.featuredAt).toBeTypeOf("number");

      const reply = await postService.create({
        format: "note",
        bodyMarkdown: "reply",
        replyToId: root.id,
      });

      // featuredAt is an independent property — replies should NOT inherit it
      expect(reply.featuredAt).toBeNull();
    });

    it("getThread returns all posts in a thread", async () => {
      const root = await postService.create({
        format: "note",
        bodyMarkdown: "root",
      });
      const reply1 = await postService.create({
        format: "note",
        bodyMarkdown: "reply1",
        replyToId: root.id,
      });
      await postService.create({
        format: "note",
        bodyMarkdown: "reply2",
        replyToId: reply1.id,
      });

      const thread = await postService.getThread(root.id);
      expect(thread).toHaveLength(3);
      // Ordered by createdAt
      expect(thread[0]?.bodyText).toBe("root");
    });

    it("getThreadPosition counts the chain from the root down to a post", async () => {
      const root = await postService.create({
        format: "note",
        bodyMarkdown: "root",
      });
      const reply1 = await postService.create({
        format: "note",
        bodyMarkdown: "reply1",
        replyToId: root.id,
      });
      const reply2 = await postService.create({
        format: "note",
        bodyMarkdown: "reply2",
        replyToId: reply1.id,
      });

      expect(await postService.getThreadPosition(root.id)).toBe(1);
      expect(await postService.getThreadPosition(reply1.id)).toBe(2);
      expect(await postService.getThreadPosition(reply2.id)).toBe(3);
    });

    it("getThreadPosition walks the reply chain rather than counting members", async () => {
      // `create` only allows replying to the tail, so today a thread is a
      // straight chain and depth happens to equal its size. The walk is what
      // makes the two agree — counting `threadId` members would give the same
      // answer here and the wrong one the moment a draft chain is incomplete.
      const root = await postService.create({
        format: "note",
        bodyMarkdown: "root",
      });
      const tail = await postService.create({
        format: "note",
        bodyMarkdown: "tail",
        replyToId: root.id,
      });

      // A second post filed under the same thread without joining the chain:
      // it is not above the tail, so it must not push the tail's position.
      await postService.create({
        format: "note",
        bodyMarkdown: "unrelated",
      });

      expect(await postService.getThreadPosition(tail.id)).toBe(2);
      expect(await postService.getThread(root.id)).toHaveLength(2);
    });

    it("getThreadPosition returns 0 for a post that does not exist", async () => {
      expect(await postService.getThreadPosition("pst_missing")).toBe(0);
    });

    it("getThread excludes deleted posts", async () => {
      const root = await postService.create({
        format: "note",
        bodyMarkdown: "root",
      });
      const reply = await postService.create({
        format: "note",
        bodyMarkdown: "reply",
        replyToId: root.id,
      });

      await postService.delete(reply.id);

      const thread = await postService.getThread(root.id);
      expect(thread).toHaveLength(1);
    });

    it("cascades status changes from root to thread", async () => {
      const root = await postService.create({
        format: "note",
        bodyMarkdown: "root",
        status: "published",
      });
      await postService.create({
        format: "note",
        bodyMarkdown: "reply",
        replyToId: root.id,
      });

      await postService.update(root.id, { status: "draft" });

      const thread = await postService.getThread(root.id);
      for (const post of thread) {
        expect(post.status).toBe("draft");
        expect(post.publishedAt).toBeNull();
      }
    });

    it("publishing a draft thread stamps publishedAt on all posts", async () => {
      const root = await postService.create({
        format: "note",
        bodyMarkdown: "root",
        status: "draft",
      });
      await postService.create({
        format: "note",
        bodyMarkdown: "reply",
        replyToId: root.id,
      });

      await new Promise((r) => setTimeout(r, 1100));
      await postService.update(root.id, { status: "published" });

      const thread = await postService.getThread(root.id);
      for (const post of thread) {
        expect(post.status).toBe("published");
        expect(post.publishedAt).toBeTypeOf("number");
      }
    });

    it("cascades visibility changes from root to thread", async () => {
      const root = await postService.create({
        format: "note",
        bodyMarkdown: "root",
      });
      await postService.create({
        format: "note",
        bodyMarkdown: "reply",
        replyToId: root.id,
      });

      await postService.update(root.id, { visibility: "latest_hidden" });

      const thread = await postService.getThread(root.id);
      for (const post of thread) {
        expect(post.visibility).toBe("latest_hidden");
      }
    });

    it("filters replies by the root post visibility", async () => {
      const latestHiddenRoot = await postService.create({
        format: "note",
        bodyMarkdown: "root",
        visibility: "latest_hidden",
      });
      const latestHiddenReply = await postService.create({
        format: "note",
        bodyMarkdown: "reply",
        replyToId: latestHiddenRoot.id,
      });
      await postService.create({
        format: "note",
        bodyMarkdown: "public root",
      });

      const postsByVisibility = await postService.list({
        visibility: "latest_hidden",
      });

      expect(postsByVisibility.map((post) => post.id)).toEqual([
        latestHiddenReply.id,
        latestHiddenRoot.id,
      ]);
    });

    it("rejects visibility changes on thread replies", async () => {
      const root = await postService.create({
        format: "note",
        bodyMarkdown: "root",
      });
      const reply = await postService.create({
        format: "note",
        bodyMarkdown: "reply",
        replyToId: root.id,
      });

      await expect(
        postService.update(reply.id, { visibility: "latest_hidden" }),
      ).rejects.toThrow(
        "Cannot change visibility of a thread reply. Update the root post instead.",
      );
    });

    it("allows featuring a thread reply", async () => {
      const root = await postService.create({
        format: "note",
        bodyMarkdown: "root",
      });
      const reply = await postService.create({
        format: "note",
        bodyMarkdown: "reply",
        replyToId: root.id,
      });

      // Featured is independent of visibility — replies can be featured
      const updated = await postService.update(reply.id, { featured: true });
      expect(updated?.featuredAt).toBeTypeOf("number");

      const unfeatured = await postService.update(reply.id, {
        featured: false,
      });
      expect(unfeatured?.featuredAt).toBeNull();
    });

    it("rejects creating a pinned thread reply", async () => {
      const root = await postService.create({
        format: "note",
        bodyMarkdown: "root",
      });

      await expect(
        postService.create({
          format: "note",
          bodyMarkdown: "reply",
          replyToId: root.id,
          pinned: true,
        }),
      ).rejects.toThrow(
        "Cannot pin a thread reply. Pin the root post instead.",
      );
    });

    it("rejects pinning a thread reply", async () => {
      const root = await postService.create({
        format: "note",
        bodyMarkdown: "root",
      });
      const reply = await postService.create({
        format: "note",
        bodyMarkdown: "reply",
        replyToId: root.id,
      });

      await expect(
        postService.update(reply.id, { pinned: true }),
      ).rejects.toThrow(
        "Cannot pin a thread reply. Pin the root post instead.",
      );
    });
  });

  describe("getReplyCounts", () => {
    it("returns empty map for empty input", async () => {
      const counts = await postService.getReplyCounts([]);
      expect(counts.size).toBe(0);
    });

    it("returns reply counts for posts", async () => {
      const root = await postService.create({
        format: "note",
        bodyMarkdown: "root",
      });
      const reply1 = await postService.create({
        format: "note",
        bodyMarkdown: "reply1",
        replyToId: root.id,
      });
      await postService.create({
        format: "note",
        bodyMarkdown: "reply2",
        replyToId: reply1.id,
      });

      const counts = await postService.getReplyCounts([root.id]);
      expect(counts.get(root.id)).toBe(2);
    });

    it("returns 0 (missing) for posts without replies", async () => {
      const post = await postService.create({
        format: "note",
        bodyMarkdown: "no replies",
      });

      const counts = await postService.getReplyCounts([post.id]);
      expect(counts.get(post.id)).toBeUndefined();
    });

    it("excludes deleted replies from count", async () => {
      const root = await postService.create({
        format: "note",
        bodyMarkdown: "root",
      });
      const reply = await postService.create({
        format: "note",
        bodyMarkdown: "reply",
        replyToId: root.id,
      });
      await postService.create({
        format: "note",
        bodyMarkdown: "reply2",
        replyToId: reply.id,
      });

      await postService.delete(reply.id);

      const counts = await postService.getReplyCounts([root.id]);
      expect(counts.get(root.id)).toBe(1);
    });

    it("excludes draft replies from count", async () => {
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

      const counts = await postService.getReplyCounts([root.id]);
      expect(counts.get(root.id)).toBe(1);
    });
  });

  describe("lastActivityAt (thread bump-to-top)", () => {
    it("sets lastActivityAt equal to publishedAt for non-thread posts", async () => {
      const post = await postService.create({
        format: "note",
        bodyMarkdown: "standalone",
        publishedAt: 5000,
      });

      expect(post.lastActivityAt).toBe(5000);
    });

    it("updates root lastActivityAt when a reply is created", async () => {
      const root = await postService.create({
        format: "note",
        bodyMarkdown: "root",
        publishedAt: 1000,
      });
      expect(root.lastActivityAt).toBe(1000);

      await postService.create({
        format: "note",
        bodyMarkdown: "reply",
        replyToId: root.id,
        publishedAt: 9000,
      });

      const updatedRoot = await postService.getById(root.id);
      expect(updatedRoot?.lastActivityAt).toBe(9000);
    });

    it("list returns thread root bumped to top after reply", async () => {
      const oldPost = await postService.create({
        format: "note",
        bodyMarkdown: "old thread root",
        publishedAt: 1000,
      });
      await postService.create({
        format: "note",
        bodyMarkdown: "newer standalone",
        publishedAt: 5000,
      });

      // Reply to old post with a newer timestamp — should bump it above standalone
      await postService.create({
        format: "note",
        bodyMarkdown: "reply",
        replyToId: oldPost.id,
        publishedAt: 9000,
      });

      const listed = await postService.list({ excludeReplies: true });
      expect(listed[0]?.bodyText).toBe("old thread root");
      expect(listed[1]?.bodyText).toBe("newer standalone");
    });

    it("recalculates root lastActivityAt when a reply is deleted", async () => {
      const root = await postService.create({
        format: "note",
        bodyMarkdown: "root",
        publishedAt: 1000,
      });
      const reply1 = await postService.create({
        format: "note",
        bodyMarkdown: "reply1",
        replyToId: root.id,
        publishedAt: 3000,
      });
      await postService.create({
        format: "note",
        bodyMarkdown: "reply2",
        replyToId: reply1.id,
        publishedAt: 5000,
      });

      // Root should be bumped to latest reply
      let updatedRoot = await postService.getById(root.id);
      expect(updatedRoot?.lastActivityAt).toBe(5000);

      // Delete the latest reply — root should fall back to reply1's time
      const reply2 = (await postService.list({ threadId: root.id })).find(
        (p) => p.bodyText === "reply2",
      );
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- test setup guarantees reply2 exists
      await postService.delete(reply2!.id);

      updatedRoot = await postService.getById(root.id);
      expect(updatedRoot?.lastActivityAt).toBe(3000);

      // Delete the remaining reply — root should fall back to its own publishedAt
      await postService.delete(reply1.id);

      updatedRoot = await postService.getById(root.id);
      expect(updatedRoot?.lastActivityAt).toBe(1000);
    });
  });

  describe("reindexBodyText", () => {
    function bodyWithLink(text: string, href: string): string {
      return JSON.stringify({
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              {
                type: "text",
                text,
                marks: [{ type: "link", attrs: { href } }],
              },
            ],
          },
        ],
      });
    }

    it("recomputes body_text and updates only rows that differ", async () => {
      const post = await postService.create({
        format: "note",
        body: bodyWithLink("docs", "https://rebuild.example/page"),
      });

      // Simulate the pre-fix state by stripping URLs from body_text directly.
      await db
        .update(posts)
        .set({ bodyText: "docs" })
        .where(eq(posts.id, post.id));

      const firstPass = await postService.reindexBodyText();
      expect(firstPass.processed).toBe(1);
      expect(firstPass.updated).toBe(1);
      expect(firstPass.skipped).toBe(0);
      expect(firstPass.done).toBe(true);
      expect(firstPass.nextCursor).toBeNull();

      const reindexed = await postService.getById(post.id);
      expect(reindexed?.bodyText).toContain("rebuild.example");

      // Idempotent: re-running immediately should be a no-op.
      const secondPass = await postService.reindexBodyText();
      expect(secondPass.updated).toBe(0);
      expect(secondPass.skipped).toBe(1);
      expect(secondPass.done).toBe(true);
    });

    it("skips soft-deleted posts", async () => {
      const live = await postService.create({
        format: "note",
        body: bodyWithLink("a", "https://live.example"),
      });
      const gone = await postService.create({
        format: "note",
        body: bodyWithLink("b", "https://gone.example"),
      });

      // Strip body_text on both to force an update on the next pass.
      await db
        .update(posts)
        .set({ bodyText: "a" })
        .where(eq(posts.id, live.id));
      await db
        .update(posts)
        .set({ bodyText: "b" })
        .where(eq(posts.id, gone.id));
      await postService.delete(gone.id);

      const result = await postService.reindexBodyText();
      expect(result.processed).toBe(1);
      expect(result.updated).toBe(1);
      expect(result.done).toBe(true);
    });

    it("paginates with cursor when more posts remain", async () => {
      for (let i = 0; i < 3; i++) {
        await postService.create({
          format: "note",
          body: bodyWithLink(`p${i}`, `https://p${i}.example`),
        });
      }

      const first = await postService.reindexBodyText({ limit: 2 });
      expect(first.processed).toBe(2);
      expect(first.done).toBe(false);
      expect(first.nextCursor).not.toBeNull();

      const second = await postService.reindexBodyText({
        limit: 2,
        cursor: first.nextCursor ?? undefined,
      });
      expect(second.processed).toBe(1);
      expect(second.done).toBe(true);
      expect(second.nextCursor).toBeNull();
    });
  });

  describe("rebuildBodyHtml", () => {
    async function createFootnotePost(label: string) {
      return postService.create({
        format: "note",
        bodyMarkdown: `Body ${label}[^1]\n\n[^1]: Definition ${label}`,
      });
    }

    function legacyFootnoteBody(): string {
      return JSON.stringify({
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              { type: "text", text: "Body " },
              {
                type: "text",
                text: "[1]",
                marks: [{ type: "link", attrs: { href: "#fn-1" } }],
              },
            ],
          },
          { type: "horizontalRule" },
          {
            type: "orderedList",
            content: [
              {
                type: "listItem",
                content: [
                  {
                    type: "paragraph",
                    content: [
                      { type: "text", text: "Definition " },
                      {
                        type: "text",
                        text: "↩︎",
                        marks: [{ type: "link", attrs: { href: "#fnref-1" } }],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      });
    }

    it("resolves stale stored HTML on reads before the rebuild writes", async () => {
      const post = await createFootnotePost("stale");
      await db
        .update(posts)
        .set({
          bodyHtml: '<span class="sidenote">legacy</span>',
          bodyHtmlVersion: 1,
        })
        .where(eq(posts.id, post.id));

      const resolved = await postService.getById(post.id);
      expect(resolved?.bodyHtml).toContain('role="doc-noteref"');
      expect(resolved?.bodyHtml).toContain('role="doc-endnotes"');
      expect(resolved?.bodyHtml).not.toContain("legacy");

      const stored = await db
        .select({ bodyHtml: posts.bodyHtml })
        .from(posts)
        .where(eq(posts.id, post.id))
        .limit(1);
      expect(stored[0]?.bodyHtml).toContain("legacy");
    });

    it("supports dry-run, preserves timestamps, and is idempotent", async () => {
      const post = await createFootnotePost("rebuild");
      await db
        .update(posts)
        .set({
          bodyHtml: '<span class="sidenote">legacy</span>',
          bodyHtmlVersion: 1,
        })
        .where(eq(posts.id, post.id));

      const before = await db
        .select({
          updatedAt: posts.updatedAt,
          publishedAt: posts.publishedAt,
        })
        .from(posts)
        .where(eq(posts.id, post.id))
        .limit(1);

      const dryRun = await postService.rebuildBodyHtml({ dryRun: true });
      expect(dryRun).toMatchObject({
        processed: 1,
        wouldRebuild: 1,
        rebuilt: 0,
        skipped: 0,
        conflicted: 0,
        failed: 0,
        done: true,
        targetVersion: POST_BODY_HTML_VERSION,
      });

      const firstPass = await postService.rebuildBodyHtml();
      expect(firstPass).toMatchObject({
        wouldRebuild: 1,
        rebuilt: 1,
        failed: 0,
      });

      const stored = await db
        .select({
          bodyHtml: posts.bodyHtml,
          bodyHtmlVersion: posts.bodyHtmlVersion,
          updatedAt: posts.updatedAt,
          publishedAt: posts.publishedAt,
        })
        .from(posts)
        .where(eq(posts.id, post.id))
        .limit(1);
      expect(stored[0]?.bodyHtmlVersion).toBe(POST_BODY_HTML_VERSION);
      expect(stored[0]?.bodyHtml).toContain('role="doc-endnotes"');
      expect(stored[0]?.updatedAt).toBe(before[0]?.updatedAt);
      expect(stored[0]?.publishedAt).toBe(before[0]?.publishedAt);

      const secondPass = await postService.rebuildBodyHtml();
      expect(secondPass).toMatchObject({
        wouldRebuild: 0,
        rebuilt: 0,
        skipped: 1,
        failed: 0,
      });
    });

    it("atomically upgrades historical generic footnotes and their projections", async () => {
      const post = await postService.create({
        format: "note",
        title: "Legacy",
        bodyMarkdown: "Placeholder",
      });
      const legacyBody = legacyFootnoteBody();
      await db
        .update(posts)
        .set({
          body: legacyBody,
          bodyHtml:
            '<p>Body <a href="#fn-1">[1]</a></p><hr><ol><li><p>Definition <a href="#fnref-1">↩︎</a></p></li></ol>',
          bodyHtmlVersion: 3,
          bodyText: "Body [1] #fn-1 Definition ↩︎ #fnref-1",
          summary: "Body [1]\n\nDefinition ↩︎",
        })
        .where(eq(posts.id, post.id));
      const before = await db
        .select({ updatedAt: posts.updatedAt, body: posts.body })
        .from(posts)
        .where(eq(posts.id, post.id))
        .limit(1);

      const dryRun = await postService.rebuildBodyHtml({
        dryRun: true,
        summaryConfig: { maxParagraphs: 5, maxChars: 500 },
      });
      expect(dryRun).toMatchObject({
        wouldRebuild: 1,
        rebuilt: 0,
        wouldUpgradeFootnotes: 1,
        upgradedFootnotes: 0,
        failed: 0,
      });
      expect(
        await db
          .select({ body: posts.body })
          .from(posts)
          .where(eq(posts.id, post.id))
          .limit(1),
      ).toEqual([{ body: legacyBody }]);

      const result = await postService.rebuildBodyHtml({
        summaryConfig: { maxParagraphs: 5, maxChars: 500 },
      });
      expect(result).toMatchObject({
        rebuilt: 1,
        wouldUpgradeFootnotes: 1,
        upgradedFootnotes: 1,
        conflicted: 0,
        failed: 0,
      });

      const stored = await db
        .select({
          body: posts.body,
          bodyHtml: posts.bodyHtml,
          bodyHtmlVersion: posts.bodyHtmlVersion,
          bodyText: posts.bodyText,
          summary: posts.summary,
          updatedAt: posts.updatedAt,
        })
        .from(posts)
        .where(eq(posts.id, post.id))
        .limit(1);
      expect(stored[0]?.body).toContain('"type":"footnoteReference"');
      expect(stored[0]?.body).toContain('"type":"footnoteDefinition"');
      expect(stored[0]?.bodyHtml).toContain('role="doc-noteref"');
      expect(stored[0]?.bodyHtml).toContain('role="doc-endnotes"');
      expect(stored[0]?.bodyText).toBe("Body Definition");
      expect(stored[0]?.summary).toBe("Body");
      expect(stored[0]?.bodyHtmlVersion).toBe(POST_BODY_HTML_VERSION);
      expect(stored[0]?.updatedAt).toBe(before[0]?.updatedAt);

      await expect(postService.rebuildBodyHtml()).resolves.toMatchObject({
        wouldRebuild: 0,
        wouldUpgradeFootnotes: 0,
        upgradedFootnotes: 0,
        skipped: 1,
      });
    });

    it("reports malformed canonical bodies without marking them current", async () => {
      const post = await createFootnotePost("invalid");
      await db
        .update(posts)
        .set({
          body: "not json",
          bodyHtml: "<p>legacy fallback</p>",
          bodyHtmlVersion: 1,
        })
        .where(eq(posts.id, post.id));

      const result = await postService.rebuildBodyHtml();
      expect(result.failed).toBe(1);
      expect(result.failures[0]?.postId).toBe(post.id);
      expect(result.rebuilt).toBe(0);

      const stored = await db
        .select({
          bodyHtml: posts.bodyHtml,
          bodyHtmlVersion: posts.bodyHtmlVersion,
        })
        .from(posts)
        .where(eq(posts.id, post.id))
        .limit(1);
      expect(stored[0]).toEqual({
        bodyHtml: "<p>legacy fallback</p>",
        bodyHtmlVersion: 1,
      });
      expect((await postService.getById(post.id))?.bodyHtml).toBe(
        "<p>legacy fallback</p>",
      );
    });

    it("paginates deterministically", async () => {
      const created = [];
      for (const label of ["one", "two", "three"]) {
        created.push(await createFootnotePost(label));
      }
      await db
        .update(posts)
        .set({ bodyHtmlVersion: 1 })
        .where(eq(posts.siteId, DEFAULT_TEST_SITE_ID));

      const first = await postService.rebuildBodyHtml({ limit: 2 });
      expect(first.processed).toBe(2);
      expect(first.done).toBe(false);
      expect(first.nextCursor).not.toBeNull();

      const second = await postService.rebuildBodyHtml({
        limit: 2,
        cursor: first.nextCursor ?? undefined,
      });
      expect(second.processed).toBe(1);
      expect(second.done).toBe(true);
      expect(first.rebuilt + second.rebuilt).toBe(created.length);
    });

    it("lets a concurrent canonical-body edit win the compare-and-swap", async () => {
      const post = await createFootnotePost("conflict");
      await db
        .update(posts)
        .set({ bodyHtmlVersion: 1 })
        .where(eq(posts.id, post.id));

      const concurrentBody = JSON.stringify({
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "Concurrent edit" }],
          },
        ],
      });
      let injected = false;
      const conflictDb = new Proxy(db, {
        get(target, property, receiver) {
          if (property === "update") {
            return (...args: Parameters<Database["update"]>) => {
              if (!injected) {
                injected = true;
                sqlite
                  .prepare("UPDATE post SET body = ? WHERE id = ?")
                  .run(concurrentBody, post.id);
              }
              return target.update(...args);
            };
          }

          const value = Reflect.get(target, property, receiver) as unknown;
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
      const conflictService = createPostService(
        conflictDb,
        { slugIdLength: 5 },
        DEFAULT_TEST_SITE_ID,
      );

      const result = await conflictService.rebuildBodyHtml();

      expect(result).toMatchObject({ rebuilt: 0, conflicted: 1 });
      const stored = await db
        .select({ body: posts.body, version: posts.bodyHtmlVersion })
        .from(posts)
        .where(eq(posts.id, post.id))
        .limit(1);
      expect(stored[0]).toEqual({ body: concurrentBody, version: 1 });
    });

    it("never widens a rebuild to another site", async () => {
      const defaultPost = await createFootnotePost("default");
      const secondSiteId = "sit_second000000000000000000000";
      const timestamp = Math.floor(Date.now() / 1000);
      await db.insert(sites).values({
        id: secondSiteId,
        key: "second",
        status: "active",
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      const secondService = createPostService(
        db,
        { slugIdLength: 5 },
        secondSiteId,
      );
      const secondPost = await secondService.create({
        format: "note",
        bodyMarkdown: "Second[^1]\n\n[^1]: Other site",
      });
      await db
        .update(posts)
        .set({ bodyHtmlVersion: 1 })
        .where(eq(posts.id, defaultPost.id));
      await db
        .update(posts)
        .set({ bodyHtmlVersion: 1 })
        .where(eq(posts.id, secondPost.id));

      const result = await postService.rebuildBodyHtml();
      expect(result.processed).toBe(1);

      const rows = await db
        .select({ id: posts.id, version: posts.bodyHtmlVersion })
        .from(posts);
      expect(rows.find((row) => row.id === defaultPost.id)?.version).toBe(
        POST_BODY_HTML_VERSION,
      );
      expect(rows.find((row) => row.id === secondPost.id)?.version).toBe(1);
    });
  });

  describe("listForSitemap", () => {
    it("returns published non-reply non-private non-deleted posts", async () => {
      const root = await postService.create({
        format: "note",
        bodyMarkdown: "root",
        status: "published",
      });
      await postService.create({
        format: "note",
        bodyMarkdown: "reply",
        replyToId: root.id,
        status: "published",
      });
      await postService.create({
        format: "note",
        bodyMarkdown: "private",
        visibility: "private",
        status: "published",
      });
      await postService.create({
        format: "note",
        bodyMarkdown: "draft",
        status: "draft",
      });
      await postService.create({
        format: "note",
        bodyMarkdown: "latest hidden",
        visibility: "latest_hidden",
        status: "published",
      });

      const entries = await postService.listForSitemap({ limit: 100 });
      const ids = entries.map((e) => e.id);
      // Root post and latest_hidden post should be included; reply/private/draft excluded.
      expect(ids).toHaveLength(2);
      expect(ids).toContain(root.id);
    });

    it("returns entries in ascending id order", async () => {
      const created: string[] = [];
      for (let i = 0; i < 5; i++) {
        const post = await postService.create({
          format: "note",
          bodyMarkdown: `post ${i}`,
          status: "published",
        });
        created.push(post.id);
      }

      const entries = await postService.listForSitemap({ limit: 100 });
      const ids = entries.map((e) => e.id);
      // TypeIDs embed a UUIDv7 timestamp, so creation order == ascending id.
      expect(ids).toEqual([...ids].sort());
      expect(ids).toEqual(created);
    });

    it("respects afterId as an exclusive cursor", async () => {
      const posts = [];
      for (let i = 0; i < 5; i++) {
        posts.push(
          await postService.create({
            format: "note",
            bodyMarkdown: `post ${i}`,
            status: "published",
          }),
        );
      }

      const firstPage = await postService.listForSitemap({ limit: 2 });
      expect(firstPage).toHaveLength(2);

      const cursor = firstPage[firstPage.length - 1]?.id;
      const secondPage = await postService.listForSitemap({
        afterId: cursor,
        limit: 2,
      });
      expect(secondPage.map((e) => e.id)).toEqual([posts[2]?.id, posts[3]?.id]);

      const thirdPage = await postService.listForSitemap({
        afterId: secondPage[secondPage.length - 1]?.id,
        limit: 2,
      });
      expect(thirdPage.map((e) => e.id)).toEqual([posts[4]?.id]);
    });

    it("countForSitemap matches listForSitemap without a cursor", async () => {
      for (let i = 0; i < 3; i++) {
        await postService.create({
          format: "note",
          bodyMarkdown: `p${i}`,
          status: "published",
        });
      }
      await postService.create({
        format: "note",
        bodyMarkdown: "private",
        visibility: "private",
        status: "published",
      });

      const count = await postService.countForSitemap();
      const entries = await postService.listForSitemap({ limit: 100 });
      expect(count).toBe(entries.length);
      expect(count).toBe(3);
    });
  });
});
