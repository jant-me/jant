/**
 * Snapshot Table Registry Guard
 *
 * `jant site snapshot export/import` walks two hand-written arrays in
 * `bin/lib/site-snapshot.js`. Nothing connects them to `db/schema.ts`: `bin/`
 * is plain JavaScript, outside the type system, so a new site-scoped table
 * compiles, lints and tests clean while the snapshot silently skips it.
 *
 * That already happened. `smart_collection` arrived with migration 0033, and
 * the commit that added it updated the schema, both dialects, five services, a
 * route and three test files — but not these arrays. The damage was silent in
 * both directions: export dropped smart collections, and `--replace` could not
 * delete the ones a visitor created, so they outlived every nightly demo
 * rebuild as rows with no slug and no nav entry.
 *
 * These tests close the gap. Every site-scoped table has to be named in one of
 * the two registries, so a new table forces a decision instead of defaulting to
 * "forgotten". The order assertions pin the arrays' other implicit contract:
 * `SNAPSHOT_TABLES` is an INSERT order and `SNAPSHOT_CLEAR_TABLES` is a DELETE
 * order, and both have to respect foreign keys — which are enforced, on D1 and
 * on Node alike (`bin/lib/node-sqlite.js` sets `foreign_keys = ON`).
 *
 * Reading `db/schema.ts` alone covers both dialects: the registries are shared
 * (only the dumped SQL is dialect-specific), and `db/pg/schema.ts` is required
 * to declare the same tables.
 */

import { is } from "drizzle-orm";
import { SQLiteTable, getTableConfig } from "drizzle-orm/sqlite-core";
import { describe, expect, it } from "vitest";
import {
  SNAPSHOT_CLEAR_TABLES,
  SNAPSHOT_EXCLUDED_TABLES,
  SNAPSHOT_TABLES,
  getSnapshotSelectSql,
} from "../../bin/lib/site-snapshot.js";
import {
  TABLE_EXPORT_ORDER,
  sortExportTables,
} from "../../bin/lib/sql-export.js";
import * as schema from "../db/schema.js";

/** `site_setting` is cleared by key, not wholesale — see `buildReplaceSql`. */
const CLEARED_BY_KEY = "site_setting";

type SchemaTable = {
  /** Physical table name, as it appears in SQL. */
  name: string;
  /** Tables this one points at with a foreign key, excluding self-references. */
  dependsOn: string[];
};

/**
 * Reads every site-scoped table out of the Drizzle schema with its foreign-key
 * dependencies. "Site-scoped" means the table carries a `site_id` column, which
 * is what makes a row belong to one site's content rather than the instance.
 *
 * @returns One entry per site-scoped table, in declaration order.
 */
function readSiteScopedTables(): SchemaTable[] {
  const tables: SchemaTable[] = [];

  for (const exported of Object.values(schema)) {
    if (!is(exported, SQLiteTable)) continue;
    const config = getTableConfig(exported);
    if (!config.columns.some((column) => column.name === "site_id")) continue;

    const dependsOn = [
      ...new Set(
        config.foreignKeys.map(
          (foreignKey) =>
            getTableConfig(foreignKey.reference().foreignTable).name,
        ),
      ),
    ].filter((target) => target !== config.name);

    tables.push({ name: config.name, dependsOn });
  }

  return tables;
}

const siteScopedTables = readSiteScopedTables();
const siteScopedNames = siteScopedTables.map((table) => table.name);

