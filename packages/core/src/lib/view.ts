/**
 * View Model Conversions (v2)
 *
 * Transforms raw database models into render-ready View types.
 * Theme components receive only View types -- no lib/ imports needed.
 */

import type { JSONContent } from "@tiptap/core";
import type {
  Post,
  PostWithMedia,
  Media,
  MediaView,
  PostView,
  CollectionTagView,
  NavItemView,
  NavItem,
  SearchResult,
  SearchResultView,
  ArchiveGroup,
  Collection,
  Format,
  Status,
  NavItemType,
  NavItemPlacement,
  AppConfig,
  SystemNavKey,
} from "../types.js";
import { SYSTEM_NAV_KEYS } from "../types/constants.js";
import {
  toISOString,
  formatDate,
  formatTime,
  formatRelativeTime,
} from "./time.js";
import { getCollectionPagePath } from "./collection-paths.js";
import { getMediaUrl, getImageUrl, getPublicUrlForProvider } from "./image.js";
import { extractSummaryHtml, extractBodyText } from "./summary.js";
import { renderTiptapDocumentAroundBoundary } from "./tiptap-render.js";
import { highlightText } from "./search-snippet.js";
import { isFullUrl, toPublicPath, toSameSitePath } from "./url.js";

// =============================================================================
// Media Context
// =============================================================================

/**
 * Central media config -- extracted once per request from appConfig.
 */
export interface MediaContext {
  r2PublicUrl?: string;
  imageTransformUrl?: string;
  s3PublicUrl?: string;
  localPublicUrl?: string;
  sitePathPrefix?: string;
  timeZone?: string;
  /** Active storage driver name — used to resolve CDN URLs for server-stored assets like previews. */
  storageDriver?: string;
}

/**
 * Creates a MediaContext from AppConfig.
 *
 * @param appConfig - Resolved app configuration
 * @returns MediaContext with URL values
 */
export function createMediaContext(appConfig: AppConfig): MediaContext {
  return {
    r2PublicUrl: appConfig.r2PublicUrl || undefined,
    imageTransformUrl: appConfig.imageTransformUrl || undefined,
    s3PublicUrl: appConfig.s3PublicUrl || undefined,
    localPublicUrl: appConfig.localPublicUrl || undefined,
    sitePathPrefix: appConfig.sitePathPrefix || undefined,
    timeZone: appConfig.timeZone || undefined,
    storageDriver: appConfig.storageDriver || undefined,
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
    ctx.localPublicUrl,
  );
  const url = getMediaUrl(media.storageKey, publicUrl, ctx.sitePathPrefix);

  // Only apply image transforms for image MIME types
  const thumbnailUrl = media.mimeType.startsWith("image/")
    ? getImageUrl(url, ctx.imageTransformUrl, {
        width: 1200,
        height: 768,
        quality: 80,
        format: "auto",
        fit: "scale-down",
      })
    : url;

  const posterRawUrl = media.posterKey
    ? getMediaUrl(media.posterKey, publicUrl, ctx.sitePathPrefix)
    : undefined;
  const posterUrl = posterRawUrl
    ? getImageUrl(posterRawUrl, ctx.imageTransformUrl, {
        width: 640,
        quality: 80,
        format: "auto",
        fit: "scale-down",
      })
    : undefined;

  return {
    id: media.id,
    url,
    thumbnailUrl,
    mimeType: media.mimeType,
    altText: media.alt ?? undefined,
    width: media.width ?? undefined,
    height: media.height ?? undefined,
    durationSeconds: media.durationSeconds ?? undefined,
    size: media.size,
    blurhash: media.blurhash ?? undefined,
    waveform: media.waveform ?? undefined,
    posterUrl,
    chars: media.chars ?? undefined,
  };
}

// =============================================================================
// Post Conversions
// =============================================================================

/** Feed summary limits for titled, article-style posts (the excerpt is a teaser). */
const ARTICLE_SUMMARY_MAX_BLOCKS = 5;
const ARTICLE_SUMMARY_MAX_CHARS = 500;
/** Larger feed summary limits for untitled notes — the body itself is the content. */
const NOTE_SUMMARY_MAX_BLOCKS = 10;
const NOTE_SUMMARY_MAX_CHARS = 1500;
/** Don't truncate an untitled note just to hide a tail under this many chars. */
const NOTE_SUMMARY_MIN_HIDDEN_CHARS = 200;

