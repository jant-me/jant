/**
 * The subscribe page.
 *
 * What is under test is mostly the page's contract with readers: three feeds on
 * every site, whole addresses that survive being pasted into a reader, and the
 * right pair for whichever end `/feed` currently returns. Getting the pairing
 * wrong would list the same feed twice under two names — the confusion this
 * page exists to end.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createTestApp } from "../../../__tests__/helpers/app.js";
import { i18nMiddleware } from "../../../i18n/index.js";
import { languageRoutes } from "../language.js";
import { pageRoutes } from "../page.js";
import { subscribeRoutes } from "../subscribe.js";

const CORE_ROOT = resolve(import.meta.dirname, "../../../..");

/**
 * Vitest stubs `@lingui/core/macro` so `msg()` returns `id === message` rather
 * than SWC's compiled hash IDs (`src/__tests__/helpers/lingui-core-macro-mock.ts`).
 * Loading the `msgid → msgstr` pairs from `locales/settings/{locale}.po` lets
 * route tests exercise both `lingui.config.ts` catalog membership and runtime
 * locale selection end to end.
 */
function readSettingsPoCatalog(locale: string): Record<string, string> {
  const po = readFileSync(
    resolve(CORE_ROOT, `src/i18n/locales/settings/${locale}.po`),
    "utf8",
  );
  const catalog: Record<string, string> = {};
  for (const block of po.split(/\n{2,}/)) {
    const field = (keyword: string) => {
      const match = new RegExp(
        `^${keyword} ("(?:[^"\\\\]|\\\\.)*"(?:\\n"(?:[^"\\\\]|\\\\.)*")*)`,
        "m",
      ).exec(block);
      if (!match?.[1]) return null;
      return match[1]
        .split("\n")
        .map((line) => JSON.parse(line) as string)
        .join("");
    };
    const id = field("msgid");
    const str = field("msgstr");
    if (id && str) catalog[id] = str;
  }
  return catalog;
}

const zhHansPo = readSettingsPoCatalog("zh-Hans");
const zhHantPo = readSettingsPoCatalog("zh-Hant");

vi.mock("../../../i18n/i18n.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../i18n/i18n.js")>();
  return {
    ...actual,
    createI18n(locale: Parameters<typeof actual.createI18n>[0]) {
      const instance = actual.createI18n(locale);
      instance.load("zh-Hans", zhHansPo);
      instance.load("zh-Hant", zhHantPo);
      instance.activate(locale);
      return instance;
    },
  };
});

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

  it("renders Simplified Chinese copy on a zh-Hans site while keeping public chrome in English", async () => {
    const { app, services } = createSubscribeTestApp();
    await services.settings.set("SITE_LANGUAGE", "zh-Hans");
    await services.settings.set("MAIN_RSS_FEED", "latest");

    const html = await (await app.request("/subscribe")).text();

    expect(html).toContain("<title>订阅");
    expect(html).toContain(
      "本站发布 Atom 订阅源。复制下面任一地址到订阅阅读器。",
    );
    expect(html).toContain("主订阅源");
    expect(html).toContain("与首页相同的帖子。");
    expect(html).toContain("仅包含标为 Featured 的帖子。");
    expect(html).toContain("已发布的全部帖子，包括不在首页显示的帖子。");
    expect(html).toContain(">All<");
    expect(html).toContain("订阅源 URL 已复制。");
    expect(html).toContain("无法复制。请选中地址手动复制。");
    expect(html).toContain("订阅阅读器是做什么的");
    expect(html).toContain(
      "前往 aboutfeeds.com 阅读更详细的订阅源与阅读器介绍",
    );
    // Surrounding public header chrome (`Search` lives in `settings` too as
    // `搜索`) stays English so `/subscribe` does not diverge from `/` or `/archive`.
    expect(html).toContain('aria-label="Search"');
  });

  it("maps regional Traditional Chinese tags to the zh-Hant catalog", async () => {
    const { app, services } = createSubscribeTestApp();
    await services.settings.set("SITE_LANGUAGE", "zh-TW");
    await services.settings.set("MAIN_RSS_FEED", "latest");

    const html = await (await app.request("/subscribe")).text();

    expect(html).toContain("<title>訂閱");
    expect(html).toContain("主要訂閱來源");
    expect(html).toContain("與首頁相同的貼文。");
    expect(html).toContain(
      "選集與篩選後的封存檢視也有各自的訂閱源，留意那些頁面上的這個圖示。",
    );
    expect(html).toContain(">All<");
  });

  it("matches each multilingual view's language and falls back to English when untranslated", async () => {
    const { app, services } = createSubscribeTestApp();
    await services.settings.set("SITE_LANGUAGE", "zh-Hans");
    await services.settings.set("ADDITIONAL_LANGUAGES", "en,zh-Hant,ja");
    await services.settings.set("MULTILINGUAL_ENABLED", "true");
    await services.settings.set("MAIN_RSS_FEED", "latest");

    const rootHtml = await (await app.request("/subscribe")).text();
    const enHtml = await (await app.request("/en/subscribe")).text();
    const hantHtml = await (await app.request("/zh-hant/subscribe")).text();
    const jaHtml = await (await app.request("/ja/subscribe")).text();

    expect(rootHtml).toContain("订阅阅读器是做什么的");
    expect(enHtml).toContain("What a feed reader does");
    expect(feedPaths(enHtml)).toEqual([
      "/en/feed",
      "/en/featured/feed",
      "/en/archive/feed",
    ]);
    expect(hantHtml).toContain("訂閱閱讀器是做什麼的");
    expect(feedPaths(hantHtml)).toEqual([
      "/zh-hant/feed",
      "/zh-hant/featured/feed",
      "/zh-hant/archive/feed",
    ]);
    expect(jaHtml).toContain("What a feed reader does");
  });

  // `DASHBOARD_LANGUAGE` is the author's private preference; `/subscribe` is
  // read by visitors of the site's content language.
  it("follows the site's content language rather than DASHBOARD_LANGUAGE", async () => {
    const { app, services } = createSubscribeTestApp();
    await services.settings.set("SITE_LANGUAGE", "en");
    await services.settings.set("DASHBOARD_LANGUAGE", "zh-Hans");

    const html = await (await app.request("/subscribe")).text();

    expect(html).toContain("What a feed reader does");
    expect(html).not.toContain("订阅阅读器是做什么的");
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
