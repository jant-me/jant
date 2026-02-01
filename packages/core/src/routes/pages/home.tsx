/**
 * Home Page Route
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

export const homeRoute = new Hono<Env>();

homeRoute.get("/", async (c) => {
  const i18n = getI18n(c);
  const isComplete = await c.var.services.settings.isOnboardingComplete();
  if (!isComplete) {
    return c.redirect("/setup");
  }

  const siteName = (await c.var.services.settings.get("SITE_NAME")) ?? "Jant";

  const posts = await c.var.services.posts.list({
    visibility: ["featured", "quiet"],
    limit: 20,
  });

  return c.html(
    <BaseLayout title={siteName}>
      <div class="container py-8">
        <header class="mb-8 flex items-center justify-between">
          <h1 class="text-2xl font-semibold">{siteName}</h1>
          <nav class="flex items-center gap-4 text-sm">
            <a href="/archive" class="text-muted-foreground hover:text-foreground">
              {i18n._(msg({ message: "Archive", comment: "@context: Navigation link to archive page" }))}
            </a>
            <a href="/feed/rss.xml" class="text-muted-foreground hover:text-foreground">
              RSS
            </a>
          </nav>
        </header>

        <main class="flex flex-col gap-6">
          {posts.length === 0 ? (
            <p class="text-muted-foreground">{i18n._(msg({ message: "No posts yet.", comment: "@context: Empty state message on home page" }))}</p>
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
                  {post.visibility === "featured" && (
                    <span class="ml-2 text-xs">{i18n._(msg({ message: "Featured", comment: "@context: Post visibility badge" }))}</span>
                  )}
                </footer>
              </article>
            ))
          )}
        </main>

        {posts.length >= 20 && (
          <nav class="mt-8 text-center">
            <a href="/archive" class="text-sm text-muted-foreground hover:text-foreground">
              {i18n._(msg({ message: "View all posts →", comment: "@context: Link to view all posts on archive page" }))}
            </a>
          </nav>
        )}
      </div>
    </BaseLayout>
  );
});
