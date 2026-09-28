import { describe, expect, it } from "vitest";
import { createTestApp } from "../../../../__tests__/helpers/app.js";
import { publicPostsApiRoutes } from "../posts.js";

// The list this path answered moved to `/api/public/threads` in 0.9 and was
// removed in 0.10.0; its behaviors are tested there.
describe("Public Posts API Routes", () => {
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

  it("gives a text attachment its file, not the author's content endpoint", async () => {
    // `contentUrl` needs a session or token; an anonymous reader got a 401
    // from the address the public response handed them.
    const files = new Map<string, Uint8Array>();
    const storage = {
      async put(key: string, body: Uint8Array | ReadableStream) {
        files.set(
          key,
          body instanceof Uint8Array
            ? body
            : new Uint8Array(await new Response(body).arrayBuffer()),
        );
      },
      async get() {
        return null;
      },
      async delete(key: string) {
        files.delete(key);
      },
    };
    const { app, services } = createTestApp({
      authenticated: false,
      storage: storage as never,
    });
    app.route("/api/public/posts", publicPostsApiRoutes);
    const post = await services.posts.createWithAttachments(
      { format: "note", bodyMarkdown: "With notes" },
      [{ type: "text", contentFormat: "markdown", content: "# Notes" }],
      {
        media: services.media,
        storage: storage as never,
        storageDriver: "r2",
        maxFileSizeMB: 10,
      },
    );

    const res = await app.request(`/api/public/posts/${post.slug}`);
    const body = await res.json();

    const [attachment] = body.attachments;
    expect(attachment).toMatchObject({
      type: "text",
      contentFormat: "markdown",
    });
    expect(attachment).not.toHaveProperty("contentUrl");
    const [storedKey] = [...files.keys()];
    expect(attachment.url.endsWith(storedKey)).toBe(true);
  });
});
