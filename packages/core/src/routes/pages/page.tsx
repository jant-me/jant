/**
 * Custom Page Route
 *
 * Catch-all route for custom pages accessible via their path field
 */

import { Hono } from "hono";
import { useLingui } from "../../i18n/index.js";
import type { Bindings, Post } from "../../types.js";
import type { AppVariables } from "../../app.js";
import { BaseLayout } from "../../theme/layouts/index.js";

type Env = { Bindings: Bindings; Variables: AppVariables };

export const pageRoutes = new Hono<Env>();

function PageContent({ page }: { page: Post }) {
  const { t } = useLingui();

  return (
    <div class="container py-8 max-w-2xl">
      <article class="h-entry">
        {page.title && (
          <h1 class="p-name text-3xl font-semibold mb-6">{page.title}</h1>
        )}

        <div
          class="e-content prose"
          dangerouslySetInnerHTML={{ __html: page.contentHtml || "" }}
        />
      </article>

      <nav class="mt-8 pt-6 border-t">
        <a href="/" class="text-sm hover:underline">
          ←{" "}
          {t({
            message: "Back to home",
            comment: "@context: Navigation link back to home page",
          })}
        </a>
      </nav>
    </div>
  );
}

// Catch-all for custom page paths
pageRoutes.get("/:path", async (c) => {
  const path = c.req.param("path");

  // Look up page by path
  const page = await c.var.services.posts.getByPath(path);

  // Not found or not a page
  if (!page || page.type !== "page") {
    return c.notFound();
  }

  // Don't show drafts
  if (page.visibility === "draft") {
    return c.notFound();
  }

  const siteName = (await c.var.services.settings.get("SITE_NAME")) ?? "Jant";

  return c.html(
    <BaseLayout
      title={`${page.title} - ${siteName}`}
      description={page.content?.slice(0, 160)}
      c={c}
    >
      <PageContent page={page} />
    </BaseLayout>,
  );
});
