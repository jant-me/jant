import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";
import { run } from "../../../bin/commands/reset-password.js";
import { migrate } from "../runtime.js";
import type { Bindings } from "../../types.js";
import { createBootstrapService } from "../../services/bootstrap.js";
import { createNodeDatabase } from "../../db/index.js";

describe("jant reset-password", () => {
  const tempDirs: string[] = [];
  const originalEnv = process.env.DATABASE_URL;

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

  it("writes the reset token to the Node SQLite database when DATABASE_URL is set", async () => {
    const root = await mkdtemp(join(tmpdir(), "jant-reset-password-"));
    tempDirs.push(root);

    const databasePath = join(root, "jant.sqlite");
    await migrate({ DATABASE_URL: `file:${databasePath}` } as Bindings);
    process.env.DATABASE_URL = `file:${databasePath}`;

    const sqlite = new Database(databasePath);
    try {
      const bootstrap = createBootstrapService(createNodeDatabase(sqlite));
      await sqlite
        .prepare(
          `
            INSERT INTO "user" ("id", "email", "name", "email_verified", "created_at", "updated_at")
            VALUES (?, ?, ?, ?, ?, ?)
          `,
        )
        .run(
          "usr_reset_password_test",
          "owner@example.com",
          "Owner",
          1,
          new Date().toISOString(),
          new Date().toISOString(),
        );
      await bootstrap.provisionOwnerAccount({
        ownerUserId: "usr_reset_password_test",
      });
      await bootstrap.completeSiteSetup(
        { siteName: "Reset Password Test" },
        { oldLanguage: "" },
      );
    } finally {
      sqlite.close();
    }

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await run([]);

    const sqliteReadonly = new Database(databasePath, { readonly: true });
    try {
      const stored = sqliteReadonly
        .prepare(
          `
            SELECT value
            FROM "site_setting"
            WHERE "key" = 'PASSWORD_RESET_TOKEN'
          `,
        )
        .pluck()
        .get();

      expect(stored).toMatch(/^[a-f0-9]{64}:\d{10}$/);
    } finally {
      sqliteReadonly.close();
    }

    expect(logSpy).toHaveBeenCalledWith("Runtime: Node database");
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringMatching(/^Visit: \/reset\?token=[a-f0-9]{64}$/),
    );
  });
});
