import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import type { Bindings } from "../../../types.js";
import type { AppVariables } from "../../../types/app-context.js";
import {
  createTestDatabase,
  DEFAULT_TEST_SITE_ID,
} from "../../../__tests__/helpers/db.js";
import { posts as postTable } from "../../../db/schema.js";
import { createPostService } from "../../../services/post.js";
import { createPathService } from "../../../services/path.js";
import { createSettingsService } from "../../../services/settings.js";
import { createMediaService } from "../../../services/media.js";
import { DEFAULT_APP_PORT } from "../../../lib/env.js";
import { resolveConfig } from "../../../lib/resolve-config.js";
import { feedRoutes } from "../feed.js";
import { latestRoutes } from "../../pages/latest.js";
import { featuredRoutes } from "../../pages/featured.js";
import type { Database } from "../../../db/index.js";

type Env = { Bindings: Bindings; Variables: AppVariables };

function createFeedTestApp(envOverrides: Partial<Bindings> = {}) {
  const { db } = createTestDatabase();
  const pathService = createPathService(db as never, DEFAULT_TEST_SITE_ID);

  const services = {
    paths: pathService,
    posts: createPostService(
      db as never,
      { slugIdLength: 5 },
      DEFAULT_TEST_SITE_ID,
      pathService,
    ),
    settings: createSettingsService(db as never, DEFAULT_TEST_SITE_ID),
    media: createMediaService(db as never, DEFAULT_TEST_SITE_ID),
  };

  const app = new Hono<Env>();

  app.use("*", async (c, next) => {
    const env = {
      SITE_ORIGIN: `http://localhost:${DEFAULT_APP_PORT}`,
      SITE_PATH_PREFIX: "",
      ...envOverrides,
    } as Bindings;
    c.env = env;

    c.set("services", services as AppVariables["services"]);
    const allSettings = await services.settings.getAll();
    c.set("allSettings", allSettings);
    c.set("appConfig", resolveConfig(env, allSettings));
    c.set("i18n", {
      _(value: string | { message?: string }) {
        return typeof value === "string" ? value : (value.message ?? "");
      },
    } as AppVariables["i18n"]);
    await next();
  });

  app.route("/feed", feedRoutes);
  // The canonical latest/featured feeds live in their page route groups.
  app.route("/latest", latestRoutes);
  app.route("/featured", featuredRoutes);

  return { app, services, db: db as unknown as Database };
}

