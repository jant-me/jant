/**
 * Executes the real 0008 backfill SQL against a stored `featured` Discover
 * choice. The same file runs on Postgres; it is a plain `UPDATE`.
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
    "../backfills/0008_turn_off_featured_only_discover.sql",
  ),
  "utf-8",
);

describe("0008 backfill — turn off featured-only Discover", () => {
  it("turns `featured` off and leaves other choices alone, on every run", () => {
    const { sqlite } = createTestDatabase();
    sqlite.exec(
      `INSERT INTO site (id, key, created_at, updated_at)
       VALUES ('sit_other', 'other', 1, 1)`,
    );
    const insert = sqlite.prepare(
      `INSERT INTO site_setting (site_id, key, value, updated_at)
       VALUES (?, ?, ?, 1)`,
    );
    insert.run(DEFAULT_TEST_SITE_ID, "DISCOVER", "featured");
    insert.run(DEFAULT_TEST_SITE_ID, "MAIN_RSS_FEED", "featured");
    insert.run("sit_other", "DISCOVER", "latest");

    sqlite.exec(BACKFILL_SQL);
    sqlite.exec(BACKFILL_SQL);

    expect(
      sqlite
        .prepare(
          "SELECT site_id, key, value FROM site_setting ORDER BY site_id, key",
        )
        .all(),
    ).toEqual([
      { site_id: "sit_other", key: "DISCOVER", value: "latest" },
      { site_id: DEFAULT_TEST_SITE_ID, key: "DISCOVER", value: "off" },
      {
        site_id: DEFAULT_TEST_SITE_ID,
        key: "MAIN_RSS_FEED",
        value: "featured",
      },
    ]);
  });
});
