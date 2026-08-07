/**
 * Language view routing.
 *
 * The path matrix here is the contract for how `/:lang` coexists with every
 * other route group. Hono decides precedence by registration order and cannot
 * "un-match" a route from middleware, so these are the tests that catch a
 * reordering in `app.tsx` before it silently turns `/archive` into a language
 * view — or `/en` into a 404 for a site with an `en` post.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { createTestApp } from "../../../__tests__/helpers/app.js";
import { i18nMiddleware } from "../../../i18n/index.js";
import { archiveRoutes } from "../archive.js";
import { collectionRoutes } from "../collection.js";
import { collectionsPageRoutes } from "../collections.js";
import { featuredRoutes } from "../featured.js";
import { homeRoutes } from "../home.js";
import { languageRoutes } from "../language.js";
import { latestRoutes } from "../latest.js";
import { pageRoutes } from "../page.js";
import { searchRoutes } from "../search.js";
import { feedRoutes } from "../../feed/feed.js";
import { publicPostsApiRoutes } from "../../api/public/posts.js";

/**
 * Mount the public route groups in the same order `createApp()` does — the
 * order is the behaviour under test.
 */
function createLanguageTestApp() {
  const testApp = createTestApp();
  const { app } = testApp;

  app.use("*", async (c, next) => {
    c.set("publicPath", c.req.path);
    c.set("publicRequestUrl", c.req.url);
    await next();
  });
  // The real middleware, because `<html lang>` is part of what is under test.
  app.use("*", i18nMiddleware());

  // API routes come first in `createApp()` too, ahead of the catch-all.
  app.route("/api/public/posts", publicPostsApiRoutes);
  app.route("/feed", feedRoutes);
  app.route("/search", searchRoutes);
  app.route("/archive", archiveRoutes);
  app.route("/featured", featuredRoutes);
  app.route("/latest", latestRoutes);
  app.route("/collections", collectionsPageRoutes);
  app.route("/collections", collectionRoutes);
  app.route("/", homeRoutes);
  app.route("/:lang", languageRoutes);
  app.route("/", pageRoutes);

  return testApp;
}

async function enableMultilingual(
  services: ReturnType<typeof createTestApp>["services"],
  { primary = "zh-Hans", additional = "en,zh-Hant" } = {},
) {
  await services.settings.set("SITE_LANGUAGE", primary);
  await services.settings.set("ADDITIONAL_LANGUAGES", additional);
  await services.settings.set("MULTILINGUAL_ENABLED", "true");
}

function noteBody(text: string): string {
  return JSON.stringify({
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text }] }],
  });
}

