/**
 * Archive Page Route
 *
 * Tumblr-style archive grid with rich filtering:
 * year, collection, format, media types, title presence.
 * Page-based pagination with media-enriched thread-root tiles.
 *
 * Also serves a filtered Atom feed at /archive/feed.
 */

import { msg } from "@lingui/core/macro";
import { Hono } from "hono";
import type { Context } from "hono";
import type {
  Bindings,
  FeedData,
  Format,
  MediaKind,
  PostWithMedia,
} from "../../types.js";
import type { AppVariables } from "../../types/app-context.js";
import type {
  ArchiveFilters,
  ArchiveSort,
  ArchiveView,
  ArchiveVisibility,
} from "../../types/props.js";
import { FORMATS, MEDIA_KINDS } from "../../types.js";
import { ArchivePage } from "../../ui/pages/ArchivePage.js";
import { defaultFeedRenderer } from "../../lib/feed.js";
import {
  getFeedEntryUpdatedAt,
  getRssPublishedBefore,
  RSS_FEED_CACHE_CONTROL,
} from "../../lib/feed-policy.js";
import { getNavigationData } from "../../lib/navigation.js";
import { buildPageTitle } from "../../lib/page-title.js";
import { renderPublicPage } from "../../lib/render.js";
import { formatYearMonth } from "../../lib/time.js";
import { toAbsoluteSiteUrl } from "../../lib/url.js";
import {
  buildSurfaceAlternates,
  getViewLang,
  toViewPath,
  viewBasePath,
} from "../../lib/view-language.js";
import {
  createMediaContext,
  toArchiveGroupsWithMedia,
  toPostViews,
} from "../../lib/view.js";
import { buildMediaMap } from "../../lib/media-helpers.js";
import { assembleTimelineItems } from "../../lib/timeline.js";
import { getI18n } from "../../i18n/index.js";
import type { PostFilters } from "../../services/post.js";
import { toPlainText } from "../../lib/markdown.js";

type Env = { Bindings: Bindings; Variables: AppVariables };

// =============================================================================
// Shared filter parsing
// =============================================================================

/** Parsed archive query parameters (before service-level filter conversion). */
interface ParsedArchiveParams {
  format?: Format;
  validYear?: number;
  collectionSlug?: string;
  mediaKinds?: MediaKind[];
  hasMedia?: boolean;
  hasTitle?: boolean;
  hasReplies?: boolean;
  visibility?: ArchiveVisibility;
  visibilityAll: boolean;
  view?: ArchiveView;
  sort: ArchiveSort;
  currentPage: number;
}

/**
 * Parse archive filter query parameters.
 *
 * @param c - Hono context
 * @param queryOverrides - Optional map of query param overrides (used by custom archive URLs)
 * @returns Parsed and validated query parameters
 */
