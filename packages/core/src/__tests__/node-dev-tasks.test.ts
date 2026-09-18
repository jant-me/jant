/**
 * Local Node Dev Task Guard
 *
 * `db-node-bootstrap-shell` and `db-node-clean` were added in 4bc0bfe8 and
 * never touched the Node database. The shell migrated it, then set up the
 * local Wrangler D1 database and wrote credentials to `.dev.vars`, leaving the
 * Node site at `/setup`. Clean deleted `packages/core/.data`, a directory the
 * Node runtime no longer uses. Both exited 0, so nothing noticed.
 *
 * These tests run each task's own script through `dev/run-script.mjs` against
 * a throwaway directory, and check the database and env file it leaves. The
 * runner starts Vite, hence the timeouts.
 */

import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { writeScriptEnvValues } from "../../dev/script-env.js";
import { DEFAULT_NAVIGATION_PROFILE } from "../types/constants.js";

const CORE_DIR = resolve(import.meta.dirname, "../..");

/** Variables that would point a task somewhere other than the temp directory. */
const TARGET_VARIABLES = [
  "AUTH_SECRET",
  "DATABASE_URL",
  "DATA_DIR",
  "DEMO_EMAIL",
  "DEMO_PASSWORD",
  "DEV_API_TOKEN",
  "LOCAL_STORAGE_PATH",
  "PORT",
  "SITE_RESOLUTION_MODE",
  "STORAGE_DRIVER",
];

function taskEnv(
  overrides: Record<string, string>,
): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = {
    ...process.env,
    // No announcement to a Discover directory from a test database.
    DISCOVER_PING_URL: "",
  };
  for (const name of TARGET_VARIABLES) {
    delete env[name];
  }
  return { ...env, ...overrides };
}

function runScript(
  script: string,
  args: string[],
  env: Record<string, string | undefined>,
) {
  const result = spawnSync(
    process.execPath,
    ["dev/run-script.mjs", `dev/scripts/${script}`, ...args],
    { cwd: CORE_DIR, encoding: "utf8", env, timeout: 120_000 },
  );
  expect(result.error).toBeUndefined();
  return { ...result, output: `${result.stdout}\n${result.stderr}` };
}

function envFileLines(path: string): string[] {
  return readFileSync(path, "utf8").split("\n");
}

