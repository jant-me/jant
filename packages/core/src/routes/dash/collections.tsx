/**
 * Dashboard Collections Routes
 */

import { Hono } from "hono";
import { useLingui } from "../../i18n/index.js";
import type { Bindings, Collection, Post } from "../../types.js";
import type { AppVariables } from "../../app.js";
import { DashLayout } from "../../theme/layouts/index.js";
import {
  EmptyState,
  ListItemRow,
  ActionButtons,
  CrudPageHeader,
  DangerZone,
} from "../../theme/components/index.js";
import * as sqid from "../../lib/sqid.js";

type Env = { Bindings: Bindings; Variables: AppVariables };

export const collectionsRoutes = new Hono<Env>();

function CollectionsListContent({
  collections,
}: {
  collections: Collection[];
}) {
  const { t } = useLingui();

  return (
    <>
      <CrudPageHeader
        title={t({
          message: "Collections",
          comment: "@context: Dashboard heading",
        })}
        ctaLabel={t({
          message: "New Collection",
          comment: "@context: Button to create new collection",
        })}
        ctaHref="/dash/collections/new"
      />

      {collections.length === 0 ? (
        <EmptyState
          message={t({
            message: "No collections yet.",
            comment: "@context: Empty state message",
          })}
          ctaText={t({
            message: "New Collection",
            comment: "@context: Button to create new collection",
          })}
          ctaHref="/dash/collections/new"
        />
      ) : (
        <div class="flex flex-col divide-y">
          {collections.map((col) => (
            <ListItemRow
              key={col.id}
              actions={
                <ActionButtons
                  editHref={`/dash/collections/${col.id}/edit`}
                  editLabel={t({
                    message: "Edit",
                    comment: "@context: Button to edit collection",
                  })}
                  viewHref={`/c/${col.path}`}
                  viewLabel={t({
                    message: "View",
                    comment: "@context: Button to view collection",
                  })}
                />
              }
            >
              <a
                href={`/dash/collections/${col.id}`}
                class="font-medium hover:underline"
              >
                {col.title}
              </a>
              <p class="text-sm text-muted-foreground">/{col.path}</p>
              {col.description && (
                <p class="text-sm text-muted-foreground mt-1">
                  {col.description}
                </p>
              )}
            </ListItemRow>
          ))}
        </div>
      )}
    </>
  );
}

function NewCollectionContent() {
  const { t } = useLingui();
  return (
    <>
      <h1 class="text-2xl font-semibold mb-6">
        {t({ message: "New Collection", comment: "@context: Page heading" })}
      </h1>

      <form
        method="post"
        action="/dash/collections"
        class="flex flex-col gap-4 max-w-lg"
      >
        <div class="field">
          <label class="label">
            {t({
              message: "Title",
              comment: "@context: Collection form field",
            })}
          </label>
          <input
            type="text"
            name="title"
            class="input"
            required
            placeholder={t({
              message: "My Collection",
              comment: "@context: Collection title placeholder",
            })}
          />
        </div>

        <div class="field">
          <label class="label">
            {t({ message: "Slug", comment: "@context: Collection form field" })}
          </label>
          <input
            type="text"
            name="path"
            class="input"
            required
            placeholder="my-collection"
            pattern="[a-z0-9-]+"
          />
          <p class="text-xs text-muted-foreground mt-1">
            {t({
              message: "URL-safe identifier (lowercase, numbers, hyphens)",
              comment: "@context: Collection path help text",
            })}
          </p>
        </div>

        <div class="field">
          <label class="label">
            {t({
              message: "Description (optional)",
              comment: "@context: Collection form field",
            })}
          </label>
          <textarea
            name="description"
            class="textarea"
            rows={3}
            placeholder={t({
              message: "What's this collection about?",
              comment: "@context: Collection description placeholder",
            })}
          />
        </div>

        <div class="flex gap-2">
          <button type="submit" class="btn">
            {t({
              message: "Create Collection",
              comment: "@context: Button to save new collection",
            })}
          </button>
          <a href="/dash/collections" class="btn-outline">
            {t({
              message: "Cancel",
              comment: "@context: Button to cancel form",
            })}
          </a>
        </div>
      </form>
    </>
  );
}

