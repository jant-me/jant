import { Hono } from "hono";
import { z } from "zod";
import type { Bindings, Collection, Media, Post } from "../../../types.js";
import type { AppVariables } from "../../../types/app-context.js";
import { getCollectionPagePath } from "../../../lib/collection-paths.js";
import {
  CollectionSortOrderSchema,
  FormatSchema,
  parseValidated,
} from "../../../lib/schemas.js";
import { NotFoundError } from "../../../lib/errors.js";
import { toApiAttachment } from "../../../lib/api-posts.js";
import { tiptapJsonToMarkdown } from "../../../lib/tiptap-to-markdown.js";
import { toPublicPath } from "../../../lib/url.js";
import {
  getImageUrl,
  getMediaUrl,
  getPublicUrlForProvider,
} from "../../../lib/image.js";
import {
  resolveCollectionSortOrder,
  supportsCollectionRatingSort,
} from "../../../lib/collection-sort.js";
import { requirePublicApiEnabled } from "../../../middleware/public-content-access.js";

type Env = { Bindings: Bindings; Variables: AppVariables };

export const publicPostsApiRoutes = new Hono<Env>();

publicPostsApiRoutes.use("*", requirePublicApiEnabled());

const ListPublicPostsQuerySchema = z.object({
  format: FormatSchema.optional(),
  collection: z.string().optional(),
  sort: CollectionSortOrderSchema.optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
  content: z.enum(["markdown"]).optional(),
});

const PublicPostContentQuerySchema = z.object({
  content: z.enum(["markdown"]).optional(),
});

export type PublicPostBaseResponse = {
  id: string;
  format: Post["format"];
  status: "published";
  visibility: Post["visibility"];
  slug: string;
  permalink: string;
  title?: string | null;
  url?: string | null;
  sourceName?: string | null;
  sourceUrl?: string | null;
  quoteText: string | null;
  summary: string | null;
  rating: number | null;
  previewKind: string | null;
  previewProvider: string | null;
  previewImageUrl: string | null;
  replyToId: string | null;
  threadId: string;
  /** Reply published without announcing its Thread. Always false on roots. */
  quietReply: boolean;
  pinnedAt: number | null;
  featuredAt: number | null;
  publishedAt: number | null;
  /** Root only: newest post in the Thread, quiet replies excluded. */
  lastActivityAt: number;
  /** Root only: newest post in the Thread, quiet replies included. */
  threadUpdatedAt: number;
  createdAt: number;
  updatedAt: number;
  attachments: ReturnType<typeof toApiAttachment>[];
  collections: {
    id: string;
    slug: string;
    title: string;
    url: string;
  }[];
};

export type PublicPostRenderedResponse = PublicPostBaseResponse & {
  bodyHtml: string | null;
  bodyText: string | null;
};

export type PublicPostMarkdownResponse = PublicPostBaseResponse & {
  bodyMarkdown: string | null;
};

export type PublicPostResponse =
  | PublicPostRenderedResponse
  | PublicPostMarkdownResponse;

function isPublicDetailVisible(post: Post | null): post is Post {
  return (
    post !== null &&
    post.status === "published" &&
    post.visibility !== "private"
  );
}

export function toPublicPost(
  post: Post,
  mediaList: Media[],
  threadCollections: Collection[],
  appConfig: AppVariables["appConfig"],
  options?: { content?: "markdown" },
): PublicPostResponse {
  const {
    r2PublicUrl,
    imageTransformUrl,
    s3PublicUrl,
    localPublicUrl,
    sitePathPrefix,
    storageDriver,
  } = appConfig;

  const previewImagePublicUrl = getPublicUrlForProvider(
    storageDriver,
    r2PublicUrl,
    s3PublicUrl,
    localPublicUrl,
  );
  const previewImageUrl = post.previewImageKey
    ? getImageUrl(
        getMediaUrl(
          post.previewImageKey,
          previewImagePublicUrl,
          sitePathPrefix,
        ),
        imageTransformUrl,
        { width: 1280, quality: 80, format: "auto", fit: "scale-down" },
      )
    : null;

  const base = {
    id: post.id,
    format: post.format,
    status: "published" as const,
    visibility: post.visibility,
    slug: post.slug,
    permalink: toPublicPath(`/${post.slug}`, sitePathPrefix),
    quoteText: post.quoteText,
    summary: post.summary,
    rating: post.rating,
    previewKind: post.previewKind,
    previewProvider: post.previewProvider,
    previewImageUrl,
    replyToId: post.replyToId,
    threadId: post.threadId,
    quietReply: post.quietReply,
    pinnedAt: post.pinnedAt,
    featuredAt: post.featuredAt,
    publishedAt: post.publishedAt,
    lastActivityAt: post.lastActivityAt,
    threadUpdatedAt: post.threadUpdatedAt,
    createdAt: post.createdAt,
    updatedAt: post.updatedAt,
    attachments: mediaList.map((media) =>
      toApiAttachment(
        media,
        r2PublicUrl,
        imageTransformUrl,
        s3PublicUrl,
        localPublicUrl,
        sitePathPrefix,
      ),
    ),
    collections: threadCollections.map((collection) => ({
      id: collection.id,
      slug: collection.slug,
      title: collection.title,
      url: toPublicPath(getCollectionPagePath(collection.slug), sitePathPrefix),
    })),
  };
  const contentFields =
    options?.content === "markdown"
      ? {
          bodyMarkdown: post.body ? tiptapJsonToMarkdown(post.body) : null,
        }
      : {
          bodyHtml: post.bodyHtml,
          bodyText: post.bodyText,
        };

  if (post.format === "quote") {
    return {
      ...base,
      ...contentFields,
      sourceName: post.title,
      sourceUrl: post.url,
    };
  }

  return {
    ...base,
    ...contentFields,
    title: post.title,
    url: post.url,
  };
}

publicPostsApiRoutes.get("/", async (c) => {
  const { format, collection, sort, cursor, limit, content } = parseValidated(
    ListPublicPostsQuerySchema,
    c.req.query(),
  );

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

  const posts = collectionIds
    ? await c.var.services.posts.listCollectionThreadRootsForCollections(
        collectionIds,
        {
          status: "published",
          excludePrivate: true,
          excludeLatestHidden: true,
          rootFormat: format,
          sortOrder,
          cursor: cursor ?? undefined,
          limit,
        },
      )
    : await c.var.services.posts.list({
        format,
        status: "published",
        cursor: cursor ?? undefined,
        limit,
        excludePrivate: true,
        excludeLatestHidden: true,
        excludeReplies: true,
      });

  const postIds = posts.map((post) => post.id);
  const [mediaMap, collectionsMap] = await Promise.all([
    c.var.services.media.getByPostIds(postIds),
    c.var.services.collections.getCollectionsByPostIds(postIds),
  ]);

  return c.json({
    posts: posts.map((post) =>
      toPublicPost(
        post,
        mediaMap.get(post.id) ?? [],
        collectionsMap.get(post.id) ?? [],
        c.var.appConfig,
        { content },
      ),
    ),
    nextCursor:
      posts.length === limit ? (posts[posts.length - 1]?.id ?? null) : null,
  });
});

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

  const [mediaList, threadCollections] = await Promise.all([
    c.var.services.media.getByPostId(post.id),
    c.var.services.collections.getCollectionsByPostId(post.id),
  ]);

  return c.json(
    toPublicPost(post, mediaList, threadCollections, c.var.appConfig, {
      content,
    }),
  );
});
