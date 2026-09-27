/**
 * Schema parity between the two dialects.
 *
 * Jant keeps one schema per dialect — `db/schema.ts` for SQLite and D1,
 * `db/pg/schema.ts` for Postgres — and AGENTS.md requires every change to land
 * in both. Nothing checked it: a column added to one alone compiles, migrates,
 * and passes the SQLite tests, and Drizzle drops what it doesn't know about,
 * so the Postgres site loses that data without an error.
 *
 * These tests compare the two table by table and column by column, including
 * whether a column may be null. The only differences allowed are listed below,
 * each with its reason.
 */

import { is } from "drizzle-orm";
import {
  PgTable,
  getTableConfig as getPgTableConfig,
} from "drizzle-orm/pg-core";
import {
  SQLiteTable,
  getTableConfig as getSqliteTableConfig,
} from "drizzle-orm/sqlite-core";
import { describe, expect, it } from "vitest";
import * as pgSchema from "../pg/schema.js";
import * as sqliteSchema from "../schema.js";

/**
 * Columns only Postgres has. SQLite searches through the `post_fts` virtual
 * table its migrations create; Postgres keeps generated search columns on
 * `post` instead.
 */
const POSTGRES_ONLY_COLUMNS = new Set([
  "post.search_text",
  "post.search_document",
]);

type Column = { notNull: boolean };

/** `table.column` → the column's nullability, for one dialect's schema. */
function readColumns(dialect: "sqlite" | "pg"): Map<string, Column> {
  const columns = new Map<string, Column>();
  const exports =
    dialect === "sqlite"
      ? Object.values(sqliteSchema)
      : Object.values(pgSchema);
  for (const exported of exports) {
    const config =
      dialect === "sqlite"
        ? is(exported, SQLiteTable)
          ? getSqliteTableConfig(exported)
          : null
        : is(exported, PgTable)
          ? getPgTableConfig(exported)
          : null;
    if (!config) continue;
    for (const column of config.columns) {
      columns.set(`${config.name}.${column.name}`, {
        notNull: column.notNull,
      });
    }
  }
  return columns;
}

const sqliteColumns = readColumns("sqlite");
const pgColumns = readColumns("pg");

function tablesOf(columns: Map<string, Column>): string[] {
  return [
    ...new Set([...columns.keys()].map((key) => key.split(".")[0])),
  ].sort();
}

describe("SQLite and Postgres schemas", () => {
  it("declare the same tables", () => {
    expect(tablesOf(sqliteColumns).length).toBeGreaterThan(20);
    expect(tablesOf(pgColumns)).toEqual(tablesOf(sqliteColumns));
  });

  it("declare the same columns, apart from Postgres's search columns", () => {
    const sqliteOnly = [...sqliteColumns.keys()].filter(
      (key) => !pgColumns.has(key),
    );
    const pgOnly = [...pgColumns.keys()].filter(
      (key) => !sqliteColumns.has(key) && !POSTGRES_ONLY_COLUMNS.has(key),
    );
    expect({ sqliteOnly, pgOnly }).toEqual({ sqliteOnly: [], pgOnly: [] });
  });

  it("agree on which columns may be null", () => {
    const differ = [...sqliteColumns]
      .filter(([key, column]) => {
        const pg = pgColumns.get(key);
        return pg !== undefined && pg.notNull !== column.notNull;
      })
      .map(([key]) => key);
    expect(differ).toEqual([]);
  });
});