/**
 * Splice a zero-width marker into rendered body HTML at a summary boundary.
 *
 * The summary HTML is not a byte-prefix of `bodyHtml` — structural nodes
 * (horizontalRule, moreBreak, image) appear in `bodyHtml` but are excluded from
 * the summary, so slicing `bodyHtml` by summary length lands mid-tag and
 * corrupts the markup. Instead we split a full-document render at the exact
 * source boundary. The full render plan keeps repeated-footnote backlinks
 * byte-compatible across the split.
 *
 * @param bodyJson - Tiptap JSON string for the post body
 * @param bodyHtml - Rendered body HTML to splice the marker into
 * @param breakAtIndex - Index in `doc.content` where the post-summary content begins
 * @param markerHtml - Inert marker to insert at the boundary (e.g. an anchor span)
 * @returns `bodyHtml` with the marker inserted, or null when the split can't be
 *   computed safely (caller should fall back to the untouched body)
 */
function spliceAtSummaryBoundary(
  bodyJson: string,
  bodyHtml: string,
  breakAtIndex: number,
  markerHtml: string,
  namespace: string,
): string | null {
  try {
    const doc = JSON.parse(bodyJson) as { type?: string; content?: unknown[] };
    if (
      doc.type !== "doc" ||
      !Array.isArray(doc.content) ||
      breakAtIndex <= 0 ||
      breakAtIndex > doc.content.length
    ) {
      return null;
    }
    const split = renderTiptapDocumentAroundBoundary(
      doc as JSONContent,
      breakAtIndex,
      { namespace },
    );
    if (!split || split.beforeHtml + split.afterHtml !== bodyHtml) return null;
    return split.beforeHtml + markerHtml + split.afterHtml;
  } catch {
    // Better an untouched body than corrupted markup.
    return null;
  }
}

function normalizePreviewText(
  text: string | null | undefined,
): string | undefined {
  const normalized = (text ?? "").replace(/\s+/g, " ").trim();
  return normalized || undefined;
}

function getLegacyBodyPreview(post: PostWithMedia): string | undefined {
  const body = post.body?.trim();
  if (!body || body.startsWith("{") || body.startsWith("[")) {
    return undefined;
  }
  return normalizePreviewText(body);
}

function getPlainSummary(post: PostWithMedia): string | undefined {
  if (post.format === "quote") {
    return normalizePreviewText(post.quoteText);
  }

  // `post.bodyText` is written with `includeLinkHrefs: true` for FTS search
  // indexing, so it's polluted with trailing link URLs. For human-facing
  // preview text, prefer a clean re-derivation from the source TipTap JSON.
  // Fall back to `post.bodyText` when the body isn't valid JSON (legacy rows
  // or fixtures); that path predates link-href injection and carries no
  // pollution risk.
  const cleanBody = post.body ? extractBodyText(post.body) : null;

  return (
    normalizePreviewText(post.summary) ||
    normalizePreviewText(cleanBody) ||
    normalizePreviewText(post.bodyText) ||
    getLegacyBodyPreview(post) ||
    normalizePreviewText(post.url)
  );
}

