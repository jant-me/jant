import { describe, it, expect } from "vitest";
import { createTestApp } from "../../../__tests__/helpers/app.js";
import { searchApiRoutes } from "../search.js";

/** Wraps plain text in a minimal valid TipTap JSON document. */
function tiptapDoc(text: string): string {
  return JSON.stringify({
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [{ type: "text", text }],
      },
    ],
  });
}

/** The author API under test, signed in unless a test says otherwise. */
function setup(options: { authenticated?: boolean } = {}) {
  const testApp = createTestApp({
    authenticated: options.authenticated ?? true,
    fts: true,
  });
  testApp.app.route("/api/search", searchApiRoutes);
  return testApp;
}

describe("Search API Routes", () => {
  it("returns 400 when query is missing", async () => {
    const { app } = setup();

    const res = await app.request("/api/search");
    expect(res.status).toBe(400);

    const body = await res.json();
    expect(body.error).toContain("'q' is required");
  });

  it("returns 400 for empty query", async () => {
    const { app } = setup();

    const res = await app.request("/api/search?q=");
    expect(res.status).toBe(400);
  });

  it("returns 400 for query over 200 characters", async () => {
    const { app } = setup();

    const longQuery = "a".repeat(201);
    const res = await app.request(`/api/search?q=${longQuery}`);
    expect(res.status).toBe(400);

    const body = await res.json();
    expect(body.error).toBe(
      "Query parameter 'q' is longer than 200 characters",
    );
  });

  it("returns search results for valid query", async () => {
    const { app, services } = setup();

    await services.posts.create({
      format: "note",
      body: tiptapDoc("Testing search functionality in jant"),
    });

    const res = await app.request("/api/search?q=jant");
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.query).toBe("jant");
    expect(body.results.length).toBeGreaterThanOrEqual(1);
    expect(body.count).toBeGreaterThanOrEqual(1);
    expect(body.results[0].permalink).toMatch(/^\/[a-z0-9]/);
  });

  it("links a result by its custom URL", async () => {
    const { app, services } = setup();
    await services.posts.create({
      format: "note",
      body: tiptapDoc("A post about jant"),
      path: "blog/about-jant",
    });

    const res = await app.request("/api/search?q=jant");
    expect((await res.json()).results[0].permalink).toBe("/blog/about-jant");
  });

  it("returns quote attribution as sourceName/sourceUrl", async () => {
    const { app, services } = setup();

    await services.posts.create({
      format: "quote",
      title: "Marcus Aurelius",
      url: "https://example.com/meditations",
      quoteText: "What stands in the way becomes the way.",
    });

    const res = await app.request("/api/search?q=Marcus");
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.results).toHaveLength(1);
    expect(body.results[0].format).toBe("quote");
    expect(body.results[0].sourceName).toBe("Marcus Aurelius");
    expect(body.results[0].sourceUrl).toBe("https://example.com/meditations");
    expect(body.results[0].permalink).toMatch(/^\/[a-z0-9]/);
    expect(body.results[0]).not.toHaveProperty("title");
    expect(body.results[0]).not.toHaveProperty("url");
  });

  it("returns empty results for non-matching query", async () => {
    const { app } = setup();

    const res = await app.request("/api/search?q=zznonexistentzzz");
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.results).toEqual([]);
    expect(body.count).toBe(0);
  });

  describe("private posts", () => {
    async function seedPrivateThread(
      services: ReturnType<typeof createTestApp>["services"],
    ) {
      const root = await services.posts.create({
        format: "note",
        title: "Secret diary",
        body: tiptapDoc("Private root about lanterns"),
        visibility: "private",
      });
      await services.posts.create({
        format: "note",
        body: tiptapDoc("Private reply about lanterns"),
        replyToId: root.id,
      });
      await services.posts.create({
        format: "note",
        title: "Public notes",
        body: tiptapDoc("Public post about lanterns"),
      });
    }

    it("finds private posts and replies in a private Thread, with their visibility", async () => {
      const { app, services } = setup();
      await seedPrivateThread(services);

      const res = await app.request("/api/search?q=lanterns");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.count).toBe(3);
      const byVisibility = body.results
        .map((r: { visibility: string }) => r.visibility)
        .sort();
      expect(byVisibility).toEqual(["private", "private", "public"]);

      const titleRes = await app.request("/api/search?q=Secret");
      const titleBody = await titleRes.json();
      expect(titleBody.count).toBe(1);
      expect(titleBody.results[0]).toMatchObject({
        title: "Secret diary",
        visibility: "private",
      });
    });
  });

  describe("limit", () => {
    async function seedMatches(
      services: ReturnType<typeof createTestApp>["services"],
    ) {
      for (let i = 0; i < 3; i++) {
        await services.posts.create({
          format: "note",
          body: tiptapDoc(`Lantern note number ${i}`),
        });
      }
    }

    it.each(["-1", "0", "-500"])(
      "raises limit=%s to one result",
      async (limit) => {
        const { app, services } = setup();
        await seedMatches(services);

        const res = await app.request(`/api/search?q=lantern&limit=${limit}`);
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.count).toBe(1);
      },
    );

    it("refuses a limit that isn't a number", async () => {
      const { app, services } = setup();
      await seedMatches(services);

      const res = await app.request("/api/search?q=lantern&limit=abc");
      expect(res.status).toBe(400);
    });

    it("keeps a limit within range as given", async () => {
      const { app, services } = setup();
      await seedMatches(services);

      const res = await app.request("/api/search?q=lantern&limit=2");
      const body = await res.json();
      expect(body.count).toBe(2);
    });
  });

  describe("authentication", () => {
    it("returns 401 to a signed-out caller", async () => {
      const { app, services } = setup({ authenticated: false });
      await services.posts.create({
        format: "note",
        body: tiptapDoc("Public post about lanterns"),
      });

      const res = await app.request("/api/search?q=lanterns");
      expect(res.status).toBe(401);
    });

    it("accepts a Bearer token", async () => {
      const { app, services } = setup({ authenticated: false });
      const { plaintext } = await services.apiTokens.create("Test client");
      await services.posts.create({
        format: "note",
        title: "Secret diary",
        body: tiptapDoc("Private root about lanterns"),
        visibility: "private",
      });

      const res = await app.request("/api/search?q=lanterns", {
        headers: { Authorization: `Bearer ${plaintext}` },
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.results[0]).toMatchObject({
        title: "Secret diary",
        visibility: "private",
      });
    });
  });

  it("does not rate-limit the author", async () => {
    // The per-client search limit (30/min in the test app) belongs to the
    // reader's `/search` page, not to the author API.
    const { app } = setup();

    const headers = { "cf-connecting-ip": "203.0.113.7" };
    for (let i = 0; i < 40; i++) {
      const res = await app.request("/api/search?q=hi", { headers });
      expect(res.status).toBe(200);
    }
  });
});
