/**
 * Dashboard Pages Routes
 *
 * Management for custom pages (posts with type="page")
 */

import { Hono } from "hono";
import { useLingui } from "../../i18n/index.js";
import type { Bindings, Post } from "../../types.js";
import type { AppVariables } from "../../app.js";
import { DashLayout } from "../../theme/layouts/index.js";
import {
  PageForm,
  VisibilityBadge,
  EmptyState,
  ListItemRow,
  ActionButtons,
  CrudPageHeader,
  DangerZone,
} from "../../theme/components/index.js";
import * as sqid from "../../lib/sqid.js";
import * as time from "../../lib/time.js";
import { VisibilitySchema, parseFormData } from "../../lib/schemas.js";

type Env = { Bindings: Bindings; Variables: AppVariables };

export const pagesRoutes = new Hono<Env>();

function PagesListContent({ pages }: { pages: Post[] }) {
  const { t } = useLingui();

  return (
    <>
      <CrudPageHeader
        title={t({ message: "Pages", comment: "@context: Pages main heading" })}
        ctaLabel={t({
          message: "New Page",
          comment: "@context: Button to create new page",
        })}
        ctaHref="/dash/pages/new"
      />

      {pages.length === 0 ? (
        <EmptyState
          message={t({
            message: "No pages yet.",
            comment: "@context: Empty state message when no pages exist",
          })}
          ctaText={t({
            message: "Create your first page",
            comment: "@context: Button in empty state to create first page",
          })}
          ctaHref="/dash/pages/new"
        />
      ) : (
        <div class="flex flex-col divide-y">
          {pages.map((page) => (
            <ListItemRow
              key={page.id}
              actions={
                <ActionButtons
                  editHref={`/dash/pages/${sqid.encode(page.id)}/edit`}
                  editLabel={t({
                    message: "Edit",
                    comment: "@context: Button to edit page",
                  })}
                  viewHref={
                    page.visibility !== "draft" && page.path
                      ? `/${page.path}`
                      : undefined
                  }
                  viewLabel={t({
                    message: "View",
                    comment: "@context: Button to view page on public site",
                  })}
                />
              }
            >
              <div class="flex items-center gap-2 mb-1">
                <VisibilityBadge visibility={page.visibility} />
                <span class="text-xs text-muted-foreground">
                  {time.formatDate(page.updatedAt)}
                </span>
              </div>
              <a
                href={`/dash/pages/${sqid.encode(page.id)}`}
                class="font-medium hover:underline"
              >
                {page.title ||
                  t({
                    message: "Untitled",
                    comment: "@context: Default title for untitled page",
                  })}
              </a>
              <p class="text-sm text-muted-foreground mt-1">/{page.path}</p>
            </ListItemRow>
          ))}
        </div>
      )}
    </>
  );
}

function NewPageContent() {
  const { t } = useLingui();
  return (
    <>
      <h1 class="text-2xl font-semibold mb-6">
        {t({ message: "New Page", comment: "@context: New page main heading" })}
      </h1>
      <PageForm action="/dash/pages" />
    </>
  );
}

function ViewPageContent({ page }: { page: Post }) {
  const { t } = useLingui();
  return (
    <>
      <div class="flex items-center justify-between mb-6">
        <div>
          <h1 class="text-2xl font-semibold">
            {page.title ||
              t({
                message: "Page",
                comment: "@context: Default page heading when untitled",
              })}
          </h1>
          {page.path && <p class="text-muted-foreground mt-1">/{page.path}</p>}
        </div>
        <ActionButtons
          editHref={`/dash/pages/${sqid.encode(page.id)}/edit`}
          editLabel={t({
            message: "Edit",
            comment: "@context: Button to edit page",
          })}
          viewHref={
            page.visibility !== "draft" && page.path
              ? `/${page.path}`
              : undefined
          }
          viewLabel={t({
            message: "View",
            comment: "@context: Button to view page on public site",
          })}
        />
      </div>

      <div class="card">
        <section>
          <div
            class="prose"
            dangerouslySetInnerHTML={{ __html: page.contentHtml || "" }}
          />
        </section>
      </div>

      <DangerZone
        actionLabel={t({
          message: "Delete Page",
          comment: "@context: Button to delete page",
        })}
        formAction={`/dash/pages/${sqid.encode(page.id)}/delete`}
        confirmMessage="Are you sure you want to delete this page?"
      />
    </>
  );
}

