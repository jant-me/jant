import { describe, it, expect } from "vitest";
import { createTestApp } from "../../../__tests__/helpers/app.js";
import { walkPostPages } from "../../../__tests__/helpers/cursor-walk.js";
import { createEntityId } from "../../../lib/ids.js";
import { postsApiRoutes } from "../posts.js";

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

describe("Posts API Routes", () => {
  describe("GET /api/posts", () => {
    it("returns 401 when not authenticated", async () => {
      const { app } = createTestApp({ authenticated: false });
      app.route("/api/posts", postsApiRoutes);

      const res = await app.request("/api/posts");
      expect(res.status).toBe(401);
    });

    it("returns empty list when no posts exist", async () => {
      const { app } = createTestApp({ authenticated: true });
      app.route("/api/posts", postsApiRoutes);

      const res = await app.request("/api/posts");
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.posts).toEqual([]);
      expect(body.nextCursor).toBeNull();
    });

    it("returns posts with IDs", async () => {
      const { app, services } = createTestApp({ authenticated: true });
      app.route("/api/posts", postsApiRoutes);

      await services.posts.create({
        format: "note",
        bodyMarkdown: "Hello world",
      });

      const res = await app.request("/api/posts");
      const body = await res.json();

      expect(body.posts).toHaveLength(1);
      expect(body.posts[0].bodyText).toBe("Hello world");
      expect(body.posts[0].id).toBeTruthy();
    });

    it("includes attachments in list response", async () => {
      const { app, services } = createTestApp({ authenticated: true });
      app.route("/api/posts", postsApiRoutes);

      const post = await services.posts.create({
        format: "note",
        bodyMarkdown: "with media",
      });

      const media = await services.media.create({
        filename: "test.jpg",
        originalName: "test.jpg",
        mimeType: "image/jpeg",
        size: 1024,
        storageKey: "media/test.jpg",
        width: 800,
        height: 600,
      });

      await services.media.attachToPost(post.id, [media.id]);

      const res = await app.request("/api/posts");
      const body = await res.json();

      expect(body.posts[0].attachments).toHaveLength(1);
      expect(body.posts[0].attachments[0].id).toBe(media.id);
      expect(body.posts[0].attachments[0].type).toBe("media");
      expect(body.posts[0].attachments[0].mimeType).toBe("image/jpeg");
      expect(body.posts[0].attachments[0].url).toBeTruthy();
      expect(body.posts[0].attachments[0].previewUrl).toBeTruthy();
    });

    it("filters by status", async () => {
      const { app, services } = createTestApp({ authenticated: true });
      app.route("/api/posts", postsApiRoutes);

      await services.posts.create({
        format: "note",
        bodyMarkdown: "published post",
      });
      await services.posts.create({
        format: "note",
        bodyMarkdown: "draft post",
        status: "draft",
      });

      const res = await app.request("/api/posts?status=draft");
      const body = await res.json();

      expect(body.posts).toHaveLength(1);
      expect(body.posts[0].status).toBe("draft");
    });

    it("supports limit parameter", async () => {
      const { app, services } = createTestApp({ authenticated: true });
      app.route("/api/posts", postsApiRoutes);

      for (let i = 0; i < 5; i++) {
        await services.posts.create({
          format: "note",
          bodyMarkdown: `post ${i}`,
        });
      }

      const res = await app.request("/api/posts?limit=2");
      const body = await res.json();

      expect(body.posts).toHaveLength(2);
      expect(body.nextCursor).toBeTruthy();
    });

    it("pages published posts and drafts with an opaque cursor", async () => {
      const { app, services } = createTestApp({ authenticated: true });
      app.route("/api/posts", postsApiRoutes);

      const published = [];
      for (let i = 0; i < 5; i++) {
        published.push(
          await services.posts.create({
            format: "note",
            bodyMarkdown: `post ${i}`,
            publishedAt: 1000 + (i % 2), // Ties, broken by ID.
          }),
        );
      }
      const root = published[0];
      await services.posts.create({
        format: "note",
        bodyMarkdown: "reply",
        replyToId: root?.id,
        publishedAt: 900,
      });
      for (let i = 0; i < 3; i++) {
        await services.posts.create({
          format: "note",
          bodyMarkdown: `draft ${i}`,
          status: "draft",
        });
      }

      for (const path of ["/api/posts", "/api/posts?status=draft"]) {
        const res = await app.request(path);
        const expected = (await res.json()).posts.map(
          (post: { id: string }) => post.id,
        );
        expect(expected.length).toBeGreaterThan(2);
        for (const limit of [1, 2]) {
          expect(await walkPostPages(app, path, limit)).toEqual(expected);
        }
      }

      const first = await (await app.request("/api/posts?limit=2")).json();
      expect(first.nextCursor).not.toMatch(/^pst_/);
    });

    it("reads a bare post ID as a cursor, and rejects one it can't use", async () => {
      const { app, services } = createTestApp({ authenticated: true });
      app.route("/api/posts", postsApiRoutes);

      const older = await services.posts.create({
        format: "note",
        bodyMarkdown: "older",
        publishedAt: 1000,
      });
      const newer = await services.posts.create({
        format: "note",
        bodyMarkdown: "newer",
        publishedAt: 2000,
      });
      const draft = await services.posts.create({
        format: "note",
        bodyMarkdown: "draft",
        status: "draft",
      });

      const legacy = await app.request(`/api/posts?cursor=${newer.id}`);
      expect(legacy.status).toBe(200);
      expect(
        (await legacy.json()).posts.map((post: { id: string }) => post.id),
      ).toEqual([older.id]);

      // A draft is not in the published list the cursor claims to continue.
      const wrongList = await app.request(`/api/posts?cursor=${draft.id}`);
      expect(wrongList.status).toBe(400);
      const unreadable = await app.request("/api/posts?cursor=nope");
      expect(unreadable.status).toBe(400);
      expect((await unreadable.json()).code).toBe("VALIDATION_ERROR");
    });

    // The failure this guards: ordered by thread activity with pins first, a
    // reply lifted a long-published root to the top — past a walk's cursor,
    // so the walk never returned it.
    it("orders published posts by publication alone", async () => {
      const { app, services } = createTestApp({ authenticated: true });
      app.route("/api/posts", postsApiRoutes);

      const root = await services.posts.create({
        format: "note",
        bodyMarkdown: "old root",
        publishedAt: 1000,
      });
      const pinned = await services.posts.create({
        format: "note",
        bodyMarkdown: "pinned",
        publishedAt: 2000,
        pinned: true,
      });
      const recent = await services.posts.create({
        format: "note",
        bodyMarkdown: "recent",
        publishedAt: 3000,
      });

      const first = await (await app.request("/api/posts?limit=1")).json();
      expect(first.posts[0].id).toBe(recent.id);
      const reply = await services.posts.create({
        format: "note",
        bodyMarkdown: "late reply",
        replyToId: root.id,
        publishedAt: 4000,
      });

      const rest = await walkPostPages(app, "/api/posts", 1, first.nextCursor);
      expect(rest).toEqual([pinned.id, root.id]);
      const all = await (await app.request("/api/posts")).json();
      expect(all.posts.map((post: { id: string }) => post.id)).toEqual([
        reply.id,
        recent.id,
        pinned.id,
        root.id,
      ]);
      expect(
        all.posts.map(
          (post: { threadPostCount: number }) => post.threadPostCount,
        ),
      ).toEqual([2, 1, 1, 2]);
    });

    it("keeps drafts in last-edited order", async () => {
      const { app, services } = createTestApp({ authenticated: true });
      app.route("/api/posts", postsApiRoutes);

      const first = await services.posts.create({
        format: "note",
        bodyMarkdown: "first",
        status: "draft",
        createdAt: 1000,
        updatedAt: 1000,
      });
      const second = await services.posts.create({
        format: "note",
        bodyMarkdown: "second",
        status: "draft",
        createdAt: 2000,
        updatedAt: 2000,
      });
      await services.posts.update(first.id, { bodyMarkdown: "edited" });

      const res = await app.request("/api/posts?status=draft");
      const body = await res.json();
      expect(body.posts.map((post: { id: string }) => post.id)).toEqual([
        first.id,
        second.id,
      ]);
      expect(body.posts[0].threadPostCount).toBe(0);
    });

    it("serializes quote attribution as sourceName/sourceUrl", async () => {
      const { app, services } = createTestApp({ authenticated: true });
      app.route("/api/posts", postsApiRoutes);

      await services.posts.create({
        format: "quote",
        title: "Marcus Aurelius",
        url: "https://example.com/meditations",
        quoteText: "What stands in the way becomes the way.",
      });

      const res = await app.request("/api/posts");
      const body = await res.json();

      expect(body.posts).toHaveLength(1);
      expect(body.posts[0].format).toBe("quote");
      expect(body.posts[0].sourceName).toBe("Marcus Aurelius");
      expect(body.posts[0].sourceUrl).toBe("https://example.com/meditations");
      expect(body.posts[0].quoteText).toBe(
        "What stands in the way becomes the way.",
      );
      expect(body.posts[0]).not.toHaveProperty("title");
      expect(body.posts[0]).not.toHaveProperty("url");
    });
  });

  describe("GET /api/posts/slug", () => {
    it("suggests a title-based slug", async () => {
      const { app } = createTestApp({ authenticated: true });
      app.route("/api/posts", postsApiRoutes);

      const res = await app.request(
        "/api/posts/slug?mode=suggest&title=Hello World",
      );
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.slug).toBe("hello-world");
    });

    it("adds a suffix when the base slug is already taken", async () => {
      const { app, services } = createTestApp({ authenticated: true });
      app.route("/api/posts", postsApiRoutes);

      await services.posts.create({
        format: "note",
        title: "Hello World",
        bodyMarkdown: "taken",
      });

      const res = await app.request(
        "/api/posts/slug?mode=suggest&title=Hello World",
      );
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.slug).toMatch(/^hello-world-[a-z0-9]{5}$/);
    });

    it("treats the current post slug as available when editing", async () => {
      const { app, services } = createTestApp({ authenticated: true });
      app.route("/api/posts", postsApiRoutes);

      const post = await services.posts.create({
        format: "note",
        title: "Hello World",
        bodyMarkdown: "hello",
      });

      const takenRes = await app.request(
        "/api/posts/slug?mode=check&slug=hello-world",
      );
      expect(takenRes.status).toBe(200);
      expect((await takenRes.json()).available).toBe(false);

      const ownRes = await app.request(
        `/api/posts/slug?mode=check&slug=hello-world&postId=${post.id}`,
      );
      expect(ownRes.status).toBe(200);
      expect((await ownRes.json()).available).toBe(true);
    });
  });

  describe("GET /api/posts/:id/content", () => {
    it("returns 401 when not authenticated", async () => {
      const { app, services } = createTestApp({ authenticated: false });
      app.route("/api/posts", postsApiRoutes);

      const post = await services.posts.create({
        format: "note",
        bodyMarkdown: "test post",
      });
      const res = await app.request(`/api/posts/${post.id}/content`);
      expect(res.status).toBe(401);
    });

    it("returns markdown for a note body", async () => {
      const { app, services } = createTestApp({ authenticated: true });
      app.route("/api/posts", postsApiRoutes);

      const post = await services.posts.create({
        format: "note",
        bodyMarkdown: "# Heading\n\nBody text",
      });

      const res = await app.request(`/api/posts/${post.id}/content`);
      expect(res.status).toBe(200);
      await expect(res.json()).resolves.toEqual({
        id: post.id,
        type: "post",
        format: "note",
        contentFormat: "markdown",
        content: "# Heading\n\nBody text",
        chars: 17,
      });
    });

    it("returns quote commentary without quoteText or source metadata", async () => {
      const { app, services } = createTestApp({ authenticated: true });
      app.route("/api/posts", postsApiRoutes);

      const post = await services.posts.create({
        format: "quote",
        title: "Marcus Aurelius",
        url: "https://example.com/meditations",
        quoteText: "What stands in the way becomes the way.",
        bodyMarkdown: "Short commentary",
      });

      const res = await app.request(`/api/posts/${post.id}/content`);
      expect(res.status).toBe(200);
      await expect(res.json()).resolves.toEqual({
        id: post.id,
        type: "post",
        format: "quote",
        contentFormat: "markdown",
        content: "Short commentary",
        chars: 16,
      });
    });

    it("returns empty markdown when a link has no commentary body", async () => {
      const { app, services } = createTestApp({ authenticated: true });
      app.route("/api/posts", postsApiRoutes);

      const post = await services.posts.create({
        format: "link",
        title: "Example",
        url: "https://example.com",
      });

      const res = await app.request(`/api/posts/${post.id}/content`);
      expect(res.status).toBe(200);
      await expect(res.json()).resolves.toEqual({
        id: post.id,
        type: "post",
        format: "link",
        contentFormat: "markdown",
        content: "",
        chars: 0,
      });
    });

    it("returns 404 for a non-existent post", async () => {
      const { app } = createTestApp({ authenticated: true });
      app.route("/api/posts", postsApiRoutes);
      const missingId = createEntityId("post");

      const res = await app.request(`/api/posts/${missingId}/content`);
      expect(res.status).toBe(404);
    });
  });

  describe("GET /api/posts/:id", () => {
    it("returns 401 when not authenticated", async () => {
      const { app, services } = createTestApp({ authenticated: false });
      app.route("/api/posts", postsApiRoutes);

      const post = await services.posts.create({
        format: "note",
        bodyMarkdown: "test post",
      });
      const res = await app.request(`/api/posts/${post.id}`);
      expect(res.status).toBe(401);
    });

    it("returns a post by ID", async () => {
      const { app, services } = createTestApp({ authenticated: true });
      app.route("/api/posts", postsApiRoutes);

      const post = await services.posts.create({
        format: "note",
        bodyMarkdown: "test post",
      });
      const res = await app.request(`/api/posts/${post.id}`);
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.bodyText).toBe("test post");
      expect(body.id).toBe(post.id);
    });

    it("includes attachments in single post response", async () => {
      const { app, services } = createTestApp({ authenticated: true });
      app.route("/api/posts", postsApiRoutes);

      const post = await services.posts.create({
        format: "note",
        bodyMarkdown: "with media",
      });

      const media = await services.media.create({
        filename: "test.jpg",
        originalName: "test.jpg",
        mimeType: "image/jpeg",
        size: 1024,
        storageKey: "media/test.jpg",
      });

      await services.media.attachToPost(post.id, [media.id]);

      const res = await app.request(`/api/posts/${post.id}`);
      const body = await res.json();

      expect(body.attachments).toHaveLength(1);
      expect(body.attachments[0].id).toBe(media.id);
      expect(body.attachments[0].type).toBe("media");
    });

    it("returns quote posts with sourceName/sourceUrl", async () => {
      const { app, services } = createTestApp({ authenticated: true });
      app.route("/api/posts", postsApiRoutes);

      const post = await services.posts.create({
        format: "quote",
        title: "Marcus Aurelius",
        url: "https://example.com/meditations",
        quoteText: "What stands in the way becomes the way.",
      });

      const res = await app.request(`/api/posts/${post.id}`);
      const body = await res.json();

      expect(body.sourceName).toBe("Marcus Aurelius");
      expect(body.sourceUrl).toBe("https://example.com/meditations");
      expect(body.quoteText).toBe("What stands in the way becomes the way.");
      expect(body).not.toHaveProperty("title");
      expect(body).not.toHaveProperty("url");
    });

    it("returns 400 for invalid ID", async () => {
      const { app } = createTestApp({ authenticated: true });
      app.route("/api/posts", postsApiRoutes);

      const res = await app.request("/api/posts/!!invalid!!");
      expect(res.status).toBe(400);
    });

    it("returns 404 for non-existent post", async () => {
      const { app } = createTestApp({ authenticated: true });
      app.route("/api/posts", postsApiRoutes);
      const missingId = createEntityId("post");

      const res = await app.request(`/api/posts/${missingId}`);
      expect(res.status).toBe(404);
    });
  });

  describe("POST /api/posts", () => {
    it("returns 401 when not authenticated", async () => {
      const { app } = createTestApp({ authenticated: false });
      app.route("/api/posts", postsApiRoutes);

      const res = await app.request("/api/posts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          format: "note",
          bodyMarkdown: "test",
        }),
      });

      expect(res.status).toBe(401);
    });

    it("creates a post when authenticated", async () => {
      const { app } = createTestApp({ authenticated: true });
      app.route("/api/posts", postsApiRoutes);

      const res = await app.request("/api/posts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          format: "note",
          bodyMarkdown: "Hello from API",
        }),
      });

      expect(res.status).toBe(201);

      const body = await res.json();
      expect(body.bodyText).toBe("Hello from API");
      expect(body.id).toBeTruthy();
      expect(body.attachments).toEqual([]);
    });

    it("keeps the creation and edit times a restore sends", async () => {
      const { app } = createTestApp({ authenticated: true });
      app.route("/api/posts", postsApiRoutes);

      const res = await app.request("/api/posts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          format: "note",
          bodyMarkdown: "Moved from another site",
          publishedAt: 1700000500,
          createdAt: 1700000000,
          updatedAt: 1700009000,
        }),
      });

      expect(res.status).toBe(201);
      expect(await res.json()).toMatchObject({
        publishedAt: 1700000500,
        createdAt: 1700000000,
        updatedAt: 1700009000,
      });
    });

    it("creates a post with bodyMarkdown", async () => {
      const { app } = createTestApp({ authenticated: true });
      app.route("/api/posts", postsApiRoutes);

      const res = await app.request("/api/posts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          format: "note",
          bodyMarkdown: "Hello **bold** world",
        }),
      });

      expect(res.status).toBe(201);

      const body = await res.json();
      expect(body.bodyText).toContain("Hello");
      expect(body.bodyHtml).toContain("<strong>bold</strong>");
    });

    it("treats single newlines in bodyMarkdown as paragraph whitespace", async () => {
      const { app } = createTestApp({ authenticated: true });
      app.route("/api/posts", postsApiRoutes);

      const res = await app.request("/api/posts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          format: "note",
          bodyMarkdown: "第一行\n第二行",
        }),
      });

      expect(res.status).toBe(201);

      const body = await res.json();
      expect(body.bodyHtml).toContain("<p>第一行\n第二行</p>");
      expect(body.bodyHtml).not.toContain("<br>");
    });

    it("preserves explicit hard breaks in bodyMarkdown", async () => {
      const { app } = createTestApp({ authenticated: true });
      app.route("/api/posts", postsApiRoutes);

      const res = await app.request("/api/posts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          format: "note",
          bodyMarkdown: "第一行  \n第二行",
        }),
      });

      expect(res.status).toBe(201);

      const body = await res.json();
      expect(body.bodyHtml).toContain("<p>第一行<br>第二行</p>");
    });

    it("returns 400 when both body and bodyMarkdown are provided", async () => {
      const { app } = createTestApp({ authenticated: true });
      app.route("/api/posts", postsApiRoutes);

      const res = await app.request("/api/posts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          format: "note",
          body: '{"type":"doc","content":[]}',
          bodyMarkdown: "Hello",
        }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain("Provide either body or bodyMarkdown");
    });

    it("creates a post with ordered attachments", async () => {
      const { app, services } = createTestApp({ authenticated: true });
      app.route("/api/posts", postsApiRoutes);

      const m1 = await services.media.create({
        filename: "a.jpg",
        originalName: "a.jpg",
        mimeType: "image/jpeg",
        size: 1024,
        storageKey: "media/a.jpg",
      });
      const m2 = await services.media.create({
        filename: "b.jpg",
        originalName: "b.jpg",
        mimeType: "image/jpeg",
        size: 2048,
        storageKey: "media/b.jpg",
      });

      const res = await app.request("/api/posts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          format: "note",
          bodyMarkdown: "with images",
          attachments: [
            { type: "media", mediaId: m1.id },
            { type: "media", mediaId: m2.id },
          ],
        }),
      });

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.attachments).toHaveLength(2);
      expect(body.attachments[0]).toMatchObject({
        type: "media",
        id: m1.id,
      });
      expect(body.attachments[1]).toMatchObject({
        type: "media",
        id: m2.id,
      });
    });

    it("returns 409 when replying to a post that is no longer the thread tail", async () => {
      const { app, services } = createTestApp({ authenticated: true });
      app.route("/api/posts", postsApiRoutes);

      const root = await services.posts.create({
        format: "note",
        bodyMarkdown: "root",
      });
      await services.posts.create({
        format: "note",
        bodyMarkdown: "reply 1",
        replyToId: root.id,
      });

      const res = await app.request("/api/posts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          format: "note",
          bodyMarkdown: "reply 2",
          replyToId: root.id,
        }),
      });

      expect(res.status).toBe(409);
      await expect(res.json()).resolves.toMatchObject({
        code: "CONFLICT",
        error:
          "This post is no longer the end of the thread. Reply to the latest post instead.",
      });
    });

    it("creates text attachments through the posts API", async () => {
      const storage = createMockStorage();
      const { app } = createTestApp({
        authenticated: true,
        storage,
      });
      app.route("/api/posts", postsApiRoutes);

      const res = await app.request("/api/posts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          format: "note",
          bodyMarkdown: "test",
          attachments: [
            {
              type: "text",
              contentFormat: "markdown",
              content: "# Attached\n\nHello text attachment",
            },
          ],
        }),
      });

      expect(res.status).toBe(201);

      const body = await res.json();
      expect(body.attachments).toEqual([
        expect.objectContaining({
          type: "text",
          contentFormat: "markdown",
          summary: "Attached Hello text attachment",
          chars: 30,
        }),
      ]);
      expect(body.attachments[0].contentUrl).toContain("/api/attachments/");
      // Markdown-only storage: a single .md object per text attachment, and
      // `url` is that file.
      expect(storage.files.size).toBe(1);
      const [storedKey] = [...storage.files.keys()];
      expect(body.attachments[0].url.endsWith(storedKey)).toBe(true);
    });

    it("creates quote posts with sourceName/sourceUrl", async () => {
      const { app } = createTestApp({ authenticated: true });
      app.route("/api/posts", postsApiRoutes);

      const res = await app.request("/api/posts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          format: "quote",
          sourceName: "Marcus Aurelius",
          sourceUrl: "https://example.com/meditations",
          quoteText: "What stands in the way becomes the way.",
        }),
      });

      expect(res.status).toBe(201);

      const body = await res.json();
      expect(body.format).toBe("quote");
      expect(body.sourceName).toBe("Marcus Aurelius");
      expect(body.sourceUrl).toBe("https://example.com/meditations");
      expect(body.quoteText).toBe("What stands in the way becomes the way.");
      expect(body).not.toHaveProperty("title");
      expect(body).not.toHaveProperty("url");
    });

    it("returns 400 when creating a link post without a title", async () => {
      const { app } = createTestApp({ authenticated: true });
      app.route("/api/posts", postsApiRoutes);

      const res = await app.request("/api/posts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          format: "link",
          url: "https://example.com",
        }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain("Link posts need a title.");
    });

    it("returns 400 for invalid attachment media IDs", async () => {
      const { app } = createTestApp({ authenticated: true });
      app.route("/api/posts", postsApiRoutes);
      const missingMediaId = createEntityId("media");

      const res = await app.request("/api/posts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          format: "note",
          bodyMarkdown: "test",
          attachments: [{ type: "media", mediaId: missingMediaId }],
        }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain("invalid media IDs");
    });

    it("returns 400 for invalid body", async () => {
      const { app } = createTestApp({ authenticated: true });
      app.route("/api/posts", postsApiRoutes);

      const res = await app.request("/api/posts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ format: "invalid-type" }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain("Invalid");
      expect(body.code).toBe("VALIDATION_ERROR");
    });

    it("returns 400 for missing required fields", async () => {
      const { app } = createTestApp({ authenticated: true });
      app.route("/api/posts", postsApiRoutes);

      const res = await app.request("/api/posts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(400);
    });
  });

  describe("PUT /api/posts/:id", () => {
    it("returns 401 when not authenticated", async () => {
      const { app, services } = createTestApp({ authenticated: false });
      app.route("/api/posts", postsApiRoutes);

      const post = await services.posts.create({
        format: "note",
        bodyMarkdown: "original",
      });

      const res = await app.request(`/api/posts/${post.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bodyMarkdown: "updated" }),
      });

      expect(res.status).toBe(401);
    });

    it("updates a post when authenticated", async () => {
      const { app, services } = createTestApp({ authenticated: true });
      app.route("/api/posts", postsApiRoutes);

      const post = await services.posts.create({
        format: "note",
        bodyMarkdown: "original",
      });

      const res = await app.request(`/api/posts/${post.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bodyMarkdown: "updated" }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.bodyText).toBe("updated");
      expect(body.attachments).toEqual([]);
    });

    it("updates post with attachments to replace attachments", async () => {
      const { app, services } = createTestApp({ authenticated: true });
      app.route("/api/posts", postsApiRoutes);

      const post = await services.posts.create({
        format: "note",
        bodyMarkdown: "test",
      });

      const m1 = await services.media.create({
        filename: "a.jpg",
        originalName: "a.jpg",
        mimeType: "image/jpeg",
        size: 1024,
        storageKey: "media/a.jpg",
      });

      await services.media.attachToPost(post.id, [m1.id]);

      const m2 = await services.media.create({
        filename: "b.jpg",
        originalName: "b.jpg",
        mimeType: "image/jpeg",
        size: 2048,
        storageKey: "media/b.jpg",
      });

      const res = await app.request(`/api/posts/${post.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          attachments: [{ type: "media", mediaId: m2.id }],
        }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.attachments).toHaveLength(1);
      expect(body.attachments[0]).toMatchObject({
        type: "media",
        id: m2.id,
      });
    });

    it("preserves existing attachments when attachments is omitted", async () => {
      const { app, services } = createTestApp({ authenticated: true });
      app.route("/api/posts", postsApiRoutes);

      const post = await services.posts.create({
        format: "note",
        bodyMarkdown: "test",
      });

      const m1 = await services.media.create({
        filename: "a.jpg",
        originalName: "a.jpg",
        mimeType: "image/jpeg",
        size: 1024,
        storageKey: "media/a.jpg",
      });

      await services.media.attachToPost(post.id, [m1.id]);

      const res = await app.request(`/api/posts/${post.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bodyMarkdown: "updated content" }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.attachments).toHaveLength(1);
      expect(body.attachments[0]).toMatchObject({
        type: "media",
        id: m1.id,
      });
    });

    it("returns 404 for non-existent post", async () => {
      const { app } = createTestApp({ authenticated: true });
      app.route("/api/posts", postsApiRoutes);
      const missingId = createEntityId("post");

      const res = await app.request(`/api/posts/${missingId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bodyMarkdown: "test" }),
      });

      expect(res.status).toBe(404);
    });

    it("returns 400 for invalid update data", async () => {
      const { app, services } = createTestApp({ authenticated: true });
      app.route("/api/posts", postsApiRoutes);

      const post = await services.posts.create({
        format: "note",
        bodyMarkdown: "test",
      });

      const res = await app.request(`/api/posts/${post.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ format: "invalid-type" }),
      });

      expect(res.status).toBe(400);
    });

    it("updates quote attribution through sourceName/sourceUrl", async () => {
      const { app, services } = createTestApp({ authenticated: true });
      app.route("/api/posts", postsApiRoutes);

      const post = await services.posts.create({
        format: "quote",
        title: "Marcus Aurelius",
        url: "https://example.com/meditations",
        quoteText: "What stands in the way becomes the way.",
      });

      const res = await app.request(`/api/posts/${post.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceName: "Epictetus",
          sourceUrl: "https://example.com/discourses",
        }),
      });

      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.sourceName).toBe("Epictetus");
      expect(body.sourceUrl).toBe("https://example.com/discourses");
      expect(body).not.toHaveProperty("title");
      expect(body).not.toHaveProperty("url");
    });

    it("clears quote attribution when sourceName is set to null", async () => {
      const { app, services } = createTestApp({ authenticated: true });
      app.route("/api/posts", postsApiRoutes);

      const post = await services.posts.create({
        format: "quote",
        title: "Marcus Aurelius",
        url: "https://example.com/meditations",
        quoteText: "What stands in the way becomes the way.",
      });

      const res = await app.request(`/api/posts/${post.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceName: null,
        }),
      });

      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.sourceName).toBeNull();
      expect(body.sourceUrl).toBe("https://example.com/meditations");
      expect(body).not.toHaveProperty("title");
      expect(body).not.toHaveProperty("url");
    });
  });

  describe("DELETE /api/posts/:id", () => {
    it("returns 401 when not authenticated", async () => {
      const { app, services } = createTestApp({ authenticated: false });
      app.route("/api/posts", postsApiRoutes);

      const post = await services.posts.create({
        format: "note",
        bodyMarkdown: "test",
      });

      const res = await app.request(`/api/posts/${post.id}`, {
        method: "DELETE",
      });

      expect(res.status).toBe(401);
    });

    it("deletes a post when authenticated", async () => {
      const { app, services } = createTestApp({ authenticated: true });
      app.route("/api/posts", postsApiRoutes);

      const post = await services.posts.create({
        format: "note",
        bodyMarkdown: "to be deleted",
      });

      const res = await app.request(`/api/posts/${post.id}`, {
        method: "DELETE",
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);

      // Verify post is deleted
      const found = await services.posts.getById(post.id);
      expect(found).toBeNull();
    });

    it("returns 404 for non-existent post", async () => {
      const { app } = createTestApp({ authenticated: true });
      app.route("/api/posts", postsApiRoutes);
      const missingId = createEntityId("post");

      const res = await app.request(`/api/posts/${missingId}`, {
        method: "DELETE",
      });

      expect(res.status).toBe(404);
    });

    it("deletes media records when post is deleted", async () => {
      const { app, services } = createTestApp({ authenticated: true });
      app.route("/api/posts", postsApiRoutes);

      const post = await services.posts.create({
        format: "note",
        bodyMarkdown: "with media",
      });

      const m1 = await services.media.create({
        filename: "a.jpg",
        originalName: "a.jpg",
        mimeType: "image/jpeg",
        size: 1024,
        storageKey: "media/a.jpg",
      });
      const m2 = await services.media.create({
        filename: "b.jpg",
        originalName: "b.jpg",
        mimeType: "image/jpeg",
        size: 2048,
        storageKey: "media/b.jpg",
      });

      await services.media.attachToPost(post.id, [m1.id, m2.id]);

      const res = await app.request(`/api/posts/${post.id}`, {
        method: "DELETE",
      });

      expect(res.status).toBe(200);

      // Media records should be deleted, not just detached
      expect(await services.media.getById(m1.id)).toBeNull();
      expect(await services.media.getById(m2.id)).toBeNull();
    });

    it("deletes media for all posts in a thread when root is deleted", async () => {
      const { app, services } = createTestApp({ authenticated: true });
      app.route("/api/posts", postsApiRoutes);

      const root = await services.posts.create({
        format: "note",
        bodyMarkdown: "thread root",
      });
      const reply = await services.posts.create({
        format: "note",
        bodyMarkdown: "reply",
        replyToId: root.id,
      });

      const rootMedia = await services.media.create({
        filename: "root.jpg",
        originalName: "root.jpg",
        mimeType: "image/jpeg",
        size: 1024,
        storageKey: "media/root.jpg",
      });
      const replyMedia = await services.media.create({
        filename: "reply.jpg",
        originalName: "reply.jpg",
        mimeType: "image/jpeg",
        size: 2048,
        storageKey: "media/reply.jpg",
      });

      await services.media.attachToPost(root.id, [rootMedia.id]);
      await services.media.attachToPost(reply.id, [replyMedia.id]);

      const res = await app.request(`/api/posts/${root.id}`, {
        method: "DELETE",
      });

      expect(res.status).toBe(200);

      // Both root and reply media should be deleted
      expect(await services.media.getById(rootMedia.id)).toBeNull();
      expect(await services.media.getById(replyMedia.id)).toBeNull();
    });
  });
});
