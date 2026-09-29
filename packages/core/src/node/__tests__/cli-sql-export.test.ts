import { describe, expect, it } from "vitest";
import {
  getTableColumns,
  listExportTables,
} from "../../../bin/lib/sql-export.js";

interface CapturedQueryRunner {
  query: (sql: string) => Promise<Array<Record<string, unknown>>>;
  lastSql?: string;
}

function createQueryRunner(
  rows: Array<Record<string, unknown>>,
): CapturedQueryRunner {
  const runner: CapturedQueryRunner = {
    async query(sql: string) {
      runner.lastSql = sql;
      return rows;
    },
  };
  return runner;
}

describe("getTableColumns", () => {
  it("filters Postgres GENERATED ALWAYS columns out of the dump column list", async () => {
    const runner = createQueryRunner([
      { name: "id" },
      { name: "title" },
      // pg already filters via is_generated = 'NEVER', so the runner only
      // returns the storable columns. We capture the SQL to assert the WHERE.
    ]);

    const columns = await getTableColumns(runner, "post", "pg");

    expect(columns).toEqual(["id", "title"]);
    expect(runner.lastSql).toMatch(/is_generated\s*=\s*'NEVER'/);
  });

  it("filters SQLite STORED/VIRTUAL generated columns via table_xinfo.hidden", async () => {
    const runner = createQueryRunner([
      { cid: 0, name: "id", hidden: 0 },
      { cid: 1, name: "title", hidden: 0 },
      { cid: 2, name: "search_virtual", hidden: 2 },
      { cid: 3, name: "search_stored", hidden: 3 },
    ]);

    const columns = await getTableColumns(runner, "post", "sqlite");

    expect(columns).toEqual(["id", "title"]);
    expect(runner.lastSql).toMatch(/PRAGMA\s+table_xinfo/);
  });
});

describe("listExportTables", () => {
  // D1 keeps a table of its own (`_cf_KV` remotely, `_cf_METADATA` locally)
  // and refuses every read of it, so asking for its columns failed
  // `jant db export --remote` on every Cloudflare site.
  it("leaves out D1's own tables, migration history, and the search index", async () => {
    const runner = createQueryRunner(
      [
        "_cf_KV",
        "_cf_METADATA",
        "d1_migrations",
        "post",
        "post_fts",
        "post_fts_data",
        "site",
      ].map((name) => ({ name, sql: `CREATE TABLE "${name}" (id)` })),
    );

    expect(await listExportTables(runner)).toEqual(["site", "post"]);
  });
});
