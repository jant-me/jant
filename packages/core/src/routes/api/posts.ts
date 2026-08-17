/**
 * Posts API Routes
 */

import { Hono } from "hono";
import type { Bindings } from "../../types.js";
import type { AppVariables } from "../../types/app-context.js";
import { z } from "zod";
import {
  ContentLanguageSchema,
  CreatePostApiSchema,
  UpdatePostApiSchema,
  FormatSchema,
  PostIdSchema,
  StatusSchema,
  parseValidated,
} from "../../lib/schemas.js";
import { requireAuthApi } from "../../middleware/auth.js";
import { toApiAttachment, toApiPost } from "../../lib/api-posts.js";
import { getPostDisplayTitle } from "../../lib/post-meta.js";
import { assertFound, NotFoundError, parseIdParam } from "../../lib/errors.js";
import { AddressQuerySchema, requestInternalPath } from "../../lib/address.js";
import { toPublicPath } from "../../lib/url.js";
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

  // Fetch post, media, collections and thread position in parallel (all keyed
  // by the same id)
  const [post, mediaList, threadCollections, threadPosition] =
    await Promise.all([
      c.var.services.posts.getById(id),
      c.var.services.media.getByPostId(id),
      c.var.services.collections.getCollectionsByPostId(id),
      c.var.services.posts.getThreadPosition(id),
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

  return c.json({
    ...toApiPost(foundPost, {
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
    threadPosition,
  });
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
      language: body.language,
      translationOfId: body.translationOfId,
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
        language: body.language,
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

// =============================================================================
// Language and translations
// =============================================================================

const SetLanguageSchema = z.object({ language: ContentLanguageSchema });
const TranslationCandidatesQuerySchema = z.object({
  q: z.string().trim().min(1).max(200),
  limit: z.coerce.number().int().min(1).max(20).optional().default(8),
});
const LinkTranslationSchema = z.object({ postId: PostIdSchema });

/**
 * Set the content language of a whole Thread.
 *
 * Thread-wide because `post.language` is uniform inside a Thread — see the
 * service method for why every language filter depends on that.
 */
postsApiRoutes.put("/:id/language", requireAuthApi(), async (c) => {
  const id = parseIdParam(c.req.param("id"), ID_PREFIX.post);
  const { language } = parseValidated(SetLanguageSchema, await c.req.json());

  await c.var.services.posts.setThreadLanguage(id, language);
  await triggerGitHubSyncInline(c);

  return c.json({ success: true, language });
});

/** List the Thread roots this post is a translation of. */
postsApiRoutes.get("/:id/translations", requireAuthApi(), async (c) => {
  const id = parseIdParam(c.req.param("id"), ID_PREFIX.post);
  const post = assertFound(await c.var.services.posts.getById(id), "Post");
  const translations = await c.var.services.posts.listTranslations(
    post.threadId,
  );

  return c.json({
    translations: translations.map((translation) => ({
      id: translation.id,
      slug: translation.slug,
      title: translation.title,
      // What to show in a list: notes are usually untitled, and a slug is not
      // a name.
      label: getPostDisplayTitle(translation) || translation.slug,
      language: translation.language,
    })),
  });
});

/**
 * Posts this one could be linked to as a translation.
 *
 * The eligibility rules live in the service; the menu only renders what comes
 * back, so it never offers a post the link would refuse.
 */
postsApiRoutes.get(
  "/:id/translations/candidates",
  requireAuthApi(),
  async (c) => {
    const id = parseIdParam(c.req.param("id"), ID_PREFIX.post);
    const { q, limit } = parseValidated(
      TranslationCandidatesQuerySchema,
      c.req.query(),
    );

    const candidates = await c.var.services.posts.listTranslationCandidates(
      id,
      {
        query: q,
        limit,
      },
    );

    return c.json({
      candidates: candidates.map((post) => ({
        id: post.id,
        slug: post.slug,
        title: post.title,
        label: getPostDisplayTitle(post) || post.slug,
        language: post.language,
      })),
    });
  },
);

/**
 * The Thread a pasted address names, and whether it can be linked to this one.
 *
 * Separate from the candidate search so a URL never quietly becomes search
 * words: this endpoint only ever answers about one address, and answers with a
 * reason when the Thread it names is not eligible.
 */
postsApiRoutes.get("/:id/translations/resolve", requireAuthApi(), async (c) => {
  const id = parseIdParam(c.req.param("id"), ID_PREFIX.post);
  const { url } = parseValidated(AddressQuerySchema, c.req.query());

  const path = requestInternalPath(c, url);
  if (path === null) {
    return c.json({ resolution: { kind: "external", address: url.trim() } });
  }

  const resolution = await c.var.services.posts.resolveTranslationCandidate(
    id,
    path,
  );
  const address = toPublicPath(path, c.var.appConfig.sitePathPrefix);

  if (resolution.status === "ok") {
    const post = resolution.post;
    return c.json({
      resolution: {
        kind: "ok",
        address,
        candidate: {
          id: post.id,
          slug: post.slug,
          label: getPostDisplayTitle(post) || post.slug,
          language: post.language,
        },
      },
    });
  }

  return c.json({
    resolution: {
      kind: resolution.status,
      address,
      ...("language" in resolution ? { language: resolution.language } : {}),
    },
  });
});

/** Link two already-published Threads as translations of each other. */
postsApiRoutes.post("/:id/translations", requireAuthApi(), async (c) => {
  const id = parseIdParam(c.req.param("id"), ID_PREFIX.post);
  const { postId } = parseValidated(LinkTranslationSchema, await c.req.json());

  await c.var.services.posts.linkTranslation(id, postId);
  await triggerGitHubSyncInline(c);

  return c.json({ success: true });
});

/** Take this Thread out of its translation group. */
postsApiRoutes.delete("/:id/translations", requireAuthApi(), async (c) => {
  const id = parseIdParam(c.req.param("id"), ID_PREFIX.post);

  await c.var.services.posts.unlinkTranslation(id);
  await triggerGitHubSyncInline(c);

  return c.json({ success: true });
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
