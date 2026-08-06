/**
 * Executes the real 0005 backfill SQL against legacy-shaped rows.
 *
 * The backfill runs on user data through `jant migrate`, and the same file is
 * executed on both SQLite and Postgres, so it has to be portable and safe to
 * rerun. These tests cover the SQLite side; the SQL avoids dialect-specific
 * syntax (no `UPDATE ... FROM`, only correlated subqueries and TRUE/FALSE
 * literals, which both engines accept).
 */

import { readFileSync } from "fs";
import { resolve } from "path";
import type BetterSqlite3 from "better-sqlite3";
import { beforeEach, describe, expect, it } from "vitest";
import {
  createTestDatabase,
  DEFAULT_TEST_SITE_ID,
} from "../../__tests__/helpers/db.js";

const BACKFILL_SQL = readFileSync(
  resolve(
    import.meta.dirname,
    "../backfills/0005_split_thread_activity_from_quiet_replies.sql",
  ),
  "utf-8",
);

interface RootRow {
  quiet_reply: number;
  last_activity_at: number | null;
  thread_updated_at: number | null;
}

describe("0005 backfill — split thread activity from quiet replies", () => {
  let sqlite: BetterSqlite3.Database;

  function runBackfill() {
    sqlite.exec(BACKFILL_SQL);
  }

  /** Insert a post row the way the pre-0031 schema would have left it. */
  function insertLegacyPost(row: {
    id: string;
    threadId: string;
    replyToId?: string | null;
    publishedAt: number | null;
    lastActivityAt: number | null;
    status?: string;
  }) {
    sqlite
      .prepare(
        `INSERT INTO post (
           id, site_id, format, status, visibility, thread_id, reply_to_id,
           published_at, last_activity_at, created_at, updated_at
         ) VALUES (?, ?, 'note', ?, 'public', ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        row.id,
        DEFAULT_TEST_SITE_ID,
        row.status ?? "published",
        row.threadId,
        row.replyToId ?? null,
        row.publishedAt,
        row.lastActivityAt,
        row.publishedAt ?? 0,
        row.publishedAt ?? 0,
      );
  }

  function readPost(id: string): RootRow {
    return sqlite
      .prepare(
        `SELECT quiet_reply, last_activity_at, thread_updated_at
         FROM post WHERE id = ?`,
      )
      .get(id) as RootRow;
  }

  beforeEach(() => {
    sqlite = createTestDatabase().sqlite;
  });

  it("recovers a quiet reply from the gap it left behind", () => {
    // A reply sitting later than the root's recorded activity can only have
    // gotten there by skipping the bump — the signature of a quiet reply.
    insertLegacyPost({
      id: "pst_root",
      threadId: "pst_root",
      publishedAt: 1000,
      lastActivityAt: 1000,
    });
    insertLegacyPost({
      id: "pst_quiet",
      threadId: "pst_root",
      replyToId: "pst_root",
      publishedAt: 3000,
      lastActivityAt: 3000,
    });

    runBackfill();

    expect(readPost("pst_quiet").quiet_reply).toBe(1);
    const root = readPost("pst_root");
    expect(root.last_activity_at).toBe(1000);
    expect(root.thread_updated_at).toBe(3000);
  });

  it("leaves announced replies alone", () => {
    insertLegacyPost({
      id: "pst_root2",
      threadId: "pst_root2",
      publishedAt: 1000,
      lastActivityAt: 2000,
    });
    insertLegacyPost({
      id: "pst_reply2",
      threadId: "pst_root2",
      replyToId: "pst_root2",
      publishedAt: 2000,
      lastActivityAt: 2000,
    });

    runBackfill();

    expect(readPost("pst_reply2").quiet_reply).toBe(0);
    const root = readPost("pst_root2");
    expect(root.last_activity_at).toBe(2000);
    expect(root.thread_updated_at).toBe(2000);
  });

  it("ignores drafts when computing both timestamps", () => {
    insertLegacyPost({
      id: "pst_root3",
      threadId: "pst_root3",
      publishedAt: 1000,
      lastActivityAt: 1000,
    });
    insertLegacyPost({
      id: "pst_draft3",
      threadId: "pst_root3",
      replyToId: "pst_root3",
      publishedAt: null,
      lastActivityAt: null,
      status: "draft",
    });

    runBackfill();

    expect(readPost("pst_draft3").quiet_reply).toBe(0);
    const root = readPost("pst_root3");
    expect(root.last_activity_at).toBe(1000);
    expect(root.thread_updated_at).toBe(1000);
  });

  it("keeps a fully unpublished thread's existing last_activity_at", () => {
    insertLegacyPost({
      id: "pst_root4",
      threadId: "pst_root4",
      publishedAt: null,
      lastActivityAt: 500,
      status: "draft",
    });

    runBackfill();

    const root = readPost("pst_root4");
    expect(root.last_activity_at).toBe(500);
    expect(root.thread_updated_at).toBeNull();
  });

  it("is idempotent", () => {
    insertLegacyPost({
      id: "pst_root5",
      threadId: "pst_root5",
      publishedAt: 1000,
      lastActivityAt: 1000,
    });
    insertLegacyPost({
      id: "pst_quiet5",
      threadId: "pst_root5",
      replyToId: "pst_root5",
      publishedAt: 3000,
      lastActivityAt: 3000,
    });
    insertLegacyPost({
      id: "pst_loud5",
      threadId: "pst_root5",
      replyToId: "pst_root5",
      publishedAt: 900,
      lastActivityAt: 900,
    });

    runBackfill();
    const first = readPost("pst_root5");
    runBackfill();
    runBackfill();
    const third = readPost("pst_root5");

    expect(third).toEqual(first);
    expect(first.last_activity_at).toBe(1000);
    expect(first.thread_updated_at).toBe(3000);
    expect(readPost("pst_quiet5").quiet_reply).toBe(1);
    expect(readPost("pst_loud5").quiet_reply).toBe(0);
  });

  it("scopes recovery to the reply's own thread", () => {
    insertLegacyPost({
      id: "pst_a",
      threadId: "pst_a",
      publishedAt: 5000,
      lastActivityAt: 5000,
    });
    insertLegacyPost({
      id: "pst_b",
      threadId: "pst_b",
      publishedAt: 1000,
      lastActivityAt: 1000,
    });
    // Later than thread A's activity, but it belongs to thread B.
    insertLegacyPost({
      id: "pst_b_reply",
      threadId: "pst_b",
      replyToId: "pst_b",
      publishedAt: 2000,
      lastActivityAt: 2000,
    });

    runBackfill();

    expect(readPost("pst_b_reply").quiet_reply).toBe(1);
    expect(readPost("pst_b").last_activity_at).toBe(1000);
    expect(readPost("pst_a").last_activity_at).toBe(5000);
  });
});