function parseArchiveParams(
  c: Context<Env>,
  queryOverrides?: Record<string, string>,
): ParsedArchiveParams {
  const q = (key: string): string | undefined =>
    queryOverrides ? queryOverrides[key] : c.req.query(key);

  const formatParam = q("format") as Format | undefined;
  const format =
    formatParam && FORMATS.includes(formatParam) ? formatParam : undefined;

  const yearParam = q("year");
  const year = yearParam ? parseInt(yearParam, 10) : undefined;
  const validYear = year && !isNaN(year) && year > 1970 ? year : undefined;

  const collectionSlug = q("collection") || undefined;

  // Presence filters use single-word params with any/none values
  // (media=any|none|<kinds>, title=any|none, replies=any|none). The legacy
  // hasMedia/hasTitle/hasReplies=1/0 params are still accepted so old
  // bookmarks, feed subscriptions, and stored custom archive URLs keep
  // working; new URLs are always generated in the new style.
  const parsePresence = (
    param: string | undefined,
    legacy: string | undefined,
  ): boolean | undefined => {
    if (param === "any") return true;
    if (param === "none") return false;
    if (legacy === "1") return true;
    if (legacy === "0") return false;
    return undefined;
  };

  const mediaParam = q("media") || undefined;
  const mediaIsPresence = mediaParam === "any" || mediaParam === "none";
  const mediaKinds =
    mediaParam && !mediaIsPresence
      ? (mediaParam
          .split(",")
          .filter((m): m is MediaKind =>
            (MEDIA_KINDS as readonly string[]).includes(m),
          ) as MediaKind[])
      : undefined;
  const hasMedia = parsePresence(
    mediaIsPresence ? mediaParam : undefined,
    q("hasMedia"),
  );

  const hasTitle = parsePresence(q("title"), q("hasTitle"));
  const hasReplies = parsePresence(q("replies"), q("hasReplies"));

  const VALID_VISIBILITIES = ["public", "latest_hidden", "private", "featured"];
  const rawVisibilityParam = q("visibility");
  // "hidden" is the URL spelling of the internal latest_hidden value
  const visibilityParam =
    rawVisibilityParam === "hidden" ? "latest_hidden" : rawVisibilityParam;
  const visibilityAll = visibilityParam === "all";
  const visibility =
    visibilityParam && VALID_VISIBILITIES.includes(visibilityParam)
      ? (visibilityParam as ArchiveVisibility)
      : undefined;

  const viewParam = q("view") as ArchiveView | undefined;
  const view =
    viewParam && (viewParam === "grid" || viewParam === "list")
      ? viewParam
      : undefined;

  // sort selects the time axis for ordering, month grouping, and the year
  // filter alike — they must stay on the same column or the month headers
  // stop agreeing with the order inside them.
  const sort: ArchiveSort = q("sort") === "updated" ? "updated" : "published";

  // Page always comes from the actual request URL (pagination links use ?page=N)
  const pageParam = c.req.query("page");
  const currentPage = Math.max(1, parseInt(pageParam || "1", 10) || 1);

  return {
    format,
    validYear,
    collectionSlug,
    mediaKinds: mediaKinds && mediaKinds.length > 0 ? mediaKinds : undefined,
    hasMedia,
    hasTitle,
    hasReplies,
    visibility,
    visibilityAll,
    view,
    sort,
    currentPage,
  };
}

/**
 * Build PostFilters from parsed archive params.
 *
 * @param params - Parsed query params
 * @param opts - Auth & collection context
 * @returns PostFilters for the post service
 */
function buildArchivePostFilters(
  params: ParsedArchiveParams,
  opts: {
    isAuthenticated: boolean;
    collectionId?: string;
    lang?: string;
  },
): PostFilters {
  const { isAuthenticated, collectionId, lang } = opts;

  // Map visibility: feed routes force public; page respects auth
  // Authenticated users default to showing all visibilities
  const effectiveVisibility = isAuthenticated
    ? params.visibilityAll
      ? undefined
      : (params.visibility ?? undefined)
    : undefined;

  // The year filter follows the active axis, so every month bucket shown
  // under `year=N` really belongs to that year.
  const yearRange = params.validYear
    ? {
        after: Date.UTC(params.validYear, 0, 1) / 1000,
        before: Date.UTC(params.validYear + 1, 0, 1) / 1000,
      }
    : undefined;
  const sortsByActivity = params.sort === "updated";

  return {
    format: params.format,
    lang,
    status: "published",
    excludeReplies: true,
    excludePrivate: !isAuthenticated,
    excludeLatestHidden: false,
    ...(effectiveVisibility === "featured"
      ? { featured: true }
      : effectiveVisibility
        ? { visibility: effectiveVisibility }
        : {}),
    collectionId,
    ...(yearRange
      ? sortsByActivity
        ? { axisAfter: yearRange.after, axisBefore: yearRange.before }
        : { publishedAfter: yearRange.after, publishedBefore: yearRange.before }
      : {}),
    mediaKinds: params.mediaKinds,
    hasMedia: params.hasMedia,
    hasTitle: params.hasTitle,
    hasReplies: params.hasReplies,
    // "thread_updated", not "activity": the archive is the canonical all-posts
    // view, and the quiet-reply switch only promises not to move a Thread on
    // Latest. Here the honest answer is when the Thread last changed.
    sortBy: sortsByActivity ? "thread_updated" : "published",
    ignorePinnedSort: true,
  };
}

