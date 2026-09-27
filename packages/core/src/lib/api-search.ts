import type { Post } from "../types.js";
import { toPublicPath } from "./url.js";

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

export function toSearchApiResult(
  post: Post,
  snippet: string | undefined,
  sitePathPrefix?: string,
): SearchApiResult {
  const permalink = toPublicPath(`/${post.slug}`, sitePathPrefix);

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
