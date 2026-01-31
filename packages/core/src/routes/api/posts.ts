/**
 * Posts API Routes
 */

import { Hono } from "hono";
import type { Bindings, PostType, Visibility } from "../../types.js";
import type { AppVariables } from "../../app.js";
import * as sqid from "../../lib/sqid.js";

type Env = { Bindings: Bindings; Variables: AppVariables };

export const postsApiRoutes = new Hono<Env>();

// List posts
postsApiRoutes.get("/", async (c) => {
  const type = c.req.query("type") as PostType | undefined;
  const visibility = c.req.query("visibility") as Visibility | undefined;
  const cursor = c.req.query("cursor");
  const limit = parseInt(c.req.query("limit") ?? "100", 10);

  const posts = await c.var.services.posts.list({
    type,
    visibility: visibility ? [visibility] : ["featured", "quiet"],
    cursor: cursor ? sqid.decode(cursor) ?? undefined : undefined,
    limit,
  });

  return c.json({
    posts: posts.map((p) => ({
      ...p,
      sqid: sqid.encode(p.id),
    })),
    nextCursor: posts.length === limit ? sqid.encode(posts[posts.length - 1]!.id) : null,
  });
});

// Get single post
postsApiRoutes.get("/:id", async (c) => {
  const id = sqid.decode(c.req.param("id"));
  if (!id) return c.json({ error: "Invalid ID" }, 400);

  const post = await c.var.services.posts.getById(id);
  if (!post) return c.json({ error: "Not found" }, 404);

  return c.json({ ...post, sqid: sqid.encode(post.id) });
});

// Create post (requires auth)
postsApiRoutes.post("/", async (c) => {
  // TODO: Add auth check

  const body = await c.req.json();

  const post = await c.var.services.posts.create({
    type: body.type,
    title: body.title,
    content: body.content,
    visibility: body.visibility,
    sourceUrl: body.sourceUrl,
    sourceName: body.sourceName,
    path: body.path,
    replyToId: body.replyToId ? sqid.decode(body.replyToId) ?? undefined : undefined,
    publishedAt: body.publishedAt,
  });

  return c.json({ ...post, sqid: sqid.encode(post.id) }, 201);
});

// Update post (requires auth)
postsApiRoutes.put("/:id", async (c) => {
  // TODO: Add auth check

  const id = sqid.decode(c.req.param("id"));
  if (!id) return c.json({ error: "Invalid ID" }, 400);

  const body = await c.req.json();

  const post = await c.var.services.posts.update(id, {
    type: body.type,
    title: body.title,
    content: body.content,
    visibility: body.visibility,
    sourceUrl: body.sourceUrl,
    sourceName: body.sourceName,
    path: body.path,
    publishedAt: body.publishedAt,
  });

  if (!post) return c.json({ error: "Not found" }, 404);

  return c.json({ ...post, sqid: sqid.encode(post.id) });
});

// Delete post (requires auth)
postsApiRoutes.delete("/:id", async (c) => {
  // TODO: Add auth check

  const id = sqid.decode(c.req.param("id"));
  if (!id) return c.json({ error: "Invalid ID" }, 400);

  const success = await c.var.services.posts.delete(id);
  if (!success) return c.json({ error: "Not found" }, 404);

  return c.json({ success: true });
});
