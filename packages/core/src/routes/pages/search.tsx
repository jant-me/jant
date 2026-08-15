/**
 * Search Page Route
 */

import { Hono } from "hono";
import type { Context } from "hono";
import type { Bindings, SearchResult } from "../../types.js";
import type { AppVariables } from "../../types/app-context.js";
import { SearchPage } from "../../ui/pages/SearchPage.js";
import { getNavigationData } from "../../lib/navigation.js";
import { buildPageTitle } from "../../lib/page-title.js";
import { renderPublicPage } from "../../lib/render.js";
import { createMediaContext, toSearchResultViews } from "../../lib/view.js";
import {
  buildSurfaceAlternates,
  getViewLang,
} from "../../lib/view-language.js";

type Env = { Bindings: Bindings; Variables: AppVariables };

export const searchRoutes = new Hono<Env>();

/**
 * Render the search page for the current view language.
 *
 * @param c - Hono context
 * @returns Search page response
 */
export async function renderSearchPage(c: Context<Env>): Promise<Response> {
  const query = c.req.query("q") || "";
  const pageParam = c.req.query("page");
  const page = pageParam ? Math.max(1, parseInt(pageParam, 10) || 1) : 1;

  const navData = await getNavigationData(c);

  // Only search if there's a query
  let results: SearchResult[] = [];
  let error: string | undefined;
  let hasMore = false;
  const pageSize = c.var.appConfig.searchPageSize;

  if (query.trim()) {
    try {
      // Fetch one extra to check for more
      results = await c.var.services.search.search(query, {
        limit: pageSize + 1,
        offset: (page - 1) * pageSize,
        status: ["published"],
        lang: getViewLang(c) ?? undefined,
      });

      hasMore = results.length > pageSize;
      if (hasMore) {
        results = results.slice(0, pageSize);
      }
    } catch (err) {
      // eslint-disable-next-line no-console -- Error logging is intentional
      console.error("Search error:", err);
      error = "Search failed. Please try again.";
    }
  }

  // Transform to View Models
  const mediaCtx = createMediaContext(c.var.appConfig);
  const postIds = results.map((r) => r.post.id);
  const [aliasesMap, collectionsMap] = await Promise.all([
    c.var.services.paths.getPostAliases(postIds),
    c.var.services.collections.getCollectionsByPostIds(postIds),
  ]);
  const aliasMap = new Map<string, string>();
  for (const [id, aliases] of aliasesMap) {
    if (aliases[0]) aliasMap.set(id, aliases[0]);
  }
  const resultViews = toSearchResultViews(
    results,
    mediaCtx,
    query,
    aliasMap,
    collectionsMap,
  );

  return renderPublicPage(c, {
    title: buildPageTitle(
      query ? `Search: ${query}` : "Search",
      navData.siteName,
    ),
    alternateLanguages: buildSurfaceAlternates(c),
    navData,
    content: (
      <SearchPage
        query={query}
        results={resultViews}
        error={error}
        hasMore={hasMore}
        page={page}
        basePath={navData.basePath}
        isAuthenticated={navData.isAuthenticated}
      />
    ),
  });
}

searchRoutes.get("/", renderSearchPage);
