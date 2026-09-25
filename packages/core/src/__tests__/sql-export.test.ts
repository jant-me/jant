/**
 * The SQL dump behind `db export` and `site snapshot export`.
 *
 * On D1 every query goes through `wrangler d1 execute --json`, whose output
 * the CLI buffers. One `SELECT *` of a real site's `post` table overflowed
 * that buffer, so the dump reads D1 a page at a time.
 */

import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { dumpDatabaseToSql } from "../../bin/lib/sql-export.js";
import { orderSnapshotPostRows } from "../../bin/lib/site-snapshot.js";
import { describeWranglerFailure } from "../../bin/lib/d1-query.js";
import { WRANGLER_MAX_BUFFER } from "../../bin/lib/wrangler-cli.js";

function createQueryRunner() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE "post" ("id" TEXT PRIMARY KEY, "site_id" TEXT, "body" TEXT);
  `);
  const insert = db.prepare(
    `INSERT INTO "post" ("id", "site_id", "body") VALUES (?, ?, ?)`,
  );
  for (let index = 0; index < 7; index += 1) {
    insert.run(`pst_${index}`, "site", `body ${index}`);
  }

  const statements: string[] = [];
  return {
    statements,
    runner: {
      async query(sql: string) {
        statements.push(sql);
        return db.prepare(sql).all() as Record<string, unknown>[];
      },
    },
  };
}

describe("dumpDatabaseToSql", () => {
  it("reads a table in pages when given a page size", async () => {
    const { runner, statements } = createQueryRunner();

    const sql = await dumpDatabaseToSql(runner, {
      source: "local",
      dialect: "sqlite",
      tables: ["post"],
      pageSize: 3,
    });

    const reads = statements.filter((statement) =>
      statement.includes('FROM "post"'),
    );
    expect(reads).toEqual([
      'SELECT * FROM "post" ORDER BY rowid LIMIT 3 OFFSET 0',
      'SELECT * FROM "post" ORDER BY rowid LIMIT 3 OFFSET 3',
      'SELECT * FROM "post" ORDER BY rowid LIMIT 3 OFFSET 6',
    ]);
    for (let index = 0; index < 7; index += 1) {
      expect(sql).toContain(`'pst_${index}'`);
    }
  });

  it("pages a table's own ordered select", async () => {
    const { runner, statements } = createQueryRunner();

    const sql = await dumpDatabaseToSql(runner, {
      source: "local",
      dialect: "sqlite",
      tables: ["post"],
      pageSize: 5,
      selectSqlByTable: {
        post: `SELECT * FROM "post" WHERE "site_id" = 'site' ORDER BY "id"\n`,
      },
    });

    expect(
      statements.filter((statement) => statement.includes('FROM "post"')),
    ).toEqual([
      `SELECT * FROM "post" WHERE "site_id" = 'site' ORDER BY "id" LIMIT 5 OFFSET 0`,
      `SELECT * FROM "post" WHERE "site_id" = 'site' ORDER BY "id" LIMIT 5 OFFSET 5`,
    ]);
    expect(sql.match(/INSERT INTO "post"/g)).toHaveLength(7);
  });

  it("reads a table in one query without a page size", async () => {
    const { runner, statements } = createQueryRunner();

    await dumpDatabaseToSql(runner, {
      source: "node",
      dialect: "sqlite",
      tables: ["post"],
    });

    expect(
      statements.filter((statement) => statement.includes('FROM "post"')),
    ).toEqual(['SELECT * FROM "post"']);
  });
});

describe("describeWranglerFailure", () => {
  it("names the buffer overflow instead of echoing the rows", () => {
    const error = Object.assign(new Error("spawnSync node ENOBUFS"), {
      code: "ENOBUFS",
      stdout: '[{"results":[' + '{"id":"pst_x","body":"…"},'.repeat(50_000),
      stderr: "",
    });

    const message = describeWranglerFailure(
      ["d1", "execute", "DB", "--local", "--json"],
      error,
    );

    expect(message).toBe(
      `\`wrangler d1 execute DB\` printed more than ${WRANGLER_MAX_BUFFER} bytes, the most the CLI buffers.`,
    );
  });

  it("keeps a long failure's stdout to an excerpt", () => {
    const message = describeWranglerFailure(["d1", "execute", "DB"], {
      name: "Error",
      message: "Command failed",
      stdout: "x".repeat(10_000),
      stderr: "",
    } as Error & { stdout: string; stderr: string });

    expect(message.length).toBeLessThan(2_200);
    expect(message).toContain("(10000 characters)");
  });
});

describe("snapshot post order", () => {
  it("puts every post after its root and the post it replies to", () => {
    const rows = [
      { id: "reply-2", thread_id: "root", reply_to_id: "reply-1" },
      { id: "reply-1", thread_id: "root", reply_to_id: "root" },
      { id: "other", thread_id: "other", reply_to_id: null },
      { id: "root", thread_id: "root", reply_to_id: null },
    ];

    expect(orderSnapshotPostRows(rows).map((row) => row.id)).toEqual([
      "root",
      "reply-1",
      "reply-2",
      "other",
    ]);
  });

  it("keeps the dump order when parents already come first", () => {
    const rows = [
      { id: "a", thread_id: "a", reply_to_id: null },
      { id: "b", thread_id: "a", reply_to_id: "a" },
      { id: "c", thread_id: "c", reply_to_id: null },
    ];

    expect(orderSnapshotPostRows(rows)).toEqual(rows);
  });

  it("applies a table's row order to the dump", async () => {
    const { runner } = createQueryRunner();

    const sql = await dumpDatabaseToSql(runner, {
      source: "node",
      dialect: "sqlite",
      tables: ["post"],
      orderRowsByTable: {
        post: (rows: Record<string, unknown>[]) => [...rows].reverse(),
      },
    });

    expect(sql.indexOf("'pst_6'")).toBeLessThan(sql.indexOf("'pst_0'"));
  });
});