describe("local Node dev tasks", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  function makeTempDir(prefix: string): string {
    const dir = mkdtempSync(join(tmpdir(), prefix));
    tempDirs.push(dir);
    return dir;
  }

  it(
    "db-node-bootstrap-shell sets up the Node database and writes dev credentials to the env file",
    { timeout: 300_000 },
    () => {
      const dir = makeTempDir("jant-bootstrap-shell-");
      const envPath = join(dir, "test.env");
      const ownLines = ["# Local settings", `DATA_DIR=${dir}`];
      writeFileSync(envPath, `${ownLines.join("\n")}\n`);
      const env = taskEnv({ JANT_ENV_FILE: envPath });

      const first = runScript("bootstrap-node-dev.ts", [], env);
      expect(first.status, first.output).toBe(0);
      expect(first.stdout).toContain("created the site and the dev account");
      expect(first.stdout).not.toMatch(/do(es)? not sign in/);

      // The file's own lines stay as they were; the credentials follow as one
      // block below a blank line.
      const written = envFileLines(envPath);
      expect(written.slice(0, 3)).toEqual([...ownLines, ""]);
      expect(written.slice(3)).toEqual([
        expect.stringMatching(/^AUTH_SECRET=\S{32,}$/),
        expect.stringMatching(/^DEV_API_TOKEN=jnt_dev_[0-9a-f]{32}$/),
        "DEMO_EMAIL=debug@jant.test",
        "DEMO_PASSWORD=jant-dev-debug-login",
        "",
      ]);

      const sqlite = new Database(join(dir, "jant.sqlite"), {
        readonly: true,
      });
      try {
        expect(
          sqlite
            .prepare(
              `SELECT "user"."email" FROM "user" JOIN "account" ON "account"."user_id" = "user"."id" WHERE "account"."provider_id" = 'credential'`,
            )
            .all(),
        ).toEqual([{ email: "debug@jant.test" }]);
        expect(
          sqlite
            .prepare(
              `SELECT "value" FROM "site_setting" WHERE "key" = 'ONBOARDING_STATUS'`,
            )
            .get(),
        ).toEqual({ value: "completed" });
        expect(
          (
            sqlite.prepare(`SELECT "system_key" FROM "nav_item"`).all() as {
              system_key: string;
            }[]
          )
            .map((row) => row.system_key)
            .sort(),
        ).toEqual([...DEFAULT_NAVIGATION_PROFILE.systemKeys].sort());
        expect(
          sqlite.prepare(`SELECT COUNT(*) AS count FROM "post"`).get(),
        ).toEqual({ count: 0 });
      } finally {
        sqlite.close();
      }

      // A second run finds the site set up, and keeps the generated secrets.
      const afterFirst = readFileSync(envPath, "utf8");
      const second = runScript("bootstrap-node-dev.ts", [], env);
      expect(second.status, second.output).toBe(0);
      expect(second.stdout).toContain("already set up, left unchanged");
      expect(second.stdout).not.toMatch(/do(es)? not sign in/);
      expect(readFileSync(envPath, "utf8")).toBe(afterFirst);

      // A new password is recorded, but not set on the existing account, and
      // the task says so.
      const third = runScript(
        "bootstrap-node-dev.ts",
        ["another-password"],
        env,
      );
      expect(third.status, third.output).toBe(0);
      expect(third.stdout).toContain(
        "debug@jant.test has a different password",
      );
      expect(envFileLines(envPath)).toContain("DEMO_PASSWORD=another-password");
    },
  );

  it(
    "db-node-clean deletes the SQLite database, its WAL files, and media, and nothing else",
    { timeout: 150_000 },
    () => {
      const dir = makeTempDir("jant-clean-");
      const deleted = [
        join(dir, "jant.sqlite"),
        join(dir, "jant.sqlite-wal"),
        join(dir, "jant.sqlite-shm"),
        join(dir, "media"),
      ];
      const kept = join(dir, "notes.txt");
      mkdirSync(join(dir, "media/2026"), { recursive: true });
      writeFileSync(join(dir, "media/2026/photo.webp"), "image");
      for (const file of deleted.slice(0, 3)) {
        writeFileSync(file, "");
      }
      writeFileSync(kept, "keep");

      const result = runScript(
        "clean-node-dev.ts",
        [],
        taskEnv({ JANT_ENV_FILE: "", DATA_DIR: dir }),
      );

      expect(result.status, result.output).toBe(0);
      expect(deleted.filter((path) => existsSync(path))).toEqual([]);
      expect(existsSync(kept)).toBe(true);
    },
  );

  it("db-node-clean refuses a Postgres database", { timeout: 150_000 }, () => {
    const result = runScript(
      "clean-node-dev.ts",
      [],
      taskEnv({
        JANT_ENV_FILE: "",
        DATABASE_URL: "postgres://jant:jant@127.0.0.1:9/jant_dev",
      }),
    );

    expect(result.status).not.toBe(0);
    expect(result.output).toContain(
      "db-node-clean only supports Node SQLite development databases.",
    );
  });
});

describe("writeScriptEnvValues", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("replaces keys in place and appends new ones as one block", () => {
    const dir = mkdtempSync(join(tmpdir(), "jant-script-env-"));
    tempDirs.push(dir);
    const envPath = join(dir, ".env.node");
    writeFileSync(
      envPath,
      "# Database\nDATABASE_URL=file:./data/jant.sqlite\nDEMO_PASSWORD=old\n\n\n",
    );

    writeScriptEnvValues(envPath, {
      DEMO_PASSWORD: "new",
      AUTH_SECRET: "secret",
      DEV_API_TOKEN: "token",
    });

    expect(readFileSync(envPath, "utf8")).toBe(
      "# Database\nDATABASE_URL=file:./data/jant.sqlite\nDEMO_PASSWORD=new\n\nAUTH_SECRET=secret\nDEV_API_TOKEN=token\n",
    );
  });

  it("writes a new file without a leading blank line", () => {
    const dir = mkdtempSync(join(tmpdir(), "jant-script-env-"));
    tempDirs.push(dir);
    const envPath = join(dir, ".env.node");

    writeScriptEnvValues(envPath, { AUTH_SECRET: "secret" });

    expect(readFileSync(envPath, "utf8")).toBe("AUTH_SECRET=secret\n");
  });
});
