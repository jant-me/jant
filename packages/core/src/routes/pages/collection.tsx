/**
 * Collection Page Route
 */

import { Hono, type Context } from "hono";
import { buildFeedPostViews } from "../feed/feed.js";
import type { Bindings } from "../../types.js";
import type { AppVariables } from "../../types/app-context.js";
import { CollectionPage } from "../../ui/pages/CollectionPage.js";
import type { CollectionPageProps } from "../../types.js";
import { getNavigationData } from "../../lib/navigation.js";
import { formatPageLabel, parsePageNumber } from "../../lib/pagination.js";
import { buildPageTitle } from "../../lib/page-title.js";
import { renderPublicPage } from "../../lib/render.js";
import {
  collectionSortParam,
  parseCollectionSortParam,
  resolveCollectionSortOrder,
  supportsCollectionRatingSort,
} from "../../lib/collection-sort.js";
import { assembleCollectionTimeline } from "../../lib/timeline.js";
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
  buildLanguageSwitcher,
  buildSurfaceAlternates,
  getViewLang,
  toViewPath,
  viewBasePath,
} from "../../lib/view-language.js";
import { getOrBuildEntry } from "../../i18n/supported-locales.js";
import {
  getCollectionPagePath,
  getCollectionSelectionFeedPath,
  getCollectionSelectionPath,
  isAggregateCollectionSelection,
} from "../../lib/collection-paths.js";
import type { I18n } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { getI18n } from "../../i18n/index.js";

type Env = { Bindings: Bindings; Variables: AppVariables };

export const collectionRoutes = new Hono<Env>();

function buildCollectionSelectionTitle(
  collections: { title: string }[],
  i18n: I18n,
): string {
  if (collections.length > 1) {
    return i18n._(
      msg({
        message: "Combined Collections",
        comment:
          "@context: Page title when viewing multiple collections together",
      }),
    );
  }
  return collections.map((collection) => collection.title).join(" + ");
}

/**
 * Render a collection selection page. Used by root-level single-collection
 * paths, collection aliases resolved through the path registry, and aggregate
 * routes under `/collections/{slug1}+{slug2}`.
 *
 * @param c - Hono context
 * @param slugExpression - Collection slug (or `a+b` aggregate expression)
 * @param pagePathOverride - When set, used as the public page path instead of the derived canonical path
 */
export async function renderCollectionPage(
  c: Context<Env>,
  slugExpression: string,
  pagePathOverride?: string,
): Promise<Response | null> {
  const page = parsePageNumber(c.req.query("page"));
  const paginatedPageTitle = formatPageLabel(page);

  const [selection, navData] = await Promise.all([
    c.var.services.collections.resolveSelection(slugExpression),
    getNavigationData(c),
  ]);
  if (!selection) return null;

  const canonicalPagePath =
    pagePathOverride ?? getCollectionSelectionPath(selection.slugExpression);

  // Only redirect for slug normalization when using the derived canonical path
  if (!pagePathOverride && slugExpression !== selection.slugExpression) {
    const search = new URL(c.req.url).search;
    return c.redirect(`${toViewPath(c, canonicalPagePath)}${search}`, 301);
  }

  const requestedSort = parseCollectionSortParam(c.req.query("sort"));
  const primaryCollection = selection.collections[0];
  if (!primaryCollection) return null;
  const collectionIds = selection.collections.map(
    (collection) => collection.id,
  );
  const isAggregate = selection.collections.length > 1;

  const ratedThreadCount =
    await c.var.services.posts.countCollectionThreadRootsUpToForCollections(
      collectionIds,
      {
        status: "published",
        excludePrivate: !navData.isAuthenticated,
        hasRating: true,
      },
      2,
    );
  const showRatingSort = supportsCollectionRatingSort(ratedThreadCount);
  const requestedDefaultSort = isAggregate
    ? "newest"
    : primaryCollection.sortOrder;
  const defaultSort = resolveCollectionSortOrder(
    undefined,
    requestedDefaultSort,
    showRatingSort,
  );
  const currentSort = resolveCollectionSortOrder(
    requestedSort,
    defaultSort,
    showRatingSort,
  );

  const {
    items,
    totalCount: totalThreadCount,
    totalPages,
  } = await assembleCollectionTimeline(c, {
    collectionIds,
    page,
    isAuthenticated: navData.isAuthenticated,
    sortOrder: currentSort,
  });
  const i18n = getI18n(c);
  const selectionTitle = buildCollectionSelectionTitle(
    selection.collections,
    i18n,
  );

  // An empty page in one language is only a dead end if the reader cannot see
  // that the collection has something in another. The extra count runs only
  // when this view came up empty.
  const viewLang = getViewLang(c);
  let emptyInLanguage: CollectionPageProps["emptyInLanguage"];
  if (totalThreadCount === 0 && viewLang) {
    const acrossLanguages =
      await c.var.services.posts.countCollectionThreadRootsForCollections(
        collectionIds,
        { status: "published", excludePrivate: !navData.isAuthenticated },
      );
    if (acrossLanguages > 0) {
      const alternatives = buildLanguageSwitcher(c, {
        fallbackPath: canonicalPagePath,
      }).filter((option) => !option.isCurrent);
      if (alternatives.length > 0) {
        emptyInLanguage = {
          languageLabel: getOrBuildEntry(viewLang).native,
          alternatives,
        };
      }
    }
  }

  const feedHref = c.var.appConfig.rssFeedsEnabled
    ? `${canonicalPagePath}/feed`
    : undefined;

  return renderPublicPage(c, {
    page: "collection",
    title:
      page > 1
        ? buildPageTitle(selectionTitle, paginatedPageTitle, navData.siteName)
        : buildPageTitle(selectionTitle, navData.siteName),
    description: isAggregate
      ? undefined
      : primaryCollection.description
        ? markdownToPlainText(primaryCollection.description)
        : undefined,
    alternateLanguages: buildSurfaceAlternates(c),
    pageFeed: feedHref
      ? { href: toViewPath(c, feedHref), title: selectionTitle }
      : undefined,
    navData,
    composeCollectionId: !isAggregate ? primaryCollection.id : undefined,
    content: (
      <CollectionPage
        collections={selection.collections}
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
        isAuthenticated={navData.isAuthenticated}
        isInNavigation={navData.links.some(
          (item) =>
            item.type === "collection" &&
            item.collectionId === primaryCollection.id,
        )}
        sitePathPrefix={navData.sitePathPrefix}
        basePath={navData.basePath}
        emptyInLanguage={emptyInLanguage}
        feedHref={feedHref}
      />
    ),
  });
}

