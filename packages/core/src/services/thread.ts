/**
 * Thread Service
 *
 * Threads as a resource of their own: a list of Thread roots in one of the
 * orders the site shows, each with its Post count and, on request, the fold the
 * homepage draws; one Thread by any of its Posts; and a Thread's Posts in Thread
 * order.
 *
 * Every read goes through `PostService`. What lives here is the choice of read:
 * which order a request names, when a collection's own order and pins apply,
 * and what a reader may see as opposed to the author.
 */

import {
  resolveCollectionSortOrder,
  supportsCollectionRatingSort,
} from "../lib/collection-sort.js";
import { ValidationError } from "../lib/errors.js";
import {
  toPostFilters,
  type PostFilterSelection,
} from "../lib/filter-dimensions.js";
import { foldReplyWindows, type ThreadFold } from "../lib/thread-fold.js";
import type {
  CollectionSortOrder,
  Post,
  Status,
  ThreadSort,
} from "../types.js";
import type { CollectionService } from "./collection.js";
import type {
  PostFilters,
  PostListPageOptions,
  PostListPage,
  PostService,
  ThreadRootPageOptions,
} from "./post.js";

/**
 * Who is asking. A reader sees what the site shows anyone: published Threads
 * that aren't private. The author sees every Thread.
 */
export type ThreadAudience = "reader" | "author";

/** What a Thread list is asked for. */
export interface ThreadListQuery {
  audience: ThreadAudience;
  /** The author's status filter; a reader always sees `published`. */
  status?: Status;
  /** Filter dimensions, with collection slugs already resolved to IDs. */
  selection: PostFilterSelection;
  /**
   * A reader's list leaves out Threads hidden from Latest, as the homepage
   * does, unless this is set. A visibility in `selection` is the whole
   * visibility filter and overrides both.
   */
  includeHidden?: boolean;
  /** One content language, as a canonical BCP 47 tag. */
  lang?: string;
  /** Defaults to `activity`, or a named collection's own order. */
  sort?: ThreadSort;
  /** Attach the homepage fold to each Thread. */
  fold?: boolean;
}

/** One Thread, as a list or a lookup returns it. */
export interface ThreadSummary {
  root: Post;
  /** Published Posts in the Thread, the root included. */
  postCount: number;
  /** Present when asked for; null when the Thread has no published reply. */
  fold?: ThreadFold<Post> | null;
}

/** One page of Threads, and the opaque cursor that continues it. */
export interface ThreadListPage {
  threads: ThreadSummary[];
  nextCursor: string | null;
}

/** How a Thread is named: by a Post ID, or by a Post's slug. */
export type ThreadRef = { id: string } | { slug: string };

