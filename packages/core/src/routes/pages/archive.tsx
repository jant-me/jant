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
  Collection,
  FeedData,
  Format,
  MediaKind,
  PostWithMedia,
} from "../../types.js";
import type { AppVariables } from "../../types/app-context.js";
import type {
  ArchiveFilters,
  ArchiveLayout,
  ArchiveSort,
  ArchiveVisibility,
} from "../../types/props.js";
import {
  ARCHIVE_VISIBILITIES,
  FORMATS,
  MEDIA_KINDS,
  PUBLIC_ARCHIVE_VISIBILITIES,
} from "../../types.js";
import { ArchivePage } from "../../ui/pages/ArchivePage.js";
import type { ArchiveFilterDescription } from "../../ui/shared/archive-labels.js";
import {
  describeArchiveFilters,
  getArchiveViewTitle,
  hasActiveArchiveFilter,
} from "../../ui/shared/archive-labels.js";
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
  layout?: ArchiveLayout;
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

  const rawVisibilityParam = q("visibility");
  // "hidden" is the URL spelling of the internal latest_hidden value
  const visibilityParam =
    rawVisibilityParam === "hidden" ? "latest_hidden" : rawVisibilityParam;
  const visibilityAll = visibilityParam === "all";
  const visibility = (ARCHIVE_VISIBILITIES as readonly string[]).includes(
    visibilityParam ?? "",
  )
    ? (visibilityParam as ArchiveVisibility)
    : undefined;

  // `layout` is the current spelling; `view` is the pre-rename one, kept
  // readable indefinitely so old bookmarks and stored custom archive URLs keep
  // working. Custom archive URLs bypass the canonical redirect below, so this
  // parser — not the redirect — is what actually keeps them alive. `layout`
  // wins when a URL somehow carries both.
  const readLayout = (value: string | undefined): ArchiveLayout | undefined =>
    value === "grid" || value === "list" ? value : undefined;
  const layout = readLayout(q("layout")) ?? readLayout(q("view"));

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
    layout,
    sort,
    currentPage,
  };
}

/**
 * Whether an archive query names a result set only a signed-in reader can see.
 *
 * Answered from the query alone, never from what the database happens to hold.
 * A check that fired only when private posts existed would answer "does this
 * site keep anything private?" to whoever asked.
 *
 * @param params - Parsed query params
 * @returns `true` when rendering this query requires an authenticated reader
 * @example
 * archiveQueryRequiresAuth({ visibility: "private", ... }); // true
 * archiveQueryRequiresAuth({ visibility: "latest_hidden", ... }); // false
 */
function archiveQueryRequiresAuth(params: ParsedArchiveParams): boolean {
  if (params.visibility === undefined) return false;
  return !(PUBLIC_ARCHIVE_VISIBILITIES as readonly string[]).includes(
    params.visibility,
  );
}

/**
 * Whether this URL is a selection a reader assembled rather than a page the
 * site publishes.
 *
 * Deliberately not `hasActiveArchiveFilter`, which answers a different
 * question: whether to run the baseline count and render `42 of 1,240`. `sort`
 * does not change that count, so folding it in there would buy a wasted query
 * and the label `1,240 of 1,240`. But `sort` does change which posts land on
 * the first page, and together with `year` it changes the set outright — the
 * year filter follows the sort axis. Two questions, two predicates.
 *
 * A stored query is never reader-assembled: the author declared that path, so
 * it is a page like any other. Same `queryOverrides` seam the auth guard uses.
 *
 * @param params - Parsed query params
 * @param queryOverrides - Stored query from the path registry, when there is one
 * @returns `true` when the URL is one facet of a combinatorial family
 * @example
 * isReaderAssembledArchive({ format: "note", ... }, undefined); // true
 * isReaderAssembledArchive({ format: "note", ... }, stored); // false
 */
function isReaderAssembledArchive(
  params: ParsedArchiveParams,
  queryOverrides: Record<string, string> | undefined,
): boolean {
  if (queryOverrides) return false;
  return (
    params.format !== undefined ||
    params.validYear !== undefined ||
    params.collectionSlug !== undefined ||
    params.mediaKinds !== undefined ||
    params.hasMedia !== undefined ||
    params.hasTitle !== undefined ||
    params.hasReplies !== undefined ||
    params.visibility !== undefined ||
    params.sort === "updated"
  );
}

/**
 * What the `collection` parameter named, including "nothing at all".
 *
 * Three states, spelled out, because the missing one used to be folded into
 * `undefined` — see {@link resolveArchiveCollection}.
 */
type ArchiveCollectionSelection =
  | { kind: "unfiltered" }
  | { kind: "resolved"; collection: Collection }
  | { kind: "missing" };

