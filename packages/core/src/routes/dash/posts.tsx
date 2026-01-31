/**
 * Dashboard Posts Routes
 */

import { Hono } from "hono";
import type { Bindings } from "../../types.js";
import type { AppVariables } from "../../app.js";
import { DashLayout } from "../../theme/layouts/index.js";
import { PostForm, PostList } from "../../theme/components/index.js";
import * as sqid from "../../lib/sqid.js";

type Env = { Bindings: Bindings; Variables: AppVariables };

export const postsRoutes = new Hono<Env>();

// List posts
postsRoutes.get("/", async (c) => {
  const posts = await c.var.services.posts.list({
    visibility: ["featured", "quiet", "unlisted", "draft"],
  });
  const siteName = (await c.var.services.settings.get("SITE_NAME")) ?? "Jant";

  return c.html(
    <DashLayout title="Posts" siteName={siteName}>
      <div class="flex items-center justify-between mb-6">
        <h1 class="text-2xl font-semibold">Posts</h1>
        <a href="/dash/posts/new" class="btn">
          New Post
        </a>
      </div>
      <PostList posts={posts} />
    </DashLayout>
  );
});

// New post form
postsRoutes.get("/new", async (c) => {
  const siteName = (await c.var.services.settings.get("SITE_NAME")) ?? "Jant";

  return c.html(
    <DashLayout title="New Post" siteName={siteName}>
      <h1 class="text-2xl font-semibold mb-6">New Post</h1>
      <PostForm action="/dash/posts" />
    </DashLayout>
  );
});

// Create post
postsRoutes.post("/", async (c) => {
  const formData = await c.req.formData();

  const type = formData.get("type") as string;
  const title = formData.get("title") as string;
  const content = formData.get("content") as string;
  const visibility = formData.get("visibility") as string;
  const sourceUrl = formData.get("sourceUrl") as string;
  const path = formData.get("path") as string;

  const post = await c.var.services.posts.create({
    type: type as any,
    title: title || undefined,
    content,
    visibility: visibility as any,
    sourceUrl: sourceUrl || undefined,
    path: path || undefined,
  });

  return c.redirect(`/dash/posts/${sqid.encode(post.id)}`);
});

// View single post
postsRoutes.get("/:id", async (c) => {
  const id = sqid.decode(c.req.param("id"));
  if (!id) return c.notFound();

  const post = await c.var.services.posts.getById(id);
  if (!post) return c.notFound();

  const siteName = (await c.var.services.settings.get("SITE_NAME")) ?? "Jant";

  return c.html(
    <DashLayout title={post.title || "Post"} siteName={siteName}>
      <div class="flex items-center justify-between mb-6">
        <h1 class="text-2xl font-semibold">{post.title || "Post"}</h1>
        <div class="flex gap-2">
          <a href={`/dash/posts/${sqid.encode(post.id)}/edit`} class="btn-outline">
            Edit
          </a>
          <a href={`/p/${sqid.encode(post.id)}`} class="btn-ghost" target="_blank">
            View
          </a>
        </div>
      </div>

      <div class="card">
        <section>
          <div class="prose" dangerouslySetInnerHTML={{ __html: post.contentHtml || "" }} />
        </section>
      </div>
    </DashLayout>
  );
});

// Edit post form
postsRoutes.get("/:id/edit", async (c) => {
  const id = sqid.decode(c.req.param("id"));
  if (!id) return c.notFound();

  const post = await c.var.services.posts.getById(id);
  if (!post) return c.notFound();

  const siteName = (await c.var.services.settings.get("SITE_NAME")) ?? "Jant";

  return c.html(
    <DashLayout title={`Edit: ${post.title || "Post"}`} siteName={siteName}>
      <h1 class="text-2xl font-semibold mb-6">Edit Post</h1>
      <PostForm post={post} action={`/dash/posts/${sqid.encode(post.id)}`} />
    </DashLayout>
  );
});

// Update post
postsRoutes.post("/:id", async (c) => {
  const id = sqid.decode(c.req.param("id"));
  if (!id) return c.notFound();

  const formData = await c.req.formData();

  const type = formData.get("type") as string;
  const title = formData.get("title") as string;
  const content = formData.get("content") as string;
  const visibility = formData.get("visibility") as string;
  const sourceUrl = formData.get("sourceUrl") as string;
  const path = formData.get("path") as string;

  await c.var.services.posts.update(id, {
    type: type as any,
    title: title || null,
    content: content || null,
    visibility: visibility as any,
    sourceUrl: sourceUrl || null,
    path: path || null,
  });

  return c.redirect(`/dash/posts/${sqid.encode(id)}`);
});

// Delete post
postsRoutes.post("/:id/delete", async (c) => {
  const id = sqid.decode(c.req.param("id"));
  if (!id) return c.notFound();

  await c.var.services.posts.delete(id);

  return c.redirect("/dash/posts");
});
