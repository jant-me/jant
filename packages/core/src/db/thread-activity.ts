/**
 * Thread activity — one definition, shared by every surface that orders by it.
 *
 * A Thread's activity is when it last **gained a post**. Editing an existing
 * post is not activity: otherwise fixing a typo would drag a years-old thread
 * back to the top of Latest and of every collection that holds it.
 *
 * This lived as three separate copies (the collection thread sort, the
 * collection directory, and the Hugo export). One of them was changed in #144
 * to treat a newer `updated_at` as activity and the others were not, so the
 * same thread ranked differently depending on which page you were looking at,
 * and the drift went unnoticed for months. Adding a fourth copy is the failure
 * mode this module exists to prevent — call it instead.
 *
 * Two flavors of "last activity" exist, and they differ only in how they treat
 * quiet replies:
 *
 * - `last_activity_at` — quiet replies excluded. "Last announced." Latest, the
 *   feeds, and collection ordering read this.
 * - `thread_updated_at` — quiet replies included. "Last changed." The
 *   archive's updated sort reads this.
 *
 * Both are maintained on the Thread root by the post service; everything here
 * only reads them, with fallbacks for rows that predate the columns.
 */

import { sql, type SQL, type SQLWrapper } from "drizzle-orm";

/**
 * Activity timestamp for a Thread root row, in SQL.
 *
 * Pass column references for a query whose rows are already Thread roots, or
 * raw fragments (`sql.raw("root.last_activity_at")`) when reaching a root
 * through a correlated subquery.
 *
 * **Correlated-subquery warning:** Drizzle only qualifies interpolated columns
 * with their table name when the query has a join. In a single-table
 * `select()`, `${posts.id}` renders as a bare `"id"`, which inside a subquery
 * binds to the subquery's own alias instead of correlating to the outer row —
 * silently, with no error. Write the outer table out (`"post"."id"`) in that
 * case rather than interpolating.
 *
 * @param root - The root's three timestamp columns, most authoritative first
 * @returns COALESCE expression usable in ORDER BY, GROUP BY, or a projection
 *
 * @example
 * ```ts
 * // Rows are already Thread roots (joined on thread_collection.thread_id):
 * const activityAt = buildRootActivityExpr({
 *   lastActivityAt: posts.lastActivityAt,
 *   publishedAt: posts.publishedAt,
 *   updatedAt: posts.updatedAt,
 * });
 * ```
 */
export function buildRootActivityExpr(root: {
  lastActivityAt: SQLWrapper;
  publishedAt: SQLWrapper;
  updatedAt: SQLWrapper;
}): SQL<number> {
  return sql<number>`COALESCE(
    ${root.lastActivityAt},
    ${root.publishedAt},
    ${root.updatedAt}
  )`;
}

/** The Thread root's timestamp columns, named for a correlated subquery alias. */
export function rootActivityColumns(alias: string): {
  lastActivityAt: SQLWrapper;
  publishedAt: SQLWrapper;
  updatedAt: SQLWrapper;
} {
  return {
    lastActivityAt: sql.raw(`${alias}.last_activity_at`),
    publishedAt: sql.raw(`${alias}.published_at`),
    updatedAt: sql.raw(`${alias}.updated_at`),
  };
}

/**
 * Activity timestamp for an already-loaded Thread root, in TypeScript.
 *
 * The same COALESCE order as {@link buildRootActivityExpr}, for callers that
 * hold hydrated posts rather than a query builder.
 *
 * @param root - A Thread root post
 * @returns Unix timestamp (seconds) of the root's last activity
 *
 * @example
 * ```ts
 * const activityAt = getRootActivityAt(threadRoot);
 * ```
 */
export function getRootActivityAt(root: {
  lastActivityAt?: number | null;
  publishedAt?: number | null;
  updatedAt: number;
}): number {
  return root.lastActivityAt ?? root.publishedAt ?? root.updatedAt;
}