/**
 * Build a query string from parsed archive params (for feed self-URL and
 * archive page feed link). Omits view and page — those shape the rendered
 * page, not the result set — but carries `sort`, so the feed button on an
 * updated-sorted page hands back the matching feed.
 */
function buildArchiveFeedQuery(params: ParsedArchiveParams): string {
  const qs = new URLSearchParams();
  if (params.format) qs.set("format", params.format);
  if (params.validYear) qs.set("year", String(params.validYear));
  if (params.collectionSlug) qs.set("collection", params.collectionSlug);
  if (params.mediaKinds && params.mediaKinds.length > 0) {
    qs.set("media", params.mediaKinds.join(","));
  } else if (params.hasMedia !== undefined) {
    qs.set("media", params.hasMedia ? "any" : "none");
  }
  if (params.hasTitle !== undefined) {
    qs.set("title", params.hasTitle ? "any" : "none");
  }
  if (params.hasReplies !== undefined) {
    qs.set("replies", params.hasReplies ? "any" : "none");
  }
  if (params.sort === "updated") qs.set("sort", "updated");
  const str = qs.toString();
  return str ? `?${str}` : "";
}

export const archiveRoutes = new Hono<Env>();

/**
 * Build a canonical redirect target when a request uses legacy archive
 * param spellings (hasMedia/hasTitle/hasReplies=1/0, visibility=latest_hidden).
 *
 * Only legacy params are rewritten; everything else (including unknown
 * params) is preserved. Returns null when the URL is already canonical.
 * Applies to the /archive page only — feeds and the public API accept
 * legacy spellings silently, and custom archive URLs (path_registry
 * query overrides) never reach this path.
 *
 * @param c - Hono context
 * @returns Canonical path + query to redirect to, or null
 */
function legacyArchiveParamsRedirect(c: Context<Env>): string | null {
  const url = new URL(c.req.url);
  const params = url.searchParams;
  let changed = false;

  const rewrites = [
    ["hasMedia", "media"],
    ["hasTitle", "title"],
    ["hasReplies", "replies"],
  ] as const;
  for (const [legacy, name] of rewrites) {
    const value = params.get(legacy);
    if (value === null) continue;
    if (!params.has(name) && (value === "1" || value === "0")) {
      params.set(name, value === "1" ? "any" : "none");
    }
    params.delete(legacy);
    changed = true;
  }

  if (params.get("visibility") === "latest_hidden") {
    params.set("visibility", "hidden");
    changed = true;
  }

  if (!changed) return null;
  const qs = params.toString();
  return `${url.pathname}${qs ? `?${qs}` : ""}`;
}

// =============================================================================
// Archive page — shared rendering
// =============================================================================

/**
 * Render the archive page. Used by both the `/archive` route and custom
 * archive URLs resolved through the path registry.
 *
 * @param c - Hono context
 * @param queryOverrides - Optional pre-set query params (from path_registry.archive_query)
 */
