/**
 * Feed autodiscovery in `<head>`.
 *
 * A page that publishes its own feed must advertise it, so a reader's
 * extension subscribing from `/reading` gets the Reading collection — not
 * only the site-wide feeds every page carries.
 */

import { describe, expect, it } from "vitest";
import { createTestApp } from "../../../__tests__/helpers/app.js";
import { i18nMiddleware } from "../../../i18n/index.js";
import { archiveRoutes } from "../archive.js";
import { collectionRoutes } from "../collection.js";
import { collectionsPageRoutes } from "../collections.js";
import { languageRoutes } from "../language.js";
import { pageRoutes } from "../page.js";

function createFeedLinkTestApp() {
  const testApp = createTestApp();
  const { app } = testApp;

  app.use("*", async (c, next) => {
    c.set("publicPath", c.req.path);
    c.set("publicRequestUrl", c.req.url);
    await next();
  });
  app.use("*", i18nMiddleware());

  app.route("/archive", archiveRoutes);
  app.route("/collections", collectionsPageRoutes);
  app.route("/collections", collectionRoutes);
  app.route("/:lang", languageRoutes);
  app.route("/", pageRoutes);

  return testApp;
}

/** Every `<link rel="alternate" type="application/atom+xml">` in document order. */
function feedLinks(html: string): { title?: string; href: string }[] {
  const matches = html.matchAll(
    /<link rel="alternate" type="application\/atom\+xml"(?: title="([^"]*)")? href="([^"]*)"\/?>/g,
  );
  return [...matches].map((match) => ({
    title: match[1],
    href: match[2] as string,
  }));
}

async function createCollectionWithPost(
  services: ReturnType<typeof createTestApp>["services"],
  {
    slug,
    title,
    postTitle,
  }: { slug: string; title: string; postTitle: string },
) {
  const collection = await services.collections.create({ slug, title });
  const post = await services.posts.create({
    format: "note",
    title: postTitle,
    bodyMarkdown: postTitle,
    status: "published",
  });
  await services.collections.addThread(collection.id, post.id);
  return collection;
}

describe("feed autodiscovery links", () => {
  it("advertises a collection's own feed ahead of the site feeds", async () => {
    const { app, services } = createFeedLinkTestApp();
    await createCollectionWithPost(services, {
      slug: "reading",
      title: "Reading",
      postTitle: "Book log",
    });

    const html = await (await app.request("/reading")).text();

    expect(feedLinks(html)[0]).toEqual({
      title: "Reading",
      href: "/reading/feed",
    });
    expect(html).toContain('href="/feed"');
  });

  it("advertises the combined feed on an aggregate collection page", async () => {
    const { app, services } = createFeedLinkTestApp();
    await createCollectionWithPost(services, {
      slug: "reading",
      title: "Reading",
      postTitle: "Book log",
    });
    await createCollectionWithPost(services, {
      slug: "movies",
      title: "Movies",
      postTitle: "Film log",
    });

    const html = await (
      await app.request("/collections/reading+movies")
    ).text();

    expect(feedLinks(html)[0]?.href).toBe("/collections/reading+movies/feed");
  });

  it("advertises the archive feed, carrying the active filters", async () => {
    const { app } = createFeedLinkTestApp();

    const plain = await (await app.request("/archive")).text();
    expect(feedLinks(plain)[0]).toEqual({
      title: "Archive",
      href: "/archive/feed",
    });

    const filtered = await (await app.request("/archive?format=note")).text();
    expect(feedLinks(filtered)[0]).toEqual({
      title: "Archive: Notes",
      href: "/archive/feed?format=note",
    });
  });

  it("points at the language view's feed inside a language view", async () => {
    const { app, services } = createFeedLinkTestApp();
    await services.settings.set("SITE_LANGUAGE", "zh-Hans");
    await services.settings.set("ADDITIONAL_LANGUAGES", "en");
    await services.settings.set("MULTILINGUAL_ENABLED", "true");

    const html = await (await app.request("/en/archive")).text();

    expect(feedLinks(html)[0]?.href).toBe("/en/archive/feed");
  });

  it("drops the page feed link when feed publishing is off", async () => {
    const { app, services } = createFeedLinkTestApp();
    await services.settings.set("RSS_FEEDS_ENABLED", "false");
    await createCollectionWithPost(services, {
      slug: "reading",
      title: "Reading",
      postTitle: "Book log",
    });

    const collectionHtml = await (await app.request("/reading")).text();
    const archiveHtml = await (await app.request("/archive")).text();

    expect(feedLinks(collectionHtml)).toHaveLength(0);
    expect(feedLinks(archiveHtml)).toHaveLength(0);
  });
});
