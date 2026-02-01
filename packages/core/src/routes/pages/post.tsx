/**
 * Single Post Page Route
 */

import { Hono } from "hono";
import { msg } from "@lingui/core/macro";
import type { Bindings } from "../../types.js";
import type { AppVariables } from "../../app.js";
import { BaseLayout } from "../../theme/layouts/index.js";
import { getI18n } from "../../i18n/index.js";
import * as sqid from "../../lib/sqid.js";
import * as time from "../../lib/time.js";

type Env = { Bindings: Bindings; Variables: AppVariables };

export const postRoute = new Hono<Env>();

postRoute.get("/:id", async (c) => {
  const i18n = getI18n(c);
  const paramId = c.req.param("id");

  // Try to decode as sqid first
  let id = sqid.decode(paramId);

  // If not a valid sqid, try to find by path
  if (!id) {
    const post = await c.var.services.posts.getByPath(paramId);
    if (post) {
      id = post.id;
    }
  }

  if (!id) return c.notFound();

  const post = await c.var.services.posts.getById(id);
  if (!post) return c.notFound();

  // Don't show drafts on public site
  if (post.visibility === "draft") {
    return c.notFound();
  }

  const siteName = (await c.var.services.settings.get("SITE_NAME")) ?? "Jant";
  const title = post.title || siteName;

  return c.html(
    <BaseLayout title={title} description={post.content?.slice(0, 160)}>
      <div class="container py-8">
        <article class="h-entry">
          {post.title && <h1 class="p-name text-2xl font-semibold mb-4">{post.title}</h1>}

          <div
            class="e-content prose"
            dangerouslySetInnerHTML={{ __html: post.contentHtml || "" }}
          />

          <footer class="mt-6 pt-4 border-t text-sm text-muted-foreground">
            <time class="dt-published" datetime={time.toISOString(post.publishedAt)}>
              {time.formatDate(post.publishedAt)}
            </time>
            <a href={`/p/${sqid.encode(post.id)}`} class="u-url ml-4">
              {i18n._(msg({ message: "Permalink", comment: "@context: Link to permanent URL of post" }))}
            </a>
          </footer>
        </article>

        <nav class="mt-8">
          <a href="/" class="text-sm hover:underline">
            {i18n._(msg({ message: "← Back to home", comment: "@context: Navigation link" }))}
          </a>
        </nav>
      </div>
    </BaseLayout>
  );
});
