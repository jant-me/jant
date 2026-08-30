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

    expect(latest).toContain("New posts as they are published.");
    expect(featured).toContain("Posts marked as featured, and nothing else.");
  });

  // The description has to say what the archive feed adds, not sound like the
  // default choice.
  it("says what the archive feed carries beyond the others", async () => {
    const { app } = createSubscribeTestApp();

    const html = await (await app.request("/subscribe")).text();

    expect(html).toContain(
      "Every published post, including ones hidden from Latest.",
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
