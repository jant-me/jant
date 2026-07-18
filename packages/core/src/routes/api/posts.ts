/**
 * Posts API Routes
 */

import { Hono } from "hono";
import type { Bindings } from "../../types.js";
import type { AppVariables } from "../../types/app-context.js";
import { z } from "zod";
import {
  CreatePostApiSchema,
  UpdatePostApiSchema,
  FormatSchema,
  PostIdSchema,
  StatusSchema,
  parseValidated,
} from "../../lib/schemas.js";
import { requireAuthApi } from "../../middleware/auth.js";
import { toApiAttachment, toApiPost } from "../../lib/api-posts.js";
import { assertFound, NotFoundError, parseIdParam } from "../../lib/errors.js";
import { ID_PREFIX } from "../../lib/ids.js";
import { triggerGitHubSyncInline } from "../../lib/github-sync-trigger.js";

type Env = { Bindings: Bindings; Variables: AppVariables };

export const postsApiRoutes = new Hono<Env>();

function hasOwnField<T extends object>(value: T, key: keyof T): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

const ListPostsQuerySchema = z.object({
  format: FormatSchema.optional(),
  status: StatusSchema.optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(100),
});

const PostSlugQuerySchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("suggest"),
    title: z.string().trim().max(300).optional(),
    postId: PostIdSchema.optional(),
  }),
  z.object({
    mode: z.literal("check"),
    slug: z.string().trim().toLowerCase().min(1).max(200),
    postId: PostIdSchema.optional(),
  }),
]);

// List posts (requires auth)
postsApiRoutes.get("/", requireAuthApi(), async (c) => {
  const { format, status, cursor, limit } = parseValidated(
    ListPostsQuerySchema,
    c.req.query(),
  );

  const posts = await c.var.services.posts.list({
    format,
    status: status ?? "published",
    cursor: cursor ?? undefined,
    limit,
  });

  // Batch load media for all posts
  const postIds = posts.map((p) => p.id);
  const mediaMap = await c.var.services.media.getByPostIds(postIds);
  const {
    r2PublicUrl,
    imageTransformUrl,
    s3PublicUrl,
    localPublicUrl,
    sitePathPrefix,
  } = c.var.appConfig;

  return c.json({
    posts: posts.map((p) =>
      toApiPost(p, {
        attachments: (mediaMap.get(p.id) ?? []).map((m) =>
          toApiAttachment(
            m,
            r2PublicUrl,
            imageTransformUrl,
            s3PublicUrl,
            localPublicUrl,
            sitePathPrefix,
          ),
        ),
      }),
    ),

    nextCursor:
      posts.length === limit ? (posts[posts.length - 1]?.id ?? null) : null,
  });
});

// Suggest or validate a post slug (requires auth)
postsApiRoutes.get("/slug", requireAuthApi(), async (c) => {
  const query = parseValidated(PostSlugQuerySchema, c.req.query());

  if (query.mode === "suggest") {
    const slug = await c.var.services.posts.suggestSlug({
      title: query.title,
      excludePostId: query.postId,
    });
    return c.json({ slug });
  }

  const available = await c.var.services.posts.checkSlugAvailability(
    query.slug,
    query.postId,
  );
  return c.json({
    slug: query.slug,
    available,
  });
});

// Get post body content (requires auth)
postsApiRoutes.get("/:id/content", requireAuthApi(), async (c) => {
  const id = parseIdParam(c.req.param("id"), ID_PREFIX.post);
  const content = assertFound(
    await c.var.services.posts.getBodyContent(id),
    "Post",
  );

  return c.json(content);
});

// Get single post (requires auth)
postsApiRoutes.get("/:id", requireAuthApi(), async (c) => {
  const id = parseIdParam(c.req.param("id"), ID_PREFIX.post);

  // Fetch post, media, and collections in parallel (all keyed by the same id)
  const [post, mediaList, threadCollections] = await Promise.all([
    c.var.services.posts.getById(id),
    c.var.services.media.getByPostId(id),
    c.var.services.collections.getCollectionsByPostId(id),
  ]);
  const foundPost = assertFound(post, "Post");
  const {
    r2PublicUrl,
    imageTransformUrl,
    s3PublicUrl,
    localPublicUrl,
    sitePathPrefix,
  } = c.var.appConfig;
  const collectionIds = threadCollections.map((col) => col.id);

  return c.json(
    toApiPost(foundPost, {
      collectionIds,
      attachments: mediaList.map((m) =>
        toApiAttachment(
          m,
          r2PublicUrl,
          imageTransformUrl,
          s3PublicUrl,
          localPublicUrl,
          sitePathPrefix,
        ),
      ),
    }),
  );
});

