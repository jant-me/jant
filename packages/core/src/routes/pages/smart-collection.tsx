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
import { buildFeedPostViews } from "../feed/feed.js";
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
  getFeedLimit,
  getRssPublishedBefore,
  feedsPublished,
  renderFeed,
} from "../../lib/feed-policy.js";
import { toPlainText as markdownToPlainText } from "../../lib/markdown.js";

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
import {
  collectionSortParam,
  parseCollectionSortParam,
  resolveCollectionSortOrder,
  supportsCollectionRatingSort,
} from "../../lib/collection-sort.js";

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
  // A rating order falls back rather than showing an order that would look
  // arbitrary on a set where almost nothing is rated, as on a collection page.
  const defaultSort = resolveCollectionSortOrder(
    undefined,
    smartCollection.sort,
    showRatingSort,
  );
  // The reader's `?sort=` wins over the stored default, the same way it does on
  // a collection page. Condition params in the URL are ignored: membership is
  // edited in the dialog, not by hand in the address bar.
  const currentSort = resolveCollectionSortOrder(
    parseCollectionSortParam(c.req.query("sort")),
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
    page: "collection",
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
            : toViewPath(
                c,
                `${canonicalPagePath}?sort=${collectionSortParam(currentSort)}`,
              )
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
  // Null, which the caller answers with 404.
  if (!feedsPublished(c)) return null;
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
    limit: getFeedLimit(c),
  });

  const postViews = await buildFeedPostViews(c, posts, { publishedBefore });

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

  return renderFeed(defaultFeedRenderer(feedData));
}
