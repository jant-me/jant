/**
 * Timeline Data Assembly
 *
 * Shared helper for assembling timeline items with media and thread previews.
 * Used by page rendering with page-based pagination.
 */

import type { Context } from "hono";
import type {
  Bindings,
  CollectionSortOrder,
  Post,
  TimelineItemView,
} from "../types.js";
import type { AppVariables } from "../types/app-context.js";
import { buildMediaMap } from "./media-helpers.js";
import { createMediaContext, toPostView } from "./view.js";

type Env = { Bindings: Bindings; Variables: AppVariables };

/**
 * Result from assembling a timeline page.
 */
export interface TimelineResult {
  items: TimelineItemView[];
  currentPage: number;
  totalPages: number;
  totalCount: number;
}

interface CuratedThreadSource {
  posts: Array<{ post: Post; position: number }>;
  highlightedPostIds: ReadonlySet<string>;
}

async function buildTimelineItems(
  c: Context<Env>,
  posts: Post[],
): Promise<TimelineItemView[]> {
  if (posts.length === 0) {
    return [];
  }

  // Batch load media, collections, and latest-reply contexts in parallel
  const postIds = posts.map((p) => p.id);
  const mediaCtx = createMediaContext(c.var.appConfig);
  const [rawMediaMap, collectionsMap, threadContexts, aliasesMap] =
    await Promise.all([
      c.var.services.media.getByPostIds(postIds),
      c.var.services.collections.getCollectionsByPostIds(postIds),
      c.var.services.posts.getThreadTimelineContext(postIds),
      c.var.services.paths.getPostAliases(postIds),
    ]);
  const mediaMap = buildMediaMap(
    rawMediaMap,
    mediaCtx.r2PublicUrl,
    mediaCtx.imageTransformUrl,
    mediaCtx.s3PublicUrl,
    mediaCtx.localPublicUrl,
    mediaCtx.sitePathPrefix,
  );

  // Batch load media for the bounded leading/trailing thread context.
  const contextPostIds = new Set<string>();
  for (const ctx of threadContexts.values()) {
    contextPostIds.add(ctx.latestReply.id);
    for (const reply of [...ctx.leadingReplies, ...ctx.trailingReplies]) {
      contextPostIds.add(reply.id);
    }
  }
  const [contextMediaMap, contextCollectionsMap, contextAliasesMap] =
    contextPostIds.size > 0
      ? await Promise.all([
          c.var.services.media
            .getByPostIds([...contextPostIds])
            .then((raw) =>
              buildMediaMap(
                raw,
                mediaCtx.r2PublicUrl,
                mediaCtx.imageTransformUrl,
                mediaCtx.s3PublicUrl,
                mediaCtx.localPublicUrl,
                mediaCtx.sitePathPrefix,
              ),
            ),
          c.var.services.collections.getCollectionsByPostIds([
            ...contextPostIds,
          ]),
          c.var.services.paths.getPostAliases([...contextPostIds]),
        ])
      : [new Map(), new Map(), new Map<string, string[]>()];

  const firstAlias = (id: string) => aliasesMap.get(id)?.[0];
  const firstContextAlias = (id: string) => contextAliasesMap.get(id)?.[0];

  // Assemble timeline items with View Models
  return posts.map((post) => {
    const postView = toPostView(
      {
        ...post,
        mediaAttachments: mediaMap.get(post.id) ?? [],
      },
      mediaCtx,
      collectionsMap.get(post.id),
      undefined,
      firstAlias(post.id),
    );

    const threadCtx = threadContexts.get(post.id);

    if (threadCtx) {
      // Thread root is not the last post — hide reply button on it
      postView.isLastInThread = false;

      const toContextPostView = (reply: Post) =>
        toPostView(
          {
            ...reply,
            mediaAttachments: contextMediaMap.get(reply.id) ?? [],
          },
          mediaCtx,
          contextCollectionsMap.get(reply.id),
          false,
          firstContextAlias(reply.id),
        );

      const leadingReplyViews = threadCtx.leadingReplies.map(toContextPostView);
      const trailingReplyViews =
        threadCtx.trailingReplies.map(toContextPostView);

      const latestReplyView = toPostView(
        {
          ...threadCtx.latestReply,
          mediaAttachments: contextMediaMap.get(threadCtx.latestReply.id) ?? [],
        },
        mediaCtx,
        contextCollectionsMap.get(threadCtx.latestReply.id),
        true, // latestReply is the last post in the thread
        firstContextAlias(threadCtx.latestReply.id),
      );

      return {
        post: postView,
        threadPreview: {
          leadingReplies: leadingReplyViews,
          trailingReplies: trailingReplyViews,
          latestReply: latestReplyView,
          totalReplyCount: threadCtx.totalReplyCount,
        },
      };
    }

    return { post: postView };
  });
}

