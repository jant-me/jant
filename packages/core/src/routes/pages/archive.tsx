/**
 * Archive Page Route
 *
 * Shows all posts, optionally filtered by type
 */

import { Hono } from "hono";
import type { Bindings, PostType } from "../../types.js";
import type { AppVariables } from "../../app.js";
import { BaseLayout } from "../../theme/layouts/index.js";
import { POST_TYPES } from "../../types.js";
import * as sqid from "../../lib/sqid.js";
import * as time from "../../lib/time.js";

type Env = { Bindings: Bindings; Variables: AppVariables };

export const archiveRoute = new Hono<Env>();

// Archive page - all posts
archiveRoute.get("/", async (c) => {
  const typeParam = c.req.query("type") as PostType | undefined;
  const type = typeParam && POST_TYPES.includes(typeParam) ? typeParam : undefined;

  const siteName = (await c.var.services.settings.get("SITE_NAME")) ?? "Jant";

  const posts = await c.var.services.posts.list({
    type,
    visibility: ["featured", "quiet"],
    limit: 100,
  });

  // Group posts by year-month
  const grouped = new Map<string, typeof posts>();
  for (const post of posts) {
    const date = new Date(post.publishedAt * 1000);
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    if (!grouped.has(key)) {
      grouped.set(key, []);
    }
    grouped.get(key)!.push(post);
  }

  const title = type ? `${capitalize(type)}s` : "Archive";

  return c.html(
    <BaseLayout title={`${title} - ${siteName}`}>
      <div class="container py-8">
        <header class="mb-8">
          <h1 class="text-2xl font-semibold">{title}</h1>

          {/* Type filter */}
          <nav class="flex flex-wrap gap-2 mt-4">
            <a
              href="/archive"
              class={`badge ${!type ? "badge-primary" : "badge-outline"}`}
            >
              All
            </a>
            {POST_TYPES.filter((t) => t !== "page").map((t) => (
              <a
                key={t}
                href={`/archive?type=${t}`}
                class={`badge ${type === t ? "badge-primary" : "badge-outline"}`}
              >
                {capitalize(t)}s
              </a>
            ))}
          </nav>
        </header>

        <main>
          {posts.length === 0 ? (
            <p class="text-muted-foreground">No posts found.</p>
          ) : (
            Array.from(grouped.entries()).map(([yearMonth, monthPosts]) => (
              <section key={yearMonth} class="mb-8">
                <h2 class="text-lg font-medium mb-4 text-muted-foreground">
                  {formatYearMonth(yearMonth)}
                </h2>
                <div class="flex flex-col gap-3">
                  {monthPosts.map((post) => (
                    <article key={post.id} class="flex items-baseline gap-4">
                      <time
                        class="text-sm text-muted-foreground w-12 shrink-0"
                        datetime={time.toISOString(post.publishedAt)}
                      >
                        {new Date(post.publishedAt * 1000).getDate()}
                      </time>
                      <div class="flex-1 min-w-0">
                        <a
                          href={`/p/${sqid.encode(post.id)}`}
                          class="hover:underline"
                        >
                          {post.title || post.content?.slice(0, 80) || `Post #${post.id}`}
                        </a>
                        {!type && (
                          <span class="ml-2 badge-outline text-xs">{post.type}</span>
                        )}
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            ))
          )}
        </main>

        <nav class="mt-8">
          <a href="/" class="text-sm hover:underline">
            ← Back to home
          </a>
        </nav>
      </div>
    </BaseLayout>
  );
});

function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function formatYearMonth(yearMonth: string): string {
  const [year, month] = yearMonth.split("-");
  const date = new Date(parseInt(year!, 10), parseInt(month!, 10) - 1);
  return date.toLocaleDateString("en-US", { year: "numeric", month: "long" });
}
