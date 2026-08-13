/**
 * Executes the real 0006 backfill SQL against snapshot-shaped nav rows.
 *
 * The backfill runs on user data through `jant migrate`, and the same file is
 * executed on both SQLite and Postgres, so it has to be portable and safe to
 * rerun. These tests cover the SQLite side; the SQL avoids dialect-specific
 * syntax (no `UPDATE ... FROM`, only correlated subqueries).
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
    "../backfills/0006_clear_mirrored_page_nav_labels.sql",
  ),
  "utf-8",
);

const POST_ID = "pst_backfill00000000000000001";
const COLLECTION_ID = "col_backfill00000000000000001";

describe("0006 backfill — clear nav labels that mirror their target", () => {
  let sqlite: BetterSqlite3.Database;

  function runBackfill() {
    sqlite.exec(BACKFILL_SQL);
  }

  function labelOf(id: string): string {
    const row = sqlite
      .prepare(`SELECT label FROM nav_item WHERE id = ?`)
      .get(id) as { label: string };
    return row.label;
  }

  function insertNavItem(row: {
    id: string;
    type: "page" | "collection" | "link";
    label: string;
    position?: string;
    postId?: string;
    collectionId?: string;
  }) {
    sqlite
      .prepare(
        `INSERT INTO nav_item (
           id, site_id, type, post_id, collection_id, label, url,
           placement, position, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, '/x', 'header', ?, 1, 1)`,
      )
      .run(
        row.id,
        DEFAULT_TEST_SITE_ID,
        row.type,
        row.postId ?? null,
        row.collectionId ?? null,
        row.label,
        row.position ?? "a0",
      );
  }

  beforeEach(() => {
    sqlite = createTestDatabase().sqlite;
    sqlite
      .prepare(
        `INSERT INTO post (
           id, site_id, format, status, visibility, title, thread_id,
           published_at, last_activity_at, created_at, updated_at
         ) VALUES (?, ?, 'note', 'published', 'latest_hidden', 'About me', ?, 1, 1, 1, 1)`,
      )
      .run(POST_ID, DEFAULT_TEST_SITE_ID, POST_ID);
    sqlite
      .prepare(
        `INSERT INTO collection (id, site_id, title, sort_order, created_at, updated_at)
         VALUES (?, ?, 'Design Notes', 'newest', 1, 1)`,
      )
      .run(COLLECTION_ID, DEFAULT_TEST_SITE_ID);
  });

  it("clears a page label that only mirrors the post title", () => {
    insertNavItem({
      id: "nav_mirror0000000000000000001",
      type: "page",
      label: "About me",
      postId: POST_ID,
    });

    runBackfill();

    expect(labelOf("nav_mirror0000000000000000001")).toBe("");
  });

  it("clears a collection label that only mirrors the collection title", () => {
    insertNavItem({
      id: "nav_mirror0000000000000000002",
      type: "collection",
      label: "Design Notes",
      collectionId: COLLECTION_ID,
    });

    runBackfill();

    expect(labelOf("nav_mirror0000000000000000002")).toBe("");
  });

  it("keeps a label the author typed", () => {
    insertNavItem({
      id: "nav_custom0000000000000000001",
      type: "page",
      label: "Colophon",
      postId: POST_ID,
    });
    insertNavItem({
      id: "nav_custom0000000000000000002",
      type: "link",
      label: "About me",
      position: "a1",
    });

    runBackfill();

    expect(labelOf("nav_custom0000000000000000001")).toBe("Colophon");
    // A free-form link has no target to follow, so its label is never cleared
    // even when it happens to read like one.
    expect(labelOf("nav_custom0000000000000000002")).toBe("About me");
  });

  it("is safe to rerun", () => {
    insertNavItem({
      id: "nav_mirror0000000000000000003",
      type: "page",
      label: "About me",
      postId: POST_ID,
    });

    runBackfill();
    runBackfill();

    expect(labelOf("nav_mirror0000000000000000003")).toBe("");
  });
});
