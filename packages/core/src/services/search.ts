/**
 * Search Service (v2)
 *
 * Full-text search using FTS5 trigram for queries ≥ 3 characters.
 * Falls back to LIKE for shorter queries (common in CJK languages where
 * 2-character words cannot form a trigram).
 */

import type { Post, Status, Format, SearchResult } from "../types.js";
import type { DatabaseDialect } from "../db/dialect.js";
import type { RawQueryClient } from "../db/raw-query.js";
import { escapeHtml } from "../lib/html.js";
import { resolvePostBodyHtml } from "../lib/post-body-html.js";
import {
  buildSearchSnippet,
  extractSearchTerms,
} from "../lib/search-snippet.js";

export type { SearchResult };

export interface SearchOptions {
  /** Limit number of results */
  limit?: number;
  /** Offset for pagination */
  offset?: number;
  /** Filter by status */
  status?: Status[];
  /** Filter by format */
  format?: Format;
}

export interface SearchService {
  search(query: string, options?: SearchOptions): Promise<SearchResult[]>;
}

interface RawSearchRow {
  id: string;
  site_id: string;
  format: string;
  status: string;
  visibility: string | null;
  effective_visibility: string | null;
  pinned_at: number | null;
  featured_at: number | null;
  slug: string;
  title: string | null;
  url: string | null;
  body: string | null;
  body_html: string | null;
  body_html_version: number;
  body_text: string | null;
  quote_text: string | null;
  summary: string | null;
  rating: number | null;
  reply_to_id: string | null;
  thread_id: string;
  published_at: number | null;
  last_activity_at: number | null;
  created_at: number;
  updated_at: number;
  rank: number;
  snippet: string | null;
}

function mapRow(row: RawSearchRow): SearchResult {
  return {
    post: {
      id: row.id,
      siteId: row.site_id,
      format: row.format as Post["format"],
      status: row.status as Post["status"],
      visibility: (row.effective_visibility ??
        row.visibility) as Post["visibility"],
      pinnedAt: row.pinned_at,
      featuredAt: row.featured_at,
      slug: row.slug,
      title: row.title,
      url: row.url,
      body: row.body,
      bodyHtml: resolvePostBodyHtml({
        id: row.id,
        body: row.body,
        bodyHtml: row.body_html,
        bodyHtmlVersion: row.body_html_version,
      }),
      bodyText: row.body_text,
      quoteText: row.quote_text,
      summary: row.summary,
      rating: row.rating,
      previewImageKey: null,
      previewKind: null,
      previewProvider: null,
      replyToId: row.reply_to_id,
      threadId: row.thread_id,
      publishedAt: row.published_at,
      lastActivityAt:
        row.last_activity_at ?? row.published_at ?? row.updated_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    },
    rank: row.rank,
    snippet: row.snippet
      ? escapeHtml(row.snippet)
          .replaceAll(String.fromCharCode(2), "<mark>")
          .replaceAll(String.fromCharCode(3), "</mark>")
      : undefined,
  };
}

function withSnippetFallback(
  results: SearchResult[],
  query: string,
): SearchResult[] {
  return results.map((result) => {
    if (result.snippet) return result;

    const fallbackSnippet = buildSearchSnippet(
      [
        result.post.bodyText,
        result.post.quoteText,
        result.post.title,
        result.post.url,
      ],
      query,
    );

    return fallbackSnippet
      ? {
          ...result,
          snippet: fallbackSnippet,
        }
      : result;
  });
}

function buildSqliteFtsQuery(query: string): string | null {
  const terms = extractSearchTerms(query);
  if (terms.length === 0) return null;

  return terms.map((term) => `"${term.replace(/"/g, '""')}"*`).join(" ");
}

function buildPgPrefixTsQuery(query: string): string | null {
  const terms = extractSearchTerms(query);
  if (terms.length === 0) return null;

  return terms.map((term) => `${term}:*`).join(" & ");
}

