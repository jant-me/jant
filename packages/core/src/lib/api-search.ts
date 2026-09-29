import type { Services } from "../services/index.js";
import type { AppConfig } from "../types/config.js";
import type { Post } from "../types.js";
import { getPostPath, toPublicPath } from "./url.js";

export type SearchApiResult = {
  id: string;
  format: Post["format"];
  slug: string;
  snippet?: string;
  publishedAt: number | null;
  permalink: string;
  /** The Thread's visibility: private results reach the author only. */
  visibility: Post["visibility"];
  title?: string | null;
  url?: string | null;
  sourceName?: string | null;
  sourceUrl?: string | null;
};

/**
 * One search result as the API and MCP return it.
 *
 * @param post - The matching Post
 * @param snippet - Highlighted excerpt, when the search made one
 * @param sitePathPrefix - The site's path prefix
 * @param aliasPath - The Post's oldest custom path, its permalink when it has one
 * @returns The result object
 * @example
 * toSearchApiResult(post, "a <mark>match</mark>", "", "/blog/hello");
 */
export function toSearchApiResult(
  post: Post,
  snippet: string | undefined,
  sitePathPrefix?: string,
  aliasPath?: string | null,
): SearchApiResult {
  const permalink = toPublicPath(
    getPostPath(post.slug, aliasPath),
    sitePathPrefix,
  );

  if (post.format === "quote") {
    return {
      id: post.id,
      format: post.format,
      slug: post.slug,
      snippet,
      publishedAt: post.publishedAt,
      permalink,
      visibility: post.visibility,
      sourceName: post.title,
      sourceUrl: post.url,
    };
  }

  return {
    id: post.id,
    format: post.format,
    title: post.title,
    url: post.url,
    slug: post.slug,
    snippet,
    publishedAt: post.publishedAt,
    permalink,
    visibility: post.visibility,
  };
}

/**
 * Search results as the API and MCP return them, with each Post's custom path
 * read in one batch.
 *
 * @param deps - Services and app config; a request's `c.var`
 * @param results - What the search service found, in order
 * @returns One result object per match, in the same order
 * @example
 * const results = await loadSearchApiResults(c.var, await search.search(q));
 */
export async function loadSearchApiResults(
  deps: {
    services: Pick<Services, "paths">;
    appConfig: Pick<AppConfig, "sitePathPrefix">;
  },
  results: readonly { post: Post; snippet?: string }[],
): Promise<SearchApiResult[]> {
  const aliases = await deps.services.paths.getPostAliases(
    results.map((result) => result.post.id),
  );
  return results.map((result) =>
    toSearchApiResult(
      result.post,
      result.snippet,
      deps.appConfig.sitePathPrefix,
      aliases.get(result.post.id)?.[0],
    ),
  );
}
