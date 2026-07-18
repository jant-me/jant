/**
 * Collection Page Route
 */

import { Hono, type Context } from "hono";
import type { Bindings } from "../../types.js";
import type { AppVariables } from "../../types/app-context.js";
import { requireAuth } from "../../middleware/auth.js";
import { CollectionPage } from "../../ui/pages/CollectionPage.js";
import { CollectionEditorPage } from "../../ui/pages/CollectionEditorPage.js";
import { getNavigationData } from "../../lib/navigation.js";
import { formatPageLabel, parsePageNumber } from "../../lib/pagination.js";
import { buildPageTitle } from "../../lib/page-title.js";
import { renderPublicPage } from "../../lib/render.js";
import { CollectionSortOrderSchema } from "../../lib/schemas.js";
import {
  resolveCollectionSortOrder,
  supportsCollectionRatingSort,
} from "../../lib/collection-sort.js";
import { assembleCollectionTimeline } from "../../lib/timeline.js";
import { defaultFeedRenderer } from "../../lib/feed.js";
import { toPlainText as markdownToPlainText } from "../../lib/markdown.js";
import { buildMediaMap } from "../../lib/media-helpers.js";
import { toISOString } from "../../lib/time.js";
import { createMediaContext, toPostViews } from "../../lib/view.js";
import { toAbsoluteSiteUrl, toPublicPath } from "../../lib/url.js";
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

function resolveReturnHref(
  value: string | undefined,
  fallback: string,
): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return fallback;
  }

  return value;
}

collectionRoutes.use("/:slug/edit", requireAuth());

collectionRoutes.get("/:slug/edit", async (c) => {
  const slug = c.req.param("slug");
  if (isAggregateCollectionSelection(slug)) return c.notFound();

  const [collection, navData] = await Promise.all([
    c.var.services.collections.getBySlug(slug),
    getNavigationData(c),
  ]);
  if (!collection) return c.notFound();

  const defaultReturnHref = toPublicPath(
    getCollectionPagePath(collection.slug),
    navData.sitePathPrefix,
  );
  const cancelHref = resolveReturnHref(
    c.req.query("returnTo"),
    defaultReturnHref,
  );

  return renderPublicPage(c, {
    title: buildPageTitle("Edit", collection.title, navData.siteName),
    navData,
    content: (
      <CollectionEditorPage
        mode="edit"
        collection={collection}
        cancelHref={cancelHref}
        sitePathPrefix={navData.sitePathPrefix}
      />
    ),
  });
});

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
    return c.redirect(
      toPublicPath(`${canonicalPagePath}${search}`, navData.sitePathPrefix),
      301,
    );
  }

  const sortQuery = c.req.query("sort");
  const requestedSort =
    sortQuery && CollectionSortOrderSchema.safeParse(sortQuery).success
      ? CollectionSortOrderSchema.parse(sortQuery)
      : undefined;
  const primaryCollection = selection.collections[0];
  if (!primaryCollection) return null;
  const collectionIds = selection.collections.map(
    (collection) => collection.id,
  );
  const isAggregate = selection.collections.length > 1;

  const ratedThreadCount =
    await c.var.services.posts.countCollectionThreadRootsForCollections(
      collectionIds,
      {
        status: "published",
        excludePrivate: !navData.isAuthenticated,
        hasRating: true,
      },
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

  return renderPublicPage(c, {
    title:
      page > 1
        ? buildPageTitle(selectionTitle, paginatedPageTitle, navData.siteName)
        : buildPageTitle(selectionTitle, navData.siteName),
    description: isAggregate
      ? undefined
      : primaryCollection.description
        ? markdownToPlainText(primaryCollection.description)
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
            ? toPublicPath(canonicalPagePath, navData.sitePathPrefix)
            : toPublicPath(
                `${canonicalPagePath}?sort=${currentSort}`,
                navData.sitePathPrefix,
              )
        }
        currentSort={currentSort}
        defaultSort={defaultSort}
        showRatingSort={showRatingSort}
        isAuthenticated={navData.isAuthenticated}
        sitePathPrefix={navData.sitePathPrefix}
      />
    ),
  });
}

