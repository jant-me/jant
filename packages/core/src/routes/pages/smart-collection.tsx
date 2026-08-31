/**
 * Smart Collection Page Route
 *
 * A smart collection is always public, so this file carries no page guard, no
 * feed guard, and no "can this reader see it" branch. What it does carry is the
 * ordinary per-post visibility floor, identical to a manual collection page:
 * an author signed in may see more threads than an anonymous reader, on the
 * page and in the count alike.
 */

import type { Context } from "hono";
import type { Bindings, SmartCollection } from "../../types.js";
import type { AppVariables } from "../../types/app-context.js";
import { SmartCollectionPage } from "../../ui/pages/SmartCollectionPage.js";
import { getNavigationData } from "../../lib/navigation.js";
import { formatPageLabel, parsePageNumber } from "../../lib/pagination.js";
import { buildPageTitle } from "../../lib/page-title.js";
import { renderPublicPage } from "../../lib/render.js";
import { assembleTimelineItems } from "../../lib/timeline.js";
import { defaultFeedRenderer } from "../../lib/feed.js";
import {
  buildFeedDiscoveryFields,
  getFeedEntryUpdatedAt,
  getRssPublishedBefore,
  RSS_FEED_CACHE_CONTROL,
} from "../../lib/feed-policy.js";
import { toPlainText as markdownToPlainText } from "../../lib/markdown.js";
import { buildMediaMap } from "../../lib/media-helpers.js";
import { createMediaContext, toPostViews } from "../../lib/view.js";
import { toAbsoluteSiteUrl } from "../../lib/url.js";
import {
  buildSurfaceAlternates,
  getViewLang,
  toViewPath,
  viewBasePath,
} from "../../lib/view-language.js";
import { getCollectionPagePath } from "../../lib/collection-paths.js";
import { buildCollectionVocabulary } from "../../lib/filter-dimensions.js";
import {
  buildSmartCollectionArchiveHref,
  describeSmartCollection,
} from "../../ui/shared/smart-collection-labels.js";
import { getI18n } from "../../i18n/index.js";
import { SMART_COLLECTION_SORT_ORDERS } from "../../types.js";
import type { SmartCollectionSortOrder } from "../../types.js";
import { supportsCollectionRatingSort } from "../../lib/collection-sort.js";

type Env = { Bindings: Bindings; Variables: AppVariables };

/**
 * The collection vocabulary, loaded only when a condition names one.
 *
 * The condition line has to name the collection it filters by, and the archive
 * link has to spell its slug — but most smart collections name none, and the
 * lookup is a round trip.
 */
async function loadConditionVocabulary(
  c: Context<Env>,
  smartCollection: SmartCollection,
) {
  const ids = smartCollection.selection.collection ?? [];
  if (ids.length === 0) return buildCollectionVocabulary([]);
  return buildCollectionVocabulary(await c.var.services.collections.list());
}

function readSort(
  value: string | undefined,
  fallback: SmartCollectionSortOrder,
  showRatingSort: boolean,
): SmartCollectionSortOrder {
  // `updated` was a fourth order before `newest` came to mean the same thing.
  // Links to it are still in the wild, and they still resolve to what the
  // reader chose, so the accept-old rule costs one line here.
  const named = value === "updated" ? "newest" : value;
  const requested = (
    SMART_COLLECTION_SORT_ORDERS as readonly string[]
  ).includes(named ?? "")
    ? (named as SmartCollectionSortOrder)
    : fallback;
  // Silently falls back rather than showing an order that would look arbitrary
  // on a set where almost nothing is rated — the same rule a collection page
  // applies to its own rating sort.
  return requested === "rating_desc" && !showRatingSort ? "newest" : requested;
}

/**
 * Render a smart collection page.
 *
 * @param c - Hono context
 * @param slug - The smart collection's address
 * @returns The rendered page, or null when no smart collection lives there
 */