export interface ThreadService {
  /**
   * One page of Thread roots, in the order `query.sort` names.
   *
   * Without a `sort`, a single named collection lists in its own configured
   * order and an aggregate of several in activity order; `activity`,
   * `oldest`, and `rating` on a named collection also use the collection's
   * pins, as its page does. `published` and `updated` treat a collection as a
   * plain filter, as the archive does.
   *
   * @param query - What to list, for whom, and in which order
   * @param page - The previous page's `nextCursor`, and the page size
   * @returns The page's Threads and the cursor after them
   * @throws {ValidationError} When the cursor can't be resumed, or when
   *   `visibility` is `featured` and `sort` names anything but `published`
   * @example
   * ```ts
   * const page = await threads.listThreads(
   *   { audience: "reader", selection: {}, fold: true },
   *   { limit: 20 },
   * );
   * ```
   */
  listThreads(
    query: ThreadListQuery,
    page: PostListPageOptions,
  ): Promise<ThreadListPage>;
  /**
   * The root of the Thread a Post belongs to, when `audience` may see it.
   *
   * A reader is answered only for a published Post in a published Thread that
   * isn't private; a Thread hidden from Latest is still found.
   *
   * @param ref - Any Post in the Thread, by ID or by slug
   * @param audience - Who is asking
   * @returns The Thread's root, or null when there is none to show
   * @example
   * const root = await threads.findRoot({ slug: "a-reply" }, "reader");
   */
  findRoot(ref: ThreadRef, audience: ThreadAudience): Promise<Post | null>;
  /**
   * Post counts, and the fold on request, for Thread roots already in hand.
   *
   * @param roots - Thread roots, in the order to return them
   * @param options - `fold` attaches the homepage fold
   * @returns One summary per root, in the same order
   * @example
   * const [summary] = await threads.summarize([root], { fold: true });
   */
  summarize(
    roots: Post[],
    options: { fold?: boolean },
  ): Promise<ThreadSummary[]>;
  /**
   * One page of a Thread's Posts, in Thread order. A reader gets published
   * Posts only; the author's `status` defaults to `published`.
   *
   * @param rootId - The Thread root's ID, as {@link findRoot} returned it
   * @param query - Who is asking, and the author's status filter
   * @param page - The previous page's `nextCursor`, and the page size
   * @returns The page's Posts and the cursor after them
   * @example
   * await threads.listPosts(root.id, { audience: "reader" }, { limit: 100 });
   */
  listPosts(
    rootId: string,
    query: { audience: ThreadAudience; status?: Status },
    page: PostListPageOptions,
  ): Promise<PostListPage>;
}

const FEATURED_SORT_MESSAGE =
  "Featured posts are listed newest-published first. Leave sort out, or pass sort=published.";

/**
 * How a plain Thread list orders each `ThreadSort`, as `PostFilters` fields.
 * Only `activity`, the homepage's order, puts pinned Threads first.
 */
function toListOrder(
  sort: ThreadSort,
): Pick<PostFilters, "sortBy" | "sortOrder" | "ignorePinnedSort"> {
  switch (sort) {
    case "activity":
      return { sortBy: "activity", sortOrder: "newest" };
    case "published":
      return {
        sortBy: "published",
        sortOrder: "newest",
        ignorePinnedSort: true,
      };
    case "updated":
      return {
        sortBy: "thread_updated",
        sortOrder: "newest",
        ignorePinnedSort: true,
      };
    case "oldest":
      return {
        sortBy: "published",
        sortOrder: "oldest",
        ignorePinnedSort: true,
      };
    case "rating":
      return {
        sortBy: "activity",
        sortOrder: "rating_desc",
        ignorePinnedSort: true,
      };
  }
}

/**
 * The collection order a `ThreadSort` names, or null for the two that read a
 * collection as a plain filter.
 */
function toCollectionOrder(sort: ThreadSort): CollectionSortOrder | null {
  switch (sort) {
    case "activity":
      return "newest";
    case "oldest":
      return "oldest";
    case "rating":
      return "rating_desc";
    case "published":
    case "updated":
      return null;
  }
}

/**
 * Create the Thread service.
 *
 * @param deps - The Post and collection services it reads through
 * @returns The Thread service
 * @example
 * const threads = createThreadService({ posts, collections });
 */
