import { describe, expect, it } from "vitest";
import { createTestApp } from "../../../../__tests__/helpers/app.js";
import { publicArchiveApiRoutes } from "../archive.js";

describe("Public Archive API Routes", () => {
  describe("GET /api/public/archive", () => {
    it("includes latest_hidden posts but excludes private and drafts", async () => {
      const { app, services } = createTestApp({ authenticated: false });
      app.route("/api/public/archive", publicArchiveApiRoutes);

      const publicRoot = await services.posts.create({
        format: "note",
        title: "Public root",
        bodyMarkdown: "visible",
      });
      const hiddenRoot = await services.posts.create({
        format: "note",
        title: "Latest hidden root",
        bodyMarkdown: "hidden from latest",
        visibility: "latest_hidden",
      });
      await services.posts.create({
        format: "note",
        title: "Private root",
        bodyMarkdown: "private",
        visibility: "private",
      });
      await services.posts.create({
        format: "note",
        title: "Draft root",
        bodyMarkdown: "draft",
        status: "draft",
      });
      await services.posts.create({
        format: "note",
        bodyMarkdown: "reply",
        replyToId: publicRoot.id,
      });

      const res = await app.request("/api/public/archive");
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.nextCursor).toBeNull();
      expect(body.posts).toHaveLength(2);
      const ids = body.posts.map((p: { id: string }) => p.id);
      expect(ids).toContain(publicRoot.id);
      expect(ids).toContain(hiddenRoot.id);
      const hidden = body.posts.find(
        (p: { id: string }) => p.id === hiddenRoot.id,
      );
      expect(hidden.visibility).toBe("latest_hidden");
    });

    it("answers the visibility question it was asked", async () => {
      const { app, services } = createTestApp({ authenticated: false });
      app.route("/api/public/archive", publicArchiveApiRoutes);

      const plain = await services.posts.create({
        format: "note",
        title: "Plain root",
        bodyMarkdown: "plain",
      });
      const hidden = await services.posts.create({
        format: "note",
        title: "Hidden root",
        bodyMarkdown: "hidden",
        visibility: "latest_hidden",
      });
      const featured = await services.posts.create({
        format: "note",
        title: "Featured root",
        bodyMarkdown: "featured",
        featured: true,
      });

      const hiddenOnly = await app.request(
        "/api/public/archive?visibility=hidden",
      );
      expect(hiddenOnly.status).toBe(200);
      const hiddenBody = await hiddenOnly.json();
      expect(hiddenBody.posts.map((p: { id: string }) => p.id)).toEqual([
        hidden.id,
      ]);

      const featuredOnly = await app.request(
        "/api/public/archive?visibility=featured",
      );
      const featuredBody = await featuredOnly.json();
      expect(featuredBody.posts.map((p: { id: string }) => p.id)).toEqual([
        featured.id,
      ]);

      const publicOnly = await app.request(
        "/api/public/archive?visibility=public",
      );
      const publicBody = await publicOnly.json();
      const publicIds = publicBody.posts.map((p: { id: string }) => p.id);
      expect(publicIds).toContain(plain.id);
      expect(publicIds).not.toContain(hidden.id);
    });

    // The failure this guards: an unknown key is stripped by the schema, so a
    // caller asking for something this endpoint cannot serve used to get the
    // whole archive back and no way to tell.
    it("rejects a visibility it cannot serve instead of widening", async () => {
      const { app, services } = createTestApp({ authenticated: false });
      app.route("/api/public/archive", publicArchiveApiRoutes);

      await services.posts.create({
        format: "note",
        title: "Plain root",
        bodyMarkdown: "plain",
      });

      for (const value of ["private", "nonsense"]) {
        const res = await app.request(
          `/api/public/archive?visibility=${value}`,
        );
        expect(res.status).toBe(400);
      }
    });

    // `latest_hidden` is the stored spelling of `hidden`, which the page and
    // the feed both read. This endpoint used to be the one surface that called
    // it nonsense — a value it can serve perfectly, rejected only because it
    // kept a private copy of the vocabulary.
    it("reads the stored spelling of hidden, like every other surface", async () => {
      const { app, services } = createTestApp({ authenticated: false });
      app.route("/api/public/archive", publicArchiveApiRoutes);

      await services.posts.create({
        format: "note",
        title: "Plain root",
        bodyMarkdown: "plain",
      });
      const hidden = await services.posts.create({
        format: "note",
        title: "Hidden root",
        bodyMarkdown: "hidden",
        visibility: "latest_hidden",
      });

      const res = await app.request(
        "/api/public/archive?visibility=latest_hidden",
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.posts.map((p: { id: string }) => p.id)).toEqual([hidden.id]);
    });

    it("rejects a parameter it does not know", async () => {
      const { app, services } = createTestApp({ authenticated: false });
      app.route("/api/public/archive", publicArchiveApiRoutes);

      await services.posts.create({
        format: "note",
        title: "Plain root",
        bodyMarkdown: "plain",
      });

      const res = await app.request("/api/public/archive?formta=note");
      expect(res.status).toBe(400);
    });

    it("supports format and limit filters with cursor", async () => {
      const { app, services } = createTestApp({ authenticated: false });
      app.route("/api/public/archive", publicArchiveApiRoutes);

      await services.posts.create({
        format: "note",
        title: "Note one",
        bodyMarkdown: "first",
      });
      await services.posts.create({
        format: "note",
        title: "Note two",
        bodyMarkdown: "second",
        visibility: "latest_hidden",
      });
      await services.posts.create({
        format: "link",
        title: "Example",
        url: "https://example.com",
      });

      const res = await app.request("/api/public/archive?format=note&limit=1");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.posts).toHaveLength(1);
      expect(body.posts[0].format).toBe("note");
      expect(body.nextCursor).toBeTruthy();

      const next = await app.request(
        `/api/public/archive?format=note&limit=1&cursor=${body.nextCursor}`,
      );
      const nextBody = await next.json();
      expect(nextBody.posts).toHaveLength(1);
      expect(nextBody.posts[0].id).not.toBe(body.posts[0].id);
    });

    it("paginates chronologically without promoting pinned posts", async () => {
      const { app, services } = createTestApp({ authenticated: false });
      app.route("/api/public/archive", publicArchiveApiRoutes);

      const olderPinned = await services.posts.create({
        format: "note",
        title: "Older pinned post",
        bodyMarkdown: "older",
        pinned: true,
        publishedAt: Date.UTC(2025, 0, 1) / 1000,
      });
      const newerUnpinned = await services.posts.create({
        format: "note",
        title: "Newer unpinned post",
        bodyMarkdown: "newer",
        publishedAt: Date.UTC(2026, 0, 1) / 1000,
      });

      const first = await app.request("/api/public/archive?limit=1");
      expect(first.status).toBe(200);
      const firstBody = await first.json();
      expect(firstBody.posts.map((post: { id: string }) => post.id)).toEqual([
        newerUnpinned.id,
      ]);

      const second = await app.request(
        `/api/public/archive?limit=1&cursor=${firstBody.nextCursor}`,
      );
      expect(second.status).toBe(200);
      const secondBody = await second.json();
      expect(secondBody.posts.map((post: { id: string }) => post.id)).toEqual([
        olderPinned.id,
      ]);
    });

    it("filters by year using publishedAt", async () => {
      const { app, services } = createTestApp({ authenticated: false });
      app.route("/api/public/archive", publicArchiveApiRoutes);

      const inYear = await services.posts.create({
        format: "note",
        title: "From 2024",
        bodyMarkdown: "in",
        publishedAt: Math.floor(Date.UTC(2024, 5, 1) / 1000),
      });
      await services.posts.create({
        format: "note",
        title: "From 2023",
        bodyMarkdown: "out",
        publishedAt: Math.floor(Date.UTC(2023, 5, 1) / 1000),
      });

      const res = await app.request("/api/public/archive?year=2024");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.posts).toHaveLength(1);
      expect(body.posts[0].id).toBe(inYear.id);
    });

    it("filters by hasTitle and hasMedia", async () => {
      const { app, services } = createTestApp({ authenticated: false });
      app.route("/api/public/archive", publicArchiveApiRoutes);

      const titled = await services.posts.create({
        format: "note",
        title: "Has title",
        bodyMarkdown: "body",
      });
      const untitled = await services.posts.create({
        format: "note",
        bodyMarkdown: "body without title",
      });

      const withTitle = await app.request("/api/public/archive?hasTitle=1");
      const withTitleBody = await withTitle.json();
      expect(withTitleBody.posts.map((p: { id: string }) => p.id)).toEqual([
        titled.id,
      ]);

      const noTitle = await app.request("/api/public/archive?hasTitle=0");
      const noTitleBody = await noTitle.json();
      expect(noTitleBody.posts.map((p: { id: string }) => p.id)).toEqual([
        untitled.id,
      ]);

      const noMedia = await app.request("/api/public/archive?hasMedia=0");
      const noMediaBody = await noMedia.json();
      expect(noMediaBody.posts).toHaveLength(2);
    });

    it("filters by title and media presence words", async () => {
      const { app, services } = createTestApp({ authenticated: false });
      app.route("/api/public/archive", publicArchiveApiRoutes);

      const titled = await services.posts.create({
        format: "note",
        title: "Has title",
        bodyMarkdown: "body",
      });
      const untitled = await services.posts.create({
        format: "note",
        bodyMarkdown: "body without title",
      });

      const withTitle = await app.request("/api/public/archive?title=any");
      const withTitleBody = await withTitle.json();
      expect(withTitleBody.posts.map((p: { id: string }) => p.id)).toEqual([
        titled.id,
      ]);

      const noTitle = await app.request("/api/public/archive?title=none");
      const noTitleBody = await noTitle.json();
      expect(noTitleBody.posts.map((p: { id: string }) => p.id)).toEqual([
        untitled.id,
      ]);

      const noMedia = await app.request("/api/public/archive?media=none");
      const noMediaBody = await noMedia.json();
      expect(noMediaBody.posts).toHaveLength(2);

      const anyMedia = await app.request("/api/public/archive?media=any");
      const anyMediaBody = await anyMedia.json();
      expect(anyMediaBody.posts).toHaveLength(0);
    });

    it("filters threads and single posts via replies", async () => {
      const { app, services } = createTestApp({ authenticated: false });
      app.route("/api/public/archive", publicArchiveApiRoutes);

      const threadRoot = await services.posts.create({
        format: "note",
        bodyMarkdown: "thread root",
      });
      await services.posts.create({
        format: "note",
        bodyMarkdown: "reply",
        replyToId: threadRoot.id,
      });
      const standalone = await services.posts.create({
        format: "note",
        bodyMarkdown: "standalone",
      });

      const threads = await app.request("/api/public/archive?replies=any");
      const threadsBody = await threads.json();
      expect(threadsBody.posts.map((p: { id: string }) => p.id)).toEqual([
        threadRoot.id,
      ]);

      const singles = await app.request("/api/public/archive?replies=none");
      const singlesBody = await singles.json();
      expect(singlesBody.posts.map((p: { id: string }) => p.id)).toEqual([
        standalone.id,
      ]);
    });

    it("filters by media kind", async () => {
      const { app, services } = createTestApp({ authenticated: false });
      app.route("/api/public/archive", publicArchiveApiRoutes);

      const withImage = await services.posts.create({
        format: "note",
        title: "Image post",
        bodyMarkdown: "image body",
      });
      const image = await services.media.create({
        filename: "pic.jpg",
        originalName: "pic.jpg",
        mimeType: "image/jpeg",
        size: 1024,
        storageKey: "media/pic.jpg",
      });
      await services.media.attachToPost(withImage.id, [image.id]);

      await services.posts.create({
        format: "note",
        title: "Plain post",
        bodyMarkdown: "no media",
      });

      const res = await app.request("/api/public/archive?media=image");
      const body = await res.json();
      expect(body.posts).toHaveLength(1);
      expect(body.posts[0].id).toBe(withImage.id);

      const hasMediaRes = await app.request("/api/public/archive?hasMedia=1");
      const hasMediaBody = await hasMediaRes.json();
      expect(hasMediaBody.posts).toHaveLength(1);
      expect(hasMediaBody.posts[0].id).toBe(withImage.id);
    });

    it("filters by collection (single and aggregate)", async () => {
      const { app, services } = createTestApp({ authenticated: false });
      app.route("/api/public/archive", publicArchiveApiRoutes);

      const tech = await services.collections.create({
        slug: "tech",
        title: "Tech",
      });
      const art = await services.collections.create({
        slug: "art",
        title: "Art",
      });
      const techPost = await services.posts.create({
        format: "note",
        title: "Tech",
        bodyMarkdown: "t",
        collectionIds: [tech.id],
      });
      const artPost = await services.posts.create({
        format: "note",
        title: "Art",
        bodyMarkdown: "a",
        collectionIds: [art.id],
        visibility: "latest_hidden",
      });
      await services.posts.create({
        format: "note",
        title: "Other",
        bodyMarkdown: "o",
      });

      const single = await app.request("/api/public/archive?collection=tech");
      const singleBody = await single.json();
      expect(singleBody.posts.map((p: { id: string }) => p.id)).toEqual([
        techPost.id,
      ]);

      const aggregate = await app.request(
        "/api/public/archive?collection=tech,art",
      );
      const aggregateBody = await aggregate.json();
      const aggregateIds = aggregateBody.posts.map((p: { id: string }) => p.id);
      expect(aggregateIds).toContain(techPost.id);
      expect(aggregateIds).toContain(artPost.id);
      expect(aggregateBody.posts).toHaveLength(2);

      const unknown = await app.request(
        "/api/public/archive?collection=nonexistent",
      );
      const unknownBody = await unknown.json();
      expect(unknownBody.posts).toEqual([]);
      expect(unknownBody.nextCursor).toBeNull();
    });

    it("returns markdown instead of rendered fields when content=markdown", async () => {
      const { app, services } = createTestApp({ authenticated: false });
      app.route("/api/public/archive", publicArchiveApiRoutes);

      await services.posts.create({
        format: "note",
        title: "Markdown post",
        bodyMarkdown: "# Hello\n\nBody",
      });

      const res = await app.request("/api/public/archive?content=markdown");
      const body = await res.json();
      expect(body.posts).toHaveLength(1);
      expect(body.posts[0].bodyMarkdown).toBe("# Hello\n\nBody");
      expect(body.posts[0]).not.toHaveProperty("bodyHtml");
      expect(body.posts[0]).not.toHaveProperty("bodyText");
    });

    it("rejects invalid media kind", async () => {
      const { app } = createTestApp({ authenticated: false });
      app.route("/api/public/archive", publicArchiveApiRoutes);

      const res = await app.request("/api/public/archive?media=invalid");
      expect(res.status).toBe(400);
    });
  });
});