export async function renderSmartCollectionPage(
  c: Context<Env>,
  slug: string,
): Promise<Response | null> {
  const page = parsePageNumber(c.req.query("page"));
  const paginatedPageTitle = formatPageLabel(page);

  const [smartCollection, navData] = await Promise.all([
    c.var.services.smartCollections.getBySlug(slug),
    getNavigationData(c),
  ]);
  if (!smartCollection) return null;

  const canonicalPagePath = getCollectionPagePath(smartCollection.slug);
  const viewer = {
    isAuthenticated: navData.isAuthenticated,
    lang: getViewLang(c) ?? undefined,
  };

  // The rating order is offered only where it would say something. One cheap
  // bounded count answers that, exactly as the collection page does it.
  const ratedCount = await c.var.services.posts.countUpTo(
    {
      ...c.var.services.smartCollections.toPostFilters(smartCollection, viewer),
      hasRating: true,
    },
    2,
  );
  const showRatingSort = supportsCollectionRatingSort(ratedCount);
  const defaultSort = readSort(smartCollection.sort, "newest", showRatingSort);
  // The reader's `?sort=` wins over the stored default, the same way it does on
  // a collection page. Condition params in the URL are ignored: membership is
  // edited in the dialog, not by hand in the address bar.
  const currentSort = readSort(
    c.req.query("sort"),
    defaultSort,
    showRatingSort,
  );

  const pageSize = c.var.appConfig.pageSize;
  const filters = c.var.services.smartCollections.toPostFilters(
    { ...smartCollection, sort: currentSort },
    viewer,
  );

  const [totalThreadCount, posts, collectionVocabulary] = await Promise.all([
    c.var.services.posts.count(filters),
    c.var.services.posts.list({
      ...filters,
      limit: pageSize,
      offset: (page - 1) * pageSize,
    }),
    loadConditionVocabulary(c, smartCollection),
  ]);

  const totalPages = Math.max(1, Math.ceil(totalThreadCount / pageSize));
  const items = await assembleTimelineItems(c, posts);

  const i18n = getI18n(c);
  const dimensionCtx = { collections: collectionVocabulary };
  const feedHref = c.var.appConfig.rssFeedsEnabled
    ? `${canonicalPagePath}/feed`
    : undefined;

  return renderPublicPage(c, {
    title:
      page > 1
        ? buildPageTitle(
            smartCollection.title,
            paginatedPageTitle,
            navData.siteName,
          )
        : buildPageTitle(smartCollection.title, navData.siteName),
    description: smartCollection.description
      ? markdownToPlainText(smartCollection.description)
      : undefined,
    // A page the author declared, so it is always indexable and always has a
    // canonical and an hreflang set — unlike an archive URL a reader assembled.
    alternateLanguages: buildSurfaceAlternates(c),
    pageFeed: feedHref
      ? { href: toViewPath(c, feedHref), title: smartCollection.title }
      : undefined,
    navData,
    content: (
      <SmartCollectionPage
        smartCollection={smartCollection}
        items={items}
        totalThreadCount={totalThreadCount}
        currentPage={page}
        totalPages={totalPages}
        pagePath={canonicalPagePath}
        baseUrl={
          currentSort === defaultSort
            ? toViewPath(c, canonicalPagePath)
            : toViewPath(c, `${canonicalPagePath}?sort=${currentSort}`)
        }
        currentSort={currentSort}
        defaultSort={defaultSort}
        showRatingSort={showRatingSort}
        conditionSummary={describeSmartCollection(
          smartCollection.selection,
          i18n,
          dimensionCtx,
        )}
        conditionHref={buildSmartCollectionArchiveHref(
          smartCollection.selection,
          dimensionCtx,
        )}
        isAuthenticated={navData.isAuthenticated}
        isInNavigation={navData.links.some(
          (item) =>
            item.type === "smart_collection" &&
            item.smartCollectionId === smartCollection.id,
        )}
        sitePathPrefix={navData.sitePathPrefix}
        basePath={navData.basePath}
        feedHref={feedHref}
      />
    ),
  });
}

/**
 * Render a smart collection's Atom feed.
 *
 * No auth guard: a feed is anonymous by construction, and a smart collection
 * can never name a set only its author can see.
 *
 * @param c - Hono context
 * @param slug - The smart collection's address
 * @returns The feed response, or null when no smart collection lives there
 */
export async function renderSmartCollectionFeed(
  c: Context<Env>,
  slug: string,
): Promise<Response | null> {
  const smartCollection = await c.var.services.smartCollections.getBySlug(slug);
  if (!smartCollection) return null;

  const { appConfig, services } = c.var;
  const canonicalFeedPath = `${getCollectionPagePath(
    smartCollection.slug,
  )}/feed`;
  const publishedBefore = getRssPublishedBefore(
    appConfig.rssPublishDelaySeconds,
  );

  const filters = services.smartCollections.toPostFilters(smartCollection, {
    isAuthenticated: false,
    lang: getViewLang(c) ?? undefined,
  });
  const posts = await services.posts.list({
    ...filters,
    // The publication delay never moves: a just-published post is not announced
    // early even when a year condition bounds the same column more tightly.
    publishedBefore:
      filters.publishedBefore === undefined
        ? publishedBefore
        : Math.min(filters.publishedBefore, publishedBefore),
    limit: appConfig.rssFeedLimit,
  });

  const rootIds = posts.filter((p) => p.threadId === p.id).map((p) => p.id);
  const postIds = posts.map((post) => post.id);
  const [threadMap, rawMediaMap, aliasesMap] = await Promise.all([
    services.posts.getPublishedThreads(rootIds, { publishedBefore }),
    services.media.getByPostIds(postIds),
    services.paths.getPostAliases(postIds),
  ]);

  const replyIds: string[] = [];
  for (const [rootId, thread] of threadMap) {
    for (const reply of thread) {
      if (reply.id !== rootId) replyIds.push(reply.id);
    }
  }
  const replyMediaMap =
    replyIds.length > 0
      ? await services.media.getByPostIds(replyIds)
      : new Map<string, never[]>();

  const mediaCtx = createMediaContext(appConfig);
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
    posts.map((post) => ({
      ...post,
      mediaAttachments: mediaMap.get(post.id) ?? [],
    })),
    mediaCtx,
    undefined,
    aliasMap,
  ).map((postView, index) => {
    const post = posts[index] as (typeof posts)[number];
    const thread = threadMap.get(post.id);
    const replies =
      thread && thread.length > 1
        ? toPostViews(
            thread
              .filter((reply) => reply.id !== post.id)
              .map((reply) => ({
                ...reply,
                mediaAttachments: mediaMap.get(reply.id) ?? [],
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

  const feedData = {
    ...buildFeedDiscoveryFields(c),
    siteName: appConfig.siteName,
    siteDescription: markdownToPlainText(appConfig.siteDescription),
    siteUrl: appConfig.siteUrl,
    siteLanguage: getViewLang(c) ?? appConfig.siteLanguage,
    title: buildPageTitle(appConfig.siteName, smartCollection.title),
    selfUrl: toAbsoluteSiteUrl(
      `${viewBasePath(c)}${canonicalFeedPath}`,
      appConfig.siteUrl,
      appConfig.sitePathPrefix,
    ),
    posts: postViews,
  };

  return new Response(defaultFeedRenderer(feedData), {
    headers: {
      "Content-Type": "application/atom+xml; charset=utf-8",
      "Cache-Control": RSS_FEED_CACHE_CONTROL,
    },
  });
}
