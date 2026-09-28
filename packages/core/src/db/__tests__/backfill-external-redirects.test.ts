/**
 * Executes the real 0007 backfill SQL against redirects stored by the old
 * path normalizer. The same file runs on Postgres; it uses only `||`,
 * `substr`, and `LIKE`, which both dialects share.
 */

import { readFileSync } from "fs";
import { resolve } from "path";
import { describe, expect, it } from "vitest";
import {
  createTestDatabase,
  DEFAULT_TEST_SITE_ID,
} from "../../__tests__/helpers/db.js";

const BACKFILL_SQL = readFileSync(
  resolve(
    import.meta.dirname,
    "../backfills/0007_restore_external_redirect_scheme.sql",
  ),
  "utf-8",
);

describe("0007 backfill — restore external redirect targets", () => {
  it("puts back the scheme's // and leaves other targets alone, on every run", () => {
    const { sqlite } = createTestDatabase();
    const insert = sqlite.prepare(
      `INSERT INTO path_registry (
         id, site_id, path, kind, redirect_to_path, redirect_type,
         created_at, updated_at
       ) VALUES (?, ?, ?, 'redirect', ?, 301, 1, 1)`,
    );
    insert.run(
      "pth_a",
      DEFAULT_TEST_SITE_ID,
      "old-a",
      "https:/example.com/page",
    );
    insert.run("pth_b", DEFAULT_TEST_SITE_ID, "old-b", "http:/example.com");
    insert.run("pth_c", DEFAULT_TEST_SITE_ID, "old-c", "https://example.com/x");
    insert.run("pth_d", DEFAULT_TEST_SITE_ID, "old-d", "archive?format=note");

    sqlite.exec(BACKFILL_SQL);
    sqlite.exec(BACKFILL_SQL);

    const targets = Object.fromEntries(
      (
        sqlite
          .prepare("SELECT id, redirect_to_path FROM path_registry")
          .all() as { id: string; redirect_to_path: string }[]
      ).map((row) => [row.id, row.redirect_to_path]),
    );
    expect(targets).toEqual({
      pth_a: "https://example.com/page",
      pth_b: "http://example.com",
      pth_c: "https://example.com/x",
      pth_d: "archive?format=note",
    });
  });
});