export function createThreadService(deps: {
  posts: PostService;
  collections: CollectionService;
}): ThreadService {
  const { posts, collections } = deps;

  /**
   * The order a collection's page would use: its configured order when it is
   * the only one named, activity for several. A rating order with fewer than
   * two rated Threads falls back, as the page does — for the default only; a
   * caller who asks for `rating` gets it.
   */
  async function resolveDefaultCollectionOrder(
    collectionIds: readonly string[],
    options: ThreadRootPageOptions,
  ): Promise<CollectionSortOrder> {
    const [onlyId, ...others] = collectionIds;
    if (!onlyId || others.length > 0) return "newest";

    const collection = await collections.getById(onlyId);
    if (!collection) return "newest";

    const ratedThreadCount =
      await posts.countCollectionThreadRootsUpToForCollections(
        [onlyId],
        { ...options, hasRating: true },
        2,
      );
    return resolveCollectionSortOrder(
      undefined,
      collection.sortOrder,
      supportsCollectionRatingSort(ratedThreadCount),
    );
  }

  const service: ThreadService = {
    async listThreads(query, page) {
      const reader = query.audience === "reader";
      const { selection } = query;
      const visibility = selection.visibility;
      if (reader && visibility === "private") {
        throw new ValidationError("Private posts aren't listed here.");
      }
      if (
        visibility === "featured" &&
        query.sort !== undefined &&
        query.sort !== "published"
      ) {
        throw new ValidationError(FEATURED_SORT_MESSAGE);
      }

      const base = {
        status: reader ? ("published" as const) : (query.status ?? "published"),
        excludePrivate: reader,
        excludeLatestHidden:
          reader && visibility === undefined && !query.includeHidden,
        lang: query.lang,
      };

      const collectionIds = selection.collection;
      if (collectionIds && visibility !== "featured") {
        // Membership is the collection query's own; the other dimensions
        // narrow which roots it may return.
        const { collection: _named, ...rootSelection } = selection;
        const options: ThreadRootPageOptions = {
          ...base,
          rootFilters: toPostFilters(rootSelection, { yearAxis: "published" }),
        };
        const collectionOrder =
          query.sort === undefined
            ? await resolveDefaultCollectionOrder(collectionIds, options)
            : toCollectionOrder(query.sort);

        if (collectionOrder) {
          const result = await posts.listCollectionThreadRootPage(
            [...collectionIds],
            { ...options, sortOrder: collectionOrder },
            page,
          );
          return {
            threads: await service.summarize(result.posts, query),
            nextCursor: result.nextCursor,
          };
        }
      }

      const result = await posts.listPage(
        {
          ...base,
          excludeReplies: true,
          // Membership never depends on presentation: the year reads the
          // publication date whatever the order.
          ...toPostFilters(selection, { yearAxis: "published" }),
          ...(visibility === "featured"
            ? toListOrder("published")
            : toListOrder(query.sort ?? "activity")),
        },
        page,
      );
      return {
        threads: await service.summarize(result.posts, query),
        nextCursor: result.nextCursor,
      };
    },

    async findRoot(ref, audience) {
      const post =
        "id" in ref
          ? await posts.getById(ref.id)
          : await posts.getBySlug(ref.slug);
      if (!post) return null;
      if (audience === "reader" && post.status !== "published") return null;

      const root =
        post.threadId === post.id ? post : await posts.getById(post.threadId);
      if (!root) return null;
      if (
        audience === "reader" &&
        (root.status !== "published" || root.visibility === "private")
      ) {
        return null;
      }
      return root;
    },

    async summarize(roots, options) {
      if (roots.length === 0) return [];
      const rootIds = roots.map((root) => root.id);
      const [counts, contexts] = await Promise.all([
        posts.countThreadPosts(rootIds),
        options.fold
          ? posts.getThreadTimelineContext(rootIds)
          : Promise.resolve(null),
      ]);

      return roots.map((root) => {
        const summary: ThreadSummary = {
          root,
          postCount: counts.get(root.id) ?? 0,
        };
        if (contexts) {
          const context = contexts.get(root.id);
          summary.fold = context
            ? foldReplyWindows({
                leadingReplies: context.leadingReplies,
                trailingReplies: context.trailingReplies,
                latestReply: context.latestReply,
                nextReply: context.firstHiddenReply,
                totalReplyCount: context.totalReplyCount,
              })
            : null;
        }
        return summary;
      });
    },

    async listPosts(rootId, query, page) {
      return posts.listThreadPostsPage(
        rootId,
        {
          status:
            query.audience === "reader"
              ? "published"
              : (query.status ?? "published"),
        },
        page,
      );
    },
  };

  return service;
}
