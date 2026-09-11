import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";
import { run } from "../../../bin/commands/reset-password.js";
import { migrate } from "../runtime.js";
import type { Bindings } from "../../types.js";
import { createBootstrapService } from "../../services/bootstrap.js";
import { createSiteService } from "../../services/site.js";
import { createNodeDatabase } from "../../db/index.js";

describe("jant reset-password", () => {
  const tempDirs: string[] = [];
  const originalEnv = {
    DATABASE_URL: process.env.DATABASE_URL,
    SITE_RESOLUTION_MODE: process.env.SITE_RESOLUTION_MODE,
  };

  afterEach(async () => {
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
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
      const db = createNodeDatabase(sqlite);
      // Each setup screen is its own request, bound to the site it resolved:
      // none before the account step, the one it created after.
      const bootstrapForRequest = async () =>
        createBootstrapService(
          db,
          (await createSiteService(db).resolveSingleSite()).site.id,
        );
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
      await (
        await bootstrapForRequest()
      ).provisionOwnerAccount({
        ownerUserId: "usr_reset_password_test",
      });
      await (
        await bootstrapForRequest()
      ).completeSiteSetup(
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

  // A hosted database holds every tenant, so the token goes to the site the
  // operator named — and nowhere when they named none.
  it("writes the token to the site --site names on a host-based database", async () => {
    const root = await mkdtemp(join(tmpdir(), "jant-reset-password-hosted-"));
    tempDirs.push(root);

    const databasePath = join(root, "jant.sqlite");
    await migrate({ DATABASE_URL: `file:${databasePath}` } as Bindings);
    process.env.DATABASE_URL = `file:${databasePath}`;
    process.env.SITE_RESOLUTION_MODE = "host-based";

    const sqlite = new Database(databasePath);
    try {
      sqlite
        .prepare(
          `
            INSERT INTO site (id, key, status, created_at, updated_at)
            VALUES
              ('sit_alpha000000000000000000000', 'alpha', 'active', 1774200000, 1774200000),
              ('sit_beta0000000000000000000000', 'beta', 'active', 1774200001, 1774200001)
          `,
        )
        .run();
    } finally {
      sqlite.close();
    }

    vi.spyOn(console, "log").mockImplementation(() => {});

    await expect(run([])).rejects.toThrow(
      "host-based mode needs a target site. Pass --site <key|id>, --host <host>, or --url <url>.",
    );
    await run(["--site", "beta"]);

    const sqliteReadonly = new Database(databasePath, { readonly: true });
    try {
      const owners = sqliteReadonly
        .prepare(
          `
            SELECT site_id
            FROM "site_setting"
            WHERE "key" = 'PASSWORD_RESET_TOKEN'
          `,
        )
        .pluck()
        .all();

      expect(owners).toEqual(["sit_beta0000000000000000000000"]);
    } finally {
      sqliteReadonly.close();
    }
  });
});
