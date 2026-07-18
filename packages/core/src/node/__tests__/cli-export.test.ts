import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";
import { run } from "../../../bin/commands/export.js";
import { migrate } from "../runtime.js";
import type { Bindings } from "../../types.js";

describe("jant export", () => {
  const tempDirs: string[] = [];
  const originalEnv = process.env.DATABASE_URL;
  const siteId = "sit_01jpyz1h3v4m7s2k8r5c9t0qbd";
  const collectionId = "col_01jpyz1q6s4m8v2k5t9c3b7qdh";
  const postId = "pst_01jpyz20kt5n9r3k8t6c4d2qhf";

  afterEach(async () => {
    if (originalEnv === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = originalEnv;
    }

    await Promise.all(
      tempDirs.map((dir) => rm(dir, { recursive: true, force: true })),
    );
    tempDirs.length = 0;
    vi.restoreAllMocks();
  });

  it("exports the Node SQLite database using explicit column lists", async () => {
    const root = await mkdtemp(join(tmpdir(), "jant-export-"));
    tempDirs.push(root);

    const databasePath = join(root, "jant.sqlite");
    const exportPath = join(root, "jant-export.sql");

    await migrate({ DATABASE_URL: `file:${databasePath}` } as Bindings);
    process.env.DATABASE_URL = `file:${databasePath}`;

    const sqlite = new Database(databasePath);
    try {
      sqlite.exec(`
        INSERT INTO "site" ("id", "key", "status", "created_at", "updated_at")
        VALUES ('${siteId}', 'default', 'active', 1773753600, 1773753600);

        INSERT INTO "site_setting" ("site_id", "key", "value", "updated_at")
        VALUES ('${siteId}', 'SITE_NAME', 'Test Site', 1773753605);

        INSERT INTO "collection" ("id", "site_id", "title", "sort_order", "created_at", "updated_at")
        VALUES ('${collectionId}', '${siteId}', 'Ideas', 'newest', 1773753606, 1773753606);

        INSERT INTO "post" ("id", "site_id", "format", "status", "visibility", "thread_id", "created_at", "updated_at")
        VALUES ('${postId}', '${siteId}', 'note', 'published', 'public', '${postId}', 1773753607, 1773753607);

        INSERT INTO "thread_collection" ("site_id", "thread_id", "collection_id", "created_at", "position", "pinned_at")
        VALUES ('${siteId}', '${postId}', '${collectionId}', 1773753608, 3, NULL);
      `);
    } finally {
      sqlite.close();
    }

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await run(["--output", exportPath]);

    const output = await readFile(exportPath, "utf-8");
    expect(output).toContain("-- Source: node");
    expect(output).toContain(
      `INSERT INTO "site_setting" ("site_id", "key", "value", "updated_at") VALUES('${siteId}', 'SITE_NAME', 'Test Site', 1773753605);`,
    );
    expect(output).toContain(
      `INSERT INTO "thread_collection" ("site_id", "thread_id", "collection_id", "created_at", "position", "pinned_at") VALUES('${siteId}', '${postId}', '${collectionId}', 1773753608, 3, NULL);`,
    );
    expect(output).not.toContain("__drizzle_migrations");
    expect(logSpy).toHaveBeenCalledWith(
      `Exported Node database to ${exportPath}`,
    );
  });
});
