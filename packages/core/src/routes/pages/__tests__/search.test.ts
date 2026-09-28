import { describe, expect, it } from "vitest";
import { createTestApp } from "../../../__tests__/helpers/app.js";
import { searchRoutes } from "../search.js";

describe("Search Page Routes", () => {
  it("keeps public HTML search available when anonymous JSON APIs are off", async () => {
    const { app, services } = createTestApp({
      authenticated: false,
      fts: true,
    });
    await services.settings.set("PUBLIC_API_ENABLED", "false");
    app.route("/search", searchRoutes);

    const response = await app.request("/search?q=marker");

    expect(response.status).toBe(200);
  });

  describe("private posts", () => {
    async function seedPrivateThread(
      services: ReturnType<typeof createTestApp>["services"],
    ) {
      const root = await services.posts.create({
        format: "note",
        title: "Secret diary",
        bodyMarkdown: "Private root about lanterns",
        visibility: "private",
      });
      await services.posts.create({
        format: "note",
        bodyMarkdown: "Private reply about lanterns",
        replyToId: root.id,
      });
      await services.posts.create({
        format: "note",
        title: "Public notes",
        bodyMarkdown: "Public post about lanterns",
      });
    }

    it("leaves out private posts and replies in a private Thread for a signed-out reader", async () => {
      const { app, services } = createTestApp({
        authenticated: false,
        fts: true,
      });
      app.route("/search", searchRoutes);
      await seedPrivateThread(services);

      const response = await app.request("/search?q=lanterns");

      expect(response.status).toBe(200);
      const html = await response.text();
      expect(html).toContain("Public notes");
      expect(html).not.toContain("Secret diary");
      expect(html).not.toContain("Private root");
      expect(html).not.toContain("Private reply");
    });

    it("includes them for the signed-in author", async () => {
      const { app, services } = createTestApp({
        authenticated: true,
        fts: true,
      });
      app.route("/search", searchRoutes);
      await seedPrivateThread(services);

      const response = await app.request("/search?q=lanterns");

      expect(response.status).toBe(200);
      const html = await response.text();
      expect(html).toContain("Public notes");
      expect(html).toContain("Secret diary");
      expect(html).toContain("Private reply");
    });
  });

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

  describe("rate limit", () => {
    // The test app uses the default limit of 30 searches per minute.
    const headers = { "cf-connecting-ip": "203.0.113.9" };

    it("answers a signed-out reader's 31st search in a minute with 429", async () => {
      const { app } = createTestApp({ authenticated: false, fts: true });
      app.route("/search", searchRoutes);

      for (let i = 0; i < 30; i++) {
        const res = await app.request("/search?q=lanterns", { headers });
        expect(res.status).toBe(200);
      }
      const limited = await app.request("/search?q=lanterns", { headers });

      expect(limited.status).toBe(429);
      expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
      const html = await limited.text();
      expect(html).toContain("Too many searches. Wait a minute and try again.");
      expect(html).not.toContain("No results");
    });

    it("doesn't count a visit without a query", async () => {
      const { app } = createTestApp({ authenticated: false, fts: true });
      app.route("/search", searchRoutes);

      for (let i = 0; i < 40; i++) {
        expect((await app.request("/search", { headers })).status).toBe(200);
      }
      expect(
        (await app.request("/search?q=lanterns", { headers })).status,
      ).toBe(200);
    });

    it("doesn't limit the signed-in author", async () => {
      const { app } = createTestApp({ authenticated: true, fts: true });
      app.route("/search", searchRoutes);

      for (let i = 0; i < 40; i++) {
        const res = await app.request("/search?q=lanterns", { headers });
        expect(res.status).toBe(200);
      }
    });

    it.each([
      ["rate limiting is off", { enabled: false }],
      ["the search limit is 0", { searchPerMinute: 0 }],
    ])("doesn't limit anyone when %s", async (_label, rateLimit) => {
      const { app } = createTestApp({ authenticated: false, fts: true });
      app.use("/search", async (c, next) => {
        c.set("appConfig", {
          ...c.var.appConfig,
          rateLimit: { ...c.var.appConfig.rateLimit, ...rateLimit },
        });
        await next();
      });
      app.route("/search", searchRoutes);

      for (let i = 0; i < 40; i++) {
        const res = await app.request("/search?q=lanterns", { headers });
        expect(res.status).toBe(200);
      }
    });
  });
});