function clipPreviewText(
  text: string | undefined,
  maxChars: number,
): string | undefined {
  if (!text) return undefined;
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars).trimEnd()}...`;
}

/**
 * Converts a PostWithMedia to a render-ready PostView.
 *
 * @param post - Post with media attachments from database
 * @param _ctx - Media context with URL configuration
 * @param threadCollections - Optional shared Thread collections projected here
 * @returns Render-ready PostView with pre-computed fields
 */
export function toPostView(
  post: PostWithMedia,
  ctx: MediaContext,
  threadCollections?: Collection[],
  isLastInThread?: boolean,
  aliasPath?: string,
  pinnedInCollection?: boolean,
): PostView {
  const id = post.id;
  const permalink = toPublicPath(
    aliasPath ?? `/${post.slug}`,
    ctx.sitePathPrefix,
  );
  const timeZone = ctx.timeZone ?? "UTC";
  const publishedAt = post.publishedAt ?? post.updatedAt;
  const featuredAt = post.featuredAt;
  const summary = getPlainSummary(post);

  // Pre-compute excerpt from the unified plain-text summary.
  const excerpt = clipPreviewText(summary, 160);

  // Pre-compute feed/list truncation. The two formats differ:
  //
  // - Titled (article-style) posts get an excerpt teaser (`summaryHtml`) and a
  //   "Continue" link to the full page; a `#continue` anchor is spliced into the
  //   body for scroll targeting on that page.
  // - Untitled notes render their body in full and expand in place. When the
  //   body is long enough to truncate (larger limit + tolerance guard) we splice
  //   a `data-note-break` marker at the boundary so the feed can clamp the tail
  //   with CSS and reveal it on click — no excerpt, no extra fetch. We do NOT
  //   set `summaryHtml` for notes (the card renders the full marked body), and
  //   only flag `summaryHasMore` when the split actually succeeds.
  let summaryHtml: string | undefined;
  let summaryHasMore: boolean | undefined;
  let bodyHtmlWithAnchor = post.bodyHtml;
  if (post.body) {
    const isArticle = !!post.title;
    const result = extractSummaryHtml(
      post.body,
      isArticle ? ARTICLE_SUMMARY_MAX_BLOCKS : NOTE_SUMMARY_MAX_BLOCKS,
      isArticle ? ARTICLE_SUMMARY_MAX_CHARS : NOTE_SUMMARY_MAX_CHARS,
      isArticle ? 0 : NOTE_SUMMARY_MIN_HIDDEN_CHARS,
      { namespace: id },
    );
    if (result && isArticle) {
      summaryHtml = result.html;
      summaryHasMore = result.hasMore;
      if (result.hasMore && post.bodyHtml) {
        const spliced = spliceAtSummaryBoundary(
          post.body,
          post.bodyHtml,
          result.breakAtIndex,
          '<span id="continue"></span>',
          id,
        );
        if (spliced) bodyHtmlWithAnchor = spliced;
      }
    } else if (result && result.hasMore && post.bodyHtml) {
      const spliced = spliceAtSummaryBoundary(
        post.body,
        post.bodyHtml,
        result.breakAtIndex,
        "<span data-note-break></span>",
        id,
      );
      if (spliced) {
        bodyHtmlWithAnchor = spliced;
        summaryHasMore = true;
      }
    }
  }

  // Convert collection tags
  const collections: CollectionTagView[] = (threadCollections ?? []).map(
    (c) => ({
      slug: c.slug,
      title: c.title,
      url: toPublicPath(getCollectionPagePath(c.slug), ctx.sitePathPrefix),
    }),
  );

  // Convert media attachments
  const media: MediaView[] = post.mediaAttachments.map((m) => ({
    id: m.id,
    url: m.url,
    thumbnailUrl: m.previewUrl,
    mimeType: m.mimeType,
    altText: m.alt ?? undefined,
    width: m.width ?? undefined,
    height: m.height ?? undefined,
    durationSeconds: m.durationSeconds ?? undefined,
    size: m.size ?? undefined,
    blurhash: m.blurhash ?? undefined,
    waveform: m.waveform ?? undefined,
    posterUrl: m.posterUrl ?? undefined,
    originalName: m.originalName ?? undefined,
    summary: m.summary ?? undefined,
    chars: m.chars ?? undefined,
  }));

  return {
    id,
    permalink,
    slug: post.slug,
    title: post.title ?? undefined,
    bodyHtml: bodyHtmlWithAnchor ?? undefined,
    summary,
    excerpt,
    summaryHtml,
    summaryHasMore,
    url: post.url ?? undefined,
    quoteText: post.quoteText ?? undefined,
    format: post.format as Format,
    status: post.status as Status,
    visibility: post.visibility,
    pinned: post.pinnedAt !== null,
    pinnedInCollection: pinnedInCollection || undefined,
    featured: featuredAt !== null,
    featuredAt: featuredAt !== null ? toISOString(featuredAt) : undefined,
    featuredAtFormatted:
      featuredAt !== null ? formatDate(featuredAt, timeZone) : undefined,
    featuredAtTime:
      featuredAt !== null ? formatTime(featuredAt, timeZone) : undefined,
    rating: post.rating ?? undefined,
    previewKind: post.previewKind ?? undefined,
    previewProvider: post.previewProvider ?? undefined,
    previewImageUrl: post.previewImageKey
      ? getImageUrl(
          getMediaUrl(
            post.previewImageKey,
            getPublicUrlForProvider(
              ctx.storageDriver ?? "r2",
              ctx.r2PublicUrl,
              ctx.s3PublicUrl,
              ctx.localPublicUrl,
            ),
            ctx.sitePathPrefix,
          ),
          ctx.imageTransformUrl,
          { width: 1280, quality: 80, format: "auto", fit: "scale-down" },
        )
      : undefined,
    publishedAt: toISOString(publishedAt),
    publishedAtFormatted: formatDate(publishedAt, timeZone),
    publishedAtTime: formatTime(publishedAt, timeZone),
    publishedAtRelative: formatRelativeTime(publishedAt, timeZone),
    updatedAt: toISOString(post.updatedAt),
    media,
    collections,
    replyToId: post.replyToId ?? undefined,
    threadRootId: post.replyToId ? post.threadId : undefined,
    isLastInThread: isLastInThread ?? true,
    body: post.body ?? undefined,
  };
}