export async function renderArchivePage(
  c: Context<Env>,
  queryOverrides?: Record<string, string>,
): Promise<Response> {
  const { services, appConfig } = c.var;
  const pageSize = appConfig.archivePageSize;
  const params = parseArchiveParams(c, queryOverrides);

  // --- Resolve collection slug to ID ----------------------------------------

  const collection = params.collectionSlug
    ? await services.collections.getBySlug(params.collectionSlug)
    : undefined;
  const collectionId = collection?.id;

  const navData = await getNavigationData(c);

  const filters = buildArchivePostFilters(params, {
    isAuthenticated: navData.isAuthenticated,
    collectionId,
    lang: getViewLang(c) ?? undefined,
  });

  // --- Parallel data fetches ------------------------------------------------
  // List view doesn't need month-based grouping, so skip countByYearMonth.

  const isListView = params.view === "list";

  const [totalCount, monthlyCounts, posts, availableYears, allCollections] =
    await Promise.all([
      services.posts.count(filters),
      isListView
        ? Promise.resolve([] as { yearMonth: string; count: number }[])
        : services.posts.countByYearMonth(filters),
      services.posts.list({
        ...filters,
        limit: pageSize,
        offset: (params.currentPage - 1) * pageSize,
      }),
      services.posts.getDistinctYears({
        status: "published",
        excludeReplies: true,
        lang: filters.lang,
        sortBy: filters.sortBy,
      }),
      services.collections.list(),
    ]);

  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));

  const mediaCtx = createMediaContext(appConfig);
  const allPostIds = posts.map((p) => p.id);
  const archiveAliasesMap =
    await c.var.services.paths.getPostAliases(allPostIds);
  const archiveAliasMap = new Map<string, string>();
  for (const [id, aliases] of archiveAliasesMap) {
    if (aliases[0]) archiveAliasMap.set(id, aliases[0]);
  }

  // --- List view: flat timeline items (no month grouping) ------------------

  let groups: Awaited<ReturnType<typeof toArchiveGroupsWithMedia>> = [];
  let flatItems: Awaited<ReturnType<typeof assembleTimelineItems>> | undefined;

  if (isListView) {
    flatItems = await assembleTimelineItems(c, posts);
  } else {
    // --- Grid view: group posts by year-month --------------------------------

    const grouped = new Map<string, PostWithMedia[]>();
    for (const post of posts) {
      // Bucket on the same axis the query sorted by, so groups stay ordered.
      const groupedAt =
        params.sort === "updated"
          ? post.threadUpdatedAt
          : (post.publishedAt ?? post.updatedAt);
      const key = formatYearMonth(groupedAt, appConfig.timeZone);
      if (!grouped.has(key)) {
        grouped.set(key, []);
      }
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- Map.set() above guarantees key exists
      grouped.get(key)!.push({
        ...post,
        mediaAttachments: [],
      });
    }

    const monthlyCountMap = new Map(
      monthlyCounts.map((row) => [row.yearMonth, row.count] as const),
    );

    const postIds = posts.map((p) => p.id);
    const [rawMediaMap, replyCounts] = await Promise.all([
      services.media.getByPostIds(postIds),
      services.posts.getReplyCounts(postIds),
    ]);
    const mediaMap = buildMediaMap(
      rawMediaMap,
      mediaCtx.r2PublicUrl,
      mediaCtx.imageTransformUrl,
      mediaCtx.s3PublicUrl,
      mediaCtx.localPublicUrl,
      mediaCtx.sitePathPrefix,
    );

    for (const [key, monthPosts] of grouped) {
      grouped.set(
        key,
        monthPosts.map((post) => ({
          ...post,
          mediaAttachments: mediaMap.get(post.id) ?? [],
        })),
      );
    }

    groups = toArchiveGroupsWithMedia(grouped, mediaCtx, archiveAliasMap).map(
      (group) => ({
        ...group,
        posts: group.posts.map((post) => ({
          ...post,
          replyCount: replyCounts.get(post.id) ?? undefined,
        })),
        totalCount:
          monthlyCountMap.get(`${group.year}-${group.month}`) ??
          group.posts.length,
      }),
    );
  }

  // --- Build active filter state for UI -------------------------------------

  const effectiveVisibility = navData.isAuthenticated
    ? params.visibilityAll
      ? undefined
      : (params.visibility ?? undefined)
    : undefined;

  const archiveFilters: ArchiveFilters = {
    year: params.validYear,
    collectionSlug: params.collectionSlug,
    collectionTitle: collection?.title,
    format: params.format,
    mediaKinds: params.mediaKinds,
    hasMedia: params.hasMedia,
    hasTitle: params.hasTitle,
    hasReplies: params.hasReplies,
    visibility: effectiveVisibility,
    view: params.view,
    sort: params.sort === "updated" ? "updated" : undefined,
  };

  const feedQuery = buildArchiveFeedQuery(params);

  const availableCollectionsList = allCollections.map((col) => ({
    slug: col.slug,
    title: col.title,
  }));

  return renderPublicPage(c, {
    // Distinguishes a bookmarked or shared ?sort=updated view in the tab bar.
    title: buildPageTitle(
      "Archive",
      params.sort === "updated" ? "Recently updated" : undefined,
      navData.siteName,
    ),
    alternateLanguages: buildSurfaceAlternates(c),
    navData,
    content: (
      <ArchivePage
        groups={groups}
        items={flatItems}
        totalCount={totalCount}
        currentPage={params.currentPage}
        totalPages={totalPages}
        filters={archiveFilters}
        availableYears={availableYears}
        availableCollections={availableCollectionsList}
        isAuthenticated={navData.isAuthenticated}
        basePath={navData.basePath}
        timeZone={appConfig.timeZone}
        feedHref={
          appConfig.rssFeedsEnabled ? `/archive/feed${feedQuery}` : undefined
        }
      />
    ),
  });
}

