/**
 * Archive Page Route
 *
 * Shows all posts, optionally filtered by type
 */

import { Hono } from "hono";
import type { I18n } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import type { Bindings, PostType } from "../../types.js";
import type { AppVariables } from "../../app.js";
import { BaseLayout } from "../../theme/layouts/index.js";
import { Pagination } from "../../theme/components/index.js";
import { getI18n } from "../../i18n/index.js";
import { POST_TYPES } from "../../types.js";
import * as sqid from "../../lib/sqid.js";
import * as time from "../../lib/time.js";

type Env = { Bindings: Bindings; Variables: AppVariables };

const PAGE_SIZE = 50;

export const archiveRoute = new Hono<Env>();

// Archive page - all posts
archiveRoute.get("/", async (c) => {
  const i18n = getI18n(c);
  const typeParam = c.req.query("type") as PostType | undefined;
  const type = typeParam && POST_TYPES.includes(typeParam) ? typeParam : undefined;

  // Parse cursor
  const cursorParam = c.req.query("cursor");
  const cursor = cursorParam ? parseInt(cursorParam, 10) : undefined;

  const siteName = (await c.var.services.settings.get("SITE_NAME")) ?? "Jant";

  // Fetch one extra to check for more
  const posts = await c.var.services.posts.list({
    type,
    visibility: ["featured", "quiet"],
    excludeReplies: true,
    cursor,
    limit: PAGE_SIZE + 1,
  });

  const hasMore = posts.length > PAGE_SIZE;
  const displayPosts = hasMore ? posts.slice(0, PAGE_SIZE) : posts;

  // Get reply counts for thread indicators
  const postIds = displayPosts.map((p) => p.id);
  const replyCounts = await c.var.services.posts.getReplyCounts(postIds);

  // Get next cursor
  const nextCursor = hasMore && displayPosts.length > 0
    ? displayPosts[displayPosts.length - 1]!.id
    : undefined;

  // Group posts by year-month
  const grouped = new Map<string, typeof displayPosts>();
  for (const post of displayPosts) {
    const date = new Date(post.publishedAt * 1000);
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    if (!grouped.has(key)) {
      grouped.set(key, []);
    }
    grouped.get(key)!.push(post);
  }

  const title = type
    ? getTypeLabelPlural(type, i18n)
    : i18n._(msg({ message: "Archive", comment: "@context: Archive page title" }));

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
              {i18n._(msg({ message: "All", comment: "@context: Archive filter - all types" }))}
            </a>
            {POST_TYPES.filter((t) => t !== "page").map((typeKey) => (
              <a
                key={typeKey}
                href={`/archive?type=${typeKey}`}
                class={`badge ${type === typeKey ? "badge-primary" : "badge-outline"}`}
              >
                {getTypeLabelPlural(typeKey, i18n)}
              </a>
            ))}
          </nav>
        </header>

        <main>
          {displayPosts.length === 0 && !cursor ? (
            <p class="text-muted-foreground">
              {i18n._(msg({ message: "No posts found.", comment: "@context: Archive empty state" }))}
            </p>
          ) : (
            Array.from(grouped.entries()).map(([yearMonth, monthPosts]) => (
              <section key={yearMonth} class="mb-8">
                <h2 class="text-lg font-medium mb-4 text-muted-foreground">
                  {formatYearMonth(yearMonth)}
                </h2>
                <div class="flex flex-col gap-3">
                  {monthPosts.map((post) => {
                    const replyCount = replyCounts.get(post.id);
                    return (
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
                            <span class="ml-2 badge-outline text-xs">{getTypeLabel(post.type, i18n)}</span>
                          )}
                          {replyCount && replyCount > 0 && (
                            <span class="ml-2 text-xs text-muted-foreground">
                              ({replyCount === 1
                                ? i18n._(msg({ message: "1 reply", comment: "@context: Archive post reply indicator - single" }))
                                : i18n._(msg({ message: "{count} replies", comment: "@context: Archive post reply indicator - plural" }) as any, { count: String(replyCount) })})
                            </span>
                          )}
                        </div>
                      </article>
                    );
                  })}
                </div>
              </section>
            ))
          )}
        </main>

        {/* Pagination */}
        <Pagination
          c={c}
          baseUrl={type ? `/archive?type=${type}` : "/archive"}
          hasMore={hasMore}
          nextCursor={nextCursor}
        />

        <nav class="mt-4">
          <a href="/" class="text-sm hover:underline">
            ← {i18n._(msg({ message: "Back to home", comment: "@context: Navigation link back to home page" }))}
          </a>
        </nav>
      </div>
    </BaseLayout>
  );
});

function getTypeLabel(type: string, i18n: I18n): string {
  const labels: Record<string, string> = {
    note: i18n._(msg({ message: "Note", comment: "@context: Post type label - note" })),
    article: i18n._(msg({ message: "Article", comment: "@context: Post type label - article" })),
    link: i18n._(msg({ message: "Link", comment: "@context: Post type label - link" })),
    quote: i18n._(msg({ message: "Quote", comment: "@context: Post type label - quote" })),
    image: i18n._(msg({ message: "Image", comment: "@context: Post type label - image" })),
    page: i18n._(msg({ message: "Page", comment: "@context: Post type label - page" })),
  };
  return labels[type] ?? type;
}

function getTypeLabelPlural(type: string, i18n: I18n): string {
  const labels: Record<string, string> = {
    note: i18n._(msg({ message: "Notes", comment: "@context: Post type label plural - notes" })),
    article: i18n._(msg({ message: "Articles", comment: "@context: Post type label plural - articles" })),
    link: i18n._(msg({ message: "Links", comment: "@context: Post type label plural - links" })),
    quote: i18n._(msg({ message: "Quotes", comment: "@context: Post type label plural - quotes" })),
    image: i18n._(msg({ message: "Images", comment: "@context: Post type label plural - images" })),
    page: i18n._(msg({ message: "Pages", comment: "@context: Post type label plural - pages" })),
  };
  return labels[type] ?? `${type}s`;
}

function formatYearMonth(yearMonth: string): string {
  const [year, month] = yearMonth.split("-");
  const date = new Date(parseInt(year!, 10), parseInt(month!, 10) - 1);
  return date.toLocaleDateString("en-US", { year: "numeric", month: "long" });
}