const PG_TS_HEADLINE_OPTIONS = [
  "MaxWords=18",
  "MinWords=6",
  "ShortWord=2",
  "MaxFragments=2",
  "FragmentDelimiter= … ",
  "StartSel=<mark>",
  "StopSel=</mark>",
].join(", ");

export function createSearchService(
  rawQuery: RawQueryClient,
  siteId: string,
  databaseDialect: DatabaseDialect = "sqlite",
): SearchService {
  async function searchFts(
    query: string,
    options: SearchOptions,
  ): Promise<SearchResult[]> {
    const limit = options.limit ?? 20;
    const offset = options.offset ?? 0;
    const status = options.status ?? ["published"];
    const statusPlaceholders = status.map(() => "?").join(", ");
    const formatFilter = options.format ? "AND post.format = ?" : "";
    const formatParams = options.format ? [options.format] : [];

    if (databaseDialect === "sqlite") {
      const ftsQuery = buildSqliteFtsQuery(query);
      if (!ftsQuery) return [];

      const stmt = rawQuery.prepare(`
        SELECT
          post.*,
          COALESCE(post.visibility, root_post.visibility) AS effective_visibility,
          path_registry.path AS slug,
          post_fts.rank AS rank,
          snippet(post_fts, 1, char(2), char(3), '...', 32) AS snippet
        FROM post_fts
        JOIN post ON post.rowid = post_fts.rowid
        JOIN post AS root_post ON root_post.id = post.thread_id AND root_post.site_id = post.site_id
        JOIN path_registry
          ON path_registry.post_id = post.id
         AND path_registry.site_id = post.site_id
         AND path_registry.kind = 'slug'
        WHERE post_fts MATCH ?
          AND post.site_id = ?
          AND post.status IN (${statusPlaceholders})
          ${formatFilter}
        ORDER BY post_fts.rank
        LIMIT ? OFFSET ?
      `);

      const { results } = await stmt
        .bind(ftsQuery, siteId, ...status, ...formatParams, limit, offset)
        .all<RawSearchRow>();

      return withSnippetFallback((results || []).map(mapRow), query);
    }

    if (databaseDialect !== "pg") {
      return [];
    }

    const tsQuery = buildPgPrefixTsQuery(query);
    if (!tsQuery) return [];

    const stmt = rawQuery.prepare(`
      WITH search_query AS (
        SELECT to_tsquery('simple', ?) AS tsq
      )
      SELECT
        post.*,
        COALESCE(post.visibility, root_post.visibility) AS effective_visibility,
        path_registry.path AS slug,
        ts_rank_cd(post.search_document, search_query.tsq, 32) AS rank,
        NULLIF(
          CASE
            WHEN to_tsvector('simple', coalesce(post.body_text, '')) @@ search_query.tsq THEN
              replace(
                replace(
                  ts_headline('simple', post.body_text, search_query.tsq, '${PG_TS_HEADLINE_OPTIONS}'),
                  '<mark>',
                  chr(2)
                ),
                '</mark>',
                chr(3)
              )
            WHEN to_tsvector('simple', coalesce(post.quote_text, '')) @@ search_query.tsq THEN
              replace(
                replace(
                  ts_headline('simple', post.quote_text, search_query.tsq, '${PG_TS_HEADLINE_OPTIONS}'),
                  '<mark>',
                  chr(2)
                ),
                '</mark>',
                chr(3)
              )
            WHEN to_tsvector('simple', coalesce(post.title, '')) @@ search_query.tsq THEN
              replace(
                replace(
                  ts_headline('simple', post.title, search_query.tsq, '${PG_TS_HEADLINE_OPTIONS}'),
                  '<mark>',
                  chr(2)
                ),
                '</mark>',
                chr(3)
              )
            ELSE NULL
          END,
          ''
        ) AS snippet
      FROM post
      CROSS JOIN search_query
      JOIN post AS root_post ON root_post.id = post.thread_id AND root_post.site_id = post.site_id
      JOIN path_registry
        ON path_registry.post_id = post.id
       AND path_registry.site_id = post.site_id
       AND path_registry.kind = 'slug'
      WHERE post.search_document @@ search_query.tsq
        AND post.site_id = ?
        AND post.status IN (${statusPlaceholders})
        ${formatFilter}
      ORDER BY rank DESC, post.published_at DESC NULLS LAST, post.id DESC
      LIMIT ? OFFSET ?
    `);

    const { results } = await stmt
      .bind(tsQuery, siteId, ...status, ...formatParams, limit, offset)
      .all<RawSearchRow>();

    return withSnippetFallback((results || []).map(mapRow), query);
  }

  async function searchLike(
    query: string,
    options: SearchOptions,
  ): Promise<SearchResult[]> {
    const limit = options.limit ?? 20;
    const offset = options.offset ?? 0;
    const status = options.status ?? ["published"];
    const like = `%${query}%`;
    const statusPlaceholders = status.map(() => "?").join(", ");
    const formatFilter = options.format ? "AND post.format = ?" : "";
    const formatParams = options.format ? [options.format] : [];

    if (databaseDialect === "pg") {
      const stmt = rawQuery.prepare(`
        SELECT
          post.*,
          COALESCE(post.visibility, root_post.visibility) AS effective_visibility,
          path_registry.path AS slug,
          GREATEST(
            similarity(coalesce(post.title, ''), ?),
            similarity(coalesce(post.body_text, ''), ?),
            similarity(coalesce(post.quote_text, ''), ?),
            similarity(coalesce(post.url, ''), ?)
          ) AS rank,
          NULL AS snippet
        FROM post
        JOIN post AS root_post ON root_post.id = post.thread_id AND root_post.site_id = post.site_id
        JOIN path_registry
          ON path_registry.post_id = post.id
         AND path_registry.site_id = post.site_id
         AND path_registry.kind = 'slug'
        WHERE post.search_text ILIKE ?
          AND post.site_id = ?
          AND post.status IN (${statusPlaceholders})
          ${formatFilter}
        ORDER BY rank DESC, post.published_at DESC NULLS LAST, post.id DESC
        LIMIT ? OFFSET ?
      `);

      const { results } = await stmt
        .bind(
          query,
          query,
          query,
          query,
          like,
          siteId,
          ...status,
          ...formatParams,
          limit,
          offset,
        )
        .all<RawSearchRow>();

      return withSnippetFallback((results || []).map(mapRow), query);
    }

    const likeOperator = "LIKE";
    const likeOrderBy = "ORDER BY post.published_at DESC";

    const stmt = rawQuery.prepare(`
      SELECT
        post.*,
        COALESCE(post.visibility, root_post.visibility) AS effective_visibility,
        path_registry.path AS slug,
        0 AS rank,
        NULL AS snippet
      FROM post
      JOIN post AS root_post ON root_post.id = post.thread_id AND root_post.site_id = post.site_id
      JOIN path_registry
        ON path_registry.post_id = post.id
       AND path_registry.site_id = post.site_id
       AND path_registry.kind = 'slug'
      WHERE (
        post.title ${likeOperator} ? OR
        post.body_text ${likeOperator} ? OR
        post.quote_text ${likeOperator} ? OR
        post.url ${likeOperator} ?
      )
      AND post.site_id = ?
      AND post.status IN (${statusPlaceholders})
      ${formatFilter}
      ${likeOrderBy}
      LIMIT ? OFFSET ?
    `);

    const { results } = await stmt
      .bind(
        like,
        like,
        like,
        like,
        siteId,
        ...status,
        ...formatParams,
        limit,
        offset,
      )
      .all<RawSearchRow>();

    return withSnippetFallback((results || []).map(mapRow), query);
  }

  return {
    async search(query, options = {}) {
      const trimmed = query.trim();
      if (!trimmed) return [];

      // Trigram FTS requires at least 3 characters.
      // For shorter queries (common in CJK), fall back to LIKE.
      const charCount = [...trimmed].length;
      if (charCount < 3) {
        return searchLike(trimmed, options);
      }

      const ftsResults = await searchFts(trimmed, options);
      if (ftsResults.length > 0) return ftsResults;

      return searchLike(trimmed, options);
    },
  };
}
