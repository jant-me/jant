/**
 * Search Page Route
 */

import { Hono } from "hono";
import type { Bindings } from "../../types.js";
import type { AppVariables } from "../../app.js";
import { BaseLayout } from "../../theme/layouts/index.js";
import { PagePagination } from "../../theme/components/index.js";
import { msg } from "@lingui/core/macro";
import { getI18n } from "../../i18n/index.js";
import * as sqid from "../../lib/sqid.js";
import * as time from "../../lib/time.js";

type Env = { Bindings: Bindings; Variables: AppVariables };

const PAGE_SIZE = 10;

export const searchRoute = new Hono<Env>();

searchRoute.get("/", async (c) => {
  const i18n = getI18n(c);
  const query = c.req.query("q") || "";
  const pageParam = c.req.query("page");
  const page = pageParam ? Math.max(1, parseInt(pageParam, 10) || 1) : 1;

  const siteName = (await c.var.services.settings.get("SITE_NAME")) ?? "Jant";

  // Only search if there's a query
  let results: Awaited<ReturnType<typeof c.var.services.search.search>> = [];
  let error: string | null = null;
  let hasMore = false;

  if (query.trim()) {
    try {
      // Fetch one extra to check for more
      results = await c.var.services.search.search(query, {
        limit: PAGE_SIZE + 1,
        offset: (page - 1) * PAGE_SIZE,
        visibility: ["featured", "quiet"],
      });

      hasMore = results.length > PAGE_SIZE;
      if (hasMore) {
        results = results.slice(0, PAGE_SIZE);
      }
    } catch (err) {
      console.error("Search error:", err);
      error = i18n._(msg({ message: "Search failed. Please try again.", comment: "@context: Search error message" }));
    }
  }

  const searchTitle = i18n._(msg({ message: "Search", comment: "@context: Search page title" }));

  return c.html(
    <BaseLayout title={query ? `${searchTitle}: ${query} - ${siteName}` : `${searchTitle} - ${siteName}`}>
      <div class="container py-8 max-w-2xl">
        <h1 class="text-2xl font-semibold mb-6">{searchTitle}</h1>

        {/* Search form */}
        <form method="get" action="/search" class="mb-8">
          <div class="flex gap-2">
            <input
              type="search"
              name="q"
              class="input flex-1"
              placeholder={i18n._(msg({ message: "Search posts...", comment: "@context: Search input placeholder" }))}
              value={query}
              autofocus
            />
            <button type="submit" class="btn">
              {i18n._(msg({ message: "Search", comment: "@context: Search submit button" }))}
            </button>
          </div>
        </form>

        {/* Error */}
        {error && (
          <div class="p-4 rounded-lg bg-destructive/10 text-destructive mb-6">
            {error}
          </div>
        )}

        {/* Results */}
        {query && !error && (
          <div>
            <p class="text-sm text-muted-foreground mb-4">
              {results.length === 0
                ? i18n._(msg({ message: "No results found.", comment: "@context: Search empty results" }))
                : results.length === 1
                  ? i18n._(msg({ message: "Found 1 result", comment: "@context: Search results count - single" }))
                  : i18n._(msg({ message: "Found {count} results", comment: "@context: Search results count - multiple" }) as any, { count: String(results.length) })}
            </p>

            {results.length > 0 && (
              <>
                <div class="flex flex-col gap-4">
                  {results.map((result) => (
                    <article key={result.post.id} class="p-4 rounded-lg border hover:border-primary">
                      <a href={`/p/${sqid.encode(result.post.id)}`} class="block">
                        <h2 class="font-medium hover:underline">
                          {result.post.title ||
                            result.post.content?.slice(0, 60) ||
                            `Post #${result.post.id}`}
                        </h2>

                        {result.snippet && (
                          <p
                            class="text-sm text-muted-foreground mt-2 line-clamp-2"
                            dangerouslySetInnerHTML={{ __html: result.snippet }}
                          />
                        )}

                        <footer class="flex items-center gap-2 mt-2 text-xs text-muted-foreground">
                          <span class="badge-outline">{result.post.type}</span>
                          <time datetime={time.toISOString(result.post.publishedAt)}>
                            {time.formatDate(result.post.publishedAt)}
                          </time>
                        </footer>
                      </a>
                    </article>
                  ))}
                </div>

                <PagePagination
                  c={c}
                  baseUrl={`/search?q=${encodeURIComponent(query)}`}
                  currentPage={page}
                  hasMore={hasMore}
                />
              </>
            )}
          </div>
        )}

        <nav class="mt-8 pt-6 border-t">
          <a href="/" class="text-sm hover:underline">
            ← {i18n._(msg({ message: "Back to home", comment: "@context: Navigation link back to home page" }))}
          </a>
        </nav>
      </div>
    </BaseLayout>
  );
});
