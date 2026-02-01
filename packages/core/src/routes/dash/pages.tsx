/**
 * Dashboard Pages Routes
 *
 * Management for custom pages (posts with type="page")
 */

import { Hono } from "hono";
import { useLingui } from "../../i18n/index.js";
import type { Bindings } from "../../types.js";
import type { AppVariables } from "../../app.js";
import { DashLayout } from "../../theme/layouts/index.js";
import { PageForm } from "../../theme/components/index.js";
import * as sqid from "../../lib/sqid.js";
import * as time from "../../lib/time.js";

type Env = { Bindings: Bindings; Variables: AppVariables };

export const pagesRoutes = new Hono<Env>();

function PagesListContent({ pages }: { pages: any[] }) {
  const { t } = useLingui();

  return (
    <>
      <div class="flex items-center justify-between mb-6">
        <h1 class="text-2xl font-semibold">
          {t({ message: "Pages", comment: "@context: Pages main heading" })}
        </h1>
        <a href="/dash/pages/new" class="btn">
          {t({ message: "New Page", comment: "@context: Button to create new page" })}
        </a>
      </div>

      {pages.length === 0 ? (
        <div class="text-center py-12 text-muted-foreground">
          <p>{t({ message: "No pages yet.", comment: "@context: Empty state message when no pages exist" })}</p>
          <a href="/dash/pages/new" class="btn mt-4">
            {t({ message: "Create your first page", comment: "@context: Button in empty state to create first page" })}
          </a>
        </div>
      ) : (
        <div class="flex flex-col divide-y">
          {pages.map((page) => (
            <div key={page.id} class="py-4 flex items-start gap-4">
              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2 mb-1">
                  <span
                    class={
                      page.visibility === "draft" ? "badge-outline" : "badge-secondary"
                    }
                  >
                    {page.visibility === "draft"
                      ? t({ message: "Draft", comment: "@context: Page status badge - draft" })
                      : t({ message: "Published", comment: "@context: Page status badge - published" })}
                  </span>
                  <span class="text-xs text-muted-foreground">
                    {time.formatDate(page.updatedAt)}
                  </span>
                </div>
                <a
                  href={`/dash/pages/${sqid.encode(page.id)}`}
                  class="font-medium hover:underline"
                >
                  {page.title || t({ message: "Untitled", comment: "@context: Default title for untitled page" })}
                </a>
                <p class="text-sm text-muted-foreground mt-1">
                  /{page.path}
                </p>
              </div>
              <div class="flex items-center gap-2">
                <a
                  href={`/dash/pages/${sqid.encode(page.id)}/edit`}
                  class="btn-sm-outline"
                >
                  {t({ message: "Edit", comment: "@context: Button to edit page" })}
                </a>
                {page.visibility !== "draft" && page.path && (
                  <a href={`/${page.path}`} class="btn-sm-ghost" target="_blank">
                    {t({ message: "View", comment: "@context: Button to view page on public site" })}
                  </a>
                )}
              </div>
            </div>
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

function ViewPageContent({ page }: { page: any }) {
  const { t } = useLingui();
  return (
    <>
      <div class="flex items-center justify-between mb-6">
        <div>
          <h1 class="text-2xl font-semibold">{page.title || t({ message: "Page", comment: "@context: Default page heading when untitled" })}</h1>
          {page.path && (
            <p class="text-muted-foreground mt-1">/{page.path}</p>
          )}
        </div>
        <div class="flex gap-2">
          <a href={`/dash/pages/${sqid.encode(page.id)}/edit`} class="btn-outline">
            {t({ message: "Edit", comment: "@context: Button to edit page" })}
          </a>
          {page.visibility !== "draft" && page.path && (
            <a href={`/${page.path}`} class="btn-ghost" target="_blank">
              {t({ message: "View", comment: "@context: Button to view page on public site" })}
            </a>
          )}
        </div>
      </div>

      <div class="card">
        <section>
          <div class="prose" dangerouslySetInnerHTML={{ __html: page.contentHtml || "" }} />
        </section>
      </div>

      {/* Delete form */}
      <div class="mt-8 pt-8 border-t">
        <h2 class="text-lg font-medium text-destructive mb-4">
          {t({ message: "Danger Zone", comment: "@context: Section heading for dangerous/destructive actions" })}
        </h2>
        <form method="post" action={`/dash/pages/${sqid.encode(page.id)}/delete`}>
          <button
            type="submit"
            class="btn-destructive"
            onclick="return confirm('Are you sure you want to delete this page?')"
          >
            {t({ message: "Delete Page", comment: "@context: Button to delete page" })}
          </button>
        </form>
      </div>
    </>
  );
}

function EditPageContent({ page }: { page: any }) {
  const { t } = useLingui();
  return (
    <>
      <h1 class="text-2xl font-semibold mb-6">
        {t({ message: "Edit Page", comment: "@context: Edit page main heading" })}
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
    <DashLayout c={c} title="Pages" siteName={siteName} currentPath="/dash/pages">
      <PagesListContent pages={pages} />
    </DashLayout>
  );
});

// New page form
pagesRoutes.get("/new", async (c) => {
  const siteName = (await c.var.services.settings.get("SITE_NAME")) ?? "Jant";

  return c.html(
    <DashLayout c={c} title="New Page" siteName={siteName} currentPath="/dash/pages">
      <NewPageContent />
    </DashLayout>
  );
});

// Create page
pagesRoutes.post("/", async (c) => {
  const formData = await c.req.formData();

  const title = formData.get("title") as string;
  const content = formData.get("content") as string;
  const visibility = formData.get("visibility") as string;
  const path = formData.get("path") as string;

  const page = await c.var.services.posts.create({
    type: "page",
    title,
    content,
    visibility: visibility as any,
    path: path.toLowerCase().replace(/[^a-z0-9\-]/g, "-"),
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
    <DashLayout c={c} title={page.title || "Page"} siteName={siteName} currentPath="/dash/pages">
      <ViewPageContent page={page} />
    </DashLayout>
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
    <DashLayout c={c} title={`Edit: ${page.title || "Page"}`} siteName={siteName} currentPath="/dash/pages">
      <EditPageContent page={page} />
    </DashLayout>
  );
});

// Update page
pagesRoutes.post("/:id", async (c) => {
  const id = sqid.decode(c.req.param("id"));
  if (!id) return c.notFound();

  const formData = await c.req.formData();

  const title = formData.get("title") as string;
  const content = formData.get("content") as string;
  const visibility = formData.get("visibility") as string;
  const path = formData.get("path") as string;

  await c.var.services.posts.update(id, {
    type: "page",
    title,
    content,
    visibility: visibility as any,
    path: path.toLowerCase().replace(/[^a-z0-9\-]/g, "-"),
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
