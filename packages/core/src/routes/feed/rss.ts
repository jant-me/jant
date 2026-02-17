/**
 * RSS Feed Routes
 */

import { Hono } from "hono";
import type { Context } from "hono";
import type { Bindings, FeedData } from "../../types.js";
import type { AppVariables } from "../../app.js";
import { defaultRssRenderer, defaultAtomRenderer } from "../../lib/feed.js";
import { getSiteLanguage } from "../../lib/config.js";
import { buildMediaMap } from "../../lib/media-helpers.js";
import { createMediaContext, toPostViews } from "../../lib/view.js";

type Env = { Bindings: Bindings; Variables: AppVariables };

export const rssRoutes = new Hono<Env>();

/**
 * Build FeedData from the Hono context.
 */
async function buildFeedData(c: Context<Env>): Promise<FeedData> {
  const all = await c.var.services.settings.getAll();
  const siteName = all["SITE_NAME"] ?? "Jant";
  const siteDescription = all["SITE_DESCRIPTION"] ?? "";
  const siteUrl = c.env.SITE_URL;
  const siteLanguage = await getSiteLanguage(c);

  const feedLimit = parseInt(c.env.RSS_FEED_LIMIT ?? "50", 10) || 50;

  const posts = await c.var.services.posts.list({
    status: "published",
    excludeReplies: true,
    limit: feedLimit,
  });

  // Batch load media for enclosures
  const postIds = posts.map((p) => p.id);
  const rawMediaMap = await c.var.services.media.getByPostIds(postIds);
  const mediaCtx = createMediaContext(c);
  const mediaMap = buildMediaMap(
    rawMediaMap,
    mediaCtx.r2PublicUrl,
    mediaCtx.imageTransformUrl,
    mediaCtx.s3PublicUrl,
  );

  // Transform to PostView[] with media
  const postViews = toPostViews(
    posts.map((p) => ({
      ...p,
      mediaAttachments: mediaMap.get(p.id) ?? [],
    })),
    mediaCtx,
  );

  return {
    siteName,
    siteDescription,
    siteUrl,
    siteLanguage,
    posts: postViews,
  };
}

// RSS 2.0 Feed - main feed at /feed
rssRoutes.get("/", async (c) => {
  const feedData = await buildFeedData(c);

  const renderer = c.var.config.feed?.rss ?? defaultRssRenderer;
  const xml = renderer(feedData);

  return new Response(xml, {
    headers: {
      "Content-Type": "application/rss+xml; charset=utf-8",
    },
  });
});

// Atom Feed
rssRoutes.get("/atom.xml", async (c) => {
  const feedData = await buildFeedData(c);

  const renderer = c.var.config.feed?.atom ?? defaultAtomRenderer;
  const xml = renderer(feedData);

  return new Response(xml, {
    headers: {
      "Content-Type": "application/atom+xml; charset=utf-8",
    },
  });
});
