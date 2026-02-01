/**
 * Search Page Route
 */

import { Hono } from "hono";
import { useLingui } from "../../i18n/index.js";
import type { Bindings } from "../../types.js";
import type { AppVariables } from "../../app.js";
import type { SearchResult } from "../../services/search.js";
import { BaseLayout } from "../../theme/layouts/index.js";
import { PagePagination } from "../../theme/components/index.js";
import * as sqid from "../../lib/sqid.js";
import * as time from "../../lib/time.js";

type Env = { Bindings: Bindings; Variables: AppVariables };

const PAGE_SIZE = 10;

export const searchRoutes = new Hono<Env>();

function SearchContent({
  query,
  results,
  error,
  hasMore,
  page,
}: {
  query: string;
  results: SearchResult[];
  error: string | null;
  hasMore: boolean;
  page: number;
}) {
  const { t } = useLingui();
  const searchTitle = t({ message: "Search", comment: "@context: Search page title" });

  return (
    <div class="container py-8 max-w-2xl">
      <h1 class="text-2xl font-semibold mb-6">{searchTitle}</h1>

      {/* Search form */}
      <form method="get" action="/search" class="mb-8">
        <div class="flex gap-2">
          <input
            type="search"
            name="q"
            class="input flex-1"
            placeholder={t({ message: "Search posts...", comment: "@context: Search input placeholder" })}
            value={query}
            autofocus
          />
          <button type="submit" class="btn">
            {t({ message: "Search", comment: "@context: Search submit button" })}
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
              ? t({ message: "No results found.", comment: "@context: Search empty results" })
              : results.length === 1
                ? t({ message: "Found 1 result", comment: "@context: Search results count - single" })
                : t({ message: "Found {count} results", comment: "@context: Search results count - multiple", values: { count: String(results.length) } })}
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
          ← {t({ message: "Back to home", comment: "@context: Navigation link back to home page" })}
        </a>
      </nav>
    </div>
  );
}

searchRoutes.get("/", async (c) => {
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
      // eslint-disable-next-line no-console -- Error logging is intentional
      console.error("Search error:", err);
      error = "Search failed. Please try again.";
    }
  }

  return c.html(
    <BaseLayout title={query ? `Search: ${query} - ${siteName}` : `Search - ${siteName}`} c={c}>
      <SearchContent query={query} results={results} error={error} hasMore={hasMore} page={page} />
    </BaseLayout>
  );
});
