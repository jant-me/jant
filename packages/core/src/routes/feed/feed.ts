/**
 * Atom Feed Routes
 *
 * Feed hierarchy (resource-first: a feed is a sub-resource of the page it
 * represents, so it lives at `{page}/feed`):
 * - /feed                    — site main feed (latest or featured, site-configurable; feed of `/`)
 * - /latest/feed             — latest public posts (handled in pages/latest)
 * - /featured/feed           — featured posts only (handled in pages/featured)
 * - /archive/feed            — full archive incl. Hidden-from-Latest (handled in pages/archive)
 * - /{slug}/feed             — single-collection feed (handled in page routes)
 * - /collections/{slug}/feed — combined collection feed (handled in collection routes)
 *
 * Legacy: /feed/latest and /feed/featured 308-redirect to the canonical
 * /latest/feed and /featured/feed. Kept indefinitely for old subscribers.
 */

import { msg } from "@lingui/core/macro";
import { Hono } from "hono";
import type { Context } from "hono";
import type {
  Bindings,
  FeedData,
  FeedKind,
  FeedPostView,
  Format,
  Post,
} from "../../types.js";
import type { AppVariables } from "../../types/app-context.js";
import { defaultFeedRenderer } from "../../lib/feed.js";
import {
  buildFeedDiscoveryFields,
  featuredFeedSelection,
  getFeedEntryUpdatedAt,
  getFeedLimit,
  getRssPublishedBefore,
  latestFeedSelection,
  feedsPublished,
  renderFeed,
} from "../../lib/feed-policy.js";
import { buildMediaMap } from "../../lib/media-helpers.js";
import { getI18n } from "../../i18n/index.js";
import { FORMATS } from "../../types/constants.js";

import { createMediaContext, toPostViews } from "../../lib/view.js";
import { toAbsoluteSiteUrl, toPublicPath } from "../../lib/url.js";
import { getViewLang, viewBasePath } from "../../lib/view-language.js";
import { toPlainText } from "../../lib/markdown.js";

type Env = { Bindings: Bindings; Variables: AppVariables };

export const feedRoutes = new Hono<Env>();

interface FeedOptions {
  kind: FeedKind;
  selfPath: string;
  format?: Format;
}

/**
 * Load media for a set of post IDs, build the media map, and return it.
 */
async function loadMediaMap(
  c: Context<Env>,
  postIds: string[],
  mediaCtx: ReturnType<typeof createMediaContext>,
) {
  if (postIds.length === 0) {
    return buildMediaMap(
      new Map(),
      mediaCtx.r2PublicUrl,
      mediaCtx.imageTransformUrl,
      mediaCtx.s3PublicUrl,
      mediaCtx.localPublicUrl,
      mediaCtx.sitePathPrefix,
    );
  }

  const rawMediaMap = await c.var.services.media.getByPostIds(postIds);
  return buildMediaMap(
    rawMediaMap,
    mediaCtx.r2PublicUrl,
    mediaCtx.imageTransformUrl,
    mediaCtx.s3PublicUrl,
    mediaCtx.localPublicUrl,
    mediaCtx.sitePathPrefix,
  );
}

/**
 * The entries of a feed, with each root's replies, from the root posts it
 * lists.
 *
 * Every feed builds its entries here, so an entry and its replies are named
 * the same way in all of them. A post's permalink is what `<jant:post>` rows,
 * the fold's `gap` and `latest`, and every `media:content` name it by, and a
 * consumer keys on that address; it has to be the one the site itself uses,
 * which is the post's first alias when it has one, for replies as for roots.
 *
 * @param c - The feed request
 * @param posts - The entries, in feed order
 * @param options.publishedBefore - The feed's publication cutoff, which the
 *   replies follow too
 * @param options.threadMap - Threads the caller already read, keyed by root
 * @param options.alsoUpdatedAt - More moments an entry changed, such as when
 *   a collection took it
 * @returns One view per post, in the same order
 * @example
 * const postViews = await buildFeedPostViews(c, posts, { publishedBefore });
 */
