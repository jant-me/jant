import { describe, it, expect } from "vitest";
import { createTestApp } from "../../../__tests__/helpers/app.js";
import { createEntityId } from "../../../lib/ids.js";
import { navItemsApiRoutes } from "../nav-items.js";

describe("Nav Items API Routes", () => {
  describe("GET /api/nav-items", () => {
    it("returns empty list when no nav items exist", async () => {
      const { app } = createTestApp();
      app.route("/api/nav-items", navItemsApiRoutes);

      const res = await app.request("/api/nav-items");
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.navItems).toEqual([]);
    });

    it("returns nav items ordered by position", async () => {
      const { app, services } = createTestApp();
      app.route("/api/nav-items", navItemsApiRoutes);

      await services.navItems.create({
        type: "link",
        label: "Home",
        url: "/",
      });
      await services.navItems.create({
        type: "link",
        label: "Blog",
        url: "/blog",
      });

      const res = await app.request("/api/nav-items");
      const body = await res.json();

      expect(body.navItems).toHaveLength(2);
      expect(body.navItems[0].label).toBe("Home");
      expect(body.navItems[1].label).toBe("Blog");
    });
  });

  describe("GET /api/nav-items/pages", () => {
    it("requires authentication", async () => {
      const { app } = createTestApp({ authenticated: false });
      app.route("/api/nav-items", navItemsApiRoutes);

      const res = await app.request("/api/nav-items/pages");

      expect(res.status).toBe(401);
    });

    it("searches eligible page candidates", async () => {
      const { app, services } = createTestApp({ authenticated: true });
      app.route("/api/nav-items", navItemsApiRoutes);
      const page = await services.posts.create({
        format: "note",
        title: "About this site",
        slug: "about-this-site",
        visibility: "latest_hidden",
      });
      await services.posts.create({
        format: "link",
        title: "About elsewhere",
        slug: "about-elsewhere",
        url: "https://example.com",
      });

      const res = await app.request("/api/nav-items/pages?q=ABOUT");

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        pages: [
          {
            id: page.id,
            title: "About this site",
            slug: "about-this-site",
            updatedAt: expect.any(Number),
          },
        ],
      });
    });
  });

  describe("GET /api/nav-items/resolve", () => {
    it("requires authentication", async () => {
      const { app } = createTestApp({ authenticated: false });
      app.route("/api/nav-items", navItemsApiRoutes);

      const res = await app.request("/api/nav-items/resolve?url=/about");

      expect(res.status).toBe(401);
    });

    async function resolve(
      app: ReturnType<typeof createTestApp>["app"],
      url: string,
    ) {
      const res = await app.request(
        `/api/nav-items/resolve?url=${encodeURIComponent(url)}`,
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        resolution: {
          kind: string;
          address: string;
          page?: { id: string; title: string };
          collection?: { id: string };
        };
      };
      return body.resolution;
    }

    it("finds the page at a pasted address, however it was written", async () => {
      const { app, services } = createTestApp({ authenticated: true });
      app.route("/api/nav-items", navItemsApiRoutes);
      const page = await services.posts.create({
        format: "note",
        title: "About this site",
        slug: "about-this-site",
        visibility: "latest_hidden",
      });

      for (const address of [
        "/about-this-site",
        "about-this-site",
        "http://localhost:8787/about-this-site",
        "/about-this-site?ref=twitter",
      ]) {
        expect(await resolve(app, address)).toEqual({
          kind: "page",
          address: "/about-this-site",
          page: expect.objectContaining({
            id: page.id,
            title: "About this site",
          }),
        });
      }
    });

    it("resolves a collection address to a collection item", async () => {
      const { app, services } = createTestApp({ authenticated: true });
      app.route("/api/nav-items", navItemsApiRoutes);
      const collection = await services.collections.create({
        title: "Reading",
        slug: "reading",
      });

      expect(await resolve(app, "/reading")).toEqual({
        kind: "collection",
        address: "/reading",
        collection: { id: collection.id, title: "Reading", slug: "reading" },
      });
    });

    it("says what is wrong rather than coming back empty", async () => {
      const { app, services } = createTestApp({ authenticated: true });
      app.route("/api/nav-items", navItemsApiRoutes);
      const draft = await services.posts.create({
        format: "note",
        title: "Draft page",
        slug: "draft-page",
        status: "draft",
      });
      const secret = await services.posts.create({
        format: "note",
        title: "Secret page",
        slug: "secret-page",
        visibility: "private",
      });
      const untitled = await services.posts.create({
        format: "note",
        slug: "untitled-page",
        body: JSON.stringify({
          type: "doc",
          content: [{ type: "paragraph" }],
        }),
      });

      expect((await resolve(app, `/${draft.slug}`)).kind).toBe("unpublished");
      expect((await resolve(app, `/${secret.slug}`)).kind).toBe("private");
      expect((await resolve(app, `/${untitled.slug}`)).kind).toBe("untitled");
      expect(await resolve(app, "/no-such-page")).toEqual({
        kind: "not_found",
        address: "/no-such-page",
      });
    });

    it("hands an off-site address back for the link form", async () => {
      const { app } = createTestApp({ authenticated: true });
      app.route("/api/nav-items", navItemsApiRoutes);

      expect(await resolve(app, "https://example.com/hello")).toEqual({
        kind: "external",
        address: "https://example.com/hello",
      });
    });
  });

  describe("POST /api/nav-items", () => {
    it("returns 401 when not authenticated", async () => {
      const { app } = createTestApp({ authenticated: false });
      app.route("/api/nav-items", navItemsApiRoutes);

      const res = await app.request("/api/nav-items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "link",
          label: "Home",
          url: "/",
        }),
      });

      expect(res.status).toBe(401);
    });

    it("creates a nav item when authenticated", async () => {
      const { app } = createTestApp({ authenticated: true });
      app.route("/api/nav-items", navItemsApiRoutes);

      const res = await app.request("/api/nav-items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "link",
          label: "GitHub",
          url: "https://github.com",
        }),
      });

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.label).toBe("GitHub");
      expect(body.url).toBe("https://github.com");
      expect(body.type).toBe("link");
      expect(body.headerHtml).toBeUndefined();
    });

    it("includes a site header fragment for navigation editor requests", async () => {
      const { app } = createTestApp({ authenticated: true });
      app.route("/api/nav-items", navItemsApiRoutes);

      const res = await app.request("/api/nav-items", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Jant-Site-Header": "include",
        },
        body: JSON.stringify({
          type: "link",
          label: "Docs",
          url: "/docs",
        }),
      });

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.label).toBe("Docs");
      expect(body.headerHtml).toContain('data-site-header-fragment="header"');
      expect(body.headerHtml).toContain('data-site-header-fragment="drawer"');
      expect(body.headerHtml).toContain("Docs");
    });

    it("creates a system nav item when authenticated", async () => {
      const { app } = createTestApp({ authenticated: true });
      app.route("/api/nav-items", navItemsApiRoutes);

      const res = await app.request("/api/nav-items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "system",
          systemKey: "archive",
        }),
      });

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.type).toBe("system");
      expect(body.systemKey).toBe("archive");
      expect(body.url).toBe("/archive");
      expect(body.label).toBe("");
      expect(body.placement).toBe("header");
    });

    it("uses built-in default placements for new system nav items", async () => {
      const { app } = createTestApp({ authenticated: true });
      app.route("/api/nav-items", navItemsApiRoutes);

      const latestRes = await app.request("/api/nav-items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "system",
          systemKey: "latest",
        }),
      });
      const rssRes = await app.request("/api/nav-items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "system",
          systemKey: "rss",
        }),
      });

      expect((await latestRes.json()).placement).toBe("header");
      expect((await rssRes.json()).placement).toBe("more");
    });

    it("returns 400 for missing required fields", async () => {
      const { app } = createTestApp({ authenticated: true });
      app.route("/api/nav-items", navItemsApiRoutes);

      const res = await app.request("/api/nav-items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "link" }),
      });

      expect(res.status).toBe(400);
    });

    it("returns 400 for unknown system nav keys", async () => {
      const { app } = createTestApp({ authenticated: true });
      app.route("/api/nav-items", navItemsApiRoutes);

      const res = await app.request("/api/nav-items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "system",
          systemKey: "unknown",
        }),
      });

      expect(res.status).toBe(400);
    });

    it("returns 400 for duplicate system nav items", async () => {
      const { app } = createTestApp({ authenticated: true });
      app.route("/api/nav-items", navItemsApiRoutes);

      await app.request("/api/nav-items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "system",
          systemKey: "archive",
        }),
      });

      const res = await app.request("/api/nav-items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "system",
          systemKey: "archive",
        }),
      });

      expect(res.status).toBe(400);
    });
  });

  describe("PUT /api/nav-items/:id/move", () => {
    it("moves a nav item between two others", async () => {
      const { app, services } = createTestApp({ authenticated: true });
      app.route("/api/nav-items", navItemsApiRoutes);

      const item1 = await services.navItems.create({
        type: "link",
        label: "First",
        url: "/first",
      });
      const item2 = await services.navItems.create({
        type: "link",
        label: "Second",
        url: "/second",
      });
      const item3 = await services.navItems.create({
        type: "link",
        label: "Third",
        url: "/third",
      });

      // Move Third between First and Second
      const res = await app.request(`/api/nav-items/${item3.id}/move`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          after: item1.id,
          before: item2.id,
        }),
      });

      expect(res.status).toBe(200);

      const items = await services.navItems.list();
      expect(items[0]?.label).toBe("First");
      expect(items[1]?.label).toBe("Third");
      expect(items[2]?.label).toBe("Second");
    });

    it("returns 404 for non-existent item", async () => {
      const { app } = createTestApp({ authenticated: true });
      app.route("/api/nav-items", navItemsApiRoutes);
      const missingId = createEntityId("navItem");

      const res = await app.request(`/api/nav-items/${missingId}/move`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ after: null, before: null }),
      });

      expect(res.status).toBe(404);
    });
  });

  describe("PUT /api/nav-items/:id", () => {
    it("updates a nav item when authenticated", async () => {
      const { app, services } = createTestApp({ authenticated: true });
      app.route("/api/nav-items", navItemsApiRoutes);

      const item = await services.navItems.create({
        type: "link",
        label: "Old Label",
        url: "/old",
      });

      const res = await app.request(`/api/nav-items/${item.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: "New Label" }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.label).toBe("New Label");
    });

    it("returns 404 for non-existent item", async () => {
      const { app } = createTestApp({ authenticated: true });
      app.route("/api/nav-items", navItemsApiRoutes);
      const missingId = createEntityId("navItem");

      const res = await app.request(`/api/nav-items/${missingId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: "test" }),
      });

      expect(res.status).toBe(404);
    });

    it("allows editing built-in system labels", async () => {
      const { app, services } = createTestApp({ authenticated: true });
      app.route("/api/nav-items", navItemsApiRoutes);

      const item = await services.navItems.create({
        type: "system",
        systemKey: "settings",
      });

      const res = await app.request(`/api/nav-items/${item.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: "Admin" }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.label).toBe("Admin");
    });

    it("rejects editing built-in system URLs", async () => {
      const { app, services } = createTestApp({ authenticated: true });
      app.route("/api/nav-items", navItemsApiRoutes);

      const item = await services.navItems.create({
        type: "system",
        systemKey: "settings",
      });

      const res = await app.request(`/api/nav-items/${item.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: "/custom-settings" }),
      });

      expect(res.status).toBe(400);
    });
  });

  describe("POST /api/nav-items (collection)", () => {
    it("creates a collection nav item with auto-resolved label and URL", async () => {
      const { app, services } = createTestApp({ authenticated: true });
      app.route("/api/nav-items", navItemsApiRoutes);

      // Create a collection via service
      const collection = await services.collections.create({
        title: "Design Notes",
        slug: "design-notes",
      });

      const res = await app.request("/api/nav-items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "collection",
          collectionId: collection.id,
        }),
      });

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.type).toBe("collection");
      expect(body.collectionId).toBe(collection.id);
      // No label of its own: the item follows the collection's title.
      expect(body.label).toBe("");
      expect(body.targetTitle).toBe("Design Notes");
      expect(body.url).toBe("/design-notes");
    });

    it("uses custom label when provided", async () => {
      const { app, services } = createTestApp({ authenticated: true });
      app.route("/api/nav-items", navItemsApiRoutes);

      const collection = await services.collections.create({
        title: "Design Notes",
        slug: "design-notes",
      });

      const res = await app.request("/api/nav-items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "collection",
          collectionId: collection.id,
          label: "Design",
        }),
      });

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.label).toBe("Design");
    });

    it("returns 404 for non-existent collection", async () => {
      const { app } = createTestApp({ authenticated: true });
      app.route("/api/nav-items", navItemsApiRoutes);

      const res = await app.request("/api/nav-items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "collection",
          collectionId: "col_nonexistent000000000000000",
        }),
      });

      expect(res.status).toBe(404);
    });

    it("returns 400 for duplicate collection nav items", async () => {
      const { app, services } = createTestApp({ authenticated: true });
      app.route("/api/nav-items", navItemsApiRoutes);

      const collection = await services.collections.create({
        title: "Design",
        slug: "design",
      });

      await app.request("/api/nav-items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "collection",
          collectionId: collection.id,
        }),
      });

      const res = await app.request("/api/nav-items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "collection",
          collectionId: collection.id,
        }),
      });

      expect(res.status).toBe(400);
    });
  });

  describe("POST /api/nav-items (page)", () => {
    it("derives the page label and URL from the selected post", async () => {
      const { app, services } = createTestApp({ authenticated: true });
      app.route("/api/nav-items", navItemsApiRoutes);
      const page = await services.posts.create({
        format: "note",
        title: "About me",
        slug: "about-me",
        visibility: "latest_hidden",
      });

      const res = await app.request("/api/nav-items", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Jant-Site-Header": "include",
        },
        body: JSON.stringify({ type: "page", postId: page.id }),
      });

      expect(res.status).toBe(201);
      expect(await res.json()).toMatchObject({
        type: "page",
        postId: page.id,
        // No label of its own: the item follows the page's title, which is
        // what the rendered header shows.
        label: "",
        targetTitle: "About me",
        url: "/about-me",
        headerHtml: expect.stringContaining("About me"),
      });
    });

    it("rejects a Link post as a page", async () => {
      const { app, services } = createTestApp({ authenticated: true });
      app.route("/api/nav-items", navItemsApiRoutes);
      const link = await services.posts.create({
        format: "link",
        title: "Elsewhere",
        url: "https://example.com",
      });

      const res = await app.request("/api/nav-items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "page", postId: link.id }),
      });

      expect(res.status).toBe(400);
    });
  });

  describe("DELETE /api/nav-items/:id", () => {
    it("returns 401 when not authenticated", async () => {
      const { app, services } = createTestApp({ authenticated: false });
      app.route("/api/nav-items", navItemsApiRoutes);

      const item = await services.navItems.create({
        type: "link",
        label: "Delete Me",
        url: "/delete",
      });

      const res = await app.request(`/api/nav-items/${item.id}`, {
        method: "DELETE",
      });

      expect(res.status).toBe(401);
    });

    it("deletes a nav item when authenticated", async () => {
      const { app, services } = createTestApp({ authenticated: true });
      app.route("/api/nav-items", navItemsApiRoutes);

      const item = await services.navItems.create({
        type: "link",
        label: "Delete Me",
        url: "/delete",
      });

      const res = await app.request(`/api/nav-items/${item.id}`, {
        method: "DELETE",
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
    });

    it("returns 404 for non-existent item", async () => {
      const { app } = createTestApp({ authenticated: true });
      app.route("/api/nav-items", navItemsApiRoutes);
      const missingId = createEntityId("navItem");

      const res = await app.request(`/api/nav-items/${missingId}`, {
        method: "DELETE",
      });

      expect(res.status).toBe(404);
    });
  });
});