describe("language view routing", () => {
  describe("path matrix", () => {
    let app: ReturnType<typeof createLanguageTestApp>["app"];

    beforeEach(async () => {
      const testApp = createLanguageTestApp();
      app = testApp.app;
      await enableMultilingual(testApp.services);
    });

    it.each([
      "/",
      "/archive",
      "/archive/feed",
      "/feed",
      "/latest/feed",
      "/featured",
      "/search",
      "/collections",
    ])("keeps %s on the root view", async (path) => {
      const res = await app.request(path);
      expect(res.status, path).toBe(200);
    });

    it.each([
      "/en",
      "/en/archive",
      "/en/archive/feed",
      "/en/feed",
      "/en/latest/feed",
      "/en/featured",
      "/en/search",
      "/en/collections",
      "/zh-hant",
      "/zh-hant/archive",
    ])("serves %s as a language view", async (path) => {
      const res = await app.request(path);
      expect(res.status, path).toBe(200);
    });

    it.each(["/fr", "/hello", "/hello/text/med_whatever"])(
      "leaves %s to the path registry",
      async (path) => {
        // Nothing is registered at these paths, so the catch-all 404s — the
        // point is that it is the catch-all answering, not a language view.
        const res = await app.request(path);
        expect(res.status, path).toBe(404);
      },
    );
  });

  describe("the primary language's own prefix", () => {
    it("redirects to the root it aliases", async () => {
      const { app, services } = createLanguageTestApp();
      await enableMultilingual(services);

      const res = await app.request("/zh-hans");
      expect(res.status).toBe(301);
      expect(res.headers.get("location")).toBe("/");
    });

    it("strips the prefix from sub-paths and keeps the query", async () => {
      const { app, services } = createLanguageTestApp();
      await enableMultilingual(services);

      const res = await app.request("/zh-hans/archive?format=note");
      expect(res.status).toBe(301);
      expect(res.headers.get("location")).toBe("/archive?format=note");
    });
  });

  describe("after multilingual is switched off", () => {
    beforeEach(() => {});

    it("redirects a configured prefix instead of 404ing", async () => {
      const { app, services } = createLanguageTestApp();
      await enableMultilingual(services);
      await services.settings.set("MULTILINGUAL_ENABLED", "false");

      const res = await app.request("/en/archive");
      expect(res.status).toBe(301);
      expect(res.headers.get("location")).toBe("/archive");
    });

    it("keeps feed subscribers working", async () => {
      const { app, services } = createLanguageTestApp();
      await enableMultilingual(services);
      await services.settings.set("MULTILINGUAL_ENABLED", "false");

      const res = await app.request("/en/feed");
      expect(res.status).toBe(301);
      expect(res.headers.get("location")).toBe("/feed");
    });
  });

  describe("a site that never configured a second language", () => {
    it("serves a post whose slug looks like a language tag", async () => {
      const { app, services } = createLanguageTestApp();
      await services.posts.create({
        format: "note",
        slug: "en",
        title: "Enderby",
        body: noteBody("A post that happens to live at /en"),
        status: "published",
      });

      const res = await app.request("/en");
      expect(res.status).toBe(200);
      expect(await res.text()).toContain("Enderby");
    });
  });
});

