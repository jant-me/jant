/**
 * View Model Conversions (v2)
 *
 * Transforms raw database models into render-ready View types.
 * Theme components receive only View types -- no lib/ imports needed.
 */

import type { Context } from "hono";
import type {
  Post,
  PostWithMedia,
  Page,
  Media,
  MediaView,
  PostView,
  PageView,
  NavItemView,
  NavItem,
  SearchResult,
  SearchResultView,
  ArchiveGroup,
  Format,
  Status,
  NavItemType,
} from "../types.js";
import { encode } from "./sqid.js";
import {
  toISOString,
  formatDate,
  formatTime,
  formatRelativeTime,
} from "./time.js";
import { getMediaUrl, getImageUrl, getPublicUrlForProvider } from "./image.js";
import { getHtmlExcerpt } from "./excerpt.js";

// =============================================================================
// Media Context
// =============================================================================

/**
 * Central media config -- extracted once per request from env.
 */
export interface MediaContext {
  r2PublicUrl?: string;
  imageTransformUrl?: string;
  s3PublicUrl?: string;
}

/**
 * Creates a MediaContext from Hono context environment variables.
 *
 * @param c - Hono context
 * @returns MediaContext with env values
 */
export function createMediaContext(c: Context): MediaContext {
  return {
    r2PublicUrl: c.env.R2_PUBLIC_URL,
    imageTransformUrl: c.env.IMAGE_TRANSFORM_URL,
    s3PublicUrl: c.env.S3_PUBLIC_URL,
  };
}

// =============================================================================
// Media Conversions
// =============================================================================

/**
 * Converts a raw Media record to a render-ready MediaView.
 *
 * @param media - Raw media record from database
 * @param ctx - Media context with URL configuration
 * @returns Render-ready MediaView with pre-computed URLs
 */
export function toMediaView(media: Media, ctx: MediaContext): MediaView {
  const publicUrl = getPublicUrlForProvider(
    media.provider,
    ctx.r2PublicUrl,
    ctx.s3PublicUrl,
  );
  const url = getMediaUrl(media.storageKey, publicUrl);
  const thumbnailUrl = getImageUrl(url, ctx.imageTransformUrl, {
    width: 400,
    quality: 80,
    format: "auto",
    fit: "cover",
  });

  return {
    id: media.id,
    url,
    thumbnailUrl,
    mimeType: media.mimeType,
    altText: media.alt ?? undefined,
    width: media.width ?? undefined,
    height: media.height ?? undefined,
    size: media.size,
  };
}

// =============================================================================
// Post Conversions
// =============================================================================

/**
 * Converts a PostWithMedia to a render-ready PostView.
 *
 * @param post - Post with media attachments from database
 * @param _ctx - Media context with URL configuration
 * @returns Render-ready PostView with pre-computed fields
 */
export function toPostView(post: PostWithMedia, _ctx: MediaContext): PostView {
  const permalink = post.path ? `/${post.path}` : `/p/${encode(post.id)}`;

  // Pre-compute excerpt from raw body
  let excerpt: string | undefined;
  if (post.body) {
    excerpt =
      post.body.length > 160 ? post.body.slice(0, 160) + "..." : post.body;
  }

  // Pre-compute HTML summary for article-style posts (with title)
  let summaryHtml: string | undefined;
  let summaryHasMore: boolean | undefined;
  if (post.title && post.bodyHtml) {
    const result = getHtmlExcerpt(post.bodyHtml);
    summaryHtml = result.excerpt;
    summaryHasMore = result.hasMore;
  }

  // Convert media attachments
  const media: MediaView[] = post.mediaAttachments.map((m) => ({
    id: m.id,
    url: m.url,
    thumbnailUrl: m.previewUrl,
    mimeType: m.mimeType,
    altText: m.alt ?? undefined,
    width: m.width ?? undefined,
    height: m.height ?? undefined,
  }));

  return {
    id: post.id,
    permalink,
    path: post.path ?? undefined,
    title: post.title ?? undefined,
    bodyHtml: post.bodyHtml ?? undefined,
    excerpt,
    summaryHtml,
    summaryHasMore,
    url: post.url ?? undefined,
    quoteText: post.quoteText ?? undefined,
    format: post.format as Format,
    status: post.status as Status,
    featured: post.featured === 1,
    pinned: post.pinned === 1,
    rating: post.rating ?? undefined,
    collectionId: post.collectionId ?? undefined,
    publishedAt: toISOString(post.publishedAt),
    publishedAtFormatted: formatDate(post.publishedAt),
    publishedAtTime: formatTime(post.publishedAt),
    publishedAtRelative: formatRelativeTime(post.publishedAt),
    updatedAt: toISOString(post.updatedAt),
    media,
    replyToId: post.replyToId ?? undefined,
    threadRootId: post.threadId ?? undefined,
    body: post.body ?? undefined,
  };
}