// =============================================================================
// Archive page route
// =============================================================================

/**
 * Serve the archive page, first normalizing any legacy query parameters.
 *
 * @param c - Hono context
 * @returns Archive page response, or a 308 to the canonical parameter spelling
 */
export function renderArchiveRoute(
  c: Context<Env>,
): Promise<Response> | Response {
  const canonical = legacyArchiveParamsRedirect(c);
  if (canonical) return c.redirect(canonical, 308);
  return renderArchivePage(c);
}

archiveRoutes.get("/", renderArchiveRoute);

// =============================================================================
// Archive feed
// =============================================================================

/**
 * Build a descriptive feed title from active filters.
 *
 * @param c - Hono context
 * @param params - Parsed archive filter params
 * @param collectionTitle - Resolved collection title (if any)
 * @returns Feed title string, e.g. "Site - Archive: Notes without title"
 */
function buildArchiveFeedTitle(
  c: Context<Env>,
  params: ParsedArchiveParams,
  collectionTitle?: string,
): string {
  const i18n = getI18n(c);
  const siteName = c.var.appConfig.siteName;

  const parts: string[] = [];

  if (params.format) {
    const formatLabels: Record<string, string> = {
      note: i18n._(
        msg({
          message: "Notes",
          comment:
            "@context: Archive feed title segment for note format filter",
        }),
      ),
      link: i18n._(
        msg({
          message: "Links",
          comment:
            "@context: Archive feed title segment for link format filter",
        }),
      ),
      quote: i18n._(
        msg({
          message: "Quotes",
          comment:
            "@context: Archive feed title segment for quote format filter",
        }),
      ),
    };
    parts.push(formatLabels[params.format] ?? params.format);
  }

  if (collectionTitle) {
    parts.push(collectionTitle);
  }

  if (params.hasTitle === false) {
    parts.push(
      i18n._(
        msg({
          message: "without title",
          comment: "@context: Archive feed title segment for hasTitle=0 filter",
        }),
      ),
    );
  } else if (params.hasTitle === true) {
    parts.push(
      i18n._(
        msg({
          message: "with title",
          comment: "@context: Archive feed title segment for hasTitle=1 filter",
        }),
      ),
    );
  }

  if (params.hasMedia === true) {
    parts.push(
      i18n._(
        msg({
          message: "with media",
          comment: "@context: Archive feed title segment for hasMedia=1 filter",
        }),
      ),
    );
  } else if (params.hasMedia === false) {
    parts.push(
      i18n._(
        msg({
          message: "without media",
          comment: "@context: Archive feed title segment for hasMedia=0 filter",
        }),
      ),
    );
  }

  if (params.hasReplies === true) {
    parts.push(
      i18n._(
        msg({
          message: "threads",
          comment:
            "@context: Archive feed title segment for hasReplies=1 filter",
        }),
      ),
    );
  } else if (params.hasReplies === false) {
    parts.push(
      i18n._(
        msg({
          message: "single posts",
          comment:
            "@context: Archive feed title segment for hasReplies=0 filter",
        }),
      ),
    );
  }

  if (params.validYear) {
    parts.push(String(params.validYear));
  }

  const archiveLabel = i18n._(
    msg({
      message: "Archive",
      comment: "@context: Archive feed title prefix",
    }),
  );

  if (parts.length === 0) {
    return `${siteName} - ${archiveLabel}`;
  }

  return `${siteName} - ${archiveLabel}: ${parts.join(", ")}`;
}

