import { Hono } from "hono";
import { z } from "zod";
import type { Bindings, Post } from "../../../types.js";
import type { AppVariables } from "../../../types/app-context.js";
import {
  CollectionSortOrderSchema,
  ContentLanguageSchema,
  FormatSchema,
  parseValidated,
} from "../../../lib/schemas.js";
import { NotFoundError } from "../../../lib/errors.js";
import { loadPublicPostResponses } from "../../../lib/api-public-posts.js";
import {
  resolveCollectionSortOrder,
  supportsCollectionRatingSort,
} from "../../../lib/collection-sort.js";
import { requirePublicApiEnabled } from "../../../middleware/public-content-access.js";
import {
  deprecated,
  THREAD_LIST_DEPRECATED_AT,
} from "../../../middleware/deprecation.js";

type Env = { Bindings: Bindings; Variables: AppVariables };

export const publicPostsApiRoutes = new Hono<Env>();

publicPostsApiRoutes.use("*", requirePublicApiEnabled());

const ListPublicPostsQuerySchema = z.object({
  format: FormatSchema.optional(),
  /**
   * Restrict to one content language. Machine surfaces name the language
   * explicitly; browsing surfaces express it as a URL prefix instead.
   */
  lang: ContentLanguageSchema.optional(),
  collection: z.string().optional(),
  sort: CollectionSortOrderSchema.optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
  content: z.enum(["markdown"]).optional(),
});

const PublicPostContentQuerySchema = z.object({
  content: z.enum(["markdown"]).optional(),
});

function isPublicDetailVisible(post: Post | null): post is Post {
  return (
    post !== null &&
    post.status === "published" &&
    post.visibility !== "private"
  );
}

/**
 * Deprecated in 0.9 for `GET /api/public/threads`, which lists the same Thread
 * roots with the archive's filters and the homepage's defaults. Answers as it
 * always has until 1.0.1 removes it.
 */
publicPostsApiRoutes.get(
  "/",
  deprecated(THREAD_LIST_DEPRECATED_AT, "/api/public/threads"),
  async (c) => {
    const { format, lang, collection, sort, cursor, limit, content } =
      parseValidated(ListPublicPostsQuerySchema, c.req.query());

    // Resolve collection slug(s) — accepts comma-separated (e.g. "tech,art")
    // or "+" separated (e.g. "tech+art"), matching the page URL convention.
    let collectionIds: string[] | undefined;
    let sortOrder: "newest" | "oldest" | "rating_desc" | undefined;

    if (collection) {
      // Normalize: commas → "+" so resolveSelection handles both forms
      const slugExpression = collection.replace(/,/g, "+");
      const selection =
        await c.var.services.collections.resolveSelection(slugExpression);
      if (!selection) {
        return c.json({ posts: [], nextCursor: null });
      }

      collectionIds = selection.collections.map((col) => col.id);

      // Determine sort order: single collection uses its configured default,
      // aggregate selections default to "newest"
      const isAggregate = selection.collections.length > 1;
      const primaryCollection = selection.collections[0];
      if (!primaryCollection) {
        return c.json({ posts: [], nextCursor: null });
      }
      const requestedDefaultSort = isAggregate
        ? "newest"
        : primaryCollection.sortOrder;

      const ratedThreadCount =
        await c.var.services.posts.countCollectionThreadRootsUpToForCollections(
          collectionIds,
          {
            status: "published",
            excludePrivate: true,
            excludeLatestHidden: true,
            rootFormat: format,
            hasRating: true,
          },
          2,
        );
      const showRatingSort = supportsCollectionRatingSort(ratedThreadCount);
      const defaultSort = resolveCollectionSortOrder(
        undefined,
        requestedDefaultSort,
        showRatingSort,
      );
      sortOrder = resolveCollectionSortOrder(sort, defaultSort, showRatingSort);
    }

    const { posts, nextCursor } = collectionIds
      ? await c.var.services.posts.listCollectionThreadRootPage(
          collectionIds,
          {
            status: "published",
            excludePrivate: true,
            excludeLatestHidden: true,
            rootFormat: format,
            lang,
            sortOrder,
          },
          { cursor, limit },
        )
      : await c.var.services.posts.listPage(
          {
            format,
            lang,
            status: "published",
            excludePrivate: true,
            excludeLatestHidden: true,
            excludeReplies: true,
          },
          { cursor, limit },
        );

    return c.json({
      posts: await loadPublicPostResponses(c.var, posts, { content }),
      nextCursor,
    });
  },
);

publicPostsApiRoutes.get("/:slug", async (c) => {
  const { content } = parseValidated(
    PublicPostContentQuerySchema,
    c.req.query(),
  );
  const slug = c.req.param("slug");
  const post = await c.var.services.posts.getBySlug(slug);

  if (!isPublicDetailVisible(post)) {
    throw new NotFoundError("Post");
  }

  const [response] = await loadPublicPostResponses(c.var, [post], { content });
  return c.json(response);
});