export async function buildFeedPostViews(
  c: Context<Env>,
  posts: Post[],
  options: {
    publishedBefore: number;
    threadMap?: Map<string, Post[]>;
    alsoUpdatedAt?: (index: number) => readonly (number | undefined)[];
  },
): Promise<FeedPostView[]> {
  const rootIds = posts.filter((p) => p.threadId === p.id).map((p) => p.id);
  const threadMap =
    options.threadMap ??
    (await c.var.services.posts.getPublishedThreads(rootIds, {
      publishedBefore: options.publishedBefore,
    }));

  const ids = new Set(posts.map((p) => p.id));
  for (const thread of threadMap.values()) {
    for (const post of thread) ids.add(post.id);
  }

  const mediaCtx = createMediaContext(c.var.appConfig);
  const [mediaMap, aliasesMap] = await Promise.all([
    loadMediaMap(c, [...ids], mediaCtx),
    c.var.services.paths.getPostAliases([...ids]),
  ]);
  const aliasMap = new Map<string, string>();
  for (const [id, aliases] of aliasesMap) {
    if (aliases[0]) aliasMap.set(id, aliases[0]);
  }
  const withMedia = (post: Post) => ({
    ...post,
    mediaAttachments: mediaMap.get(post.id) ?? [],
  });

  return toPostViews(posts.map(withMedia), mediaCtx, undefined, aliasMap).map(
    (postView, index) => {
      const post = posts[index] as Post;
      const thread = threadMap.get(post.id);
      const replies = thread?.filter((reply) => reply.id !== post.id) ?? [];
      return {
        ...postView,
        feedUpdatedAt: getFeedEntryUpdatedAt(
          post,
          thread,
          options.alsoUpdatedAt?.(index) ?? [],
        ),
        threadReplies:
          replies.length > 0
            ? toPostViews(replies.map(withMedia), mediaCtx, undefined, aliasMap)
            : undefined,
      };
    },
  );
}

/**
 * Build feed data for the "latest" feed kind.
 */
async function buildLatestFeedData(
  c: Context<Env>,
  feedLimit: number,
  publishedBefore: number,
  format?: Format,
): Promise<{ posts: Post[]; postViews: FeedPostView[] }> {
  const posts = await c.var.services.posts.list({
    ...latestFeedSelection({
      lang: getViewLang(c) ?? undefined,
      publishedBefore,
    }),
    format,
    ignorePinnedSort: true,
    limit: feedLimit,
  });

  const postViews = await buildFeedPostViews(c, posts, { publishedBefore });

  return { posts, postViews };
}

/**
 * Build feed data for the "featured" feed kind.
 *
 * Uses the same query strategy as the featured timeline page:
 * find thread roots that contain any featured post, then include
 * the full thread content.
 */
async function buildFeaturedFeedData(
  c: Context<Env>,
  feedLimit: number,
  publishedBefore: number,
): Promise<{ posts: Post[]; postViews: FeedPostView[] }> {
  const rootIds = await c.var.services.posts.listFeaturedThreadRootIds({
    ...featuredFeedSelection({
      lang: getViewLang(c) ?? undefined,
      publishedBefore,
    }),
    limit: feedLimit,
  });

  if (rootIds.length === 0) {
    return { posts: [], postViews: [] };
  }

  const threadMap = await c.var.services.posts.getPublishedThreads(rootIds, {
    publishedBefore,
  });

  // Extract root posts in the same order as rootIds
  const posts: Post[] = [];
  for (const rootId of rootIds) {
    const thread = threadMap.get(rootId);
    const root = thread?.[0];
    if (root && root.id === rootId) {
      posts.push(root);
    }
  }

  const postViews = await buildFeedPostViews(c, posts, {
    publishedBefore,
    threadMap,
  });

  return { posts, postViews };
}

/**
 * Build FeedData from the Hono context.
 *
 * Exported so the canonical latest/featured feeds (served from the
 * `/latest/feed` and `/featured/feed` page route groups) can reuse the
 * same feed-building logic.
 *
 * @param c - Hono context
 * @param opts - Filter options for the feed
 * @returns Feed data ready for rendering
 */
