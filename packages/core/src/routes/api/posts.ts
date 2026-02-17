/**
 * Posts API Routes
 */

import { Hono } from "hono";
import type { Bindings, Format, Status, Media } from "../../types.js";
import type { AppVariables } from "../../app.js";
import * as sqid from "../../lib/sqid.js";
import {
  CreatePostSchema,
  UpdatePostSchema,
  validateMediaCount,
} from "../../lib/schemas.js";
import { requireAuthApi } from "../../middleware/auth.js";
import {
  getMediaUrl,
  getImageUrl,
  getPublicUrlForProvider,
} from "../../lib/image.js";

type Env = { Bindings: Bindings; Variables: AppVariables };

export const postsApiRoutes = new Hono<Env>();

/**
 * Converts a Media record to a MediaAttachment API response shape.
 */
function toMediaAttachment(
  m: Media,
  r2PublicUrl?: string,
  imageTransformUrl?: string,
  s3PublicUrl?: string,
) {
  const publicUrl = getPublicUrlForProvider(
    m.provider,
    r2PublicUrl,
    s3PublicUrl,
  );
  const url = getMediaUrl(m.storageKey, publicUrl);
  const previewUrl = getImageUrl(url, imageTransformUrl, {
    width: 400,
    quality: 80,
    format: "auto",
    fit: "cover",
  });

  return {
    id: m.id,
    url,
    previewUrl,
    alt: m.alt,
    blurhash: m.blurhash,
    width: m.width,
    height: m.height,
    position: m.position,
    mimeType: m.mimeType,
  };
}

// List posts
postsApiRoutes.get("/", async (c) => {
  const format = c.req.query("format") as Format | undefined;
  const status = c.req.query("status") as Status | undefined;
  const cursor = c.req.query("cursor");
  const limit = parseInt(c.req.query("limit") ?? "100", 10);

  const posts = await c.var.services.posts.list({
    format,
    status: status ?? "published",
    cursor: cursor ? (sqid.decode(cursor) ?? undefined) : undefined,
    limit,
  });

  // Batch load media for all posts
  const postIds = posts.map((p) => p.id);
  const mediaMap = await c.var.services.media.getByPostIds(postIds);
  const r2PublicUrl = c.env.R2_PUBLIC_URL;
  const imageTransformUrl = c.env.IMAGE_TRANSFORM_URL;
  const s3PublicUrl = c.env.S3_PUBLIC_URL;

  return c.json({
    posts: posts.map((p) => ({
      ...p,
      sqid: sqid.encode(p.id),
      mediaAttachments: (mediaMap.get(p.id) ?? []).map((m) =>
        toMediaAttachment(m, r2PublicUrl, imageTransformUrl, s3PublicUrl),
      ),
    })),

    nextCursor:
      posts.length === limit
        ? sqid.encode(posts[posts.length - 1]?.id ?? 0)
        : null,
  });
});

// Get single post
postsApiRoutes.get("/:id", async (c) => {
  const id = sqid.decode(c.req.param("id"));
  if (!id) return c.json({ error: "Invalid ID" }, 400);

  const post = await c.var.services.posts.getById(id);
  if (!post) return c.json({ error: "Not found" }, 404);

  const mediaList = await c.var.services.media.getByPostId(post.id);
  const r2PublicUrl = c.env.R2_PUBLIC_URL;
  const imageTransformUrl = c.env.IMAGE_TRANSFORM_URL;
  const s3PublicUrl = c.env.S3_PUBLIC_URL;

  return c.json({
    ...post,
    sqid: sqid.encode(post.id),
    mediaAttachments: mediaList.map((m) =>
      toMediaAttachment(m, r2PublicUrl, imageTransformUrl, s3PublicUrl),
    ),
  });
});

