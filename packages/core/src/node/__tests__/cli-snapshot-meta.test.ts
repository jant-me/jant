import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  assertSnapshotDialectMatches,
  assertSnapshotMeta,
  assertSnapshotSchemaInstalled,
  listInstalledSchemaTags,
  buildMediaProviderSql,
  buildSnapshotMeta,
  getSnapshotDialect,
  SNAPSHOT_VERSION,
  upgradeSnapshotSql,
  upgradeV1SnapshotSql,
} from "../../../bin/lib/site-snapshot.js";

const SITE = { id: "sit_test", key: "default" };

describe("buildSnapshotMeta", () => {
  it("includes the dialect when provided", () => {
    const meta = buildSnapshotMeta(SITE, { dialect: "pg" });
    expect(meta.version).toBe(2);
    expect(meta.dialect).toBe("pg");
    expect(meta.site).toEqual({ id: "sit_test", key: "default" });
  });

  it("omits the dialect field when not provided (back-compat)", () => {
    const meta = buildSnapshotMeta(SITE);
    expect("dialect" in meta).toBe(false);
  });

  it("rejects unknown dialects at build time", () => {
    expect(() => buildSnapshotMeta(SITE, { dialect: "mysql" })).toThrow(
      /Unsupported snapshot dialect/,
    );
  });
});

describe("snapshot schema", () => {
  const packageVersion = JSON.parse(
    readFileSync(new URL("../../../package.json", import.meta.url), "utf8"),
  ).version;

  it("records the writing version and its last migration per dialect", () => {
    for (const dialect of ["sqlite", "pg"] as const) {
      const meta = buildSnapshotMeta(SITE, { dialect });
      expect(meta.jant).toBe(packageVersion);
      expect(meta.schema).toBe(listInstalledSchemaTags(dialect).at(-1));
    }
  });

  it("accepts a snapshot whose schema the installed package ships", () => {
    const meta = buildSnapshotMeta(SITE, { dialect: "pg" });
    expect(() => assertSnapshotSchemaInstalled(meta)).not.toThrow();
    const older = {
      ...meta,
      schema: listInstalledSchemaTags("pg")[0],
    };
    expect(() => assertSnapshotSchemaInstalled(older)).not.toThrow();
  });

  it("accepts a snapshot from before the schema was recorded", () => {
    const {
      schema: _schema,
      jant: _jant,
      ...legacy
    } = buildSnapshotMeta(SITE, { dialect: "sqlite" });
    expect(() => assertSnapshotSchemaInstalled(legacy)).not.toThrow();
  });

  it("refuses a snapshot from a newer schema, naming the fix", () => {
    const meta = {
      ...buildSnapshotMeta(SITE, { dialect: "sqlite" }),
      jant: "9.0.0",
      schema: "9999_later_change",
    };
    expect(() => assertSnapshotSchemaInstalled(meta)).toThrow(
      /Jant 9\.0\.0.*9999_later_change.*Upgrade @jant\/core/,
    );
  });

  it("checks a snapshot against its own dialect's migrations", () => {
    const sqliteTag = listInstalledSchemaTags("sqlite").at(-1);
    const pgTags = listInstalledSchemaTags("pg");
    expect(pgTags).not.toContain(sqliteTag);
    const meta = {
      ...buildSnapshotMeta(SITE, { dialect: "pg" }),
      schema: sqliteTag,
    };
    expect(() => assertSnapshotSchemaInstalled(meta)).toThrow();
  });

  it("rejects a non-string jant or schema field", () => {
    expect(() =>
      assertSnapshotMeta({ ...buildSnapshotMeta(SITE), schema: 34 }),
    ).toThrow(/schema must be a string/);
  });
});