export async function renderCollectionFeed(
  c: Context<Env>,
  slugExpression: string,
  feedPathOverride?: string,
): Promise<Response | null> {
  // Null, which every caller answers with 404, as it does a selection that
  // names nothing.
  if (!feedsPublished(c)) return null;
  const selection =
    await c.var.services.collections.resolveSelection(slugExpression);
  if (!selection) return null;

  const canonicalFeedPath =
    feedPathOverride ??
    getCollectionSelectionFeedPath(selection.slugExpression);

  if (!feedPathOverride && slugExpression !== selection.slugExpression) {
    const search = new URL(c.req.url).search;
    return c.redirect(`${toViewPath(c, canonicalFeedPath)}${search}`, 301);
  }

  const { appConfig } = c.var;
  const siteName = appConfig.siteName;
  const siteUrl = appConfig.siteUrl;
  // A language view's feed is that language's feed, so it declares it.
  const siteLanguage = getViewLang(c) ?? appConfig.siteLanguage;
  const feedLimit = getFeedLimit(c);
  const publishedBefore = getRssPublishedBefore(
    appConfig.rssPublishDelaySeconds,
  );
  const primaryCollection = selection.collections[0];
  if (!primaryCollection) return null;

  const entries =
    await c.var.services.posts.listCollectionFeedEntriesForCollections(
      selection.collections.map((collection) => collection.id),
      {
        status: "published",
        excludePrivate: true,
        lang: getViewLang(c) ?? undefined,
        ignoreCollectionPinnedSort: true,
        publishedBefore,
        limit: feedLimit,
      },
    );
  const posts = entries.map((entry) => entry.post);

  const postViews = await buildFeedPostViews(c, posts, {
    publishedBefore,
    // A post a collection took in recently changed as far as its feed goes.
    alsoUpdatedAt: (index) => [entries[index]?.collectedAt],
  });
  const i18n = getI18n(c);
  const selectionTitle = buildCollectionSelectionTitle(
    selection.collections,
    i18n,
  );

  const xml = defaultFeedRenderer({
    ...buildFeedDiscoveryFields(c),
    siteName,
    // Site name first, like every other feed: a reader's sidebar sorts by
    // feed title, so leading with the collection would scatter one site's
    // feeds across the alphabet.
    title: buildPageTitle(siteName, selectionTitle),
    siteDescription:
      selection.collections.length === 1 && primaryCollection.description
        ? markdownToPlainText(primaryCollection.description)
        : "",
    siteUrl,
    selfUrl: toAbsoluteSiteUrl(
      `${viewBasePath(c)}${canonicalFeedPath}`,
      siteUrl,
      appConfig.sitePathPrefix,
    ),
    siteLanguage,
    posts: postViews,
  });

  return renderFeed(xml);
}

/**
 * Serve `/collections/{expression}` — the aggregate selection page.
 *
 * A single slug does not live here; it shares the root namespace with posts,
 * so it is redirected to its canonical root-level address.
 *
 * @param c - Hono context
 * @returns Collection page, a redirect, or 404
 */
export async function renderCollectionSelectionRoute(
  c: Context<Env>,
): Promise<Response> {
  const slugExpression = c.req.param("slug");
  if (!slugExpression) return c.notFound();

  if (!isAggregateCollectionSelection(slugExpression)) {
    const collection =
      await c.var.services.collections.getBySlug(slugExpression);
    if (!collection) return c.notFound();

    const search = new URL(c.req.url).search;
    return c.redirect(
      `${toViewPath(c, getCollectionPagePath(collection.slug))}${search}`,
      301,
    );
  }

  const result = await renderCollectionPage(c, slugExpression);
  return result ?? c.notFound();
}

/**
 * Serve `/collections/{expression}/feed` — the aggregate selection's feed.
 *
 * @param c - Hono context
 * @returns Atom feed, a redirect, or 404
 */
export async function renderCollectionSelectionFeedRoute(
  c: Context<Env>,
): Promise<Response> {
  if (!feedsPublished(c)) return c.notFound();
  const slugExpression = c.req.param("slug");
  if (!slugExpression) return c.notFound();

  if (!isAggregateCollectionSelection(slugExpression)) {
    const collection =
      await c.var.services.collections.getBySlug(slugExpression);
    if (!collection) return c.notFound();

    const search = new URL(c.req.url).search;
    return c.redirect(
      `${toViewPath(c, getCollectionSelectionFeedPath(collection.slug))}${search}`,
      301,
    );
  }

  const result = await renderCollectionFeed(c, slugExpression);
  return result ?? c.notFound();
}

collectionRoutes.get("/:slug", renderCollectionSelectionRoute);
collectionRoutes.get("/:slug/feed", renderCollectionSelectionFeedRoute);
