import { describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import type { Bindings } from "../../../types.js";
import type { AppVariables } from "../../../types/app-context.js";
import { DEFAULT_APP_PORT } from "../../../lib/env.js";
import { resolveConfig } from "../../../lib/resolve-config.js";
import { createTestApp } from "../../../__tests__/helpers/app.js";
import { sitemapRoutes } from "../sitemap.js";
import { SITEMAP_SHARD_SIZE } from "../../../lib/feed.js";

type Env = { Bindings: Bindings; Variables: AppVariables };
const TEST_SITE_ORIGIN = `http://localhost:${DEFAULT_APP_PORT}`;

function createRobotsTestApp(
  allSettings: Record<string, string> = {},
  envOverrides: Partial<Bindings> = {},
) {
  // robots.txt doesn't need service wiring; keep a minimal harness for it.
  const app = new Hono<Env>();

  app.use("*", async (c, next) => {
    const env = {
      SITE_ORIGIN: TEST_SITE_ORIGIN,
      SITE_PATH_PREFIX: "",
      ...envOverrides,
    } as Bindings;
    c.env = env;
    c.set("appConfig", resolveConfig(env, allSettings));
    await next();
  });

  app.route("/", sitemapRoutes);
  return app;
}

function createSitemapTestApp() {
  const testApp = createTestApp();
  testApp.app.route("/", sitemapRoutes);
  return testApp;
}

describe("Sitemap Routes", () => {
  describe("/robots.txt", () => {
    it("disallows internal utility routes while allowing the public site", async () => {
      const app = createRobotsTestApp();

      const res = await app.request("/robots.txt");

      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toBe("text/plain; charset=utf-8");

      const robots = await res.text();
      expect(robots).toContain("User-agent: *");
      expect(robots).toContain("Allow: /");
      expect(robots).toContain("Disallow: /_/");
      expect(robots).toContain(`Sitemap: ${TEST_SITE_ORIGIN}/sitemap.xml`);
    });

    it("disallows the entire site when global noindex is enabled", async () => {
      const app = createRobotsTestApp({ NOINDEX: "true" });

      const res = await app.request("/robots.txt");

      expect(res.status).toBe(200);

      const robots = await res.text();
      expect(robots).toContain("Disallow: /");
      expect(robots).not.toContain("Allow: /");
      expect(robots).not.toContain("Disallow: /_/");
    });
  });

  describe("/sitemap.xml (index)", () => {
    it("lists pages shard + one post shard when there are a few posts", async () => {
      const { app, services } = createSitemapTestApp();
      for (let i = 0; i < 3; i++) {
        await services.posts.create({
          format: "note",
          bodyMarkdown: `post ${i}`,
          status: "published",
        });
      }

      const res = await app.request("/sitemap.xml");
      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toContain("application/xml");

      const xml = await res.text();
      expect(xml).toContain("<sitemapindex");
      expect(xml).toContain("/sitemap-pages.xml");
      expect(xml).toContain("/sitemap-posts-1.xml");
      expect(xml).not.toContain("/sitemap-posts-2.xml");
      // No collections → no collections shard entry
      expect(xml).not.toContain("/sitemap-collections.xml");
    });

    it("lists multiple post shards when post count exceeds shard size", async () => {
      const { app, services } = createSitemapTestApp();
      // Create enough posts to span 2 shards. Use shard_size + 1 to minimize
      // work while still forcing a second shard.
      for (let i = 0; i < SITEMAP_SHARD_SIZE + 1; i++) {
        await services.posts.create({
          format: "note",
          bodyMarkdown: `p${i}`,
          status: "published",
        });
      }

      const res = await app.request("/sitemap.xml");
      const xml = await res.text();
      expect(xml).toContain("/sitemap-posts-1.xml");
      expect(xml).toContain("/sitemap-posts-2.xml");
      expect(xml).not.toContain("/sitemap-posts-3.xml");
    });

    it("includes the collections shard when collections exist", async () => {
      const { app, services } = createSitemapTestApp();
      await services.collections.create({
        slug: "reading",
        title: "Reading",
      });

      const res = await app.request("/sitemap.xml");
      const xml = await res.text();
      expect(xml).toContain("/sitemap-collections.xml");
    });
  });

  describe("/sitemap-posts-N.xml", () => {
    it("emits <url> entries for page 1 in ascending id order", async () => {
      const { app, services } = createSitemapTestApp();
      const created: string[] = [];
      for (let i = 0; i < 3; i++) {
        const post = await services.posts.create({
          format: "note",
          bodyMarkdown: `post ${i}`,
          title: `Post ${i}`,
          status: "published",
        });
        created.push(post.slug);
      }

      const res = await app.request("/sitemap-posts-1.xml");
      expect(res.status).toBe(200);

      const xml = await res.text();
      expect(xml).toContain("<urlset");
      for (const slug of created) {
        expect(xml).toContain(`/${slug}`);
      }

      // Slugs appear in id-ascending order (== creation order for TypeIDs).
      const indices = created.map((slug) => xml.indexOf(`/${slug}`));
      expect(indices).toEqual([...indices].sort((a, b) => a - b));
    });

    // A Thread root's page renders its replies, so anything that changes a
    // reply changes the page. Unlike ordering, edits count for <lastmod> —
    // the page really did change.
    it("moves <lastmod> when a reply is added", async () => {
      const { app, services } = createSitemapTestApp();
      const readLastmod = async () => {
        const xml = await (await app.request("/sitemap-posts-1.xml")).text();
        return /<lastmod>([^<]+)<\/lastmod>/.exec(xml)?.[1];
      };

      vi.useFakeTimers();
      try {
        // lastmod is a date, so the two writes need to land on different days.
        vi.setSystemTime(new Date("2026-03-01T00:00:00Z"));
        const root = await services.posts.create({
          format: "note",
          bodyMarkdown: "root",
          title: "Threaded",
          status: "published",
        });
        expect(await readLastmod()).toBe("2026-03-01");

        vi.setSystemTime(new Date("2026-03-05T00:00:00Z"));
        await services.posts.create({
          format: "note",
          bodyMarkdown: "reply",
          replyToId: root.id,
          status: "published",
        });
        expect(await readLastmod()).toBe("2026-03-05");
      } finally {
        vi.useRealTimers();
      }
    });

    it("ignores a draft reply in <lastmod>", async () => {
      const { app, services } = createSitemapTestApp();
      const readLastmod = async () => {
        const xml = await (await app.request("/sitemap-posts-1.xml")).text();
        return /<lastmod>([^<]+)<\/lastmod>/.exec(xml)?.[1];
      };

      vi.useFakeTimers();
      try {
        vi.setSystemTime(new Date("2026-03-01T00:00:00Z"));
        const root = await services.posts.create({
          format: "note",
          bodyMarkdown: "root",
          title: "Threaded",
          status: "published",
        });

        vi.setSystemTime(new Date("2026-03-05T00:00:00Z"));
        await services.posts.create({
          format: "note",
          bodyMarkdown: "unpublished reply",
          replyToId: root.id,
          status: "draft",
        });

        // Not on the page, so it must not claim the page changed.
        expect(await readLastmod()).toBe("2026-03-01");
      } finally {
        vi.useRealTimers();
      }
    });

    it("excludes private posts, replies, and drafts", async () => {
      const { app, services } = createSitemapTestApp();
      const root = await services.posts.create({
        format: "note",
        bodyMarkdown: "root",
        status: "published",
      });
      const reply = await services.posts.create({
        format: "note",
        bodyMarkdown: "reply",
        replyToId: root.id,
        status: "published",
      });
      const priv = await services.posts.create({
        format: "note",
        bodyMarkdown: "private",
        visibility: "private",
        status: "published",
      });
      const draft = await services.posts.create({
        format: "note",
        bodyMarkdown: "draft",
        status: "draft",
      });

      const xml = await (await app.request("/sitemap-posts-1.xml")).text();
      expect(xml).toContain(`/${root.slug}`);
      expect(xml).not.toContain(`/${reply.slug}`);
      expect(xml).not.toContain(`/${priv.slug}`);
      expect(xml).not.toContain(`/${draft.slug}`);
    });

    it("includes latest_hidden posts (they are public URLs)", async () => {
      const { app, services } = createSitemapTestApp();
      const hidden = await services.posts.create({
        format: "note",
        bodyMarkdown: "hidden",
        visibility: "latest_hidden",
        status: "published",
      });

      const xml = await (await app.request("/sitemap-posts-1.xml")).text();
      expect(xml).toContain(`/${hidden.slug}`);
    });

    it("splits content across shards at SITEMAP_SHARD_SIZE boundaries", async () => {
      const { app, services } = createSitemapTestApp();
      const created: string[] = [];
      for (let i = 0; i < SITEMAP_SHARD_SIZE + 2; i++) {
        const post = await services.posts.create({
          format: "note",
          bodyMarkdown: `p${i}`,
          status: "published",
        });
        created.push(post.slug);
      }

      const page1 = await (await app.request("/sitemap-posts-1.xml")).text();
      const page2 = await (await app.request("/sitemap-posts-2.xml")).text();

      // First 500 slugs in page 1
      expect(page1).toContain(`/${created[0]}`);
      expect(page1).toContain(`/${created[SITEMAP_SHARD_SIZE - 1]}`);
      expect(page1).not.toContain(`/${created[SITEMAP_SHARD_SIZE]}`);

      // Remainder in page 2
      expect(page2).toContain(`/${created[SITEMAP_SHARD_SIZE]}`);
      expect(page2).toContain(`/${created[SITEMAP_SHARD_SIZE + 1]}`);
      expect(page2).not.toContain(`/${created[0]}`);
    });

    it("returns 404 for a shard beyond the last page", async () => {
      const { app, services } = createSitemapTestApp();
      await services.posts.create({
        format: "note",
        bodyMarkdown: "only",
        status: "published",
      });

      const res = await app.request("/sitemap-posts-2.xml");
      expect(res.status).toBe(404);
    });

    it("uses long cache for a full shard and short cache for a partial shard", async () => {
      const { app, services } = createSitemapTestApp();
      // Exactly one full shard followed by one post in the next shard.
      for (let i = 0; i < SITEMAP_SHARD_SIZE + 1; i++) {
        await services.posts.create({
          format: "note",
          bodyMarkdown: `p${i}`,
          status: "published",
        });
      }

      const full = await app.request("/sitemap-posts-1.xml");
      expect(full.headers.get("Cache-Control")).toContain("86400");

      const partial = await app.request("/sitemap-posts-2.xml");
      expect(partial.headers.get("Cache-Control")).toContain("max-age=180");
    });

    it("uses alias in <loc> when a post has one", async () => {
      const { app, services } = createSitemapTestApp();
      const post = await services.posts.create({
        format: "note",
        bodyMarkdown: "body",
        status: "published",
      });
      await services.customUrls.create({
        path: "my-alias",
        targetType: "post",
        targetId: post.id,
      });

      const xml = await (await app.request("/sitemap-posts-1.xml")).text();
      expect(xml).toContain(`<loc>${TEST_SITE_ORIGIN}/my-alias</loc>`);
      expect(xml).not.toContain(`/${post.slug}<`);
    });

    it("emits absolute URLs anchored to the site origin for nested aliases", async () => {
      // Regression: `getPostAliases` returns aliases with a leading "/", so
      // blindly prepending another "/" produces "//blog/foo", which
      // `new URL()` resolves as protocol-relative and hijacks the hostname
      // (e.g. `https://blog/foo`).
      const { app, services } = createSitemapTestApp();
      const post = await services.posts.create({
        format: "note",
        bodyMarkdown: "body",
        status: "published",
      });
      await services.customUrls.create({
        path: "blog/about-notes",
        targetType: "post",
        targetId: post.id,
      });

      const xml = await (await app.request("/sitemap-posts-1.xml")).text();
      expect(xml).toContain(`<loc>${TEST_SITE_ORIGIN}/blog/about-notes</loc>`);
      expect(xml).not.toMatch(/<loc>https?:\/\/blog\//);
    });
  });

  describe("/sitemap-collections.xml", () => {
    it("lists public collections", async () => {
      const { app, services } = createSitemapTestApp();
      await services.collections.create({ slug: "reading", title: "Reading" });
      await services.collections.create({ slug: "movies", title: "Movies" });

      const xml = await (await app.request("/sitemap-collections.xml")).text();
      expect(xml).toContain("<urlset");
      expect(xml).toContain("/reading");
      expect(xml).toContain("/movies");
    });

    it("does not include the /collections directory page (lives in pages shard)", async () => {
      const { app, services } = createSitemapTestApp();
      await services.collections.create({ slug: "reading", title: "Reading" });

      const xml = await (await app.request("/sitemap-collections.xml")).text();
      // Only per-collection URLs should appear here; the directory landing
      // is emitted by `/sitemap-pages.xml`.
      expect(xml).not.toContain("<loc>http://localhost:8787/collections</loc>");
    });

    it("returns an empty urlset when there are no collections", async () => {
      const { app } = createSitemapTestApp();
      const res = await app.request("/sitemap-collections.xml");
      expect(res.status).toBe(200);
      const xml = await res.text();
      expect(xml).toContain("<urlset");
      expect(xml).not.toContain("<url>");
    });
  });

  describe("/sitemap-pages.xml", () => {
    it("lists the homepage with priority 1.0", async () => {
      const { app } = createSitemapTestApp();
      const res = await app.request("/sitemap-pages.xml");
      expect(res.status).toBe(200);
      const xml = await res.text();
      expect(xml).toContain("<urlset");
      expect(xml).toContain("<priority>1.0</priority>");
      expect(xml).toContain("<changefreq>daily</changefreq>");
    });

    it("includes the archive aggregate page", async () => {
      const { app } = createSitemapTestApp();
      const xml = await (await app.request("/sitemap-pages.xml")).text();
      expect(xml).toContain(`${TEST_SITE_ORIGIN}/archive`);
    });

    it("includes /featured as the secondary aggregate page", async () => {
      const { app } = createSitemapTestApp();
      const xml = await (await app.request("/sitemap-pages.xml")).text();
      expect(xml).toContain(`${TEST_SITE_ORIGIN}/featured`);
      expect(xml).not.toContain(`${TEST_SITE_ORIGIN}/latest`);
    });

    it("includes /collections only when collections exist", async () => {
      const { app, services } = createSitemapTestApp();

      const emptyXml = await (await app.request("/sitemap-pages.xml")).text();
      expect(emptyXml).not.toContain(`${TEST_SITE_ORIGIN}/collections`);

      await services.collections.create({ slug: "reading", title: "Reading" });

      const populatedXml = await (
        await app.request("/sitemap-pages.xml")
      ).text();
      expect(populatedXml).toContain(`${TEST_SITE_ORIGIN}/collections`);
    });
  });
});