// Create post (requires auth)
postsApiRoutes.post("/", requireAuthApi(), async (c) => {
  const body = parseValidated(CreatePostApiSchema, await c.req.json());

  const post = await c.var.services.posts.createWithAttachments(
    {
      format: body.format,
      title: body.format === "quote" ? body.sourceName : body.title,
      body: body.body,
      bodyMarkdown: body.bodyMarkdown,
      slug: body.slug || undefined,
      path: body.path || undefined,
      status: body.status,
      visibility: body.visibility,
      pinned: body.pinned,
      featured: body.featured,
      pinnedAt: body.pinnedAt,
      featuredAt: body.featuredAt,
      url:
        body.format === "quote"
          ? body.sourceUrl || undefined
          : body.url || undefined,
      quoteText: body.quoteText,
      rating: body.rating || undefined,
      collectionIds: body.collectionIds,
      collectionEntries: body.collectionEntries,
      replyToId: body.replyToId,
      quietReply: body.quietReply,
      publishedAt: body.publishedAt,
    },
    body.attachments,
    {
      media: c.var.services.media,
      storage: c.var.storage,
      storageDriver: c.var.appConfig.storageDriver,
      maxFileSizeMB: c.var.appConfig.uploadMaxFileSize,
    },
    {
      maxParagraphs: c.var.appConfig.summaryMaxParagraphs,
      maxChars: c.var.appConfig.summaryMaxChars,
    },
  );

  const mediaList = await c.var.services.media.getByPostId(post.id);
  const {
    r2PublicUrl,
    imageTransformUrl,
    s3PublicUrl,
    localPublicUrl,
    sitePathPrefix,
  } = c.var.appConfig;

  // Trigger GitHub Sync in background (no-op when sync isn't enabled).
  await triggerGitHubSyncInline(c);

  return c.json(
    toApiPost(post, {
      attachments: mediaList.map((m) =>
        toApiAttachment(
          m,
          r2PublicUrl,
          imageTransformUrl,
          s3PublicUrl,
          localPublicUrl,
          sitePathPrefix,
        ),
      ),
    }),
    201,
  );
});

// Update post (requires auth)
postsApiRoutes.put("/:id", requireAuthApi(), async (c) => {
  const id = parseIdParam(c.req.param("id"), ID_PREFIX.post);

  const body = parseValidated(UpdatePostApiSchema, await c.req.json());
  const title = hasOwnField(body, "sourceName") ? body.sourceName : body.title;
  const url = hasOwnField(body, "sourceUrl") ? body.sourceUrl : body.url;

  const post = assertFound(
    await c.var.services.posts.updateWithAttachments(
      id,
      {
        format: body.format,
        title,
        body: body.body,
        bodyMarkdown: body.bodyMarkdown,
        slug: body.slug,
        status: body.status,
        visibility: body.visibility,
        pinned: body.pinned,
        featured: body.featured,
        pinnedAt: body.pinnedAt,
        featuredAt: body.featuredAt,
        url,
        quoteText: body.quoteText,
        rating: body.rating,
        collectionIds: body.collectionIds,
        collectionEntries: body.collectionEntries,
        publishedAt: body.publishedAt,
      },
      body.attachments,
      {
        media: c.var.services.media,
        storage: c.var.storage,
        storageDriver: c.var.appConfig.storageDriver,
        maxFileSizeMB: c.var.appConfig.uploadMaxFileSize,
      },
      {
        maxParagraphs: c.var.appConfig.summaryMaxParagraphs,
        maxChars: c.var.appConfig.summaryMaxChars,
      },
    ),
    "Post",
  );

  // Trigger GitHub Sync in background (no-op when sync isn't enabled).
  await triggerGitHubSyncInline(c);

  const mediaList = await c.var.services.media.getByPostId(post.id);
  const {
    r2PublicUrl,
    imageTransformUrl,
    s3PublicUrl,
    localPublicUrl,
    sitePathPrefix,
  } = c.var.appConfig;

  return c.json(
    toApiPost(post, {
      attachments: mediaList.map((m) =>
        toApiAttachment(
          m,
          r2PublicUrl,
          imageTransformUrl,
          s3PublicUrl,
          localPublicUrl,
          sitePathPrefix,
        ),
      ),
    }),
  );
});

// Delete post (requires auth)
postsApiRoutes.delete("/:id", requireAuthApi(), async (c) => {
  const id = parseIdParam(c.req.param("id"), ID_PREFIX.post);

  const success = await c.var.services.posts.delete(id, {
    media: c.var.services.media,
    storage: c.var.storage,
  });
  if (!success) throw new NotFoundError("Post");

  // Trigger GitHub Sync in background (no-op when sync isn't enabled).
  await triggerGitHubSyncInline(c);

  return c.json({ success: true });
});