/**
 * Resolve `?collection=` to a collection, or report that it names none.
 *
 * A slug that resolves to nothing must never fall through as "no collection
 * filter": that renders the whole archive under a name the reader chose, with
 * the heading, the chip bar, and the feed title all pretending the word was
 * never typed. The same rule `visibility=private` follows — a selection that
 * cannot be honored is answered, not erased. `/collections/{slug}` already
 * answers this exact question with a 404, and so does every caller here.
 *
 * @param c - Hono context
 * @param params - Parsed query params
 * @returns The selection, distinguishing "none asked" from "none found"
 * @example
 * await resolveArchiveCollection(c, params); // { kind: "missing" }
 */
async function resolveArchiveCollection(
  c: Context<Env>,
  params: ParsedArchiveParams,
): Promise<ArchiveCollectionSelection> {
  if (!params.collectionSlug) return { kind: "unfiltered" };

  const collection = await c.var.services.collections.getBySlug(
    params.collectionSlug,
  );
  return collection ? { kind: "resolved", collection } : { kind: "missing" };
}

/**
 * Translate the selected visibility into the matching `PostFilters` clause.
 *
 * `featured` is a virtual visibility — a separate flag rather than a stored
 * value — so it maps to a different field than the other three. The page and
 * the feed both need this mapping and must not drift on it.
 *
 * @param params - Parsed query params
 * @returns The visibility clause, or an empty object when nothing is selected
 * @example
 * visibilityFilterClause({ visibility: "featured", ... }); // { featured: true }
 */
function visibilityFilterClause(
  params: ParsedArchiveParams,
): Pick<PostFilters, "featured" | "visibility"> {
  const selected = params.visibilityAll ? undefined : params.visibility;
  if (selected === "featured") return { featured: true };
  if (selected) return { visibility: selected };
  return {};
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

  // The visibility clause is applied as selected, with no auth-dependent
  // degrade: a query naming `private` has already been redirected or 404'd by
  // the time it reaches here (see `archiveQueryRequiresAuth`). Silently
  // dropping the clause instead would render a different set under the same
  // name. `excludePrivate` below stays the unconditional floor regardless.

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
    ...visibilityFilterClause(params),
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
 * archive page feed link). Omits layout and page — those shape the rendered
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
  // Emitted in the `hidden` URL spelling, like every other archive link. A
  // feed that dropped this would hand a subscriber a different set than the
  // page they subscribed from.
  if (params.visibility && !params.visibilityAll) {
    qs.set(
      "visibility",
      params.visibility === "latest_hidden" ? "hidden" : params.visibility,
    );
  }
  if (params.sort === "updated") qs.set("sort", "updated");
  const str = qs.toString();
  return str ? `?${str}` : "";
}

export const archiveRoutes = new Hono<Env>();

/**
 * Build a canonical redirect for the archive page when the URL needs one.
 *
 * Two kinds of rewrite happen here, and they do not deserve the same status:
 *
 * - **Legacy spellings** (`hasMedia`/`hasTitle`/`hasReplies=1/0`,
 *   `visibility=latest_hidden`, `view=`) are unconditional — the old spelling
 *   is gone for everyone, so 308.
 * - **`visibility=private` for a signed-out reader** is not. That URL moved
 *   for *this* reader, *now*, and has to keep working once the author signs
 *   in, so it is a 302. When both apply, the weaker claim wins and everything
 *   is still resolved in a single hop.
 *
 * Only these params are touched; everything else, including unknown params, is
 * preserved. Returns null when the URL is already canonical for this reader.
 * Applies to the /archive page only — feeds and the public API accept legacy
 * spellings silently, and custom archive URLs (path_registry query overrides)
 * never reach this path.
 *
 * @param c - Hono context
 * @returns Redirect target and status code, or null
 */
