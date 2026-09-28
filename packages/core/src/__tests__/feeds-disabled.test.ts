/**
 * With feeds off, every feed route answers 404, and nothing else does.
 *
 * The switch used to be a middleware that matched any path ending in `/feed`,
 * which also took down a post whose custom URL happens to end that way. It
 * now lives in the routes that render a feed; this walks the whole app to
 * check that each of them still refuses.
 */

import { describe, expect, it } from "vitest";
import { createApp } from "../app.js";
import type { Database } from "../db/index.js";
import { createServices } from "../services/index.js";
import type { Bindings } from "../types.js";
import { createTestDatabase, DEFAULT_TEST_SITE_ID } from "./helpers/db.js";

const executionCtx = {
  waitUntil() {},
  passThroughOnException() {},
  props: {},
} as unknown as Parameters<ReturnType<typeof createApp>["fetch"]>[2];

async function createSite({ feeds }: { feeds: boolean }) {
  const { db, sqlite } = createTestDatabase();
  const services = createServices(
    db as unknown as Database,
    { query: async () => [] } as unknown as Parameters<
      typeof createServices
    >[1],
    DEFAULT_TEST_SITE_ID,
    { slugIdLength: 5 },
  );
  await services.settings.completeOnboarding();
  await services.settings.set("RSS_FEEDS_ENABLED", String(feeds));
  await services.collections.create({ slug: "reading", title: "Reading" });
  await services.collections.create({ slug: "movies", title: "Movies" });
  await services.smartCollections.create({
    slug: "quotes",
    title: "Quotes",
    selection: { format: "quote" },
  });
  const post = await services.posts.create({
    format: "note",
    title: "Field notes",
    bodyMarkdown: "Kept at an address that ends in feed.",
  });
  await services.customUrls.create({
    path: "notes/feed",
    targetType: "post",
    targetId: post.id,
  });

  const app = createApp();
  return (path: string) =>
    app.fetch(
      new Request(`https://blog.example${path}`),
      {
        SITE_ORIGIN: "https://blog.example",
        AUTH_SECRET: "x".repeat(40),
        NODE_SQLITE: sqlite,
      } as unknown as Bindings,
      executionCtx,
    );
}

const FEED_PATHS = [
  "/feed",
  "/feed/latest",
  "/feed/atom.xml",
  "/latest/feed",
  "/latest/feed/atom.xml",
  "/featured/feed",
  "/archive/feed",
  "/archive/feed/atom.xml",
  "/reading/feed",
  "/quotes/feed",
  "/collections/reading+movies/feed",
];

describe("feeds turned off", () => {
  it.each(FEED_PATHS)("answers 404 at %s", async (path) => {
    const get = await createSite({ feeds: false });
    expect((await get(path)).status).toBe(404);
  });

  // The same site with feeds on, so the 404s above are the switch's.
  it.each(FEED_PATHS)("answers at %s once feeds are on", async (path) => {
    const get = await createSite({ feeds: true });
    expect([200, 301, 308]).toContain((await get(path)).status);
  });

  it("still serves a post whose custom URL ends in /feed", async () => {
    const get = await createSite({ feeds: false });
    const res = await get("/notes/feed");
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("Field notes");
  });
});