describe("Atom Feed Routes", () => {
  describe("/feed — site main feed", () => {
    it("defaults to featured posts", async () => {
      const { app, services } = createFeedTestApp();

      await services.posts.create({
        format: "note",
        title: "Regular Post",
        bodyMarkdown: "Not featured",
        status: "published",
      });
      await services.posts.create({
        format: "note",
        title: "Featured Post",
        bodyMarkdown: "This is featured",
        status: "published",
        featured: true,
      });

      const res = await app.request("/feed");
      expect(res.status).toBe(200);

      const xml = await res.text();
      expect(xml).toContain("Featured Post");
      expect(xml).not.toContain("Regular Post");
    });

    it("uses latest posts when MAIN_RSS_FEED is configured", async () => {
      const { app, services } = createFeedTestApp();

      await services.settings.set("MAIN_RSS_FEED", "latest");

      await services.posts.create({
        format: "note",
        title: "Public Post",
        bodyMarkdown: "Visible in latest",
        status: "published",
      });
      await services.posts.create({
        format: "note",
        title: "Hidden Post",
        bodyMarkdown: "Not in latest",
        status: "published",
        visibility: "latest_hidden",
      });

      const res = await app.request("/feed");
      expect(res.status).toBe(200);

      const xml = await res.text();
      expect(xml).toContain("Public Post");
      expect(xml).not.toContain("Hidden Post");
    });

    it("ignores pinned ordering when the main feed is latest", async () => {
      const { app, services } = createFeedTestApp({
        RSS_FEED_LIMIT: "2",
      });

      await services.settings.set("MAIN_RSS_FEED", "latest");

      await services.posts.create({
        format: "note",
        title: "Older pinned",
        bodyMarkdown: "Pinned but old",
        status: "published",
        pinned: true,
        publishedAt: 1000,
      });
      await services.posts.create({
        format: "note",
        title: "Newer unpinned",
        bodyMarkdown: "Newer",
        status: "published",
        publishedAt: 2000,
      });
      await services.posts.create({
        format: "note",
        title: "Newest unpinned",
        bodyMarkdown: "Newest",
        status: "published",
        publishedAt: 3000,
      });

      const res = await app.request("/feed");
      expect(res.status).toBe(200);

      const xml = await res.text();
      expect(xml).toContain("Newest unpinned");
      expect(xml).toContain("Newer unpinned");
      expect(xml).not.toContain("Older pinned");
      expect(xml.indexOf("Newest unpinned")).toBeLessThan(
        xml.indexOf("Newer unpinned"),
      );
    });

    it("returns Atom content type", async () => {
      const { app } = createFeedTestApp();

      const res = await app.request("/feed");
      expect(res.headers.get("Content-Type")).toBe(
        "application/atom+xml; charset=utf-8",
      );
    });

    it("orders Featured Threads by selected Post publication time", async () => {
      const { app, services, db } = createFeedTestApp();

      const olderPublished = await services.posts.create({
        format: "note",
        title: "Older published",
        bodyMarkdown: "Old body",
        status: "published",
        publishedAt: 1000,
      });
      const newerPublished = await services.posts.create({
        format: "note",
        title: "Newer published",
        bodyMarkdown: "New body",
        status: "published",
        publishedAt: 2000,
      });

      await db
        .update(postTable)
        .set({ featuredAt: 4000 })
        .where(eq(postTable.id, olderPublished.id));
      await db
        .update(postTable)
        .set({ featuredAt: 3000 })
        .where(eq(postTable.id, newerPublished.id));

      const res = await app.request("/feed");
      expect(res.status).toBe(200);

      const xml = await res.text();
      expect(xml.indexOf("Newer published")).toBeLessThan(
        xml.indexOf("Older published"),
      );
      expect(xml).toContain("<published>1970-01-01T00:16:40.000Z</published>");
      expect(xml).toContain("<published>1970-01-01T00:33:20.000Z</published>");
    });
  });

  describe("/latest/feed — latest public posts", () => {
    it("returns public published posts and excludes hidden, private, and draft posts", async () => {
      const { app, services } = createFeedTestApp();

      await services.posts.create({
        format: "note",
        title: "Public Post",
        bodyMarkdown: "Public",
        status: "published",
      });
      await services.posts.create({
        format: "note",
        title: "Featured Post",
        bodyMarkdown: "Featured",
        status: "published",
        featured: true,
      });
      await services.posts.create({
        format: "note",
        title: "Hidden Post",
        bodyMarkdown: "Hidden",
        status: "published",
        visibility: "latest_hidden",
      });
      await services.posts.create({
        format: "note",
        title: "Private Post",
        bodyMarkdown: "Private",
        status: "published",
        visibility: "private",
      });
      await services.posts.create({
        format: "note",
        title: "Draft Post",
        bodyMarkdown: "Draft",
        status: "draft",
      });

      const res = await app.request("/latest/feed");
      expect(res.status).toBe(200);

      const xml = await res.text();
      expect(xml).toContain("Public Post");
      expect(xml).toContain("Featured Post");
      expect(xml).not.toContain("Hidden Post");
      expect(xml).not.toContain("Private Post");
      expect(xml).not.toContain("Draft Post");
    });

    it("filters by format query parameter", async () => {
      const { app, services } = createFeedTestApp();

      await services.posts.create({
        format: "note",
        title: "My Note",
        bodyMarkdown: "A note",
        status: "published",
      });
      await services.posts.create({
        format: "link",
        title: "My Link",
        url: "https://example.com",
        status: "published",
      });
      await services.posts.create({
        format: "quote",
        title: "My Quote",
        quoteText: "Something wise",
        status: "published",
      });

      const res = await app.request("/latest/feed?format=note");
      expect(res.status).toBe(200);

      const xml = await res.text();
      expect(xml).toContain("My Note");
      expect(xml).not.toContain("My Link");
      expect(xml).not.toContain("My Quote");
    });

    it("ignores invalid format query parameter", async () => {
      const { app, services } = createFeedTestApp();

      await services.posts.create({
        format: "note",
        title: "My Note",
        bodyMarkdown: "A note",
        status: "published",
      });
      await services.posts.create({
        format: "link",
        title: "My Link",
        url: "https://example.com",
        status: "published",
      });

      const res = await app.request("/latest/feed?format=invalid");
      expect(res.status).toBe(200);

      const xml = await res.text();
      expect(xml).toContain("My Note");
      expect(xml).toContain("My Link");
    });

    it("returns Atom content type", async () => {
      const { app } = createFeedTestApp();

      const res = await app.request("/latest/feed");
      expect(res.headers.get("Content-Type")).toBe(
        "application/atom+xml; charset=utf-8",
      );
    });
  });

  describe("/featured/feed — featured posts", () => {
    it("returns only featured posts", async () => {
      const { app, services } = createFeedTestApp();

      await services.posts.create({
        format: "note",
        title: "Regular Post",
        bodyMarkdown: "Not featured",
        status: "published",
      });
      await services.posts.create({
        format: "note",
        title: "Featured Post",
        bodyMarkdown: "This is featured",
        status: "published",
        featured: true,
      });

      const res = await app.request("/featured/feed");
      expect(res.status).toBe(200);

      const xml = await res.text();
      expect(xml).toContain("Featured Post");
      expect(xml).not.toContain("Regular Post");
    });

    it("deduplicates by Thread and orders from a Featured Child publication", async () => {
      const { app, services } = createFeedTestApp();

      const olderRoot = await services.posts.create({
        format: "note",
        title: "Older Thread Root",
        bodyMarkdown: "Older root body",
        status: "published",
        publishedAt: 1000,
      });
      await services.posts.create({
        format: "note",
        title: "Featured Child",
        bodyMarkdown: "Selected child body",
        status: "published",
        replyToId: olderRoot.id,
        featured: true,
        publishedAt: 3000,
      });
      await services.posts.create({
        format: "note",
        title: "Newer Root",
        bodyMarkdown: "Newer root body",
        status: "published",
        featured: true,
        publishedAt: 2000,
      });

      const res = await app.request("/featured/feed");
      expect(res.status).toBe(200);

      const xml = await res.text();
      expect(xml.match(/<entry>/g)).toHaveLength(2);
      expect(xml).toContain("Selected child body");
      expect(xml.indexOf("Older Thread Root")).toBeLessThan(
        xml.indexOf("Newer Root"),
      );
    });
  });

  describe("legacy feed path redirects", () => {
    it("redirects /feed/latest to /latest/feed, preserving ?format=", async () => {
      const { app } = createFeedTestApp();

      const res = await app.request("/feed/latest?format=note");
      expect(res.status).toBe(308);
      expect(res.headers.get("Location")).toBe("/latest/feed?format=note");
    });

    it("redirects /feed/featured to /featured/feed", async () => {
      const { app } = createFeedTestApp();

      const res = await app.request("/feed/featured");
      expect(res.status).toBe(308);
      expect(res.headers.get("Location")).toBe("/featured/feed");
    });
  });

  describe("legacy atom.xml redirects", () => {
    it("redirects /feed/atom.xml to /feed", async () => {
      const { app } = createFeedTestApp();

      const res = await app.request("/feed/atom.xml");
      expect(res.status).toBe(308);
      expect(res.headers.get("Location")).toBe("/feed");
    });

    it("redirects /feed/latest/atom.xml to /latest/feed", async () => {
      const { app } = createFeedTestApp();

      const res = await app.request("/feed/latest/atom.xml");
      expect(res.status).toBe(308);
      expect(res.headers.get("Location")).toBe("/latest/feed");
    });

    it("redirects /feed/featured/atom.xml to /featured/feed", async () => {
      const { app } = createFeedTestApp();

      const res = await app.request("/feed/featured/atom.xml");
      expect(res.status).toBe(308);
      expect(res.headers.get("Location")).toBe("/featured/feed");
    });

    it("redirects /latest/feed/atom.xml to /latest/feed", async () => {
      const { app } = createFeedTestApp();

      const res = await app.request("/latest/feed/atom.xml");
      expect(res.status).toBe(308);
      expect(res.headers.get("Location")).toBe("/latest/feed");
    });

    it("redirects /featured/feed/atom.xml to /featured/feed", async () => {
      const { app } = createFeedTestApp();

      const res = await app.request("/featured/feed/atom.xml");
      expect(res.status).toBe(308);
      expect(res.headers.get("Location")).toBe("/featured/feed");
    });
  });

  describe("legacy feed aliases", () => {
    it("redirects /feed/all to /latest/feed", async () => {
      const { app } = createFeedTestApp();

      const res = await app.request("/feed/all?format=note");
      expect(res.status).toBe(308);
      expect(res.headers.get("Location")).toBe("/latest/feed?format=note");
    });

    it("redirects /feed/all/atom.xml to /latest/feed", async () => {
      const { app } = createFeedTestApp();

      const res = await app.request("/feed/all/atom.xml?format=link");
      expect(res.status).toBe(308);
      expect(res.headers.get("Location")).toBe("/latest/feed");
    });
  });

  it("emits canonical v3 footnotes from a stale stored projection", async () => {
    const { app, services, db } = createFeedTestApp();
    const post = await services.posts.create({
      format: "note",
      title: "Footnote feed",
      bodyMarkdown: "Feed body[^1]\n\n[^1]: Feed definition",
      status: "published",
    });
    await db
      .update(postTable)
      .set({
        bodyHtml: '<span class="sidenote">legacy</span>',
        bodyHtmlVersion: 1,
      })
      .where(eq(postTable.id, post.id));

    const response = await app.request("/latest/feed");
    const xml = await response.text();

    expect(response.status).toBe(200);
    expect(xml).toContain('role="doc-noteref"');
    expect(xml).toContain('role="doc-endnotes"');
    expect(xml).toMatch(/id="fn-[a-z0-9]{13}-1"/);
    expect(xml).not.toContain(`fn-${post.id}`);
    expect(xml).not.toContain("legacy");
  });

  describe("RSS_FEED_LIMIT env var", () => {
    it("defaults to 50 when RSS_FEED_LIMIT is not set", async () => {
      const { app, services } = createFeedTestApp();

      for (let i = 0; i < 3; i++) {
        await services.posts.create({
          format: "note",
          title: `Post ${i}`,
          bodyMarkdown: `Body ${i}`,
          status: "published",
          featured: true,
        });
      }

      const res = await app.request("/feed");
      expect(res.status).toBe(200);

      const xml = await res.text();
      expect(xml).toContain("Post 0");
      expect(xml).toContain("Post 1");
      expect(xml).toContain("Post 2");
    });

    it("respects RSS_FEED_LIMIT on the latest feed", async () => {
      const { app, services } = createFeedTestApp({
        RSS_FEED_LIMIT: "2",
      });

      for (let i = 0; i < 5; i++) {
        await services.posts.create({
          format: "note",
          title: `Post ${i}`,
          bodyMarkdown: `Body ${i}`,
          status: "published",
        });
      }

      const res = await app.request("/latest/feed");
      expect(res.status).toBe(200);

      const xml = await res.text();
      expect(xml).toContain("Post 4");
      expect(xml).toContain("Post 3");
      expect(xml).not.toContain("Post 2");
      expect(xml).not.toContain("Post 1");
      expect(xml).not.toContain("Post 0");
    });

    it("falls back to 50 for invalid RSS_FEED_LIMIT", async () => {
      const { app, services } = createFeedTestApp({
        RSS_FEED_LIMIT: "not-a-number",
      });

      for (let i = 0; i < 2; i++) {
        await services.posts.create({
          format: "note",
          title: `Post ${i}`,
          bodyMarkdown: `Body ${i}`,
          status: "published",
        });
      }

      const res = await app.request("/latest/feed");
      expect(res.status).toBe(200);

      const xml = await res.text();
      expect(xml).toContain("Post 0");
      expect(xml).toContain("Post 1");
    });

    it("also applies to the featured feed", async () => {
      const { app, services } = createFeedTestApp({
        RSS_FEED_LIMIT: "1",
      });

      for (let i = 0; i < 3; i++) {
        await services.posts.create({
          format: "note",
          title: `Post ${i}`,
          bodyMarkdown: `Body ${i}`,
          status: "published",
          featured: true,
        });
      }

      const res = await app.request("/featured/feed");
      expect(res.status).toBe(200);

      const xml = await res.text();
      expect(xml).toContain("Post 2");
      expect(xml).not.toContain("Post 1");
      expect(xml).not.toContain("Post 0");
    });
  });

  describe("thread content in feed", () => {
    it("includes thread replies inline with hr separators", async () => {
      const { app, services } = createFeedTestApp();

      const root = await services.posts.create({
        format: "note",
        title: "Thread Root",
        bodyMarkdown: "Root content",
        status: "published",
      });
      await services.posts.create({
        format: "note",
        bodyMarkdown: "Reply content",
        status: "published",
        replyToId: root.id,
      });

      const res = await app.request("/latest/feed");
      expect(res.status).toBe(200);

      const xml = await res.text();
      expect(xml).toContain("Root content");
      expect(xml).toContain("Reply content");
      expect(xml).toContain("<hr/>");
    });
  });
});