describe("assertSnapshotMeta", () => {
  it("accepts a known dialect", () => {
    expect(() =>
      assertSnapshotMeta(buildSnapshotMeta(SITE, { dialect: "sqlite" })),
    ).not.toThrow();
  });

  it("accepts a snapshot without a dialect (legacy)", () => {
    expect(() => assertSnapshotMeta(buildSnapshotMeta(SITE))).not.toThrow();
  });

  it("accepts v1 snapshots for import compatibility", () => {
    expect(() =>
      assertSnapshotMeta({
        format: "jant-site-snapshot",
        version: 1,
        site: SITE,
      }),
    ).not.toThrow();
  });

  it("rejects unknown snapshot versions", () => {
    expect(() =>
      assertSnapshotMeta({
        format: "jant-site-snapshot",
        version: SNAPSHOT_VERSION + 1,
        site: SITE,
      }),
    ).toThrow(/Unsupported snapshot version/);
  });

  it("rejects an unknown dialect at read time", () => {
    expect(() =>
      assertSnapshotMeta({
        format: "jant-site-snapshot",
        version: 1,
        dialect: "mysql",
        site: SITE,
      }),
    ).toThrow(/Snapshot meta has unsupported dialect/);
  });
});

describe("upgradeV1SnapshotSql", () => {
  it("unions per-post Collection rows into Thread rows without losing metadata", () => {
    const sql = `
      INSERT INTO "collection" ("id", "site_id") VALUES('col_a', 'sit_test');
      INSERT INTO "collection" ("id", "site_id") VALUES('col_b', 'sit_test');
      INSERT INTO "post" ("id", "site_id", "thread_id") VALUES('pst_root', 'sit_test', 'pst_root');
      INSERT INTO "post" ("id", "site_id", "thread_id") VALUES('pst_reply', 'sit_test', 'pst_root');
      INSERT INTO "post_collection" ("site_id", "post_id", "collection_id", "created_at", "position", "pinned_at") VALUES('sit_test', 'pst_root', 'col_a', 10, 5, 40);
      INSERT INTO "post_collection" ("site_id", "post_id", "collection_id", "created_at", "position", "pinned_at") VALUES('sit_test', 'pst_reply', 'col_a', 30, 2, 20);
      INSERT INTO "post_collection" ("site_id", "post_id", "collection_id", "created_at", "position", "pinned_at") VALUES('sit_test', 'pst_reply', 'col_b', 15, 9, NULL);
    `;

    const upgraded = upgradeV1SnapshotSql(sql);
    expect(upgraded).not.toContain('INSERT INTO "post_collection"');
    expect(upgraded).toContain(
      'INSERT INTO "thread_collection" ("site_id", "thread_id", "collection_id", "created_at", "position", "pinned_at") VALUES(\'sit_test\', \'pst_root\', \'col_a\', 30, 2, 40)',
    );
    expect(upgraded).toContain(
      'INSERT INTO "thread_collection" ("site_id", "thread_id", "collection_id", "created_at", "position", "pinned_at") VALUES(\'sit_test\', \'pst_root\', \'col_b\', 15, 9, NULL)',
    );
  });

  it("preserves comment-like lines inside multiline post content", () => {
    const body = ["before", "-- must survive", "---", "after"].join("\n");
    const sql = `
      -- export metadata must be ignored as a real SQL comment
      INSERT INTO "collection" ("id", "site_id") VALUES('col_a', 'sit_test');
      INSERT INTO "post" ("id", "site_id", "thread_id", "body") VALUES('pst_root', 'sit_test', 'pst_root', '${body}');
      INSERT INTO "post_collection" ("site_id", "post_id", "collection_id", "created_at", "position", "pinned_at") VALUES('sit_test', 'pst_root', 'col_a', 10, 0, NULL);
    `;

    const upgraded = upgradeV1SnapshotSql(sql);
    expect(upgraded).toContain(`'${body}'`);
    expect(upgraded).not.toContain("export metadata must be ignored");
  });

  it("fails a dangling v1 membership during preflight conversion", () => {
    const sql = `
      INSERT INTO "post_collection" ("site_id", "post_id", "collection_id", "created_at", "position", "pinned_at") VALUES('sit_test', 'pst_missing', 'col_a', 10, 0, NULL);
    `;
    expect(() => upgradeV1SnapshotSql(sql)).toThrow(
      /references missing post pst_missing.*target content was not changed/,
    );
  });

  it("fails a v1 membership whose Collection is missing", () => {
    const sql = `
      INSERT INTO "post" ("id", "site_id", "thread_id") VALUES('pst_root', 'sit_test', 'pst_root');
      INSERT INTO "post_collection" ("site_id", "post_id", "collection_id", "created_at", "position", "pinned_at") VALUES('sit_test', 'pst_root', 'col_missing', 10, 0, NULL);
    `;

    expect(() => upgradeV1SnapshotSql(sql)).toThrow(
      /references missing Collection col_missing.*target content was not changed/,
    );
  });

  it("fails a v1 membership whose thread_id points at a reply", () => {
    const sql = `
      INSERT INTO "collection" ("id", "site_id") VALUES('col_a', 'sit_test');
      INSERT INTO "post" ("id", "site_id", "thread_id") VALUES('pst_member', 'sit_test', 'pst_reply');
      INSERT INTO "post" ("id", "site_id", "thread_id") VALUES('pst_reply', 'sit_test', 'pst_root');
      INSERT INTO "post_collection" ("site_id", "post_id", "collection_id", "created_at", "position", "pinned_at") VALUES('sit_test', 'pst_member', 'col_a', 10, 0, NULL);
    `;

    expect(() => upgradeV1SnapshotSql(sql)).toThrow(
      /references invalid Thread root pst_reply.*target content was not changed/,
    );
  });

  it("leaves v2 SQL unchanged", () => {
    const sql =
      'INSERT INTO "thread_collection" ("site_id") VALUES(\'sit_test\');';
    expect(upgradeSnapshotSql(sql, 2)).toBe(sql);
  });
});

