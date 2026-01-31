/**
 * Dashboard Collections Routes
 */

import { Hono } from "hono";
import type { Bindings } from "../../types.js";
import type { AppVariables } from "../../app.js";
import { DashLayout } from "../../theme/layouts/index.js";
import * as sqid from "../../lib/sqid.js";

type Env = { Bindings: Bindings; Variables: AppVariables };

export const collectionsRoutes = new Hono<Env>();

// List collections
collectionsRoutes.get("/", async (c) => {
  const siteName = (await c.var.services.settings.get("SITE_NAME")) ?? "Jant";
  const collections = await c.var.services.collections.list();

  return c.html(
    <DashLayout title="Collections" siteName={siteName}>
      <div class="flex items-center justify-between mb-6">
        <h1 class="text-2xl font-semibold">Collections</h1>
        <a href="/dash/collections/new" class="btn">
          New Collection
        </a>
      </div>

      {collections.length === 0 ? (
        <p class="text-muted-foreground">No collections yet.</p>
      ) : (
        <div class="flex flex-col divide-y">
          {collections.map((col) => (
            <div key={col.id} class="py-4 flex items-center gap-4">
              <div class="flex-1 min-w-0">
                <a href={`/dash/collections/${col.id}`} class="font-medium hover:underline">
                  {col.title}
                </a>
                <p class="text-sm text-muted-foreground">/{col.slug}</p>
                {col.description && (
                  <p class="text-sm text-muted-foreground mt-1">{col.description}</p>
                )}
              </div>
              <div class="flex items-center gap-2">
                <a href={`/dash/collections/${col.id}/edit`} class="btn-sm-outline">
                  Edit
                </a>
                <a href={`/c/${col.slug}`} class="btn-sm-ghost" target="_blank">
                  View
                </a>
              </div>
            </div>
          ))}
        </div>
      )}
    </DashLayout>
  );
});

// New collection form
collectionsRoutes.get("/new", async (c) => {
  const siteName = (await c.var.services.settings.get("SITE_NAME")) ?? "Jant";

  return c.html(
    <DashLayout title="New Collection" siteName={siteName}>
      <h1 class="text-2xl font-semibold mb-6">New Collection</h1>

      <form method="post" action="/dash/collections" class="flex flex-col gap-4 max-w-lg">
        <div class="field">
          <label class="label">Title</label>
          <input type="text" name="title" class="input" required placeholder="My Collection" />
        </div>

        <div class="field">
          <label class="label">Slug</label>
          <input
            type="text"
            name="slug"
            class="input"
            required
            placeholder="my-collection"
            pattern="[a-z0-9-]+"
          />
          <p class="text-xs text-muted-foreground mt-1">
            URL-safe identifier (lowercase, numbers, hyphens)
          </p>
        </div>

        <div class="field">
          <label class="label">Description (optional)</label>
          <textarea name="description" class="textarea" rows={3} placeholder="What's this collection about?" />
        </div>

        <div class="flex gap-2">
          <button type="submit" class="btn">
            Create Collection
          </button>
          <a href="/dash/collections" class="btn-outline">
            Cancel
          </a>
        </div>
      </form>
    </DashLayout>
  );
});

// Create collection
collectionsRoutes.post("/", async (c) => {
  const formData = await c.req.formData();

  const title = formData.get("title") as string;
  const slug = formData.get("slug") as string;
  const description = formData.get("description") as string;

  const collection = await c.var.services.collections.create({
    title,
    slug,
    description: description || undefined,
  });

  return c.redirect(`/dash/collections/${collection.id}`);
});

