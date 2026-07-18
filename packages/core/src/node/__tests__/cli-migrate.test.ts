import { afterEach, describe, expect, it, vi } from "vitest";

describe("jant migrate", () => {
  const originalDatabaseUrl = process.env.DATABASE_URL;
  const originalDataDir = process.env.DATA_DIR;
  const originalDebugFlag = process.env.JANT_DEBUG_MIGRATE;

  afterEach(() => {
    if (originalDatabaseUrl === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = originalDatabaseUrl;
    }

    if (originalDataDir === undefined) {
      delete process.env.DATA_DIR;
    } else {
      process.env.DATA_DIR = originalDataDir;
    }

    if (originalDebugFlag === undefined) {
      delete process.env.JANT_DEBUG_MIGRATE;
    } else {
      process.env.JANT_DEBUG_MIGRATE = originalDebugFlag;
    }

    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("keeps the existing DATABASE_URL when --node loads .env.node", async () => {
    process.env.DATABASE_URL =
      "postgres://shell_user:super-secret@db.example.com:5432/shell_db";
    delete process.env.DATA_DIR;
    process.env.JANT_DEBUG_MIGRATE = "1";

    const migrate = vi.fn(async () => {});
    const poolQuery = vi
      .fn()
      .mockResolvedValueOnce({
        rows: [{ id: 7, hash: "hash-before", created_at: 1775349000 }],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            conname: "chk_nav_item_system_key",
            definition:
              "CHECK (((system_key IS NULL) OR (system_key = ANY (ARRAY['latest'::text]))))",
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [{ id: 8, hash: "hash-after", created_at: 1775349118 }],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            conname: "chk_nav_item_system_key",
            definition:
              "CHECK (((system_key IS NULL) OR (system_key = ANY (ARRAY['latest'::text,'featured'::text]))))",
          },
        ],
      });
    const poolEnd = vi.fn(async () => undefined);
    const Pool = vi.fn(function MockPool() {
      return {
        end: poolEnd,
        query: poolQuery,
      };
    });

    vi.doMock("node:fs", () => ({
      existsSync: vi.fn((path) =>
        String(path).endsWith("/packages/core/src/db/migrations/pg"),
      ),
      readFileSync: vi.fn(
        () =>
          "DATABASE_URL=postgres://file_user:file-secret@db.example.com:5432/file_db\n",
      ),
      readdirSync: vi.fn(() => ["0008_yielding.sql", "0007_nav_item.sql"]),
    }));
    vi.doMock("pg", () => ({ Pool }));
    vi.doMock("../../../bin/lib/load-node-runtime.js", () => ({
      loadNodeRuntime: vi.fn(async () => ({ migrate })),
    }));
    vi.doMock("../../../bin/lib/thread-collection-migration.js", () => ({
      preflightThreadCollectionMigration: vi.fn(async () => ({
        phase: "fresh",
      })),
      verifyThreadCollectionMigration: vi.fn(async () => undefined),
    }));

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const { run } = await import("../../../bin/commands/migrate.js");
    await run(["--node"]);

    expect(migrate).toHaveBeenCalledTimes(1);
    expect(process.env.DATABASE_URL).toBe(
      "postgres://shell_user:super-secret@db.example.com:5432/shell_db",
    );

    const output = logSpy.mock.calls
      .map((args) => args.map((value) => String(value)).join(" "))
      .join("\n");

    expect(output).toContain("cli.node_env.database_url_source=process.env");
    expect(output).toContain("cli.node_env.skipped_keys=DATABASE_URL");
    expect(output).toContain(
      "cli.node.target=postgres://shell_user@db.example.com:5432/shell_db",
    );
    expect(output).not.toContain("super-secret");
    expect(output).not.toContain("file-secret");
    expect(output).toContain("cli.pg.before.journal=count=1/2");
    expect(output).toContain("cli.pg.after.journal=count=1/2");
  });
});