describe("getSnapshotDialect", () => {
  it("returns the dialect when valid", () => {
    expect(getSnapshotDialect({ dialect: "pg" })).toBe("pg");
    expect(getSnapshotDialect({ dialect: "sqlite" })).toBe("sqlite");
  });

  it("returns undefined for missing or invalid dialect", () => {
    expect(getSnapshotDialect({})).toBeUndefined();
    expect(getSnapshotDialect({ dialect: "mysql" })).toBeUndefined();
    expect(getSnapshotDialect(null)).toBeUndefined();
  });
});

describe("assertSnapshotDialectMatches", () => {
  it("passes when source and target dialects match", () => {
    expect(() =>
      assertSnapshotDialectMatches({ dialect: "pg" }, "pg"),
    ).not.toThrow();
  });

  it("throws a descriptive error when dialects mismatch", () => {
    expect(() =>
      assertSnapshotDialectMatches({ dialect: "sqlite" }, "pg"),
    ).toThrow(/Snapshot dialect mismatch.*source is sqlite.*target is pg/s);
  });

  it("skips validation when the snapshot predates the dialect field", () => {
    // Older snapshots have no dialect field — we don't know the source, so we
    // can't refuse them. The user opts into the looser check by importing
    // legacy snapshots; cross-dialect SQL errors will surface mid-import.
    expect(() => assertSnapshotDialectMatches({}, "pg")).not.toThrow();
  });
});

describe("buildMediaProviderSql", () => {
  it("records the site's media under the given storage driver", () => {
    expect(buildMediaProviderSql("sit_o'brien", "s3")).toBe(
      `UPDATE "media" SET "provider" = 's3' WHERE "site_id" = 'sit_o''brien';`,
    );
  });

  // The value is written into SQL and read back as where the bytes live, so
  // anything but a real driver is refused rather than quoted.
  it("refuses anything that is not a storage driver", () => {
    expect(() => buildMediaProviderSql("sit_test", "gcs")).toThrow(
      'Snapshot import cannot record media under storage driver "gcs".',
    );
    expect(() => buildMediaProviderSql("sit_test", "s3' OR '1")).toThrow(
      "cannot record media under storage driver",
    );
  });
});