// View single collection
collectionsRoutes.get("/:id", async (c) => {
  const id = parseInt(c.req.param("id"), 10);
  if (isNaN(id)) return c.notFound();

  const collection = await c.var.services.collections.getById(id);
  if (!collection) return c.notFound();

  const posts = await c.var.services.collections.getPosts(id);
  const siteName = (await c.var.services.settings.get("SITE_NAME")) ?? "Jant";

  return c.html(
    <DashLayout title={collection.title} siteName={siteName}>
      <div class="flex items-center justify-between mb-6">
        <div>
          <h1 class="text-2xl font-semibold">{collection.title}</h1>
          <p class="text-sm text-muted-foreground">/{collection.slug}</p>
        </div>
        <div class="flex gap-2">
          <a href={`/dash/collections/${id}/edit`} class="btn-outline">
            Edit
          </a>
          <a href={`/c/${collection.slug}`} class="btn-ghost" target="_blank">
            View
          </a>
        </div>
      </div>

      {collection.description && (
        <p class="text-muted-foreground mb-6">{collection.description}</p>
      )}

      <div class="card">
        <header>
          <h2>Posts in Collection ({posts.length})</h2>
        </header>
        <section>
          {posts.length === 0 ? (
            <p class="text-muted-foreground">No posts in this collection.</p>
          ) : (
            <div class="flex flex-col divide-y">
              {posts.map((post) => (
                <div key={post.id} class="py-3 flex items-center gap-4">
                  <div class="flex-1 min-w-0">
                    <a
                      href={`/dash/posts/${sqid.encode(post.id)}`}
                      class="font-medium hover:underline"
                    >
                      {post.title || post.content?.slice(0, 50) || `Post #${post.id}`}
                    </a>
                  </div>
                  <form method="post" action={`/dash/collections/${id}/remove-post`}>
                    <input type="hidden" name="postId" value={post.id} />
                    <button type="submit" class="btn-sm-ghost text-destructive">
                      Remove
                    </button>
                  </form>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      <div class="mt-6">
        <a href="/dash/collections" class="text-sm hover:underline">
          ← Back to Collections
        </a>
      </div>
    </DashLayout>
  );
});

// Edit collection form
collectionsRoutes.get("/:id/edit", async (c) => {
  const id = parseInt(c.req.param("id"), 10);
  if (isNaN(id)) return c.notFound();

  const collection = await c.var.services.collections.getById(id);
  if (!collection) return c.notFound();

  const siteName = (await c.var.services.settings.get("SITE_NAME")) ?? "Jant";

  return c.html(
    <DashLayout title={`Edit: ${collection.title}`} siteName={siteName}>
      <h1 class="text-2xl font-semibold mb-6">Edit Collection</h1>

      <form method="post" action={`/dash/collections/${id}`} class="flex flex-col gap-4 max-w-lg">
        <div class="field">
          <label class="label">Title</label>
          <input type="text" name="title" class="input" required value={collection.title} />
        </div>

        <div class="field">
          <label class="label">Slug</label>
          <input
            type="text"
            name="slug"
            class="input"
            required
            value={collection.slug}
            pattern="[a-z0-9-]+"
          />
        </div>

        <div class="field">
          <label class="label">Description (optional)</label>
          <textarea name="description" class="textarea" rows={3}>
            {collection.description ?? ""}
          </textarea>
        </div>

        <div class="flex gap-2">
          <button type="submit" class="btn">
            Update Collection
          </button>
          <a href={`/dash/collections/${id}`} class="btn-outline">
            Cancel
          </a>
        </div>
      </form>

      <div class="mt-8 pt-8 border-t">
        <h2 class="text-lg font-medium mb-4 text-destructive">Danger Zone</h2>
        <form method="post" action={`/dash/collections/${id}/delete`}>
          <button type="submit" class="btn-outline text-destructive">
            Delete Collection
          </button>
        </form>
      </div>
    </DashLayout>
  );
});

// Update collection
collectionsRoutes.post("/:id", async (c) => {
  const id = parseInt(c.req.param("id"), 10);
  if (isNaN(id)) return c.notFound();

  const formData = await c.req.formData();

  const title = formData.get("title") as string;
  const slug = formData.get("slug") as string;
  const description = formData.get("description") as string;

  await c.var.services.collections.update(id, {
    title,
    slug,
    description: description || undefined,
  });

  return c.redirect(`/dash/collections/${id}`);
});

// Delete collection
collectionsRoutes.post("/:id/delete", async (c) => {
  const id = parseInt(c.req.param("id"), 10);
  if (isNaN(id)) return c.notFound();

  await c.var.services.collections.delete(id);

  return c.redirect("/dash/collections");
});

// Remove post from collection
collectionsRoutes.post("/:id/remove-post", async (c) => {
  const id = parseInt(c.req.param("id"), 10);
  if (isNaN(id)) return c.notFound();

  const formData = await c.req.formData();
  const postId = parseInt(formData.get("postId") as string, 10);

  if (!isNaN(postId)) {
    await c.var.services.collections.removePost(id, postId);
  }

  return c.redirect(`/dash/collections/${id}`);
});
