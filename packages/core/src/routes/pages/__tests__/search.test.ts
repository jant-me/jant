import { describe, expect, it } from "vitest";
import { createTestApp } from "../../../__tests__/helpers/app.js";
import { searchRoutes } from "../search.js";

describe("Search Page Routes", () => {
  it("hides visible Thread collection tags on a matching child post", async () => {
    const { app, services } = createTestApp({ fts: true });
    app.route("/search", searchRoutes);

    const collection = await services.collections.create({
      slug: "search-thread",
      title: "Search Thread Collection",
    });
    const root = await services.posts.create({
      format: "note",
      bodyMarkdown: "Thread root",
    });
    await services.posts.create({
      format: "note",
      bodyMarkdown: "Unique child search marker",
      replyToId: root.id,
    });
    await services.collections.addThread(collection.id, root.id);

    const response = await app.request("/search?q=marker");

    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain("Unique child search");
    expect(html).toContain("<mark>marker</mark>");
    expect(html).not.toContain("Search Thread Collection");
  });

  it("shows Thread collection tags on a matching root post", async () => {
    const { app, services } = createTestApp({ fts: true });
    app.route("/search", searchRoutes);

    const collection = await services.collections.create({
      slug: "search-root",
      title: "Root Search Collection",
    });
    const root = await services.posts.create({
      format: "note",
      bodyMarkdown: "Unique root search marker",
    });
    await services.collections.addThread(collection.id, root.id);

    const response = await app.request("/search?q=marker");

    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain("Unique root search");
    expect(html).toContain("<mark>marker</mark>");
    expect(html).toContain("Root Search Collection");
  });
});
