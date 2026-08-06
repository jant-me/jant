import { and, eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  createTestDatabase,
  DEFAULT_TEST_SITE_ID,
} from "../../__tests__/helpers/db.js";
import { posts, threadCollections } from "../schema.js";
import {
  buildRootActivityExpr,
  getRootActivityAt,
  rootActivityColumns,
} from "../thread-activity.js";

/**
 * The SQL assertions here look pedantic, but they guard a failure mode that
 * produces no error and no obviously wrong output: Drizzle omits the table
 * qualifier on interpolated columns in a single-table projection, so a
 * correlated subquery silently binds to its own alias instead of the outer
 * row. That is why the subquery flavor takes raw fragments.
 */
describe("thread activity definition", () => {
  const normalize = (value: string) => value.replace(/\s+/g, " ");

  it("prefers last activity, then publication, then the row's own write", () => {
    expect(
      getRootActivityAt({
        lastActivityAt: 300,
        publishedAt: 200,
        updatedAt: 100,
      }),
    ).toBe(300);
    expect(
      getRootActivityAt({
        lastActivityAt: null,
        publishedAt: 200,
        updatedAt: 100,
      }),
    ).toBe(200);
    expect(
      getRootActivityAt({
        lastActivityAt: null,
        publishedAt: null,
        updatedAt: 100,
      }),
    ).toBe(100);
  });

  it("never falls back to a plain edit when real activity exists", () => {
    // An edited root keeps its activity timestamp — the whole point.
    expect(
      getRootActivityAt({
        lastActivityAt: 1000,
        publishedAt: 1000,
        updatedAt: 9999,
      }),
    ).toBe(1000);
  });

  it("qualifies the subquery flavor against the root alias", () => {
    const { db } = createTestDatabase();
    const expr = sql<number>`(
      SELECT ${buildRootActivityExpr(rootActivityColumns("root"))}
      FROM post AS root
      WHERE root.site_id = ${DEFAULT_TEST_SITE_ID}
        AND root.id = ${posts.threadId}
    )`.as("activity_at");

    const generated = normalize(
      (db as never as { select: (fields: unknown) => never })
        .select({ threadId: posts.threadId, activityAt: expr })
        // The join is what makes Drizzle qualify `posts.threadId` below.
        .from(posts)
        .innerJoin(
          threadCollections,
          and(
            eq(threadCollections.siteId, posts.siteId),
            eq(threadCollections.threadId, posts.threadId),
          ),
        )
        .groupBy(posts.threadId)
        .toSQL().sql,
    );

    // Inner columns resolve against the subquery's own alias...
    expect(generated).toContain(
      "COALESCE( root.last_activity_at, root.published_at, root.updated_at )",
    );
    // ...and the correlation still points at the outer row, not at `root`.
    expect(generated).toContain('root.id = "post"."thread_id"');
  });

  it("uses the root's own columns when rows are already roots", () => {
    const { db } = createTestDatabase();
    const generated = normalize(
      (db as never as { select: (fields: unknown) => never })
        .select({
          id: posts.id,
          activityAt: buildRootActivityExpr({
            lastActivityAt: posts.lastActivityAt,
            publishedAt: posts.publishedAt,
            updatedAt: posts.updatedAt,
          }),
        })
        .from(posts)
        .innerJoin(threadCollections, eq(threadCollections.threadId, posts.id))
        .toSQL().sql,
    );

    expect(generated).toContain(
      'COALESCE( "post"."last_activity_at", "post"."published_at", "post"."updated_at" )',
    );
  });
});
