import { describe, it, expect, vi } from "vitest";
import { createTestApp } from "../../../__tests__/helpers/app.js";
import { createEntityId } from "../../../lib/ids.js";
import { MAX_COLLECTION_SLUG_LENGTH } from "../../../types.js";
import { collectionsApiRoutes } from "../collections.js";

describe("Collections API Routes", () => {
  describe("GET /api/collections", () => {
    it("returns empty list when no collections exist", async () => {
      const { app } = createTestApp();
      app.route("/api/collections", collectionsApiRoutes);

      const res = await app.request("/api/collections");
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.collections).toEqual([]);
      expect(body.directoryItems).toEqual([]);
    });

    it("returns collections with Thread counts and directory items", async () => {
      const { app, services } = createTestApp();
      app.route("/api/collections", collectionsApiRoutes);

      const col = await services.collections.create({
        slug: "tech",
        title: "Tech",
      });
      const post = await services.posts.create({
        format: "note",
        bodyMarkdown: "tech post",
      });
      await services.collections.addThread(col.id, post.id);

      const res = await app.request("/api/collections");
      const body = await res.json();

      expect(body.collections).toHaveLength(1);
      expect(body.collections[0].slug).toBe("tech");
      expect(body.collections[0].threadCount).toBe(1);
      expect(body.collections[0].recentActivityAt).toBe(post.lastActivityAt);

      expect(body.directoryItems).toHaveLength(1);
      expect(body.directoryItems[0].type).toBe("collection");
      expect(body.directoryItems[0].collectionId).toBe(col.id);
    });

    it("returns smart collections with the same two measures", async () => {
      const { app, services } = createTestApp();
      app.route("/api/collections", collectionsApiRoutes);

      await services.smartCollections.create({
        slug: "quotes",
        title: "Quotes",
        selection: { format: "quote" },
      });
      const quote = await services.posts.create({
        format: "quote",
        quoteText: "Worth keeping",
      });

      const res = await app.request("/api/collections");
      const body = await res.json();

      expect(body.smartCollections).toHaveLength(1);
      expect(body.smartCollections[0].threadCount).toBe(1);
      expect(body.smartCollections[0].recentActivityAt).toBe(
        quote.lastActivityAt,
      );
    });

    it("returns divider labels", async () => {
      const { app, services } = createTestApp({ authenticated: true });
      app.route("/api/collections", collectionsApiRoutes);

      const divider = await services.collections.createDirectoryItem({
        type: "divider",
        label: "Notes",
      });

      const res = await app.request("/api/collections");
      const body = await res.json();

      expect(body.directoryItems).toContainEqual(
        expect.objectContaining({
          id: divider.id,
          type: "divider",
          label: "Notes",
        }),
      );
    });

    it("returns compose-sorted collections when view=compose", async () => {
      vi.useFakeTimers();

      try {
        const { app, services } = createTestApp({ authenticated: true });
        app.route("/api/collections", collectionsApiRoutes);

        vi.setSystemTime(new Date("2024-01-01T00:00:00Z"));
        const older = await services.collections.create({
          slug: "older",
          title: "Older",
        });

        vi.setSystemTime(new Date("2024-01-01T00:00:10Z"));
        const newer = await services.collections.create({
          slug: "newer",
          title: "Newer",
        });

        vi.setSystemTime(new Date("2024-01-01T00:01:00Z"));
        await services.posts.create({
          format: "note",
          bodyMarkdown: "shared add",
          collectionIds: [older.id, newer.id],
        });

        const res = await app.request("/api/collections?view=compose");
        expect(res.status).toBe(200);
        expect(res.headers.get("cache-control")).toBe("no-store");

        const body = await res.json();
        expect(body.directoryItems).toEqual([]);
        expect(
          body.collections.map((collection: { id: string }) => collection.id),
        ).toEqual([newer.id, older.id]);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe("GET /api/collections/:id", () => {
    it("returns a collection by id", async () => {
      const { app, services } = createTestApp();
      app.route("/api/collections", collectionsApiRoutes);

      const col = await services.collections.create({
        slug: "tech",
        title: "Tech Articles",
      });

      const res = await app.request(`/api/collections/${col.id}`);
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.title).toBe("Tech Articles");
      expect(body.slug).toBe("tech");
    });

    it("returns 400 for invalid id", async () => {
      const { app } = createTestApp();
      app.route("/api/collections", collectionsApiRoutes);

      const res = await app.request("/api/collections/!!invalid!!");
      expect(res.status).toBe(400);
    });

    it("returns 404 for non-existent collection", async () => {
      const { app } = createTestApp();
      app.route("/api/collections", collectionsApiRoutes);
      const missingId = createEntityId("collection");

      const res = await app.request(`/api/collections/${missingId}`);
      expect(res.status).toBe(404);
    });
  });

  describe("POST /api/collections", () => {
    it("returns 401 when not authenticated", async () => {
      const { app } = createTestApp({ authenticated: false });
      app.route("/api/collections", collectionsApiRoutes);

      const res = await app.request("/api/collections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug: "tech", title: "Tech" }),
      });

      expect(res.status).toBe(401);
    });

    it("creates a collection when authenticated", async () => {
      const { app } = createTestApp({ authenticated: true });
      app.route("/api/collections", collectionsApiRoutes);

      const res = await app.request("/api/collections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug: "tech",
          title: "Tech",
          description: "Tech articles",
        }),
      });

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.slug).toBe("tech");
      expect(body.title).toBe("Tech");
      expect(body.description).toBe("Tech articles");
    });

    it("returns 400 for missing required fields", async () => {
      const { app } = createTestApp({ authenticated: true });
      app.route("/api/collections", collectionsApiRoutes);

      const res = await app.request("/api/collections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug: "tech" }),
      });

      expect(res.status).toBe(400);
    });

    it("rejects rating_asc as a collection sort order", async () => {
      const { app } = createTestApp({ authenticated: true });
      app.route("/api/collections", collectionsApiRoutes);

      const res = await app.request("/api/collections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug: "tech",
          title: "Tech",
          sortOrder: "rating_asc",
        }),
      });

      expect(res.status).toBe(400);
    });

    it("rejects slugs longer than the maximum length", async () => {
      const { app } = createTestApp({ authenticated: true });
      app.route("/api/collections", collectionsApiRoutes);

      const res = await app.request("/api/collections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug: "a".repeat(MAX_COLLECTION_SLUG_LENGTH + 1),
          title: "Tech",
        }),
      });

      expect(res.status).toBe(400);
    });
  });

  describe("PUT /api/collections/:id", () => {
    it("updates a collection when authenticated", async () => {
      const { app, services } = createTestApp({ authenticated: true });
      app.route("/api/collections", collectionsApiRoutes);

      const col = await services.collections.create({
        slug: "tech",
        title: "Tech",
      });

      const res = await app.request(`/api/collections/${col.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Technology" }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.title).toBe("Technology");
    });

    it("returns 404 for non-existent collection", async () => {
      const { app } = createTestApp({ authenticated: true });
      app.route("/api/collections", collectionsApiRoutes);
      const missingId = createEntityId("collection");

      const res = await app.request(`/api/collections/${missingId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "test" }),
      });

      expect(res.status).toBe(404);
    });
  });

  describe("DELETE /api/collections/:id", () => {
    it("returns 401 when not authenticated", async () => {
      const { app, services } = createTestApp({ authenticated: false });
      app.route("/api/collections", collectionsApiRoutes);

      const col = await services.collections.create({
        slug: "tech",
        title: "Tech",
      });

      const res = await app.request(`/api/collections/${col.id}`, {
        method: "DELETE",
      });

      expect(res.status).toBe(401);
    });

    it("deletes a collection when authenticated", async () => {
      const { app, services } = createTestApp({ authenticated: true });
      app.route("/api/collections", collectionsApiRoutes);

      const col = await services.collections.create({
        slug: "tech",
        title: "Tech",
      });

      const res = await app.request(`/api/collections/${col.id}`, {
        method: "DELETE",
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);

      const found = await services.collections.getById(col.id);
      expect(found).toBeNull();
    });

    it("returns 404 for non-existent collection", async () => {
      const { app } = createTestApp({ authenticated: true });
      app.route("/api/collections", collectionsApiRoutes);
      const missingId = createEntityId("collection");

      const res = await app.request(`/api/collections/${missingId}`, {
        method: "DELETE",
      });

      expect(res.status).toBe(404);
    });
  });

  describe("POST /api/collections/directory-items", () => {
    it("creates a divider directory item", async () => {
      const { app } = createTestApp({ authenticated: true });
      app.route("/api/collections", collectionsApiRoutes);

      const res = await app.request("/api/collections/directory-items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "divider" }),
      });

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.type).toBe("divider");
      expect(body.collectionId).toBeNull();
    });

    it("creates a custom link directory item", async () => {
      const { app } = createTestApp({ authenticated: true });
      app.route("/api/collections", collectionsApiRoutes);

      const res = await app.request("/api/collections/directory-items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "link",
          label: "Quotes",
          url: "/archive?format=quote",
        }),
      });

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.type).toBe("link");
      expect(body.label).toBe("Quotes");
      expect(body.url).toBe("/archive?format=quote");
    });
  });

  describe("DELETE /api/collections/directory-items/:id", () => {
    it("deletes a directory item", async () => {
      const { app, services } = createTestApp({ authenticated: true });
      app.route("/api/collections", collectionsApiRoutes);

      const item = await services.collections.createDirectoryItem({
        type: "divider",
      });

      const res = await app.request(
        `/api/collections/directory-items/${item.id}`,
        { method: "DELETE" },
      );

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
    });
  });

  describe("PUT /api/collections/directory-items/:id", () => {
    it("updates a divider label", async () => {
      const { app, services } = createTestApp({ authenticated: true });
      app.route("/api/collections", collectionsApiRoutes);

      const item = await services.collections.createDirectoryItem({
        type: "divider",
      });

      const res = await app.request(
        `/api/collections/directory-items/${item.id}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ label: "Reading" }),
        },
      );

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.label).toBe("Reading");
    });

    it("updates a custom link label and url", async () => {
      const { app, services } = createTestApp({ authenticated: true });
      app.route("/api/collections", collectionsApiRoutes);

      const item = await services.collections.createDirectoryItem({
        type: "link",
        label: "Quotes",
        url: "/archive?format=quote",
      });

      const res = await app.request(
        `/api/collections/directory-items/${item.id}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            label: "Quote archive",
            url: "/archive?format=quote&view=list",
          }),
        },
      );

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.label).toBe("Quote archive");
      expect(body.url).toBe("/archive?format=quote&view=list");
    });
  });

  describe("PUT /api/collections/directory-items/:id/move", () => {
    it("moves a directory item", async () => {
      const { app, services } = createTestApp({ authenticated: true });
      app.route("/api/collections", collectionsApiRoutes);

      await services.collections.create({ slug: "a", title: "A" });
      await services.collections.create({ slug: "b", title: "B" });
      await services.collections.create({ slug: "c", title: "C" });

      const items = await services.collections.listDirectoryItems();
      expect(items).toHaveLength(3);
      const itemA = items[0];
      const itemB = items[1];
      const itemC = items[2];

      // Move C between A and B
      const res = await app.request(
        `/api/collections/directory-items/${itemC?.id ?? ""}/move`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            after: itemA?.id ?? "",
            before: itemB?.id ?? "",
          }),
        },
      );

      expect(res.status).toBe(200);

      const reordered = await services.collections.listDirectoryItems();
      expect(reordered[0]?.id).toBe(itemA?.id);
      expect(reordered[1]?.id).toBe(itemC?.id);
      expect(reordered[2]?.id).toBe(itemB?.id);
    });

    it("moves a smart collection, which the directory names by its own id", async () => {
      const { app, services } = createTestApp({ authenticated: true });
      app.route("/api/collections", collectionsApiRoutes);

      const a = await services.collections.create({ slug: "a", title: "A" });
      const b = await services.collections.create({ slug: "b", title: "B" });
      const quotes = await services.smartCollections.create({
        slug: "quotes",
        title: "Quotes",
      });

      const items = await services.collections.listDirectoryItems();

      // The shape the drag surface sends: a smart collection id beside a
      // directory row id.
      const res = await app.request(
        `/api/collections/directory-items/${quotes.id}/move`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            after: items[0]?.id ?? "",
            before: items[1]?.id ?? "",
          }),
        },
      );

      expect(res.status).toBe(200);

      const reordered = await services.collections.listDirectoryItems();
      expect(
        reordered.map((item) => item.collectionId ?? item.smartCollectionId),
      ).toEqual([a.id, quotes.id, b.id]);
    });
  });

  describe("POST /api/collections/:id/threads", () => {
    it("adds a thread to a collection", async () => {
      const { app, services } = createTestApp({ authenticated: true });
      app.route("/api/collections", collectionsApiRoutes);

      const col = await services.collections.create({
        slug: "tech",
        title: "Tech",
      });
      const post = await services.posts.create({
        format: "note",
        bodyMarkdown: "test",
      });

      const res = await app.request(`/api/collections/${col.id}/threads`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ threadId: post.id }),
      });

      expect(res.status).toBe(201);

      const threadIds = await services.collections.getThreadIds(col.id);
      expect(threadIds).toContain(post.id);
    });

    it("normalizes a child post ID to the thread root", async () => {
      const { app, services } = createTestApp({ authenticated: true });
      app.route("/api/collections", collectionsApiRoutes);

      const col = await services.collections.create({
        slug: "tech",
        title: "Tech",
      });
      const root = await services.posts.create({
        format: "note",
        bodyMarkdown: "root",
      });
      const child = await services.posts.create({
        format: "note",
        bodyMarkdown: "child",
        replyToId: root.id,
      });

      const res = await app.request(`/api/collections/${col.id}/threads`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ threadId: child.id }),
      });

      expect(res.status).toBe(201);
      expect(await services.collections.getThreadIds(col.id)).toEqual([
        root.id,
      ]);
    });

    it("returns 404 for non-existent collection", async () => {
      const { app, services } = createTestApp({ authenticated: true });
      app.route("/api/collections", collectionsApiRoutes);
      const missingId = createEntityId("collection");

      const post = await services.posts.create({
        format: "note",
        bodyMarkdown: "test",
      });

      const res = await app.request(`/api/collections/${missingId}/threads`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ threadId: post.id }),
      });

      expect(res.status).toBe(404);
    });

    it("returns 401 when not authenticated", async () => {
      const { app, services } = createTestApp({ authenticated: false });
      app.route("/api/collections", collectionsApiRoutes);

      const col = await services.collections.create({
        slug: "tech",
        title: "Tech",
      });

      const res = await app.request(`/api/collections/${col.id}/threads`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          threadId: "00000000-0000-0000-0000-000000000001",
        }),
      });

      expect(res.status).toBe(401);
    });
  });

  describe("DELETE /api/collections/:id/threads/:threadId", () => {
    it("removes a thread from a collection", async () => {
      const { app, services } = createTestApp({ authenticated: true });
      app.route("/api/collections", collectionsApiRoutes);

      const col = await services.collections.create({
        slug: "tech",
        title: "Tech",
      });
      const post = await services.posts.create({
        format: "note",
        bodyMarkdown: "test",
      });

      await services.collections.addThread(col.id, post.id);

      const res = await app.request(
        `/api/collections/${col.id}/threads/${post.id}`,
        { method: "DELETE" },
      );

      expect(res.status).toBe(200);

      const threadIds = await services.collections.getThreadIds(col.id);
      expect(threadIds).not.toContain(post.id);
    });
  });

  describe("PUT/DELETE /api/collections/:id/threads/:threadId/pin", () => {
    it("pins and unpins the whole thread when given a child post ID", async () => {
      const { app, services } = createTestApp({ authenticated: true });
      app.route("/api/collections", collectionsApiRoutes);

      const col = await services.collections.create({
        slug: "tech",
        title: "Tech",
      });
      const root = await services.posts.create({
        format: "note",
        bodyMarkdown: "root",
      });
      const child = await services.posts.create({
        format: "note",
        bodyMarkdown: "child",
        replyToId: root.id,
      });
      await services.collections.addThread(col.id, root.id);

      const pinRes = await app.request(
        `/api/collections/${col.id}/threads/${child.id}/pin`,
        { method: "PUT" },
      );

      expect(pinRes.status).toBe(200);
      expect(await services.collections.getPinnedThreadIds([col.id])).toEqual(
        new Set([root.id]),
      );

      const unpinRes = await app.request(
        `/api/collections/${col.id}/threads/${child.id}/pin`,
        { method: "DELETE" },
      );

      expect(unpinRes.status).toBe(200);
      expect(await services.collections.getPinnedThreadIds([col.id])).toEqual(
        new Set(),
      );
    });
  });
});
