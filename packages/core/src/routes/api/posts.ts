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
  FormatSchema,
  parseValidated,
  PostContentSchema,
  PostIdSchema,
  readJsonBody,
  StatusSchema,
  UpdatePostApiSchema,
} from "../../lib/schemas.js";
import { requireAuthApi } from "../../middleware/auth.js";
import {
  apiPostListOrder,
  loadApiPostDetail,
  loadApiPostResponse,
  loadApiPostResponses,
} from "../../lib/api-posts.js";
import { getPostDisplayTitle } from "../../lib/post-meta.js";
import { assertFound, NotFoundError, parseIdParam } from "../../lib/errors.js";
import { AddressQuerySchema, requestInternalPath } from "../../lib/address.js";
import { toPublicPath } from "../../lib/url.js";
import { ID_PREFIX } from "../../lib/ids.js";
import { triggerGitHubSyncInline } from "../../lib/github-sync-trigger.js";
import {
  postWriteDeps,
  toCreatePostInput,
  toUpdatePostInput,
  assertUpdateFitsFormat,
} from "../../lib/api-post-input.js";

type Env = { Bindings: Bindings; Variables: AppVariables };

export const postsApiRoutes = new Hono<Env>();

const ListPostsQuerySchema = z.object({
  format: FormatSchema.optional(),
  status: StatusSchema.optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(100),
  content: PostContentSchema.optional(),
});

const GetPostQuerySchema = z.object({
  content: PostContentSchema.optional(),
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
  const { format, status, cursor, limit, content } = parseValidated(
    ListPostsQuerySchema,
    c.req.query(),
  );

  const listStatus = status ?? "published";
  const { posts, nextCursor } = await c.var.services.posts.listPage(
    { format, status: listStatus, ...apiPostListOrder(listStatus) },
    { cursor, limit },
  );

  return c.json({
    posts: await loadApiPostResponses(c.var, posts, { content }),
    nextCursor,
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

// Get single post (requires auth)
postsApiRoutes.get("/:id", requireAuthApi(), async (c) => {
  const id = parseIdParam(c.req.param("id"), ID_PREFIX.post);
  const { content } = parseValidated(GetPostQuerySchema, c.req.query());

  const post = assertFound(await c.var.services.posts.getById(id), "Post");

  return c.json(await loadApiPostDetail(c.var, post, { content }));
});

// Create post (requires auth)
postsApiRoutes.post("/", requireAuthApi(), async (c) => {
  const body = parseValidated(CreatePostApiSchema, await readJsonBody(c));

  const deps = postWriteDeps(c.var);
  const post = await c.var.services.posts.createWithAttachments(
    toCreatePostInput(body),
    body.attachments,
    deps.attachments,
    deps.summary,
  );

  // Trigger GitHub Sync in background (no-op when sync isn't enabled).
  await triggerGitHubSyncInline(c);

  return c.json(await loadApiPostResponse(c.var, post), 201);
});

// Update post (requires auth)
postsApiRoutes.put("/:id", requireAuthApi(), async (c) => {
  const id = parseIdParam(c.req.param("id"), ID_PREFIX.post);

  const body = parseValidated(UpdatePostApiSchema, await readJsonBody(c));
  const existing = assertFound(await c.var.services.posts.getById(id), "Post");
  assertUpdateFitsFormat(body, existing.format);
  const deps = postWriteDeps(c.var);
  const post = assertFound(
    await c.var.services.posts.updateWithAttachments(
      id,
      toUpdatePostInput(body),
      body.attachments,
      deps.attachments,
      deps.summary,
    ),
    "Post",
  );

  // Trigger GitHub Sync in background (no-op when sync isn't enabled).
  await triggerGitHubSyncInline(c);

  return c.json(await loadApiPostResponse(c.var, post));
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
  const { language } = parseValidated(SetLanguageSchema, await readJsonBody(c));

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
  const { postId } = parseValidated(
    LinkTranslationSchema,
    await readJsonBody(c),
  );

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