export async function renderCollectionFeed(
  c: Context<Env>,
  slugExpression: string,
  feedPathOverride?: string,
): Promise<Response | null> {
  const selection =
    await c.var.services.collections.resolveSelection(slugExpression);
  if (!selection) return null;

  const canonicalFeedPath =
    feedPathOverride ??
    getCollectionSelectionFeedPath(selection.slugExpression);

  if (!feedPathOverride && slugExpression !== selection.slugExpression) {
    const search = new URL(c.req.url).search;
    return c.redirect(
      toPublicPath(
        `${canonicalFeedPath}${search}`,
        c.var.appConfig.sitePathPrefix,
      ),
      301,
    );
  }

  const { appConfig } = c.var;
  const siteName = appConfig.siteName;
  const siteUrl = appConfig.siteUrl;
  const siteLanguage = appConfig.siteLanguage;
  const feedLimit = appConfig.rssFeedLimit;
  const primaryCollection = selection.collections[0];
  if (!primaryCollection) return null;

  const entries =
    await c.var.services.posts.listCollectionFeedEntriesForCollections(
      selection.collections.map((collection) => collection.id),
      {
        status: "published",
        excludePrivate: true,
        ignoreCollectionPinnedSort: true,
        limit: feedLimit,
      },
    );
  const posts = entries.map((entry) => entry.post);

  // Collect thread root IDs to batch-load replies
  const rootIds = posts.filter((p) => p.threadId === p.id).map((p) => p.id);

  const postIds = posts.map((post) => post.id);
  const [threadMap, rawMediaMap, aliasesMap] = await Promise.all([
    c.var.services.posts.getPublishedThreads(rootIds),
    c.var.services.media.getByPostIds(postIds),
    c.var.services.paths.getPostAliases(postIds),
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
      ? await c.var.services.media.getByPostIds(replyIds)
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
    posts.map((post) => ({
      ...post,
      mediaAttachments: mediaMap.get(post.id) ?? [],
    })),
    mediaCtx,
    undefined,
    aliasMap,
  ).map((postView, index) => {
    const post = posts[index] as (typeof posts)[number];
    const collectedAt = entries[index]?.collectedAt;

    // Build thread replies
    const thread = threadMap.get(post.id);
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

    // feedUpdatedAt = max(lastActivityAt, collectedAt)
    const lastActivity = toISOString(post.lastActivityAt);
    const collectedIso = collectedAt ? toISOString(collectedAt) : null;
    const feedUpdatedAt =
      collectedIso && collectedIso > lastActivity ? collectedIso : lastActivity;

    return {
      ...postView,
      feedUpdatedAt,
      threadReplies: replies,
    };
  });
  const i18n = getI18n(c);
  const selectionTitle = buildCollectionSelectionTitle(
    selection.collections,
    i18n,
  );

  const xml = defaultFeedRenderer({
    siteName: buildPageTitle(selectionTitle, siteName),
    siteDescription:
      selection.collections.length === 1 && primaryCollection.description
        ? markdownToPlainText(primaryCollection.description)
        : "",
    siteUrl,
    selfUrl: toAbsoluteSiteUrl(
      canonicalFeedPath,
      siteUrl,
      appConfig.sitePathPrefix,
    ),
    siteLanguage,
    posts: postViews,
  });

  return new Response(xml, {
    headers: {
      "Content-Type": "application/atom+xml; charset=utf-8",
      "Cache-Control": "public, max-age=180",
    },
  });
}

collectionRoutes.get("/:slug", async (c) => {
  const slugExpression = c.req.param("slug");
  const sitePathPrefix = c.var.appConfig.sitePathPrefix;

  if (!isAggregateCollectionSelection(slugExpression)) {
    const collection =
      await c.var.services.collections.getBySlug(slugExpression);
    if (!collection) return c.notFound();

    const search = new URL(c.req.url).search;
    return c.redirect(
      toPublicPath(
        `${getCollectionPagePath(collection.slug)}${search}`,
        sitePathPrefix,
      ),
      301,
    );
  }

  const result = await renderCollectionPage(c, slugExpression);
  return result ?? c.notFound();
});

// Collection RSS feed
collectionRoutes.get("/:slug/feed", async (c) => {
  const slugExpression = c.req.param("slug");
  const sitePathPrefix = c.var.appConfig.sitePathPrefix;

  if (!isAggregateCollectionSelection(slugExpression)) {
    const collection =
      await c.var.services.collections.getBySlug(slugExpression);
    if (!collection) return c.notFound();

    const search = new URL(c.req.url).search;
    return c.redirect(
      toPublicPath(
        `${getCollectionSelectionFeedPath(collection.slug)}${search}`,
        sitePathPrefix,
      ),
      301,
    );
  }

  const result = await renderCollectionFeed(c, slugExpression);
  return result ?? c.notFound();
});
