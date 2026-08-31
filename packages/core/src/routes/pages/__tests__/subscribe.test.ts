/**
 * The subscribe page.
 *
 * What is under test is mostly the page's contract with readers: three feeds on
 * every site, whole addresses that survive being pasted into a reader, and the
 * right pair for whichever end `/feed` currently returns. Getting the pairing
 * wrong would list the same feed twice under two names — the confusion this
 * page exists to end.
 */

import { describe, expect, it } from "vitest";
import { createTestApp } from "../../../__tests__/helpers/app.js";
import { i18nMiddleware } from "../../../i18n/index.js";
import { languageRoutes } from "../language.js";
import { pageRoutes } from "../page.js";
import { subscribeRoutes } from "../subscribe.js";

function createSubscribeTestApp() {
  const testApp = createTestApp();
  const { app } = testApp;

  app.use("*", async (c, next) => {
    c.set("publicPath", c.req.path);
    c.set("publicRequestUrl", c.req.url);
    await next();
  });
  app.use("*", i18nMiddleware());

  app.route("/subscribe", subscribeRoutes);
  app.route("/:lang", languageRoutes);
  app.route("/", pageRoutes);

  return testApp;
}

/** Every address the page offers for copying, in document order. */
function feedAddresses(html: string): string[] {
  return [...html.matchAll(/<input[^>]*>/g)]
    .filter((match) => match[0].includes("data-copy-field-value"))
    .map((match) => /value="([^"]*)"/.exec(match[0])?.[1] ?? "");
}

/**
 * The addresses as paths, for asserting which feeds are offered without
 * pinning the test to the host the test app happens to run under.
 */
function feedPaths(html: string): string[] {
  return feedAddresses(html).map((address) => new URL(address).pathname);
}

/** Where each feed's name links, in document order. */
function labelLinks(html: string): string[] {
  return [
    ...html.matchAll(/<a href="([^"]*)" title="Open the page[^"]*"/g),
  ].map((match) => match[1] ?? "");
}