// Create post (requires auth)
postsApiRoutes.post("/", requireAuthApi(), async (c) => {
  const rawBody = await c.req.json();

  // Validate request body
  const parseResult = CreatePostSchema.safeParse(rawBody);
  if (!parseResult.success) {
    return c.json(
      { error: "Validation failed", details: parseResult.error.flatten() },
      400,
    );
  }

  const body = parseResult.data;

  // Validate media count
  if (body.mediaIds) {
    const mediaError = validateMediaCount(body.mediaIds);
    if (mediaError) {
      return c.json({ error: mediaError }, 400);
    }

    // Verify all media IDs exist
    if (body.mediaIds.length > 0) {
      const existing = await c.var.services.media.getByIds(body.mediaIds);
      if (existing.length !== body.mediaIds.length) {
        return c.json({ error: "One or more media IDs are invalid" }, 400);
      }
    }
  }

  const post = await c.var.services.posts.create({
    format: body.format,
    title: body.title,
    body: body.body,
    path: body.path || undefined,
    status: body.status,
    featured: body.featured,
    pinned: body.pinned,
    url: body.url || undefined,
    quoteText: body.quoteText,
    rating: body.rating || undefined,
    collectionId: body.collectionId || undefined,
    replyToId: body.replyToId
      ? (sqid.decode(body.replyToId) ?? undefined)
      : undefined,
    publishedAt: body.publishedAt,
  });

  // Attach media
  if (body.mediaIds && body.mediaIds.length > 0) {
    await c.var.services.media.attachToPost(post.id, body.mediaIds);
  }

  const mediaList = await c.var.services.media.getByPostId(post.id);
  const r2PublicUrl = c.env.R2_PUBLIC_URL;
  const imageTransformUrl = c.env.IMAGE_TRANSFORM_URL;
  const s3PublicUrl = c.env.S3_PUBLIC_URL;

  return c.json(
    {
      ...post,
      sqid: sqid.encode(post.id),
      mediaAttachments: mediaList.map((m) =>
        toMediaAttachment(m, r2PublicUrl, imageTransformUrl, s3PublicUrl),
      ),
    },
    201,
  );
});

// Update post (requires auth)
postsApiRoutes.put("/:id", requireAuthApi(), async (c) => {
  const id = sqid.decode(c.req.param("id"));
  if (!id) return c.json({ error: "Invalid ID" }, 400);

  const rawBody = await c.req.json();

  // Validate request body
  const parseResult = UpdatePostSchema.safeParse(rawBody);
  if (!parseResult.success) {
    return c.json(
      { error: "Validation failed", details: parseResult.error.flatten() },
      400,
    );
  }

  const body = parseResult.data;

  // Validate media count if mediaIds is provided
  if (body.mediaIds !== undefined) {
    const mediaError = validateMediaCount(body.mediaIds);
    if (mediaError) {
      return c.json({ error: mediaError }, 400);
    }

    // Verify all media IDs exist
    if (body.mediaIds.length > 0) {
      const existing = await c.var.services.media.getByIds(body.mediaIds);
      if (existing.length !== body.mediaIds.length) {
        return c.json({ error: "One or more media IDs are invalid" }, 400);
      }
    }
  }

  const post = await c.var.services.posts.update(id, {
    format: body.format,
    title: body.title,
    body: body.body,
    path: body.path,
    status: body.status,
    featured: body.featured,
    pinned: body.pinned,
    url: body.url,
    quoteText: body.quoteText,
    rating: body.rating || undefined,
    collectionId: body.collectionId || undefined,
    publishedAt: body.publishedAt,
  });

  if (!post) return c.json({ error: "Not found" }, 404);

  // Update media attachments if provided (including empty array to clear)
  if (body.mediaIds !== undefined) {
    await c.var.services.media.attachToPost(post.id, body.mediaIds);
  }

  const mediaList = await c.var.services.media.getByPostId(post.id);
  const r2PublicUrl = c.env.R2_PUBLIC_URL;
  const imageTransformUrl = c.env.IMAGE_TRANSFORM_URL;
  const s3PublicUrl = c.env.S3_PUBLIC_URL;

  return c.json({
    ...post,
    sqid: sqid.encode(post.id),
    mediaAttachments: mediaList.map((m) =>
      toMediaAttachment(m, r2PublicUrl, imageTransformUrl, s3PublicUrl),
    ),
  });
});

// Delete post (requires auth)
postsApiRoutes.delete("/:id", requireAuthApi(), async (c) => {
  const id = sqid.decode(c.req.param("id"));
  if (!id) return c.json({ error: "Invalid ID" }, 400);

  // Detach media before deleting
  await c.var.services.media.detachFromPost(id);

  const success = await c.var.services.posts.delete(id);
  if (!success) return c.json({ error: "Not found" }, 404);

  return c.json({ success: true });
});
