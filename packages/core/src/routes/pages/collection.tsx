/**
 * Collection Page Route
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

export const collectionRoute = new Hono<Env>();

collectionRoute.get("/:path", async (c) => {
  const i18n = getI18n(c);
  const path = c.req.param("path");

  const collection = await c.var.services.collections.getByPath(path);
  if (!collection) return c.notFound();

  const posts = await c.var.services.collections.getPosts(collection.id);
  const siteName = (await c.var.services.settings.get("SITE_NAME")) ?? "Jant";

  return c.html(
    <BaseLayout title={`${collection.title} - ${siteName}`} description={collection.description ?? undefined}>
      <div class="container py-8">
        <header class="mb-8">
          <h1 class="text-2xl font-semibold">{collection.title}</h1>
          {collection.description && (
            <p class="text-muted-foreground mt-2">{collection.description}</p>
          )}
        </header>

        <main class="flex flex-col gap-6">
          {posts.length === 0 ? (
            <p class="text-muted-foreground">{i18n._(msg({ message: "No posts in this collection.", comment: "@context: Empty state message" }))}</p>
          ) : (
            posts.map((post) => (
              <article key={post.id} class="h-entry">
                {post.title && (
                  <h2 class="p-name text-lg font-medium mb-2">
                    <a href={`/p/${sqid.encode(post.id)}`} class="u-url hover:underline">
                      {post.title}
                    </a>
                  </h2>
                )}
                <div
                  class="e-content prose prose-sm"
                  dangerouslySetInnerHTML={{ __html: post.contentHtml || "" }}
                />
                <footer class="mt-2 text-sm text-muted-foreground">
                  <time class="dt-published" datetime={time.toISOString(post.publishedAt)}>
                    {time.formatDate(post.publishedAt)}
                  </time>
                </footer>
              </article>
            ))
          )}
        </main>

        <nav class="mt-8">
          <a href="/" class="text-sm hover:underline">
            {i18n._(msg({ message: "← Back to home", comment: "@context: Navigation link" }))}
          </a>
        </nav>
      </div>
    </BaseLayout>
  );
});