function EditPageContent({ page }: { page: Post }) {
  const { t } = useLingui();
  return (
    <>
      <h1 class="text-2xl font-semibold mb-6">
        {t({
          message: "Edit Page",
          comment: "@context: Edit page main heading",
        })}
      </h1>
      <PageForm page={page} action={`/dash/pages/${sqid.encode(page.id)}`} />
    </>
  );
}

// List pages
pagesRoutes.get("/", async (c) => {
  const pages = await c.var.services.posts.list({
    type: "page",
    visibility: ["unlisted", "draft"],
    limit: 100,
  });
  const siteName = (await c.var.services.settings.get("SITE_NAME")) ?? "Jant";

  return c.html(
    <DashLayout
      c={c}
      title="Pages"
      siteName={siteName}
      currentPath="/dash/pages"
    >
      <PagesListContent pages={pages} />
    </DashLayout>,
  );
});

// New page form
pagesRoutes.get("/new", async (c) => {
  const siteName = (await c.var.services.settings.get("SITE_NAME")) ?? "Jant";

  return c.html(
    <DashLayout
      c={c}
      title="New Page"
      siteName={siteName}
      currentPath="/dash/pages"
    >
      <NewPageContent />
    </DashLayout>,
  );
});

// Create page
pagesRoutes.post("/", async (c) => {
  const formData = await c.req.formData();

  const title = formData.get("title") as string;
  const content = formData.get("content") as string;
  const visibility = parseFormData(formData, "visibility", VisibilitySchema);
  const path = formData.get("path") as string;

  const page = await c.var.services.posts.create({
    type: "page",
    title,
    content,
    visibility,
    path: path.toLowerCase().replace(/[^a-z0-9-]/g, "-"),
  });

  return c.redirect(`/dash/pages/${sqid.encode(page.id)}`);
});

// View single page
pagesRoutes.get("/:id", async (c) => {
  const id = sqid.decode(c.req.param("id"));
  if (!id) return c.notFound();

  const page = await c.var.services.posts.getById(id);
  if (!page || page.type !== "page") return c.notFound();

  const siteName = (await c.var.services.settings.get("SITE_NAME")) ?? "Jant";

  return c.html(
    <DashLayout
      c={c}
      title={page.title || "Page"}
      siteName={siteName}
      currentPath="/dash/pages"
    >
      <ViewPageContent page={page} />
    </DashLayout>,
  );
});

// Edit page form
pagesRoutes.get("/:id/edit", async (c) => {
  const id = sqid.decode(c.req.param("id"));
  if (!id) return c.notFound();

  const page = await c.var.services.posts.getById(id);
  if (!page || page.type !== "page") return c.notFound();

  const siteName = (await c.var.services.settings.get("SITE_NAME")) ?? "Jant";

  return c.html(
    <DashLayout
      c={c}
      title={`Edit: ${page.title || "Page"}`}
      siteName={siteName}
      currentPath="/dash/pages"
    >
      <EditPageContent page={page} />
    </DashLayout>,
  );
});

// Update page
pagesRoutes.post("/:id", async (c) => {
  const id = sqid.decode(c.req.param("id"));
  if (!id) return c.notFound();

  const formData = await c.req.formData();

  const title = formData.get("title") as string;
  const content = formData.get("content") as string;
  const visibility = parseFormData(formData, "visibility", VisibilitySchema);
  const path = formData.get("path") as string;

  await c.var.services.posts.update(id, {
    type: "page",
    title,
    content,
    visibility,
    path: path.toLowerCase().replace(/[^a-z0-9-]/g, "-"),
  });

  return c.redirect(`/dash/pages/${sqid.encode(id)}`);
});

// Delete page
pagesRoutes.post("/:id/delete", async (c) => {
  const id = sqid.decode(c.req.param("id"));
  if (!id) return c.notFound();

  await c.var.services.posts.delete(id);

  return c.redirect("/dash/pages");
});