/**
 * Resolves the unpublished draft sitting at the end of a Thread, if any.
 *
 * Both maps come from the same ordering over the same rows, differing only in
 * whether drafts are eligible — so when they disagree, the draft-inclusive
 * answer is by definition unpublished. No status lookup needed.
 *
 * @param threadId - Thread root ID to look up
 * @param publishedTails - Tails from `getThreadTailIds(ids)`
 * @param draftInclusiveTails - Tails from `getThreadTailIds(ids, { includeDrafts: true })`
 * @returns The trailing draft's Post ID, or undefined when the Thread ends
 *   on a published Post
 * @example
 * ```ts
 * const draftTailId = resolveDraftTailId(post.threadId, tails, draftTails);
 * if (draftTailId) view.draftTailId = draftTailId;
 * ```
 */
export function resolveDraftTailId(
  threadId: string,
  publishedTails: Map<string, string>,
  draftInclusiveTails: Map<string, string>,
): string | undefined {
  const withDrafts = draftInclusiveTails.get(threadId);
  if (!withDrafts) return undefined;
  return withDrafts === publishedTails.get(threadId) ? undefined : withDrafts;
}

/**
 * Batch converts PostWithMedia[] to PostView[].
 *
 * @param posts - Posts with media attachments
 * @param ctx - Media context with URL configuration
 * @returns Render-ready PostView[]
 */
export function toPostViews(
  posts: PostWithMedia[],
  ctx: MediaContext,
  isLastInThreadMap?: Map<string, boolean>,
  aliasMap?: Map<string, string>,
): PostView[] {
  return posts.map((p) =>
    toPostView(
      p,
      ctx,
      undefined,
      isLastInThreadMap?.get(p.id),
      aliasMap?.get(p.id),
    ),
  );
}

/**
 * Converts a bare Post (no media) to a PostView with empty media array.
 */
export function toPostViewFromPost(
  post: Post,
  ctx: MediaContext,
  isLastInThread?: boolean,
  aliasPath?: string,
  threadCollections?: Collection[],
): PostView {
  return toPostView(
    { ...post, mediaAttachments: [] },
    ctx,
    threadCollections,
    isLastInThread,
    aliasPath,
  );
}

/**
 * Batch converts Post[] (no media) to PostView[].
 */
export function toPostViewsFromPosts(
  posts: Post[],
  ctx: MediaContext,
  isLastInThreadMap?: Map<string, boolean>,
  aliasMap?: Map<string, string>,
): PostView[] {
  return posts.map((p) =>
    toPostViewFromPost(
      p,
      ctx,
      isLastInThreadMap?.get(p.id),
      aliasMap?.get(p.id),
    ),
  );
}

// =============================================================================
// Navigation Conversions
// =============================================================================

/**
 * Converts a NavItem to a NavItemView with pre-computed state.
 *
 * @param item - Raw nav item from database
 * @param currentPath - Current URL path for active state
 * @param isAuthenticated - Whether the user is logged in (affects system settings item)
 */
