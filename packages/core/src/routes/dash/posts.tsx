/**
 * Dashboard Posts Routes
 */

import { Hono } from "hono";
import { msg } from "@lingui/core/macro";
import type { Bindings } from "../../types.js";
import type { AppVariables } from "../../app.js";
import { DashLayout } from "../../theme/layouts/index.js";
import { PostForm, PostList } from "../../theme/components/index.js";
import { getI18n } from "../../i18n/index.js";
import * as sqid from "../../lib/sqid.js";

type Env = { Bindings: Bindings; Variables: AppVariables };

export const postsRoutes = new Hono<Env>();

// List posts
postsRoutes.get("/", async (c) => {
  const i18n = getI18n(c);
  const posts = await c.var.services.posts.list({
    visibility: ["featured", "quiet", "unlisted", "draft"],
  });
  const siteName = (await c.var.services.settings.get("SITE_NAME")) ?? "Jant";

  return c.html(
    <DashLayout c={c} title={i18n._(msg({ message: "Posts", comment: "@context: Dashboard page title" }))} siteName={siteName} currentPath="/dash/posts">
      <div class="flex items-center justify-between mb-6">
        <h1 class="text-2xl font-semibold">{i18n._(msg({ message: "Posts", comment: "@context: Dashboard heading" }))}</h1>
        <a href="/dash/posts/new" class="btn">
          {i18n._(msg({ message: "New Post", comment: "@context: Button to create new post" }))}
        </a>
      </div>
      <PostList c={c} posts={posts} />
    </DashLayout>
  );
});

// New post form
postsRoutes.get("/new", async (c) => {
  const i18n = getI18n(c);
  const siteName = (await c.var.services.settings.get("SITE_NAME")) ?? "Jant";

  return c.html(
    <DashLayout c={c} title={i18n._(msg({ message: "New Post", comment: "@context: Page title" }))} siteName={siteName} currentPath="/dash/posts">
      <h1 class="text-2xl font-semibold mb-6">{i18n._(msg({ message: "New Post", comment: "@context: Page heading" }))}</h1>
      <PostForm c={c} action="/dash/posts" />
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
  const i18n = getI18n(c);
  const id = sqid.decode(c.req.param("id"));
  if (!id) return c.notFound();

  const post = await c.var.services.posts.getById(id);
  if (!post) return c.notFound();

  const siteName = (await c.var.services.settings.get("SITE_NAME")) ?? "Jant";
  const defaultTitle = i18n._(msg({ message: "Post", comment: "@context: Default post title" }));
  const pageTitle = post.title || defaultTitle;

  return c.html(
    <DashLayout c={c} title={pageTitle} siteName={siteName} currentPath="/dash/posts">
      <div class="flex items-center justify-between mb-6">
        <h1 class="text-2xl font-semibold">{post.title || defaultTitle}</h1>
        <div class="flex gap-2">
          <a href={`/dash/posts/${sqid.encode(post.id)}/edit`} class="btn-outline">
            {i18n._(msg({ message: "Edit", comment: "@context: Button to edit post" }))}
          </a>
          <a href={`/p/${sqid.encode(post.id)}`} class="btn-ghost" target="_blank">
            {i18n._(msg({ message: "View", comment: "@context: Button to view post" }))}
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
  const i18n = getI18n(c);
  const id = sqid.decode(c.req.param("id"));
  if (!id) return c.notFound();

  const post = await c.var.services.posts.getById(id);
  if (!post) return c.notFound();

  const siteName = (await c.var.services.settings.get("SITE_NAME")) ?? "Jant";
  const defaultTitle = i18n._(msg({ message: "Post", comment: "@context: Default post title" }));
  const editTitle = i18n._(msg({ message: "Edit: {title}", comment: "@context: Page title for editing post" }) as any, { title: post.title || defaultTitle });

  return c.html(
    <DashLayout c={c} title={editTitle} siteName={siteName} currentPath="/dash/posts">
      <h1 class="text-2xl font-semibold mb-6">{i18n._(msg({ message: "Edit Post", comment: "@context: Page heading" }))}</h1>
      <PostForm c={c} post={post} action={`/dash/posts/${sqid.encode(post.id)}`} />
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
