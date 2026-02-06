/**
 * Dashboard Posts Routes
 */

import { Hono } from "hono";
import { z } from "zod";
import { useLingui } from "../../i18n/index.js";
import type { Bindings, Post } from "../../types.js";
import type { AppVariables } from "../../app.js";
import { DashLayout } from "../../theme/layouts/index.js";
import { PostForm, PostList, CrudPageHeader, ActionButtons } from "../../theme/components/index.js";
import * as sqid from "../../lib/sqid.js";
import {
  PostTypeSchema,
  VisibilitySchema,
  parseFormData,
  parseFormDataOptional,
} from "../../lib/schemas.js";

type Env = { Bindings: Bindings; Variables: AppVariables };

export const postsRoutes = new Hono<Env>();

function PostsListContent({ posts }: { posts: Post[] }) {
  const { t } = useLingui();
  return (
    <>
      <CrudPageHeader
        title={t({ message: "Posts", comment: "@context: Dashboard heading" })}
        ctaLabel={t({ message: "New Post", comment: "@context: Button to create new post" })}
        ctaHref="/dash/posts/new"
      />
      <PostList posts={posts} />
    </>
  );
}

function NewPostContent() {
  const { t } = useLingui();
  return (
    <>
      <h1 class="text-2xl font-semibold mb-6">
        {t({ message: "New Post", comment: "@context: Page heading" })}
      </h1>
      <PostForm action="/dash/posts" />
    </>
  );
}

// List posts
postsRoutes.get("/", async (c) => {
  const posts = await c.var.services.posts.list({
    visibility: ["featured", "quiet", "unlisted", "draft"],
  });
  const siteName = (await c.var.services.settings.get("SITE_NAME")) ?? "Jant";

  return c.html(
    <DashLayout c={c} title="Posts" siteName={siteName} currentPath="/dash/posts">
      <PostsListContent posts={posts} />
    </DashLayout>
  );
});

// New post form
postsRoutes.get("/new", async (c) => {
  const siteName = (await c.var.services.settings.get("SITE_NAME")) ?? "Jant";

  return c.html(
    <DashLayout c={c} title="New Post" siteName={siteName} currentPath="/dash/posts">
      <NewPostContent />
    </DashLayout>
  );
});

// Create post
postsRoutes.post("/", async (c) => {
  const formData = await c.req.formData();

  // Validate and parse form data
  const type = parseFormData(formData, "type", PostTypeSchema);
  const visibility = parseFormData(formData, "visibility", VisibilitySchema);
  const title = parseFormDataOptional(formData, "title", z.string());
  const content = formData.get("content") as string;
  const sourceUrl = parseFormDataOptional(formData, "sourceUrl", z.string());
  const path = parseFormDataOptional(formData, "path", z.string());

  const post = await c.var.services.posts.create({
    type,
    title,
    content,
    visibility,
    sourceUrl,
    path,
  });

  return c.redirect(`/dash/posts/${sqid.encode(post.id)}`);
});

function ViewPostContent({ post }: { post: Post }) {
  const { t } = useLingui();
  const defaultTitle = t({ message: "Post", comment: "@context: Default post title" });

  return (
    <>
      <div class="flex items-center justify-between mb-6">
        <h1 class="text-2xl font-semibold">{post.title || defaultTitle}</h1>
        <ActionButtons
          editHref={`/dash/posts/${sqid.encode(post.id)}/edit`}
          editLabel={t({ message: "Edit", comment: "@context: Button to edit post" })}
          viewHref={`/p/${sqid.encode(post.id)}`}
          viewLabel={t({ message: "View", comment: "@context: Button to view post" })}
        />
      </div>

      <div class="card">
        <section>
          <div class="prose" dangerouslySetInnerHTML={{ __html: post.contentHtml || "" }} />
        </section>
      </div>
    </>
  );
}

function EditPostContent({ post }: { post: Post }) {
  const { t } = useLingui();
  return (
    <>
      <h1 class="text-2xl font-semibold mb-6">
        {t({ message: "Edit Post", comment: "@context: Page heading" })}
      </h1>
      <PostForm post={post} action={`/dash/posts/${sqid.encode(post.id)}`} />
    </>
  );
}

// View single post
postsRoutes.get("/:id", async (c) => {
  const id = sqid.decode(c.req.param("id"));
  if (!id) return c.notFound();

  const post = await c.var.services.posts.getById(id);
  if (!post) return c.notFound();

  const siteName = (await c.var.services.settings.get("SITE_NAME")) ?? "Jant";
  const pageTitle = post.title || "Post";

  return c.html(
    <DashLayout c={c} title={pageTitle} siteName={siteName} currentPath="/dash/posts">
      <ViewPostContent post={post} />
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
    <DashLayout
      c={c}
      title={`Edit: ${post.title || "Post"}`}
      siteName={siteName}
      currentPath="/dash/posts"
    >
      <EditPostContent post={post} />
    </DashLayout>
  );
});

// Update post
postsRoutes.post("/:id", async (c) => {
  const id = sqid.decode(c.req.param("id"));
  if (!id) return c.notFound();

  const formData = await c.req.formData();

  // Validate and parse form data
  const type = parseFormData(formData, "type", PostTypeSchema);
  const visibility = parseFormData(formData, "visibility", VisibilitySchema);
  const title = parseFormDataOptional(formData, "title", z.string()) || null;
  const content = parseFormDataOptional(formData, "content", z.string()) || null;
  const sourceUrl = parseFormDataOptional(formData, "sourceUrl", z.string()) || null;
  const path = parseFormDataOptional(formData, "path", z.string()) || null;

  await c.var.services.posts.update(id, {
    type,
    title,
    content,
    visibility,
    sourceUrl,
    path,
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