describe("subscribe page", () => {
  it("offers the main feed, the other end of the list, and the archive", async () => {
    const { app, services } = createSubscribeTestApp();
    await services.settings.set("MAIN_RSS_FEED", "latest");

    const res = await app.request("/subscribe");
    const html = await res.text();

    expect(res.status).toBe(200);
    expect(feedPaths(html)).toEqual([
      "/feed",
      "/featured/feed",
      "/archive/feed",
    ]);
  });

  // `/feed` already returns the featured posts here, so offering
  // `/featured/feed` beside it would be one feed under two names.
  it("offers the latest feed when the main feed is the featured one", async () => {
    const { app, services } = createSubscribeTestApp();
    await services.settings.set("MAIN_RSS_FEED", "featured");

    const html = await (await app.request("/subscribe")).text();

    expect(feedPaths(html)).toEqual(["/feed", "/latest/feed", "/archive/feed"]);
  });

  it("names the main feed by what it currently carries", async () => {
    const { app, services } = createSubscribeTestApp();
    await services.settings.set("MAIN_RSS_FEED", "latest");
    const latest = await (await app.request("/subscribe")).text();

    await services.settings.set("MAIN_RSS_FEED", "featured");
    const featured = await (await app.request("/subscribe")).text();

    expect(latest).toContain("The same posts as the home page.");
    expect(featured).toContain("Only the posts marked as featured.");
  });

  // Each feed is the feed of a page, and the page is the only honest preview
  // of what subscribing gets you — a sentence can only approximate it.
  it("links each feed to the page whose posts it carries", async () => {
    const { app, services } = createSubscribeTestApp();
    await services.settings.set("MAIN_RSS_FEED", "latest");

    const html = await (await app.request("/subscribe")).text();

    // `/latest` only redirects to `/`, so the latest feed links straight at
    // the home page rather than sending readers through a 302.
    expect(labelLinks(html)).toEqual(["/", "/featured", "/archive"]);
  });

  // The main feed is one of the other two under a different name. If its
  // description and its page link were built separately they could drift, and
  // the page would be describing one feed while linking at another.
  it("gives the main feed the same description and page as the feed it is", async () => {
    const { app, services } = createSubscribeTestApp();

    await services.settings.set("MAIN_RSS_FEED", "featured");
    const featured = await (await app.request("/subscribe")).text();
    // Main feed first, then the opposite end (`latest`), then the archive.
    expect(labelLinks(featured)).toEqual(["/featured", "/", "/archive"]);
    expect([
      ...featured.matchAll(/Only the posts marked as featured\./g),
    ]).toHaveLength(1);

    await services.settings.set("MAIN_RSS_FEED", "latest");
    const latest = await (await app.request("/subscribe")).text();
    expect(labelLinks(latest)).toEqual(["/", "/featured", "/archive"]);
  });

  // A reader who wants more than these two paragraphs needs somewhere to go,
  // and it must not be a page about Jant.
  it("points at an outside introduction, opened safely", async () => {
    const { app } = createSubscribeTestApp();

    const html = await (await app.request("/subscribe")).text();

    const link = /<a[^>]*href="https:\/\/aboutfeeds\.com\/"[^>]*>/.exec(
      html,
    )?.[0];
    expect(link).toBeDefined();
    expect(link).toContain('rel="noopener noreferrer"');
    expect(link).toContain('target="_blank"');
  });

  // The description has to say what the archive feed adds, not sound like the
  // default choice.
  it("says what the archive feed carries beyond the others", async () => {
    const { app } = createSubscribeTestApp();

    const html = await (await app.request("/subscribe")).text();

    expect(html).toContain(
      "Every published post, including those kept off the home page.",
    );
  });

  // The addresses are the whole content of this page. A reader with scripts off
  // must still be able to select and copy them, so the server renders the field
  // and ships the button hidden rather than leaving a dead control.
  it("renders every address without waiting for JavaScript", async () => {
    const { app } = createSubscribeTestApp();

    const html = await (await app.request("/subscribe")).text();

    const addresses = feedAddresses(html);
    expect(addresses).toHaveLength(3);
    // Whole addresses: a path pasted into a feed reader resolves nowhere.
    for (const address of addresses) {
      expect(address).toMatch(/^https?:\/\/[^/]+\//);
    }
    expect(html).toContain("data-copy-field-root");
    expect(/<button[^>]*hidden[^>]*data-copy-field=/.test(html)).toBe(true);
  });

  // The page is about feeds and used to carry no feed mark at all, while its
  // closing note tells the reader to look for that glyph on other pages. The
  // note only works once the glyph has been shown here.
  it("shows the feed glyph it tells readers to look for", async () => {
    const { app } = createSubscribeTestApp();

    const html = await (await app.request("/subscribe")).text();

    // Once beside the page title, once as the specimen the closing note
    // points at.
    expect([...html.matchAll(/lucide-rss/g)]).toHaveLength(2);
    expect(html).toContain("Look for this icon on those pages.");
  });

  // A reader who has never used a feed reader is handed three addresses and no
  // idea what to do with them — the same dead end this page exists to end, one
  // step later. No product names: the list would be identical on every Jant
  // site, and it would rot.
  it("explains what a feed reader is without naming one", async () => {
    const { app } = createSubscribeTestApp();

    const html = await (await app.request("/subscribe")).text();

    expect(html).toContain("What a feed reader does");
    expect(html).toContain(
      "A feed reader checks these addresses for new posts",
    );
    expect(html).toContain("Subscribing creates no account here.");
  });

  it("404s when feeds are switched off site-wide", async () => {
    const { app, services } = createSubscribeTestApp();
    await services.settings.set("RSS_FEEDS_ENABLED", "false");

    const res = await app.request("/subscribe");

    expect(res.status).toBe(404);
  });

  it("serves a language view with that language's addresses", async () => {
    const { app, services } = createSubscribeTestApp();
    await services.settings.set("SITE_LANGUAGE", "en");
    await services.settings.set("ADDITIONAL_LANGUAGES", "ja");
    await services.settings.set("MULTILINGUAL_ENABLED", "true");
    await services.settings.set("MAIN_RSS_FEED", "latest");

    const res = await app.request("/ja/subscribe");
    const html = await res.text();

    expect(res.status).toBe(200);
    expect(feedPaths(html)).toEqual([
      "/ja/feed",
      "/ja/featured/feed",
      "/ja/archive/feed",
    ]);
  });

  // A slug may not shadow the page: `subscribe` is in RESERVED_PATHS, so this
  // never becomes a post's address in the first place.
  it("keeps the path for the page rather than a post", async () => {
    const { app, services } = createSubscribeTestApp();

    await expect(
      services.posts.create({
        format: "note",
        title: "Subscribe",
        slug: "subscribe",
        bodyMarkdown: "Trying to take the path",
        status: "published",
      }),
    ).rejects.toThrow();

    expect((await app.request("/subscribe")).status).toBe(200);
  });
});