function archiveParamsRedirect(
  c: Context<Env>,
): { location: string; status: 302 | 308 } | null {
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

  // A signed-out reader cannot select `private`, and the one answer that is
  // never right is to drop the clause and render a different set under the
  // same URL. Strip it here so the address bar and the page agree on what the
  // reader is looking at. The decision reads the param and the session only,
  // so it is identical whether or not this site holds a single private post.
  let authStripped = false;
  if (params.get("visibility") === "private" && !c.var.isAuthenticated) {
    params.delete("visibility");
    authStripped = true;
    changed = true;
  }

  // `view` became `layout` so `view` can name the saved-selection concept.
  // Only a value this page actually renders is carried across; anything else
  // is dropped, which lands the reader on the site default rather than on a
  // URL that keeps a meaningless param alive.
  const legacyLayout = params.get("view");
  if (legacyLayout !== null) {
    if (
      !params.has("layout") &&
      (legacyLayout === "grid" || legacyLayout === "list")
    ) {
      params.set("layout", legacyLayout);
    }
    params.delete("view");
    changed = true;
  }

  if (!changed) return null;
  const qs = params.toString();
  return {
    location: `${url.pathname}${qs ? `?${qs}` : ""}`,
    status: authStripped ? 302 : 308,
  };
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

  // An owner-stored query is the path's own definition, so there is nothing to
  // redirect to the way the /archive route redirects a reader's own params:
  // the path names a set this reader cannot see, and the honest answer is that
  // it does not exist for them. The presence of `queryOverrides` is exactly
  // what separates the two cases, so every future caller passing a stored
  // query inherits this guard.
  if (
    queryOverrides &&
    archiveQueryRequiresAuth(params) &&
    !c.var.isAuthenticated
  ) {
    return c.notFound();
  }

  // --- Resolve collection slug to ID ----------------------------------------

  const selection = await resolveArchiveCollection(c, params);
  if (selection.kind === "missing") return c.notFound();
  const collection =
    selection.kind === "resolved" ? selection.collection : undefined;
  const collectionId = collection?.id;

  const navData = await getNavigationData(c);

  const filters = buildArchivePostFilters(params, {
    isAuthenticated: navData.isAuthenticated,
    collectionId,
    lang: getViewLang(c) ?? undefined,
  });

  // `all` is a chip state, not a filter — describing it would name a dimension
  // the reader has explicitly cleared.
  const effectiveVisibility = params.visibilityAll
    ? undefined
    : params.visibility;

  const archiveFilterDescription: ArchiveFilterDescription = {
    collectionTitle: collection?.title,
    format: params.format,
    year: params.validYear,
    mediaKinds: params.mediaKinds,
    hasMedia: params.hasMedia,
    hasTitle: params.hasTitle,
    hasReplies: params.hasReplies,
    visibility: effectiveVisibility,
  };

  // --- Parallel data fetches ------------------------------------------------
  // List view doesn't need month-based grouping, so skip countByYearMonth.

  // No layout in the URL means the site's configured default, not grid: the
  // archive is the widest of Featured / Latest / All and the other two are
  // timelines, so `list` is the default default.
  const layout: ArchiveLayout = params.layout ?? appConfig.archiveDefaultLayout;
  const isListView = layout === "list";

  // The same view with every selection cleared, so the count can say how much
  // the filter removed. Skipped entirely when nothing is filtered — the two
  // numbers would be equal — which keeps the plain /archive page at its
  // current query count. When it does run it is the cheapest of the three
  // aggregates, since clearing the selections is what drops the collection and
  // media EXISTS subqueries.
  const baselineFilters = hasActiveArchiveFilter(archiveFilterDescription)
    ? buildArchivePostFilters(
        {
          ...params,
          format: undefined,
          validYear: undefined,
          collectionSlug: undefined,
          mediaKinds: undefined,
          hasMedia: undefined,
          hasTitle: undefined,
          hasReplies: undefined,
          visibility: undefined,
        },
        { isAuthenticated: navData.isAuthenticated, lang: filters.lang },
      )
    : undefined;

  const [
    totalCount,
    baselineCount,
    monthlyCounts,
    posts,
    availableYears,
    allCollections,
  ] = await Promise.all([
    services.posts.count(filters),
    baselineFilters
      ? services.posts.count(baselineFilters)
      : Promise.resolve(undefined),
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

  const archiveFilters: ArchiveFilters = {
    ...archiveFilterDescription,
    collectionSlug: params.collectionSlug,
    layout: params.layout,
    sort: params.sort === "updated" ? "updated" : undefined,
  };

  const feedQuery = buildArchiveFeedQuery(params);
  // A feed is unauthenticated by construction, so it cannot serve a selection
  // only the author can see. Offering the link anyway would promise a feed
  // that answers 404.
  const feedHref =
    appConfig.rssFeedsEnabled && !archiveQueryRequiresAuth(params)
      ? `/archive/feed${feedQuery}`
      : undefined;

  const availableCollectionsList = allCollections.map((col) => ({
    slug: col.slug,
    title: col.title,
  }));

  // A facet is one URL out of a family with no ceiling: `media` alone is a
  // comma-joined subset of kinds, multiplied by year x collection x format x
  // title x replies x visibility x sort. None of them is a page the site
  // publishes, and the archive sits in no cache, so every one a crawler walks
  // is a Worker invocation and seven D1 queries. `follow`, not `nofollow`:
  // the posts these URLs link to are the real pages.
  const readerAssembled = isReaderAssembledArchive(params, queryOverrides);
  if (readerAssembled) c.header("X-Robots-Tag", "noindex, follow");

  // Everything left over renders the same posts in the same order as the bare
  // path — `layout` is markup only, `visibility=all` selects nothing, and
  // tracking params select nothing either — so they all consolidate onto it.
  // `page` is the exception and stays: page 2 is different content, not a
  // different rendering of page 1.
  const canonicalQuery =
    params.currentPage > 1 ? `?page=${params.currentPage}` : "";
  const canonicalHref = readerAssembled
    ? undefined
    : `${toAbsoluteSiteUrl(c.req.path, appConfig.siteUrl, appConfig.sitePathPrefix)}${canonicalQuery}`;

  return renderPublicPage(c, {
    // A tab has no filter bar beside it, so unlike the page heading this has to
    // name the selection itself — otherwise every bookmarked filtered view
    // reads identically in the tab bar.
    title: buildPageTitle(
      getArchiveViewTitle(archiveFilterDescription, getI18n(c)),
      params.sort === "updated" ? "Recently updated" : undefined,
      navData.siteName,
    ),
    // An hreflang set is made of canonical URLs, so it mirrors the canonical
    // exactly: the same trimmed query where there is one, and nothing at all
    // on a facet, which has no canonical for the set to be built from.
    alternateLanguages: readerAssembled
      ? undefined
      : buildSurfaceAlternates(c, { query: canonicalQuery }),
    noindex: readerAssembled ? "follow" : undefined,
    canonicalHref,
    // The filters are part of the feed: a reader subscribing from a filtered
    // archive gets that filtered feed, not the whole archive.
    pageFeed: feedHref
      ? {
          href: toViewPath(c, feedHref),
          title: buildArchiveFeedLabel(c, params, collection?.title),
        }
      : undefined,
    navData,
    content: (
      <ArchivePage
        groups={groups}
        items={flatItems}
        defaultLayout={appConfig.archiveDefaultLayout}
        totalCount={totalCount}
        baselineCount={baselineCount}
        currentPage={params.currentPage}
        totalPages={totalPages}
        filters={archiveFilters}
        availableYears={availableYears}
        availableCollections={availableCollectionsList}
        isAuthenticated={navData.isAuthenticated}
        basePath={navData.basePath}
        timeZone={appConfig.timeZone}
        feedHref={feedHref}
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
  const redirect = archiveParamsRedirect(c);
  if (redirect) return c.redirect(redirect.location, redirect.status);
  return renderArchivePage(c);
}

archiveRoutes.get("/", renderArchiveRoute);

// =============================================================================
// Archive feed
// =============================================================================

/**
 * Build a descriptive label for the archive feed from the active filters.
 *
 * Shared by the feed document's own title and the autodiscovery link on the
 * archive page, so a subscriber sees the same name in both places.
 *
 * Unlike the page title this lists every active dimension. A feed name sits in
 * someone's reader for years with no UI to inspect it, so two subscriptions
 * that differ only in a dropped dimension must not arrive under one name.
 *
 * @param c - Hono context
 * @param params - Parsed archive filter params
 * @param collectionTitle - Resolved collection title (if any)
 * @returns Feed label, e.g. "Archive: Untitled, 2024"
 * @example
 * buildArchiveFeedLabel(c, params); // "Archive"
 */
function buildArchiveFeedLabel(
  c: Context<Env>,
  params: ParsedArchiveParams,
  collectionTitle?: string,
): string {
  const i18n = getI18n(c);

  const parts = describeArchiveFilters(
    {
      collectionTitle,
      format: params.format,
      year: params.validYear,
      mediaKinds: params.mediaKinds,
      hasMedia: params.hasMedia,
      hasTitle: params.hasTitle,
      hasReplies: params.hasReplies,
      visibility: params.visibilityAll ? undefined : params.visibility,
    },
    i18n,
  );

  const archiveLabel = i18n._(
    msg({
      message: "Archive",
      comment: "@context: Archive feed title prefix",
    }),
  );

  if (parts.length === 0) {
    return archiveLabel;
  }

  return `${archiveLabel}: ${parts.join(", ")}`;
}

async function buildArchiveFeedData(
  c: Context<Env>,
  selfPath: string,
): Promise<FeedData | null> {
  const { appConfig, services } = c.var;
  const params = parseArchiveParams(c);

  const selection = await resolveArchiveCollection(c, params);
  if (selection.kind === "missing") return null;
  const collection =
    selection.kind === "resolved" ? selection.collection : undefined;
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
    ...visibilityFilterClause(params),
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
    title: buildPageTitle(
      appConfig.siteName,
      buildArchiveFeedLabel(c, params, collection?.title),
    ),
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
  // No session reaches a feed reader, so a selection only the author can see
  // has no honest rendering here — not an empty feed, and certainly not the
  // unfiltered one. The page already withholds the link; this is the backstop.
  if (archiveQueryRequiresAuth(parseArchiveParams(c))) return c.notFound();

  const feedData = await buildArchiveFeedData(c, "/archive/feed");
  // A collection slug that names nothing: the same 404 the page gives, rather
  // than handing a subscriber the entire archive under the collection's name.
  if (!feedData) return c.notFound();

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
