import { beforeEach, describe, expect, it } from "vitest";
import { createTestApp } from "../../__tests__/helpers/app.js";
import { archiveRoutes } from "../pages/archive.js";
import { collectionRoutes } from "../pages/collection.js";
import { collectionsPageRoutes } from "../pages/collections.js";
import { featuredRoutes } from "../pages/featured.js";
import { latestRoutes } from "../pages/latest.js";
import { pageRoutes } from "../pages/page.js";
import { feedRoutes } from "../feed/feed.js";

/**
 * The validator every feed surface carries.
 *
 * Six route modules assemble a feed, and each used to build its own Response.
 * They now share `renderFeed`, so what these tests hold in place is that the
 * sharing is real — a tag on every feed, not just on `/feed`, whose tests are
 * the ones anyone remembers to run.
 *
 * Turning that tag into a `304` belongs to `withConditionalResponse` at the
 * edge of the app, and is covered where it lives.
 */

const ETAG = /^"[0-9a-f]{32}"$/;

function setup() {
  const testApp = createTestApp({ rssPublishDelaySeconds: 0 });
  const { app } = testApp;

  app.use("*", async (c, next) => {
    c.set("publicPath", c.req.path);
    c.set("publicRequestUrl", c.req.url);
    await next();
  });

  app.route("/feed", feedRoutes);
  app.route("/latest", latestRoutes);
  app.route("/featured", featuredRoutes);
  app.route("/archive", archiveRoutes);
  app.route("/collections", collectionsPageRoutes);
  app.route("/collections", collectionRoutes);
  // The root namespace matches any slug, so it is mounted last.
  app.route("/", pageRoutes);

  return testApp;
}

/**
 * Seed every surface with an entry.
 *
 * An empty feed has no content timestamp to date itself by and falls back to
 * the current time, so its bytes — and its tag — change on every poll. Feeds
 * under test therefore all carry content.
 */
async function seed(services: ReturnType<typeof createTestApp>["services"]) {
  await services.posts.create({
    format: "note",
    title: "Featured note",
    bodyMarkdown: "Featured body",
    status: "published",
    featured: true,
  });
  await services.posts.create({
    format: "quote",
    title: "A quote",
    quoteText: "Something worth keeping",
    bodyMarkdown: "Quote body",
    status: "published",
  });

  for (const [slug, title] of [
    ["reading", "Reading"],
    ["movies", "Movies"],
  ] as const) {
    const collection = await services.collections.create({ slug, title });
    const post = await services.posts.create({
      format: "note",
      title: `${title} log`,
      bodyMarkdown: `${title} body`,
      status: "published",
    });
    await services.collections.addThread(collection.id, post.id);
  }

  await services.smartCollections.create({
    slug: "quotes",
    title: "Quotes",
    selection: { format: "quote" },
  });
}

const FEED_PATHS = [
  ["site main feed", "/feed"],
  ["latest", "/latest/feed"],
  ["featured", "/featured/feed"],
  ["archive", "/archive/feed"],
  ["single collection", "/reading/feed"],
  ["collection selection", "/collections/reading+movies/feed"],
  ["smart collection", "/quotes/feed"],
] as const;

describe("feed conditional GET", () => {
  let app: ReturnType<typeof createTestApp>["app"];
  let services: ReturnType<typeof createTestApp>["services"];

  beforeEach(async () => {
    const testApp = setup();
    app = testApp.app;
    services = testApp.services;
    await seed(services);
  });

  describe.each(FEED_PATHS)("%s (%s)", (_name, path) => {
    it("serves the feed with a strong validator", async () => {
      const res = await app.request(path);

      expect(res.status).toBe(200);
      expect(res.headers.get("ETag")).toMatch(ETAG);
      expect(res.headers.get("Cache-Control")).toBe("public, max-age=60");
      expect(res.headers.get("Content-Type")).toBe(
        "application/atom+xml; charset=utf-8",
      );
      expect(await res.text()).toContain("<feed");
    });

    it("re-derives the same tag for an unchanged feed", async () => {
      const first = await app.request(path);
      const second = await app.request(path);

      expect(second.headers.get("ETag")).toBe(first.headers.get("ETag"));
    });
  });

  it("issues a new tag once the feed changes", async () => {
    const before = await app.request("/latest/feed");
    const staleTag = before.headers.get("ETag") as string;

    await services.posts.create({
      format: "note",
      title: "Published after the poll",
      bodyMarkdown: "New body",
      status: "published",
    });

    const after = await app.request("/latest/feed");

    expect(after.headers.get("ETag")).not.toBe(staleTag);
    expect(await after.text()).toContain("Published after the poll");
  });

  it("gives two different feeds two different tags", async () => {
    const latest = await app.request("/latest/feed");
    const featured = await app.request("/featured/feed");

    expect(featured.headers.get("ETag")).not.toBe(latest.headers.get("ETag"));
  });
});
