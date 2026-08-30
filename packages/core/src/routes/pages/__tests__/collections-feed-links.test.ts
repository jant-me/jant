/**
 * Collection feeds in the directory.
 *
 * `/subscribe` lists only the site-wide feeds, so this is the one place a
 * reader is handed a collection's feed. If these icons go, collection feeds
 * become undiscoverable outside the collection's own page.
 */

import { describe, expect, it } from "vitest";
import { createTestApp } from "../../../__tests__/helpers/app.js";
import { i18nMiddleware } from "../../../i18n/index.js";
import { collectionsPageRoutes } from "../collections.js";

function createDirectoryTestApp() {
  const testApp = createTestApp();
  const { app } = testApp;

  app.use("*", async (c, next) => {
    c.set("publicPath", c.req.path);
    c.set("publicRequestUrl", c.req.url);
    await next();
  });
  app.use("*", i18nMiddleware());
  app.route("/collections", collectionsPageRoutes);

  return testApp;
}

/** Every feed address the directory offers, in document order. */
function feedHrefs(html: string): string[] {
  return [...html.matchAll(/<a href="([^"]*)" class="feed-link"/g)].map(
    (match) => match[1] as string,
  );
}

async function seedCollection(
  services: ReturnType<typeof createTestApp>["services"],
  slug: string,
) {
  const collection = await services.collections.create({
    slug,
    title: slug,
  });
  const post = await services.posts.create({
    format: "note",
    bodyMarkdown: `A post in ${slug}`,
    status: "published",
  });
  await services.collections.addThread(collection.id, post.id);
}

describe("collections directory feed links", () => {
  it("offers each collection's feed beside it", async () => {
    const { app, services } = createDirectoryTestApp();
    await seedCollection(services, "reading");
    await seedCollection(services, "cooking");

    const html = await (await app.request("/collections")).text();

    expect(feedHrefs(html).sort()).toEqual(["/cooking/feed", "/reading/feed"]);
  });

  it("offers nothing when feeds are switched off site-wide", async () => {
    const { app, services } = createDirectoryTestApp();
    await seedCollection(services, "reading");
    await services.settings.set("RSS_FEEDS_ENABLED", "false");

    const html = await (await app.request("/collections")).text();

    expect(feedHrefs(html)).toEqual([]);
  });
});
