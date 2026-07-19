import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createTestApp } from "../../../../__tests__/helpers/app.js";
import { posts } from "../../../../db/schema.js";
import { publicPostsApiRoutes } from "../posts.js";

describe("Public Posts API Routes", () => {
  describe("GET /api/public/posts", () => {
    it("returns published public root posts without authentication", async () => {
      const { app, services } = createTestApp({ authenticated: false });
      app.route("/api/public/posts", publicPostsApiRoutes);

      const publicRoot = await services.posts.create({
        format: "note",
        title: "Public root",
        bodyMarkdown: "visible root",
      });

      await services.posts.create({
        format: "note",
        title: "Latest hidden root",
        bodyMarkdown: "hidden from latest",
        visibility: "latest_hidden",
      });
      await services.posts.create({
        format: "note",
        title: "Private root",
        bodyMarkdown: "private root",
        visibility: "private",
      });
      await services.posts.create({
        format: "note",
        title: "Draft root",
        bodyMarkdown: "draft root",
        status: "draft",
      });
      await services.posts.create({
        format: "note",
        bodyMarkdown: "public reply",
        replyToId: publicRoot.id,
      });

      const res = await app.request("/api/public/posts");
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.nextCursor).toBeNull();
      expect(body.posts).toHaveLength(1);
      expect(body.posts[0].slug).toBe(publicRoot.slug);
      expect(body.posts[0].title).toBe("Public root");
      expect(body.posts[0].status).toBe("published");
      expect(body.posts[0].visibility).toBe("public");
      expect(body.posts[0]).not.toHaveProperty("body");
    });

    it("supports format and limit filters", async () => {
      const { app, services } = createTestApp({ authenticated: false });
      app.route("/api/public/posts", publicPostsApiRoutes);

      await services.posts.create({
        format: "note",
        title: "Note one",
        bodyMarkdown: "first note",
      });
      await services.posts.create({
        format: "note",
        title: "Note two",
        bodyMarkdown: "second note",
      });
      await services.posts.create({
        format: "link",
        title: "Example",
        url: "https://example.com",
      });

      const res = await app.request("/api/public/posts?format=note&limit=1");
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.posts).toHaveLength(1);
      expect(body.posts[0].format).toBe("note");
      expect(body.nextCursor).toBeTruthy();
    });

    it("returns markdown instead of rendered fields when content=markdown", async () => {
      const { app, services } = createTestApp({ authenticated: false });
      app.route("/api/public/posts", publicPostsApiRoutes);

      await services.posts.create({
        format: "note",
        title: "Markdown post",
        bodyMarkdown: "# Hello\n\nBody text",
      });

      const res = await app.request("/api/public/posts?content=markdown");
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.posts).toHaveLength(1);
      expect(body.posts[0].bodyMarkdown).toBe("# Hello\n\nBody text");
      expect(body.posts[0]).not.toHaveProperty("bodyHtml");
      expect(body.posts[0]).not.toHaveProperty("bodyText");
    });

    it("returns canonical v3 HTML when the stored projection is stale", async () => {
      const { app, services, db } = createTestApp({ authenticated: false });
      app.route("/api/public/posts", publicPostsApiRoutes);
      const post = await services.posts.create({
        format: "note",
        title: "Footnote API",
        bodyMarkdown: "API body[^1]\n\n[^1]: API definition",
      });
      await db
        .update(posts)
        .set({
          bodyHtml: '<span class="sidenote">legacy</span>',
          bodyHtmlVersion: 1,
        })
        .where(eq(posts.id, post.id));

      const response = await app.request("/api/public/posts");
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.posts[0].bodyHtml).toContain('role="doc-noteref"');
      expect(body.posts[0].bodyHtml).toMatch(/id="fn-[a-z0-9]{13}-1"/);
      expect(body.posts[0].bodyHtml).not.toContain(post.id);
      expect(body.posts[0].bodyHtml).not.toContain("legacy");
    });

    it("filters posts by a single collection slug", async () => {
      const { app, services } = createTestApp({ authenticated: false });
      app.route("/api/public/posts", publicPostsApiRoutes);

      const collection = await services.collections.create({
        slug: "design",
        title: "Design",
      });
      const inCollection = await services.posts.create({
        format: "note",
        title: "Design post",
        bodyMarkdown: "in collection",
        collectionIds: [collection.id],
      });
      await services.posts.create({
        format: "note",
        title: "Other post",
        bodyMarkdown: "not in collection",
      });

      const res = await app.request("/api/public/posts?collection=design");
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.posts).toHaveLength(1);
      expect(body.posts[0].id).toBe(inCollection.id);
    });

    it("filters posts by multiple collection slugs (aggregate)", async () => {
      const { app, services } = createTestApp({ authenticated: false });
      app.route("/api/public/posts", publicPostsApiRoutes);

      const col1 = await services.collections.create({
        slug: "tech",
        title: "Tech",
      });
      const col2 = await services.collections.create({
        slug: "art",
        title: "Art",
      });
      const techPost = await services.posts.create({
        format: "note",
        title: "Tech post",
        bodyMarkdown: "tech",
        collectionIds: [col1.id],
      });
      const artPost = await services.posts.create({
        format: "note",
        title: "Art post",
        bodyMarkdown: "art",
        collectionIds: [col2.id],
      });
      await services.posts.create({
        format: "note",
        title: "Unrelated",
        bodyMarkdown: "neither",
      });

      const res = await app.request("/api/public/posts?collection=tech,art");
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.posts).toHaveLength(2);
      const ids = body.posts.map((p: { id: string }) => p.id);
      expect(ids).toContain(techPost.id);
      expect(ids).toContain(artPost.id);
    });

    it("returns empty array for unknown collection slug", async () => {
      const { app } = createTestApp({ authenticated: false });
      app.route("/api/public/posts", publicPostsApiRoutes);

      const res = await app.request("/api/public/posts?collection=nonexistent");
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.posts).toHaveLength(0);
      expect(body.nextCursor).toBeNull();
    });

    it("respects collection sort order (oldest)", async () => {
      const { app, services } = createTestApp({ authenticated: false });
      app.route("/api/public/posts", publicPostsApiRoutes);

      const collection = await services.collections.create({
        slug: "chronological",
        title: "Chronological",
        sortOrder: "oldest",
      });
      const older = await services.posts.create({
        format: "note",
        title: "Older",
        bodyMarkdown: "first",
        collectionIds: [collection.id],
        publishedAt: 1000,
      });
      const newer = await services.posts.create({
        format: "note",
        title: "Newer",
        bodyMarkdown: "second",
        collectionIds: [collection.id],
        publishedAt: 2000,
      });
      await services.posts.create({
        format: "note",
        bodyMarkdown: "Later reply to the older Thread",
        replyToId: older.id,
        publishedAt: 3000,
      });

      const res = await app.request(
        "/api/public/posts?collection=chronological",
      );
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.posts).toHaveLength(2);
      expect(body.posts[0].id).toBe(older.id);
      expect(body.posts[1].id).toBe(newer.id);
    });

    it("sorts collection results by Thread activity from Child Posts", async () => {
      const { app, services } = createTestApp({ authenticated: false });
      app.route("/api/public/posts", publicPostsApiRoutes);

      const collection = await services.collections.create({
        slug: "active-threads",
        title: "Active Threads",
      });
      const olderRoot = await services.posts.create({
        format: "note",
        title: "Older root",
        bodyMarkdown: "older",
        collectionIds: [collection.id],
        publishedAt: 1000,
      });
      const newerRoot = await services.posts.create({
        format: "note",
        title: "Newer root",
        bodyMarkdown: "newer",
        collectionIds: [collection.id],
        publishedAt: 2000,
      });
      await services.posts.create({
        format: "note",
        bodyMarkdown: "new activity",
        replyToId: olderRoot.id,
        publishedAt: 3000,
      });

      const res = await app.request(
        "/api/public/posts?collection=active-threads&sort=newest",
      );
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.posts.map((post: { id: string }) => post.id)).toEqual([
        olderRoot.id,
        newerRoot.id,
      ]);
    });

    it("sorts and cursor-paginates collection Threads by Child ratings", async () => {
      const { app, services } = createTestApp({ authenticated: false });
      app.route("/api/public/posts", publicPostsApiRoutes);

      const collection = await services.collections.create({
        slug: "rated-threads",
        title: "Rated Threads",
        sortOrder: "rating_desc",
      });
      const createRatedThread = async (
        title: string,
        publishedAt: number,
        rating: number,
      ) => {
        const root = await services.posts.create({
          format: "note",
          title,
          bodyMarkdown: `${title} root`,
          collectionIds: [collection.id],
          publishedAt,
        });
        await services.posts.create({
          format: "note",
          bodyMarkdown: `${title} rated Child`,
          replyToId: root.id,
          publishedAt: publishedAt + 100,
          rating,
        });
        return root;
      };

      const highest = await createRatedThread("Highest", 1000, 5);
      const middle = await createRatedThread("Middle", 2000, 3);
      const lowest = await createRatedThread("Lowest", 3000, 1);

      const firstRes = await app.request(
        "/api/public/posts?collection=rated-threads&limit=1",
      );
      expect(firstRes.status).toBe(200);
      const first = await firstRes.json();
      expect(first.posts[0].id).toBe(highest.id);
      expect(first.nextCursor).toBe(highest.id);

      const secondRes = await app.request(
        `/api/public/posts?collection=rated-threads&limit=1&cursor=${first.nextCursor}`,
      );
      expect(secondRes.status).toBe(200);
      const second = await secondRes.json();
      expect(second.posts[0].id).toBe(middle.id);
      expect(second.nextCursor).toBe(middle.id);

      const thirdRes = await app.request(
        `/api/public/posts?collection=rated-threads&limit=1&cursor=${second.nextCursor}`,
      );
      expect(thirdRes.status).toBe(200);
      const third = await thirdRes.json();
      expect(third.posts[0].id).toBe(lowest.id);
    });

    it("keeps root format and Latest visibility filters for Collections", async () => {
      const { app, services } = createTestApp({ authenticated: false });
      app.route("/api/public/posts", publicPostsApiRoutes);

      const collection = await services.collections.create({
        slug: "mixed",
        title: "Mixed",
      });
      const note = await services.posts.create({
        format: "note",
        title: "Visible note",
        bodyMarkdown: "note",
        collectionIds: [collection.id],
      });
      await services.posts.create({
        format: "link",
        title: "Visible link",
        url: "https://example.com",
        collectionIds: [collection.id],
      });
      await services.posts.create({
        format: "note",
        title: "Hidden note",
        bodyMarkdown: "hidden",
        visibility: "latest_hidden",
        collectionIds: [collection.id],
      });

      const res = await app.request(
        "/api/public/posts?collection=mixed&format=note",
      );
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.posts.map((post: { id: string }) => post.id)).toEqual([
        note.id,
      ]);
    });

    it("allows overriding collection sort order via sort parameter", async () => {
      const { app, services } = createTestApp({ authenticated: false });
      app.route("/api/public/posts", publicPostsApiRoutes);

      const collection = await services.collections.create({
        slug: "readings",
        title: "Readings",
        sortOrder: "oldest",
      });
      const older = await services.posts.create({
        format: "note",
        title: "Older",
        bodyMarkdown: "first",
        collectionIds: [collection.id],
      });
      const newer = await services.posts.create({
        format: "note",
        title: "Newer",
        bodyMarkdown: "second",
        collectionIds: [collection.id],
      });

      const res = await app.request(
        "/api/public/posts?collection=readings&sort=newest",
      );
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.posts).toHaveLength(2);
      expect(body.posts[0].id).toBe(newer.id);
      expect(body.posts[1].id).toBe(older.id);
    });
  });

  describe("GET /api/public/posts/:slug", () => {
    it("returns a public post by slug without authentication", async () => {
      const { app, services } = createTestApp({ authenticated: false });
      app.route("/api/public/posts", publicPostsApiRoutes);

      const collection = await services.collections.create({
        slug: "reading",
        title: "Reading",
      });
      const post = await services.posts.create({
        format: "note",
        title: "Public post",
        bodyMarkdown: "public body",
        collectionIds: [collection.id],
      });

      const res = await app.request(`/api/public/posts/${post.slug}`);
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.id).toBe(post.id);
      expect(body.slug).toBe(post.slug);
      expect(body.permalink).toBe(`/${post.slug}`);
      expect(body.collections).toEqual([
        {
          id: collection.id,
          slug: "reading",
          title: "Reading",
          url: "/reading",
        },
      ]);
      expect(body.bodyHtml).toContain("public body");
      expect(body).not.toHaveProperty("body");
    });

    it("returns the shared Thread Collections for a child post", async () => {
      const { app, services } = createTestApp({ authenticated: false });
      app.route("/api/public/posts", publicPostsApiRoutes);

      const collection = await services.collections.create({
        slug: "shared",
        title: "Shared",
      });
      const root = await services.posts.create({
        format: "note",
        bodyMarkdown: "root",
        collectionIds: [collection.id],
      });
      const child = await services.posts.create({
        format: "note",
        bodyMarkdown: "child",
        replyToId: root.id,
      });

      const res = await app.request(`/api/public/posts/${child.slug}`);
      expect(res.status).toBe(200);
      await expect(res.json()).resolves.toMatchObject({
        id: child.id,
        collections: [
          {
            id: collection.id,
            slug: "shared",
            title: "Shared",
          },
        ],
      });
    });

    it("returns markdown instead of rendered fields when content=markdown", async () => {
      const { app, services } = createTestApp({ authenticated: false });
      app.route("/api/public/posts", publicPostsApiRoutes);

      const post = await services.posts.create({
        format: "note",
        title: "Markdown detail",
        bodyMarkdown: "Line 1\n\nLine 2",
      });

      const res = await app.request(
        `/api/public/posts/${post.slug}?content=markdown`,
      );
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.bodyMarkdown).toBe("Line 1\n\nLine 2");
      expect(body).not.toHaveProperty("bodyHtml");
      expect(body).not.toHaveProperty("bodyText");
    });

    it("returns quote attribution as sourceName/sourceUrl", async () => {
      const { app, services } = createTestApp({ authenticated: false });
      app.route("/api/public/posts", publicPostsApiRoutes);

      const post = await services.posts.create({
        format: "quote",
        title: "Marcus Aurelius",
        url: "https://example.com/meditations",
        quoteText: "What stands in the way becomes the way.",
      });

      const res = await app.request(`/api/public/posts/${post.slug}`);
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.format).toBe("quote");
      expect(body.sourceName).toBe("Marcus Aurelius");
      expect(body.sourceUrl).toBe("https://example.com/meditations");
      expect(body).not.toHaveProperty("title");
      expect(body).not.toHaveProperty("url");
    });

    it("returns latest_hidden posts for direct reads", async () => {
      const { app, services } = createTestApp({ authenticated: false });
      app.route("/api/public/posts", publicPostsApiRoutes);

      const post = await services.posts.create({
        format: "note",
        title: "Hidden from latest",
        bodyMarkdown: "still public by permalink",
        visibility: "latest_hidden",
      });

      const res = await app.request(`/api/public/posts/${post.slug}`);
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.visibility).toBe("latest_hidden");
      expect(body.slug).toBe(post.slug);
    });

    it("returns 404 for draft or private posts", async () => {
      const { app, services } = createTestApp({ authenticated: false });
      app.route("/api/public/posts", publicPostsApiRoutes);

      const draft = await services.posts.create({
        format: "note",
        title: "Draft",
        bodyMarkdown: "draft body",
        status: "draft",
      });
      const privatePost = await services.posts.create({
        format: "note",
        title: "Private",
        bodyMarkdown: "private body",
        visibility: "private",
      });

      await expect(
        app.request(`/api/public/posts/${draft.slug}`),
      ).resolves.toMatchObject({ status: 404 });
      await expect(
        app.request(`/api/public/posts/${privatePost.slug}`),
      ).resolves.toMatchObject({ status: 404 });
    });
  });
});
