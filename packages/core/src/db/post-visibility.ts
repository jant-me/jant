/**
 * Who may see a post — one definition, shared by every surface that counts or
 * lists them.
 *
 * A reply carries no visibility of its own: it inherits the Thread root's, so
 * hiding a root hides the whole thread. Every query that filters by visibility
 * has to resolve that inheritance the same way, and a query that forgets is not
 * loud about it — it returns *more* rows, which looks like working code.
 *
 * That is how the collections directory came to count drafts and private
 * threads into the number it showed a signed-out reader while the collection
 * page, one click away, counted them out. Subtracting one number from the other
 * told a stranger how much unpublished material a collection held.
 *
 * The rule these helpers encode: **the same reader gets the same set on every
 * surface.** A page and the directory entry that links to it must apply this
 * from one place, not two.
 */

import { sql, type SQL, type SQLWrapper } from "drizzle-orm";
import type { Status, Visibility } from "../types/constants.js";

/** The `post` columns the visibility rules read, in either dialect's bundle. */
export interface PostVisibilityColumns {
  status: SQLWrapper;
  visibility: SQLWrapper;
  threadId: SQLWrapper;
  language: SQLWrapper;
}

/**
 * A post's visibility after Thread-root inheritance.
 *
 * Replies store `NULL` and answer with their root's value, so this is the
 * expression to compare against — never the raw column.
 *
 * @param post - The post table's `visibility` and `threadId` columns
 * @param siteId - Site the query is scoped to
 * @returns COALESCE expression yielding a {@link Visibility} value
 *
 * @example
 * ```ts
 * const visibility = buildEffectiveVisibilityExpr(posts, siteId);
 * conditions.push(sql`${visibility} != 'private'`);
 * ```
 */
export function buildEffectiveVisibilityExpr(
  post: Pick<PostVisibilityColumns, "visibility" | "threadId">,
  siteId: string,
): SQL<string> {
  return sql<string>`coalesce(
    ${post.visibility},
    (SELECT root.visibility FROM post AS root WHERE root.id = ${post.threadId} AND root.site_id = ${siteId})
  )`;
}

/** What a given reader is allowed to see, in the shape every caller passes. */
export interface ReaderVisibilityOptions {
  /** Usually `"published"`. Omitted only where drafts are the subject. */
  status?: Status;
  /** Narrow to exactly one visibility, as the archive's filter bar does. */
  visibility?: Visibility;
  /** True for a signed-out reader. */
  excludePrivate?: boolean;
  /** True where `latest_hidden` posts are held back, as on Latest. */
  excludeLatestHidden?: boolean;
  /** Restrict to one content language, for a per-language view. */
  lang?: string;
}

/**
 * The WHERE clauses that narrow posts to what one reader may see.
 *
 * Returns clauses only for the options that are set, so it composes with
 * whatever else a query filters on. Safe in a LEFT JOIN's `ON` clause, which is
 * how a directory keeps listing a collection whose posts this reader cannot
 * see, showing it as empty rather than dropping the row.
 *
 * @param post - The post table's columns
 * @param siteId - Site the query is scoped to
 * @param options - What this reader may see
 * @returns Conditions to spread into `and(...)`
 *
 * @example
 * ```ts
 * const conditions = buildReaderVisibilityConditions(posts, siteId, {
 *   status: "published",
 *   excludePrivate: !isAuthenticated,
 * });
 * ```
 */
export function buildReaderVisibilityConditions(
  post: PostVisibilityColumns,
  siteId: string,
  options: ReaderVisibilityOptions = {},
): SQL[] {
  const effectiveVisibility = buildEffectiveVisibilityExpr(post, siteId);
  const conditions: SQL[] = [];

  if (options.status) {
    conditions.push(sql`${post.status} = ${options.status}`);
  }
  if (options.visibility !== undefined) {
    conditions.push(sql`${effectiveVisibility} = ${options.visibility}`);
  }
  if (options.excludePrivate) {
    conditions.push(sql`${effectiveVisibility} != 'private'`);
  }
  if (options.excludeLatestHidden) {
    conditions.push(sql`${effectiveVisibility} != 'latest_hidden'`);
  }
  if (options.lang) {
    conditions.push(sql`${post.language} = ${options.lang}`);
  }

  return conditions;
}
