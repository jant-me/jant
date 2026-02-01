/**
 * Search Service
 *
 * Full-text search using FTS5
 */

import type { Post, Visibility } from "../types.js";

export interface SearchResult {
  post: Post;
  /** FTS5 rank score (lower is better) */
  rank: number;
  /** Highlighted snippet from content */
  snippet?: string;
}

export interface SearchOptions {
  /** Limit number of results */
  limit?: number;
  /** Offset for pagination */
  offset?: number;
  /** Filter by visibility */
  visibility?: Visibility[];
}

export interface SearchService {
  search(query: string, options?: SearchOptions): Promise<SearchResult[]>;
}

interface RawSearchRow {
  id: number;
  type: string;
  visibility: string;
  title: string | null;
  path: string | null;
  content: string | null;
  content_html: string | null;
  source_url: string | null;
  source_name: string | null;
  source_domain: string | null;
  reply_to_id: number | null;
  thread_id: number | null;
  deleted_at: number | null;
  published_at: number;
  created_at: number;
  updated_at: number;
  rank: number;
  snippet: string;
}

export function createSearchService(d1: D1Database): SearchService {
  return {
    async search(query, options = {}) {
      const limit = options.limit ?? 20;
      const offset = options.offset ?? 0;
      const visibility = options.visibility ?? ["featured", "quiet"];

      // Escape and prepare the query for FTS5
      // FTS5 uses * for prefix matching
      const ftsQuery = query
        .trim()
        .split(/\s+/)
        .filter((term) => term.length > 0)
        .map((term) => `"${term.replace(/"/g, '""')}"*`)
        .join(" ");

      if (!ftsQuery) {
        return [];
      }

      // Build visibility placeholders
      const visibilityPlaceholders = visibility.map(() => "?").join(", ");

      // Query FTS5 table and join with posts using raw D1 query
      const stmt = d1.prepare(`
        SELECT
          posts.*,
          posts_fts.rank AS rank,
          snippet(posts_fts, 1, '<mark>', '</mark>', '...', 32) AS snippet
        FROM posts_fts
        JOIN posts ON posts.id = posts_fts.rowid
        WHERE posts_fts MATCH ?
          AND posts.deleted_at IS NULL
          AND posts.visibility IN (${visibilityPlaceholders})
        ORDER BY posts_fts.rank
        LIMIT ? OFFSET ?
      `);

      const { results } = await stmt
        .bind(ftsQuery, ...visibility, limit, offset)
        .all<RawSearchRow>();

      return (results || []).map((row) => ({
        post: {
          id: row.id,
          type: row.type as Post["type"],
          visibility: row.visibility as Post["visibility"],
          title: row.title,
          path: row.path,
          content: row.content,
          contentHtml: row.content_html,
          sourceUrl: row.source_url,
          sourceName: row.source_name,
          sourceDomain: row.source_domain,
          replyToId: row.reply_to_id,
          threadId: row.thread_id,
          deletedAt: row.deleted_at,
          publishedAt: row.published_at,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        },
        rank: row.rank,
        snippet: row.snippet,
      }));
    },
  };
}