/**
 * Assembles timeline items for a known ordered list of thread-root posts.
 *
 * Reuses the same media and thread-preview path as the main latest timeline so
 * alternate grouped views can stay visually and behaviorally in sync.
 *
 * @param c - Hono context (provides services + appConfig)
 * @param posts - Ordered published thread-root posts to render
 * @returns Timeline items matching the latest-feed presentation
 */
export async function assembleTimelineItems(
  c: Context<Env>,
  posts: Post[],
): Promise<TimelineItemView[]> {
  return buildTimelineItems(c, posts);
}

async function buildCuratedThreadItems(
  c: Context<Env>,
  rootIds: string[],
  threadsByRootId: Map<string, CuratedThreadSource>,
  collectionPinnedThreadIds?: Set<string>,
): Promise<TimelineItemView[]> {
  const orderedThreads = rootIds
    .map((rootId) => threadsByRootId.get(rootId))
    .filter((thread): thread is CuratedThreadSource => Boolean(thread));

  if (orderedThreads.length === 0) {
    return [];
  }

  const mediaCtx = createMediaContext(c.var.appConfig);
  const postIds = orderedThreads.flatMap((thread) =>
    thread.posts.map(({ post }) => post.id),
  );
  const [rawMediaMap, collectionsMap, curatedAliasesMap] = await Promise.all([
    c.var.services.media.getByPostIds(postIds),
    c.var.services.collections.getCollectionsByPostIds(postIds),
    c.var.services.paths.getPostAliases(postIds),
  ]);
  const mediaMap = buildMediaMap(
    rawMediaMap,
    mediaCtx.r2PublicUrl,
    mediaCtx.imageTransformUrl,
    mediaCtx.s3PublicUrl,
    mediaCtx.localPublicUrl,
    mediaCtx.sitePathPrefix,
  );

  return orderedThreads.reduce<TimelineItemView[]>((items, thread) => {
    const rootEntry = thread.posts[0];
    if (!rootEntry || rootEntry.position !== 0) {
      return items;
    }

    const lastPostId = thread.posts[thread.posts.length - 1]?.post.id;
    const renderedPosts = thread.posts.map(({ post, position }) => ({
      position,
      view: toPostView(
        {
          ...post,
          mediaAttachments: mediaMap.get(post.id) ?? [],
        },
        mediaCtx,
        collectionsMap.get(post.id),
        post.id === lastPostId,
        curatedAliasesMap.get(post.id)?.[0],
        post.id === post.threadId &&
          collectionPinnedThreadIds?.has(post.threadId),
      ),
    }));
    const rootView = renderedPosts[0]?.view;

    if (!rootView) {
      return items;
    }

    const segments = renderedPosts.reduce<
      NonNullable<TimelineItemView["curatedThread"]>["segments"]
    >((items, renderedPost, segmentIndex) => {
      const previousPosition =
        segmentIndex === 0
          ? undefined
          : renderedPosts[segmentIndex - 1]?.position;

      items.push({
        post: renderedPost.view,
        hiddenBeforeCount:
          previousPosition === undefined
            ? renderedPost.position
            : renderedPost.position - previousPosition - 1,
        highlighted: thread.highlightedPostIds.has(renderedPost.view.id),
      });

      return items;
    }, []);

    if (segments.length === 0) {
      return items;
    }

    const isStandaloneRoot =
      segments.length === 1 && segments[0]?.post.id === rootView.id;

    if (isStandaloneRoot) {
      items.push({ post: rootView });
      return items;
    }

    items.push({
      post: rootView,
      curatedThread: {
        rootPost: rootView,
        segments,
      },
    });

    return items;
  }, []);
}

/**
 * Assembles a page of timeline items with media attachments and thread previews.
 *
 * Fetches posts using offset-based pagination, batch-loads media, identifies
 * threads, and returns render-ready `TimelineItemView[]` with page info.
 *
 * @param c - Hono context (provides services + appConfig)
 * @param options - Optional page number (1-indexed, defaults to 1)
 * @returns Assembled timeline items with pagination info
 *
 * @example
 * ```ts
 * const { items, currentPage, totalPages, totalCount } = await assembleTimeline(c);
 * const { items, currentPage, totalPages, totalCount } = await assembleTimeline(c, { page: 2 });
 * ```
 */
export async function assembleTimeline(
  c: Context<Env>,
  options?: { page?: number; isAuthenticated?: boolean },
): Promise<TimelineResult> {
  const pageSize = c.var.appConfig.pageSize;

  const page = Math.max(1, options?.page ?? 1);
  const offset = (page - 1) * pageSize;

  const excludePrivate = !(options?.isAuthenticated ?? false);

  // Count + list are independent — run in parallel
  const [totalCount, posts] = await Promise.all([
    c.var.services.posts.count({
      status: "published",
      excludeReplies: true,
      excludeLatestHidden: true,
      excludePrivate,
    }),
    c.var.services.posts.list({
      status: "published",
      excludeReplies: true,
      excludeLatestHidden: true,
      excludePrivate,
      limit: pageSize,
      offset,
    }),
  ]);
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));

  if (posts.length === 0) {
    return { items: [], currentPage: page, totalPages, totalCount };
  }

  const items = await buildTimelineItems(c, posts);

  return { items, currentPage: page, totalPages, totalCount };
}