describe("language views filter content", () => {
  async function seedTwoLanguages() {
    const testApp = createLanguageTestApp();
    await enableMultilingual(testApp.services, {
      primary: "zh-Hans",
      additional: "en",
    });

    const zh = await testApp.services.posts.create({
      format: "note",
      title: "中文文章",
      body: noteBody("中文正文"),
      language: "zh-Hans",
      status: "published",
    });
    const en = await testApp.services.posts.create({
      format: "note",
      title: "English post",
      body: noteBody("English body"),
      language: "en",
      status: "published",
    });

    return { ...testApp, zh, en };
  }

  it("shows only the view's language on its home page", async () => {
    const { app } = await seedTwoLanguages();

    const html = await (await app.request("/en")).text();
    expect(html).toContain("English post");
    expect(html).not.toContain("中文文章");
  });

  it("shows the primary language at the root", async () => {
    const { app } = await seedTwoLanguages();

    const html = await (await app.request("/")).text();
    expect(html).toContain("中文文章");
    expect(html).not.toContain("English post");
  });

  it("filters the archive", async () => {
    const { app } = await seedTwoLanguages();

    const html = await (await app.request("/en/archive")).text();
    expect(html).toContain("English post");
    expect(html).not.toContain("中文文章");
  });

  it("filters the feed and declares the view's language", async () => {
    const { app } = await seedTwoLanguages();

    const xml = await (await app.request("/en/latest/feed")).text();
    expect(xml).toContain("English post");
    expect(xml).not.toContain("中文文章");
    expect(xml).toContain('xml:lang="en"');
  });

  it("leaves the root feed on the primary language", async () => {
    const { app } = await seedTwoLanguages();

    const xml = await (await app.request("/latest/feed")).text();
    expect(xml).toContain('xml:lang="zh-Hans"');
  });

  it("keeps in-view links inside the view", async () => {
    const { app } = await seedTwoLanguages();

    const html = await (await app.request("/en/archive")).text();
    // Filter, pagination and feed URLs must not throw the reader back to the
    // root. The language switcher is the one link that leaves on purpose, so
    // this looks at the page body rather than the whole document.
    const body = html.slice(html.indexOf("<main"));
    expect(body).toContain('href="/en/archive');
    expect(body).not.toMatch(/href="\/archive[?"/]/);
  });

  it("advertises each language's copy of the surface with hreflang", async () => {
    const { app } = await seedTwoLanguages();

    const html = await (await app.request("/en/archive")).text();
    const head = html.slice(0, html.indexOf("</head>"));

    expect(head).toContain(
      '<link rel="alternate" hreflang="zh-Hans" href="http://localhost:3000/archive"/>',
    );
    expect(head).toContain(
      '<link rel="alternate" hreflang="en" href="http://localhost:3000/en/archive"/>',
    );
    // A set without a self-referential entry is ignored by search engines, and
    // the renderer used to drop this one for sharing the canonical link's URL.
    expect(head).toContain(
      '<link rel="alternate" hreflang="x-default" href="http://localhost:3000/archive"/>',
    );
  });

  it("renders the view language on the html element", async () => {
    const { app } = await seedTwoLanguages();

    expect(await (await app.request("/en/archive")).text()).toContain(
      '<html lang="en"',
    );
    expect(await (await app.request("/archive")).text()).toContain(
      '<html lang="zh-Hans"',
    );
  });

  it("renders a post in its own language whatever view led there", async () => {
    const { app, en } = await seedTwoLanguages();

    expect(await (await app.request(`/${en.slug}`)).text()).toContain(
      '<html lang="en"',
    );
  });

  it("offers a language switcher in the site header", async () => {
    const { app } = await seedTwoLanguages();

    const html = await (await app.request("/en")).text();
    expect(html).toContain('id="site-nav-lang-trigger"');
    expect(html).toContain('href="/" hreflang="zh-Hans"');
    expect(html).toContain('aria-current="true"');
  });

  it("repeats the switcher in the mobile drawer, where the header hides it", async () => {
    const { app } = await seedTwoLanguages();

    const html = await (await app.request("/en")).text();
    const drawer = html.slice(html.indexOf('id="site-nav-drawer"'));
    expect(drawer).toContain('class="site-nav-drawer-section-label">Language');
    expect(drawer).toContain('hreflang="zh-Hans"');
    expect(drawer).toContain('hreflang="en"');
  });

  it("switches to the translation from a post, not to its own path", async () => {
    const { app, services, zh, en } = await seedTwoLanguages();
    await services.posts.linkTranslation(zh.id, en.id);

    const html = await (await app.request(`/${zh.slug}`)).text();
    // The English entry points at the translation…
    expect(html).toContain(`href="/${en.slug}" hreflang="en"`);
    // …and the head advertises the whole set, this post included: an hreflang
    // group without a self-referential entry is ignored.
    expect(html).toContain(
      `<link rel="alternate" hreflang="zh-Hans" href="http://localhost:3000/${zh.slug}"/>`,
    );
    expect(html).toContain(
      `<link rel="alternate" hreflang="en" href="http://localhost:3000/${en.slug}"/>`,
    );
  });

  it("offers the translation to a reader who cannot read this one", async () => {
    const { app, services, zh, en } = await seedTwoLanguages();
    await services.posts.linkTranslation(zh.id, en.id);

    const html = await (await app.request(`/${zh.slug}`)).text();
    const line = html.slice(html.indexOf("data-post-translations"));

    expect(html).toContain("Also available in");
    expect(line).toContain(`href="/${en.slug}"`);
    expect(line).toContain("English");
    // Its own language is not an alternative to itself.
    expect(line.slice(0, line.indexOf("data-post-end"))).not.toContain(
      "简体中文",
    );
  });

  it("says nothing on a post with no translations", async () => {
    const { app, zh } = await seedTwoLanguages();

    expect(await (await app.request(`/${zh.slug}`)).text()).not.toContain(
      "Also available in",
    );
  });

  it("sends a language with no translation to that language's home", async () => {
    const { app, zh } = await seedTwoLanguages();

    const html = await (await app.request(`/${zh.slug}`)).text();
    expect(html).toContain('href="/en" hreflang="en"');
  });

  it("serves each post at one language-neutral address", async () => {
    const { app, en } = await seedTwoLanguages();

    const direct = await app.request(`/${en.slug}`);
    expect(direct.status).toBe(200);

    const prefixed = await app.request(`/en/${en.slug}`);
    expect(prefixed.status).toBe(301);
    expect(prefixed.headers.get("location")).toBe(`/${en.slug}`);
  });

  it("redirects even when the post is in another language", async () => {
    const { app, zh } = await seedTwoLanguages();

    const res = await app.request(`/en/${zh.slug}`);
    expect(res.status).toBe(301);
    expect(res.headers.get("location")).toBe(`/${zh.slug}`);
  });
});