function ViewCollectionContent({
  collection,
  posts,
}: {
  collection: Collection;
  posts: Post[];
}) {
  const { t } = useLingui();
  const postsHeader = t({
    message: "Posts in Collection ({count})",
    comment: "@context: Collection posts section heading",
    values: { count: String(posts.length) },
  });

  return (
    <>
      <div class="flex items-center justify-between mb-6">
        <div>
          <h1 class="text-2xl font-semibold">{collection.title}</h1>
          <p class="text-sm text-muted-foreground">/{collection.path}</p>
        </div>
        <ActionButtons
          editHref={`/dash/collections/${collection.id}/edit`}
          editLabel={t({
            message: "Edit",
            comment: "@context: Button to edit collection",
          })}
          viewHref={`/c/${collection.path}`}
          viewLabel={t({
            message: "View",
            comment: "@context: Button to view collection",
          })}
        />
      </div>

      {collection.description && (
        <p class="text-muted-foreground mb-6">{collection.description}</p>
      )}

      <div class="card">
        <header>
          <h2>{postsHeader}</h2>
        </header>
        <section>
          {posts.length === 0 ? (
            <p class="text-muted-foreground">
              {t({
                message: "No posts in this collection.",
                comment: "@context: Empty state message",
              })}
            </p>
          ) : (
            <div class="flex flex-col divide-y">
              {posts.map((post) => (
                <div key={post.id} class="py-3 flex items-center gap-4">
                  <div class="flex-1 min-w-0">
                    <a
                      href={`/dash/posts/${sqid.encode(post.id)}`}
                      class="font-medium hover:underline"
                    >
                      {post.title ||
                        post.content?.slice(0, 50) ||
                        `Post #${post.id}`}
                    </a>
                  </div>
                  <form
                    method="post"
                    action={`/dash/collections/${collection.id}/remove-post`}
                  >
                    <input type="hidden" name="postId" value={post.id} />
                    <button type="submit" class="btn-sm-ghost text-destructive">
                      {t({
                        message: "Remove",
                        comment:
                          "@context: Button to remove post from collection",
                      })}
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
          {t({
            message: "← Back to Collections",
            comment: "@context: Navigation link",
          })}
        </a>
      </div>
    </>
  );
}

function EditCollectionContent({ collection }: { collection: Collection }) {
  const { t } = useLingui();

  return (
    <>
      <h1 class="text-2xl font-semibold mb-6">
        {t({ message: "Edit Collection", comment: "@context: Page heading" })}
      </h1>

      <form
        method="post"
        action={`/dash/collections/${collection.id}`}
        class="flex flex-col gap-4 max-w-lg"
      >
        <div class="field">
          <label class="label">
            {t({
              message: "Title",
              comment: "@context: Collection form field",
            })}
          </label>
          <input
            type="text"
            name="title"
            class="input"
            required
            value={collection.title}
          />
        </div>

        <div class="field">
          <label class="label">
            {t({ message: "Slug", comment: "@context: Collection form field" })}
          </label>
          <input
            type="text"
            name="path"
            class="input"
            required
            value={collection.path ?? ""}
            pattern="[a-z0-9-]+"
          />
        </div>

        <div class="field">
          <label class="label">
            {t({
              message: "Description (optional)",
              comment: "@context: Collection form field",
            })}
          </label>
          <textarea name="description" class="textarea" rows={3}>
            {collection.description ?? ""}
          </textarea>
        </div>

        <div class="flex gap-2">
          <button type="submit" class="btn">
            {t({
              message: "Update Collection",
              comment: "@context: Button to save collection changes",
            })}
          </button>
          <a href={`/dash/collections/${collection.id}`} class="btn-outline">
            {t({
              message: "Cancel",
              comment: "@context: Button to cancel form",
            })}
          </a>
        </div>
      </form>

      <DangerZone
        actionLabel={t({
          message: "Delete Collection",
          comment: "@context: Button to delete collection",
        })}
        formAction={`/dash/collections/${collection.id}/delete`}
        confirmMessage="Are you sure you want to delete this collection?"
      />
    </>
  );
}

// List collections
collectionsRoutes.get("/", async (c) => {
  const siteName = (await c.var.services.settings.get("SITE_NAME")) ?? "Jant";
  const collections = await c.var.services.collections.list();

  return c.html(
    <DashLayout
      c={c}
      title="Collections"
      siteName={siteName}
      currentPath="/dash/collections"
    >
      <CollectionsListContent collections={collections} />
    </DashLayout>,
  );
});

// New collection form
collectionsRoutes.get("/new", async (c) => {
  const siteName = (await c.var.services.settings.get("SITE_NAME")) ?? "Jant";

  return c.html(
    <DashLayout
      c={c}
      title="New Collection"
      siteName={siteName}
      currentPath="/dash/collections"
    >
      <NewCollectionContent />
    </DashLayout>,
  );
});

// Create collection
collectionsRoutes.post("/", async (c) => {
  const formData = await c.req.formData();

  const title = formData.get("title") as string;
  const path = formData.get("path") as string;
  const description = formData.get("description") as string;

  const collection = await c.var.services.collections.create({
    title,
    path,
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
    <DashLayout
      c={c}
      title={collection.title}
      siteName={siteName}
      currentPath="/dash/collections"
    >
      <ViewCollectionContent collection={collection} posts={posts} />
    </DashLayout>,
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
    <DashLayout
      c={c}
      title={`Edit: ${collection.title}`}
      siteName={siteName}
      currentPath="/dash/collections"
    >
      <EditCollectionContent collection={collection} />
    </DashLayout>,
  );
});

// Update collection
collectionsRoutes.post("/:id", async (c) => {
  const id = parseInt(c.req.param("id"), 10);
  if (isNaN(id)) return c.notFound();

  const formData = await c.req.formData();

  const title = formData.get("title") as string;
  const path = formData.get("path") as string;
  const description = formData.get("description") as string;

  await c.var.services.collections.update(id, {
    title,
    path,
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