/**
 * Assembles a single timeline item for in-place timeline refreshes.
 *
 * Reuses the same thread-preview assembly path as `assembleTimeline()` so
 * page renders and partial updates stay in sync.
 *
 * @param c - Hono context (provides services + appConfig)
 * @param threadRootId - TypeID of the thread root displayed in the timeline
 * @param options - Auth state used to apply timeline visibility rules
 * @returns A render-ready timeline item, or null when it should not be shown
 */
export async function assembleTimelineItem(
  c: Context<Env>,
  threadRootId: string,
  options?: { isAuthenticated?: boolean },
): Promise<TimelineItemView | null> {
  const excludePrivate = !(options?.isAuthenticated ?? false);
  const post = await c.var.services.posts.getById(threadRootId);

  if (
    !post ||
    post.replyToId !== null ||
    post.status !== "published" ||
    post.visibility === "latest_hidden" ||
    (excludePrivate && post.visibility === "private")
  ) {
    return null;
  }

  const items = await buildTimelineItems(c, [post]);
  return items[0] ?? null;
}

/**
 * Assembles a paginated featured timeline grouped by thread root.
 *
 * @param c - Hono context (provides services + appConfig)
 * @param options - Optional page number and auth state
 * @returns Featured timeline items with pagination info
 */
export async function assembleFeaturedTimeline(
  c: Context<Env>,
  options?: { page?: number; isAuthenticated?: boolean },
): Promise<TimelineResult> {
  const pageSize = c.var.appConfig.pageSize;
  const page = Math.max(1, options?.page ?? 1);
  const offset = (page - 1) * pageSize;
  const excludePrivate = !(options?.isAuthenticated ?? false);

  const [totalCount, rootIds] = await Promise.all([
    c.var.services.posts.countFeaturedThreadRoots({
      status: "published",
      excludePrivate,
    }),
    c.var.services.posts.listFeaturedThreadRootIds({
      status: "published",
      excludePrivate,
      limit: pageSize,
      offset,
    }),
  ]);

  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));

  if (rootIds.length === 0) {
    return { items: [], currentPage: page, totalPages, totalCount };
  }

  const featuredThreads =
    await c.var.services.posts.getFeaturedThreadTimelineData(rootIds);
  const threadsByRootId = new Map<string, CuratedThreadSource>(
    [...featuredThreads].map(([threadId, thread]) => [
      threadId,
      {
        posts: thread.posts,
        highlightedPostIds: new Set(thread.featuredPostIds),
      },
    ]),
  );

  const items = await buildCuratedThreadItems(c, rootIds, threadsByRootId);

  return { items, currentPage: page, totalPages, totalCount };
}

/**
 * Assembles a paginated collection timeline grouped by thread root.
 *
 * Threads are ordered by collection activity/rating semantics. Every published
 * post in each matching Thread is rendered; Collection membership never selects
 * or hides individual posts within the Thread.
 *
 * @param c - Hono context (provides services + appConfig)
 * @param options - Collection IDs, optional page number, auth state, and sort
 * @returns Collection timeline items with pagination info
 */
export async function assembleCollectionTimeline(
  c: Context<Env>,
  options: {
    collectionIds: string[];
    page?: number;
    isAuthenticated?: boolean;
    sortOrder?: CollectionSortOrder;
  },
): Promise<TimelineResult> {
  const pageSize = c.var.appConfig.pageSize;
  const page = Math.max(1, options.page ?? 1);
  const offset = (page - 1) * pageSize;
  const excludePrivate = !(options.isAuthenticated ?? false);

  const [totalCount, rootIds] = await Promise.all([
    c.var.services.posts.countCollectionThreadRootsForCollections(
      options.collectionIds,
      {
        status: "published",
        excludePrivate,
      },
    ),
    c.var.services.posts.listCollectionThreadRootIdsForCollections(
      options.collectionIds,
      {
        status: "published",
        excludePrivate,
        sortOrder: options.sortOrder,
        limit: pageSize,
        offset,
      },
    ),
  ]);

  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));

  if (rootIds.length === 0) {
    return { items: [], currentPage: page, totalPages, totalCount };
  }

  const [threadsByRootId, pinnedThreadIds] = await Promise.all([
    c.var.services.posts.getPublishedThreads(rootIds),
    c.var.services.collections.getPinnedThreadIds(options.collectionIds),
  ]);
  const curatedThreadsByRootId = new Map<string, CuratedThreadSource>(
    [...threadsByRootId].map(([threadId, thread]) => [
      threadId,
      {
        posts: thread.map((post, position) => ({ post, position })),
        highlightedPostIds: new Set<string>(),
      },
    ]),
  );
  const items = await buildCuratedThreadItems(
    c,
    rootIds,
    curatedThreadsByRootId,
    pinnedThreadIds,
  );

  return { items, currentPage: page, totalPages, totalCount };
}