/**
 * Batch converts PostWithMedia[] to PostView[].
 */
export function toPostViews(
  posts: PostWithMedia[],
  ctx: MediaContext,
): PostView[] {
  return posts.map((p) => toPostView(p, ctx));
}

/**
 * Converts a bare Post (no media) to a PostView with empty media array.
 */
export function toPostViewFromPost(post: Post, ctx: MediaContext): PostView {
  return toPostView({ ...post, mediaAttachments: [] }, ctx);
}

/**
 * Batch converts Post[] (no media) to PostView[].
 */
export function toPostViewsFromPosts(
  posts: Post[],
  ctx: MediaContext,
): PostView[] {
  return posts.map((p) => toPostViewFromPost(p, ctx));
}

// =============================================================================
// Page Conversions
// =============================================================================

/**
 * Converts a Page to a render-ready PageView.
 */
export function toPageView(page: Page): PageView {
  return {
    id: page.id,
    slug: page.slug,
    title: page.title ?? undefined,
    bodyHtml: page.bodyHtml ?? undefined,
    status: page.status as Status,
    createdAt: toISOString(page.createdAt),
    updatedAt: toISOString(page.updatedAt),
  };
}

// =============================================================================
// Navigation Conversions
// =============================================================================

/**
 * Converts a NavItem to a NavItemView with pre-computed state.
 */
export function toNavItemView(item: NavItem, currentPath: string): NavItemView {
  const isExternal =
    item.url.startsWith("http://") || item.url.startsWith("https://");

  let isActive = false;
  if (!isExternal) {
    if (item.url === "/") {
      isActive = currentPath === "/";
    } else {
      isActive =
        currentPath === item.url || currentPath.startsWith(item.url + "/");
    }
  }

  return {
    id: item.id,
    type: item.type as NavItemType,
    label: item.label,
    url: item.url,
    pageId: item.pageId ?? undefined,
    isActive,
    isExternal,
  };
}

/**
 * Batch converts NavItem[] to NavItemView[].
 */
export function toNavItemViews(
  items: NavItem[],
  currentPath: string,
): NavItemView[] {
  return items.map((item) => toNavItemView(item, currentPath));
}

// =============================================================================
// Search Result Conversions
// =============================================================================

/**
 * Converts a SearchResult to a SearchResultView with PostView.
 */
export function toSearchResultView(
  result: SearchResult,
  ctx: MediaContext,
): SearchResultView {
  return {
    post: toPostViewFromPost(result.post, ctx),
    rank: result.rank,
    snippet: result.snippet,
  };
}

/**
 * Batch converts SearchResult[] to SearchResultView[].
 */
export function toSearchResultViews(
  results: SearchResult[],
  ctx: MediaContext,
): SearchResultView[] {
  return results.map((r) => toSearchResultView(r, ctx));
}

// =============================================================================
// Archive Group Conversions
// =============================================================================

/**
 * Converts a grouped post map to typed ArchiveGroup[].
 */
export function toArchiveGroups(
  grouped: Map<string, Post[]>,
  ctx: MediaContext,
): ArchiveGroup[] {
  const groups: ArchiveGroup[] = [];
  for (const [yearMonth, posts] of grouped) {
    const [year, month] = yearMonth.split("-");
    if (!year || !month) continue;

    const date = new Date(parseInt(year, 10), parseInt(month, 10) - 1);
    const label = date.toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
    });

    groups.push({
      year,
      month,
      label,
      posts: toPostViewsFromPosts(posts, ctx),
    });
  }
  return groups;
}