describe("collections in a language view", () => {
  async function seedCollection() {
    const testApp = createLanguageTestApp();
    await enableMultilingual(testApp.services, {
      primary: "zh-Hans",
      additional: "en",
    });

    const collection = await testApp.services.collections.create({
      slug: "reading",
      title: "Reading",
    });
    const zh = await testApp.services.posts.create({
      format: "note",
      title: "读书笔记",
      body: noteBody("中文正文"),
      language: "zh-Hans",
      status: "published",
    });
    const en = await testApp.services.posts.create({
      format: "note",
      title: "Book log",
      body: noteBody("English body"),
      language: "en",
      status: "published",
    });
    await testApp.services.collections.addThread(collection.id, zh.id);
    await testApp.services.collections.addThread(collection.id, en.id);

    return { ...testApp, collection, zh, en };
  }

  it("renders the collection page filtered to the view", async () => {
    const { app } = await seedCollection();

    const res = await app.request("/en/reading");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Book log");
    expect(html).not.toContain("读书笔记");
  });

  it("lists every collection in the directory, whatever the view", async () => {
    const { app } = await seedCollection();

    const html = await (await app.request("/en/collections")).text();
    expect(html).toContain("Reading");
    // The directory is site skeleton, but its links stay in the view.
    expect(html).toContain('href="/en/reading"');
  });

  it("filters the collection feed", async () => {
    const { app } = await seedCollection();

    const xml = await (await app.request("/en/reading/feed")).text();
    expect(xml).toContain("Book log");
    expect(xml).not.toContain("读书笔记");
  });

  it("gives an empty language view a way out", async () => {
    const testApp = createLanguageTestApp();
    await enableMultilingual(testApp.services, {
      primary: "zh-Hans",
      additional: "en",
    });
    const collection = await testApp.services.collections.create({
      slug: "reading",
      title: "Reading",
    });
    const zh = await testApp.services.posts.create({
      format: "note",
      title: "读书笔记",
      body: noteBody("中文正文"),
      language: "zh-Hans",
      status: "published",
    });
    await testApp.services.collections.addThread(collection.id, zh.id);

    const html = await (await testApp.app.request("/en/reading")).text();
    expect(html).toContain("Nothing in English here yet.");
    expect(html).toContain('href="/reading"');
    expect(html).toContain("Read it in 简体中文");
  });

  it("keeps the plain empty state when the collection is empty everywhere", async () => {
    const testApp = createLanguageTestApp();
    await enableMultilingual(testApp.services, {
      primary: "zh-Hans",
      additional: "en",
    });
    await testApp.services.collections.create({
      slug: "reading",
      title: "Reading",
    });

    const html = await (await testApp.app.request("/en/reading")).text();
    expect(html).not.toContain("Nothing in English here yet.");
    expect(html).toContain("This collection is empty.");
  });
});

describe("the public JSON API", () => {
  it("filters by an explicit language tag", async () => {
    const testApp = createLanguageTestApp();
    await enableMultilingual(testApp.services, {
      primary: "zh-Hans",
      additional: "en",
    });
    await testApp.services.posts.create({
      format: "note",
      title: "中文文章",
      body: noteBody("中文正文"),
      language: "zh-Hans",
      status: "published",
    });
    await testApp.services.posts.create({
      format: "note",
      title: "English post",
      body: noteBody("English body"),
      language: "en",
      status: "published",
    });

    const res = await testApp.app.request("/api/public/posts?lang=en");
    const body = (await res.json()) as {
      posts: { title: string; language: string }[];
    };

    expect(body.posts).toHaveLength(1);
    expect(body.posts[0]?.title).toBe("English post");
    expect(body.posts[0]?.language).toBe("en");
  });

  it("rejects a malformed language tag rather than ignoring it", async () => {
    const testApp = createLanguageTestApp();

    const res = await testApp.app.request(
      "/api/public/posts?lang=not%20a%20tag",
    );
    expect(res.status).toBe(400);
  });
});