export async function buildFeedData(
  c: Context<Env>,
  opts: FeedOptions,
): Promise<FeedData> {
  const { appConfig } = c.var;
  const i18n = getI18n(c);
  const siteName = appConfig.siteName;
  const siteDescription = toPlainText(appConfig.siteDescription);
  const siteUrl = appConfig.siteUrl;
  // A language view's feed is that language's feed, so it declares it.
  const siteLanguage = getViewLang(c) ?? appConfig.siteLanguage;
  const feedLimit = getFeedLimit(c);
  const publishedBefore = getRssPublishedBefore(
    appConfig.rssPublishDelaySeconds,
  );
  const kind = opts.kind;

  const { postViews } =
    kind === "featured"
      ? await buildFeaturedFeedData(c, feedLimit, publishedBefore)
      : await buildLatestFeedData(c, feedLimit, publishedBefore, opts.format);

  return {
    ...buildFeedDiscoveryFields(c),
    siteName,
    siteDescription,
    siteUrl,
    siteLanguage,
    title:
      kind === "featured"
        ? `${siteName} - ${i18n._(
            msg({
              message: "Featured posts",
              comment:
                "@context: Atom feed title suffix for the featured posts feed",
            }),
          )}`
        : `${siteName} - ${i18n._(
            msg({
              message: "Latest posts",
              comment:
                "@context: Atom feed title suffix for the latest public posts feed",
            }),
          )}`,
    selfUrl: toAbsoluteSiteUrl(
      `${viewBasePath(c)}${opts.selfPath}`,
      siteUrl,
      appConfig.sitePathPrefix,
    ),
    siteIconUrl: appConfig.siteAvatarUrl || undefined,
    posts: postViews,
  };
}

/**
 * Parse and validate the `format` query parameter.
 * Returns a valid Format or undefined if missing/invalid.
 */
export function parseFormatQuery(c: Context<Env>): Format | undefined {
  const raw = c.req.query("format");
  if (raw && (FORMATS as readonly string[]).includes(raw)) {
    return raw as Format;
  }
  return undefined;
}

/**
 * Render the site's main Atom feed for the current view language.
 *
 * @param c - Hono context
 * @returns Atom feed response
 */
export async function renderMainFeed(c: Context<Env>): Promise<Response> {
  if (!feedsPublished(c)) return c.notFound();
  const kind = c.var.appConfig.mainRssFeed === "latest" ? "latest" : "featured";
  const feedData = await buildFeedData(c, { kind, selfPath: "/feed" });
  return renderFeed(defaultFeedRenderer(feedData));
}

// Every route under /feed is a feed or a redirect to one.
feedRoutes.use("*", async (c, next) => {
  if (!feedsPublished(c)) return c.notFound();
  await next();
});

// Atom — /feed
feedRoutes.get("/", renderMainFeed);

// Legacy — /feed/latest moved to the canonical /latest/feed. Kept
// indefinitely as a 308 so old subscribers don't break; preserves the
// ?format= query string.
feedRoutes.get("/latest", (c) => {
  const sitePathPrefix = c.var.appConfig.sitePathPrefix;
  const qs = c.req.url.includes("?")
    ? c.req.url.slice(c.req.url.indexOf("?"))
    : "";
  return c.redirect(
    `${toPublicPath("/latest/feed", sitePathPrefix)}${qs}`,
    308,
  );
});

// Legacy — /feed/featured moved to the canonical /featured/feed.
feedRoutes.get("/featured", (c) => {
  const sitePathPrefix = c.var.appConfig.sitePathPrefix;
  return c.redirect(toPublicPath("/featured/feed", sitePathPrefix), 308);
});

// Legacy aliases
feedRoutes.get("/all", (c) => {
  const sitePathPrefix = c.var.appConfig.sitePathPrefix;
  const qs = c.req.url.includes("?")
    ? c.req.url.slice(c.req.url.indexOf("?"))
    : "";
  return c.redirect(
    `${toPublicPath("/latest/feed", sitePathPrefix)}${qs}`,
    308,
  );
});

// Legacy atom.xml paths redirect to canonical feed paths
feedRoutes.get("/atom.xml", (c) => {
  const sitePathPrefix = c.var.appConfig.sitePathPrefix;
  return c.redirect(toPublicPath("/feed", sitePathPrefix), 308);
});
feedRoutes.get("/latest/atom.xml", (c) => {
  const sitePathPrefix = c.var.appConfig.sitePathPrefix;
  return c.redirect(toPublicPath("/latest/feed", sitePathPrefix), 308);
});
feedRoutes.get("/featured/atom.xml", (c) => {
  const sitePathPrefix = c.var.appConfig.sitePathPrefix;
  return c.redirect(toPublicPath("/featured/feed", sitePathPrefix), 308);
});
feedRoutes.get("/all/atom.xml", (c) => {
  const sitePathPrefix = c.var.appConfig.sitePathPrefix;
  return c.redirect(toPublicPath("/latest/feed", sitePathPrefix), 308);
});