export function toNavItemView(
  item: NavItem,
  currentPath: string,
  isAuthenticated = false,
  sitePathPrefix = "",
  collectionFreshness?: Map<string, number>,
  siteOrigin = "",
): NavItemView {
  let url = item.url;
  let label = item.label;

  if (item.type === "system" && item.systemKey) {
    // All system nav URLs are resolved from the canonical constant,
    // so stale DB values (e.g. old "/c") are always corrected at render time.
    const config = SYSTEM_NAV_KEYS[item.systemKey as SystemNavKey];
    if (config) {
      url = config.url;
    }

    if (item.systemKey === "latest") {
      url = "/";
    }

    if (item.systemKey === "featured") {
      url = "/featured";
    }

    if (item.systemKey === "settings") {
      url = isAuthenticated ? "/settings" : "/signin";
      if (!isAuthenticated) {
        label = "Sign in";
      }
    }
  }

  // A full URL pointing at this site's own origin is really an internal link,
  // so strip it back to a path and skip external-link affordances.
  const sameSitePath = toSameSitePath(url, siteOrigin);
  const isExternal = sameSitePath === null && isFullUrl(url);
  const publicUrl = isExternal
    ? url
    : toPublicPath(sameSitePath ?? url, sitePathPrefix);

  let isActive = false;
  if (!isExternal) {
    if (publicUrl === sitePathPrefix || publicUrl === "/") {
      isActive = currentPath === (sitePathPrefix || "/");
    } else {
      isActive =
        currentPath === publicUrl || currentPath.startsWith(`${publicUrl}/`);
    }
  }

  const freshAt =
    item.type === "collection" && item.collectionId
      ? collectionFreshness?.get(item.collectionId)
      : undefined;
  const isFresh = freshAt !== undefined && freshAt > 0;

  return {
    id: item.id,
    type: item.type as NavItemType,
    systemKey: item.systemKey,
    collectionId: item.collectionId,
    postId: item.postId,
    label,
    url: publicUrl,
    placement: item.placement as NavItemPlacement,
    isActive,
    isExternal,
    isFresh: isFresh || undefined,
    freshAt: isFresh ? freshAt : undefined,
  };
}

/**
 * Batch converts NavItem[] to NavItemView[].
 *
 * @param items - Raw nav items from database
 * @param currentPath - Current URL path for active state
 * @param isAuthenticated - Whether the user is logged in
 */
export function toNavItemViews(
  items: NavItem[],
  currentPath: string,
  isAuthenticated = false,
  sitePathPrefix = "",
  collectionFreshness?: Map<string, number>,
  siteOrigin = "",
): NavItemView[] {
  return items.map((item) =>
    toNavItemView(
      item,
      currentPath,
      isAuthenticated,
      sitePathPrefix,
      collectionFreshness,
      siteOrigin,
    ),
  );
}

// =============================================================================
// Search Result Conversions
// =============================================================================

/**
 * Converts a SearchResult to a SearchResultView with PostView.
 *
 * @param result - Raw search result with post and FTS metadata
 * @param ctx - Media context for URL computation
 * @param query - Original search query for client-side title/quote highlighting
 */
export function toSearchResultView(
  result: SearchResult,
  ctx: MediaContext,
  query?: string,
  aliasPath?: string,
  threadCollections?: Collection[],
): SearchResultView {
  const post = toPostViewFromPost(
    result.post,
    ctx,
    undefined,
    aliasPath,
    threadCollections,
  );

  let titleHighlighted: string | undefined;
  let quoteHighlighted: string | undefined;

  if (query) {
    if (post.title) {
      titleHighlighted = highlightText(post.title, query);
    }
    if (post.quoteText) {
      // Truncate before highlighting to avoid splitting inside <mark> tags
      const truncated =
        post.quoteText.length > 120
          ? post.quoteText.slice(0, 120) + "..."
          : post.quoteText;
      quoteHighlighted = highlightText(truncated, query);
    }
  }

  return {
    post,
    rank: result.rank,
    snippet: result.snippet,
    titleHighlighted,
    quoteHighlighted,
  };
}

/**
 * Batch converts SearchResult[] to SearchResultView[].
 *
 * @param results - Raw search results
 * @param ctx - Media context for URL computation
 * @param query - Original search query for title/quote highlighting
 */
export function toSearchResultViews(
  results: SearchResult[],
  ctx: MediaContext,
  query?: string,
  aliasMap?: Map<string, string>,
  collectionsMap?: Map<string, Collection[]>,
): SearchResultView[] {
  return results.map((r) =>
    toSearchResultView(
      r,
      ctx,
      query,
      aliasMap?.get(r.post.id),
      collectionsMap?.get(r.post.id),
    ),
  );
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
  aliasMap?: Map<string, string>,
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
      posts: toPostViewsFromPosts(posts, ctx, undefined, aliasMap),
    });
  }
  return groups;
}

/**
 * Converts a grouped PostWithMedia map to typed ArchiveGroup[].
 * Unlike toArchiveGroups, this preserves media attachments on each post.
 *
 * @param grouped - Map of "YYYY-MM" keys to PostWithMedia arrays
 * @param ctx - Media context for URL computation
 * @returns ArchiveGroup[] with full media data on each PostView
 */
export function toArchiveGroupsWithMedia(
  grouped: Map<string, PostWithMedia[]>,
  ctx: MediaContext,
  aliasMap?: Map<string, string>,
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
      posts: toPostViews(posts, ctx, undefined, aliasMap),
    });
  }
  return groups;
}