describe("snapshot table registry", () => {
  it("covers every site-scoped table as content or an explicit exclusion", () => {
    const registered = new Set<string>([
      ...SNAPSHOT_TABLES,
      ...SNAPSHOT_EXCLUDED_TABLES,
    ]);
    const unregistered = siteScopedNames.filter(
      (name) => !registered.has(name),
    );

    expect(
      unregistered,
      [
        "These site-scoped tables are in db/schema.ts but in neither snapshot registry.",
        "A table the snapshot does not know about is dropped on export and survives",
        "`--replace` on import. Add it to SNAPSHOT_TABLES if it is site content, or to",
        "SNAPSHOT_EXCLUDED_TABLES with the reason if it is shell, credential or",
        "transient state, in bin/lib/site-snapshot.js.",
      ].join("\n"),
    ).toEqual([]);
  });

  it("does not register a table as both content and excluded", () => {
    const excluded = new Set<string>(SNAPSHOT_EXCLUDED_TABLES);
    const both = SNAPSHOT_TABLES.filter((name) => excluded.has(name));

    expect(both).toEqual([]);
  });

  it("can build an export query for every content table", () => {
    // `getSnapshotSelectSql` has no default branch: a table listed as content
    // without a matching statement throws "Unsupported snapshot table" at
    // export time, which is the same silent-until-used failure the registry
    // itself had.
    for (const table of SNAPSHOT_TABLES) {
      expect(() =>
        getSnapshotSelectSql(table, "sit_00000000000000000000000000"),
      ).not.toThrow();
    }
  });

  it("does not keep registry entries for tables the schema dropped", () => {
    const known = new Set(siteScopedNames);
    const stale = [...SNAPSHOT_TABLES, ...SNAPSHOT_EXCLUDED_TABLES].filter(
      (name) => !known.has(name),
    );

    expect(stale).toEqual([]);
  });
});

describe("snapshot table ordering", () => {
  it("registers every content table for export ordering", () => {
    // A table missing here is not merely unordered: `sortExportTables` places
    // unknown names after every known one, so a new child table is dumped
    // behind its own parents and the import fails the first time a row exists
    // to violate the constraint.
    const ordered = new Set<string>(TABLE_EXPORT_ORDER);
    expect(SNAPSHOT_TABLES.filter((name) => !ordered.has(name))).toEqual([]);
  });

  it("inserts a table only after every table it references", () => {
    // The order an export actually follows. `SNAPSHOT_TABLES` is re-sorted by
    // `TABLE_EXPORT_ORDER` on the way out, so asserting on the raw list would
    // check something the dump ignores.
    const position = new Map(
      sortExportTables(SNAPSHOT_TABLES).map((name, index) => [name, index]),
    );
    const violations: string[] = [];

    for (const table of siteScopedTables) {
      const self = position.get(table.name);
      if (self === undefined) continue;

      for (const dependency of table.dependsOn) {
        const parent = position.get(dependency);
        if (parent === undefined) continue;
        if (parent > self) {
          violations.push(
            `${table.name} (${self}) references ${dependency} (${parent})`,
          );
        }
      }
    }

    expect(
      violations,
      [
        "TABLE_EXPORT_ORDER in sql-export.js is the order rows are dumped, and so the",
        "order they are inserted on import. A table has to come after everything it",
        "points at with a foreign key, or the child row lands before its parent exists",
        "and the insert fails the constraint.",
      ].join("\n"),
    ).toEqual([]);
  });

  it("deletes a table before every table it references", () => {
    const position = new Map(
      SNAPSHOT_CLEAR_TABLES.map((name, index) => [name, index]),
    );
    const violations: string[] = [];

    for (const table of siteScopedTables) {
      const self = position.get(table.name);
      if (self === undefined) continue;

      for (const dependency of table.dependsOn) {
        const parent = position.get(dependency);
        if (parent === undefined) continue;
        if (parent < self) {
          violations.push(
            `${table.name} (${self}) references ${dependency} (${parent})`,
          );
        }
      }
    }

    expect(
      violations,
      [
        "SNAPSHOT_CLEAR_TABLES is the order rows are deleted by `--replace`, so a table",
        "has to come before everything it points at. Deleting the parent first only",
        "appears to work because the cascade takes the children with it — which is",
        "implicit, and stops being true the moment a reference is not ON DELETE CASCADE.",
      ].join("\n"),
    ).toEqual([]);
  });

  it("clears every content table except the one cleared by key", () => {
    expect([...SNAPSHOT_CLEAR_TABLES].sort()).toEqual(
      SNAPSHOT_TABLES.filter((name) => name !== CLEARED_BY_KEY).sort(),
    );
  });
});