async function buildArchiveFeedData(
  c: Context<Env>,
  selfPath: string,
): Promise<FeedData> {
  const { appConfig, services } = c.var;
  const params = parseArchiveParams(c);

  const collection = params.collectionSlug
    ? await services.collections.getBySlug(params.collectionSlug)
    : undefined;
  const rssPublishedBefore = getRssPublishedBefore(
    appConfig.rssPublishDelaySeconds,
  );
  const yearPublishedBefore = params.validYear
    ? Date.UTC(params.validYear + 1, 0, 1) / 1000
    : undefined;

  // Feed mirrors the unauthenticated archive page: published + non-private,
  // including Hidden-from-Latest. /archive is the canonical "all posts" view,
  // so its feed must match.
  //
  // Ordered by publication by default, like the page it belongs to. Ordering
  // by activity would make the feed's contents shift under a fixed
  // `rssFeedLimit` — a new reply pulls an old Thread back into the window and
  // pushes something else out — and it buys nothing in return, because readers
  // key entries by id and will not re-surface one that merely moved.
  // /latest/feed is the activity feed; this one is the chronological record.
  //
  // `?sort=updated` opts into the same axis the page uses, for a subscriber
  // who wants that trade-off deliberately.
  const sortsByActivity = params.sort === "updated";
  const filters: PostFilters = {
    format: params.format,
    lang: getViewLang(c) ?? undefined,
    status: "published",
    excludeReplies: true,
    excludePrivate: true,
    excludeLatestHidden: false,
    collectionId: collection?.id,
    mediaKinds: params.mediaKinds,
    hasMedia: params.hasMedia,
    hasTitle: params.hasTitle,
    hasReplies: params.hasReplies,
    sortBy: sortsByActivity ? "thread_updated" : "published",
    ignorePinnedSort: true,
    // The year filter follows the active axis; the RSS delay always stays on
    // publication, so a just-published post is never announced early.
    ...(params.validYear
      ? sortsByActivity
        ? {
            axisAfter: Date.UTC(params.validYear, 0, 1) / 1000,
            axisBefore: yearPublishedBefore,
          }
        : { publishedAfter: Date.UTC(params.validYear, 0, 1) / 1000 }
      : {}),
    publishedBefore:
      yearPublishedBefore === undefined || sortsByActivity
        ? rssPublishedBefore
        : Math.min(yearPublishedBefore, rssPublishedBefore),
    limit: appConfig.rssFeedLimit,
  };

  const posts = await services.posts.list(filters);

  // Collect thread root IDs to batch-load replies
  const rootIds = posts.filter((p) => p.threadId === p.id).map((p) => p.id);

  // Batch load media, aliases, and thread replies
  const postIds = posts.map((p) => p.id);
  const [threadMap, rawMediaMap, aliasesMap] = await Promise.all([
    services.posts.getPublishedThreads(rootIds, {
      publishedBefore: rssPublishedBefore,
    }),
    services.media.getByPostIds(postIds),
    services.paths.getPostAliases(postIds),
  ]);

  // Collect reply IDs for media loading
  const replyIds: string[] = [];
  for (const [rootId, thread] of threadMap) {
    for (const reply of thread) {
      if (reply.id !== rootId) {
        replyIds.push(reply.id);
      }
    }
  }

  const replyMediaMap =
    replyIds.length > 0
      ? await services.media.getByPostIds(replyIds)
      : new Map<
          string,
          typeof rawMediaMap extends Map<string, infer V> ? V : never
        >();

  const mediaCtx = createMediaContext(appConfig);

  // Merge all media
  const allRawMedia = new Map(rawMediaMap);
  for (const [id, media] of replyMediaMap) {
    allRawMedia.set(id, media);
  }

  const mediaMap = buildMediaMap(
    allRawMedia,
    mediaCtx.r2PublicUrl,
    mediaCtx.imageTransformUrl,
    mediaCtx.s3PublicUrl,
    mediaCtx.localPublicUrl,
    mediaCtx.sitePathPrefix,
  );
  const aliasMap = new Map<string, string>();
  for (const [id, aliases] of aliasesMap) {
    if (aliases[0]) aliasMap.set(id, aliases[0]);
  }

  const postViews = toPostViews(
    posts.map((p) => ({
      ...p,
      mediaAttachments: mediaMap.get(p.id) ?? [],
    })),
    mediaCtx,
    undefined,
    aliasMap,
  ).map((postView, index) => {
    const post = posts[index] as (typeof posts)[number];
    const thread = threadMap.get(post.id);

    // Build thread replies
    const replies =
      thread && thread.length > 1
        ? toPostViews(
            thread
              .filter((r) => r.id !== post.id)
              .map((r) => ({
                ...r,
                mediaAttachments: mediaMap.get(r.id) ?? [],
              })),
            mediaCtx,
          )
        : undefined;

    return {
      ...postView,
      feedUpdatedAt: getFeedEntryUpdatedAt(post, thread),
      threadReplies: replies,
    };
  });

  const feedQuery = buildArchiveFeedQuery(params);

  return {
    siteName: appConfig.siteName,
    siteDescription: toPlainText(appConfig.siteDescription),
    siteUrl: appConfig.siteUrl,
    siteLanguage: getViewLang(c) ?? appConfig.siteLanguage,
    title: buildArchiveFeedTitle(c, params, collection?.title),
    selfUrl: toAbsoluteSiteUrl(
      `${viewBasePath(c)}${selfPath}${feedQuery}`,
      appConfig.siteUrl,
      appConfig.sitePathPrefix,
    ),
    posts: postViews,
  };
}

/**
 * Render the archive Atom feed for the current view language.
 *
 * @param c - Hono context
 * @returns Atom feed response
 */
export async function renderArchiveFeed(c: Context<Env>): Promise<Response> {
  const feedData = await buildArchiveFeedData(c, "/archive/feed");
  return new Response(defaultFeedRenderer(feedData), {
    headers: {
      "Content-Type": "application/atom+xml; charset=utf-8",
      "Cache-Control": RSS_FEED_CACHE_CONTROL,
    },
  });
}

// Atom — /archive/feed
archiveRoutes.get("/feed", renderArchiveFeed);

// Legacy atom.xml redirect
export function redirectLegacyArchiveFeed(c: Context<Env>): Response {
  const qs = c.req.url.includes("?")
    ? c.req.url.slice(c.req.url.indexOf("?"))
    : "";
  return c.redirect(`${toViewPath(c, "/archive/feed")}${qs}`, 308);
}

archiveRoutes.get("/feed/atom.xml", redirectLegacyArchiveFeed);
