import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import type { Bindings } from "../../../types.js";
import type { AppVariables } from "../../../app.js";
import { createTestDatabase } from "../../../__tests__/helpers/db.js";
import { createPostService } from "../../../services/post.js";
import { createSettingsService } from "../../../services/settings.js";
import { createMediaService } from "../../../services/media.js";
import { rssRoutes } from "../rss.js";

type Env = { Bindings: Bindings; Variables: AppVariables };

function createFeedTestApp(envOverrides: Partial<Bindings> = {}) {
  const { db } = createTestDatabase();

  const services = {
    posts: createPostService(db as never),
    settings: createSettingsService(db as never),
    media: createMediaService(db as never),
  };

  const app = new Hono<Env>();

  app.use("*", async (c, next) => {
    c.env = {
      SITE_URL: "http://localhost:9019",
      ...envOverrides,
    } as Bindings;

    c.set("services", services as AppVariables["services"]);
    c.set("config", {});
    await next();
  });

  app.route("/feed", rssRoutes);

  return { app, services };
}

describe("RSS Feed Routes", () => {
  describe("RSS_FEED_LIMIT env var", () => {
    it("defaults to 50 when RSS_FEED_LIMIT is not set", async () => {
      const { app, services } = createFeedTestApp();

      // Create 3 posts
      for (let i = 0; i < 3; i++) {
        await services.posts.create({
          format: "note",
          title: `Post ${i}`,
          body: `Body ${i}`,
          status: "published",
        });
      }

      const res = await app.request("/feed");
      expect(res.status).toBe(200);

      const xml = await res.text();
      // All 3 posts should appear (under default limit of 50)
      expect(xml).toContain("Post 0");
      expect(xml).toContain("Post 1");
      expect(xml).toContain("Post 2");
    });

    it("respects RSS_FEED_LIMIT to limit the number of posts", async () => {
      const { app, services } = createFeedTestApp({
        RSS_FEED_LIMIT: "2",
      });

      // Create 5 posts
      for (let i = 0; i < 5; i++) {
        await services.posts.create({
          format: "note",
          title: `Post ${i}`,
          body: `Body ${i}`,
          status: "published",
        });
      }

      const res = await app.request("/feed");
      expect(res.status).toBe(200);

      const xml = await res.text();
      // Posts are ordered by publishedAt DESC, so the latest 2 should appear
      // With same timestamp they fall back to id DESC, so Post 4 and Post 3
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

      // Create 2 posts
      for (let i = 0; i < 2; i++) {
        await services.posts.create({
          format: "note",
          title: `Post ${i}`,
          body: `Body ${i}`,
          status: "published",
        });
      }

      const res = await app.request("/feed");
      expect(res.status).toBe(200);

      const xml = await res.text();
      // Both posts should appear (fallback to 50)
      expect(xml).toContain("Post 0");
      expect(xml).toContain("Post 1");
    });

    it("also applies to atom feed", async () => {
      const { app, services } = createFeedTestApp({
        RSS_FEED_LIMIT: "1",
      });

      for (let i = 0; i < 3; i++) {
        await services.posts.create({
          format: "note",
          title: `Post ${i}`,
          body: `Body ${i}`,
          status: "published",
        });
      }

      const res = await app.request("/feed/atom.xml");
      expect(res.status).toBe(200);

      const xml = await res.text();
      // Only the latest post should appear
      expect(xml).toContain("Post 2");
      expect(xml).not.toContain("Post 1");
      expect(xml).not.toContain("Post 0");
    });
  });
});
