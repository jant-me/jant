import { execFile, execFileSync } from "child_process";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { resolve, join } from "path";
import { promisify } from "util";
import { describe, expect, it } from "vitest";

const REPO_ROOT = resolve(import.meta.dirname, "../../../../../");
const CORE_DIR = resolve(REPO_ROOT, "packages/core");
const PNPM_BIN = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
// Async, so the concurrent fixtures below actually overlap.
const execFileAsync = promisify(execFile);

function queryLocalCount(persistDir: string, sql: string) {
  const stdout = execFileSync(
    PNPM_BIN,
    [
      "exec",
      "wrangler",
      "d1",
      "execute",
      "DB",
      "--local",
      "--persist-to",
      persistDir,
      "--command",
      sql,
      "--json",
    ],
    {
      cwd: CORE_DIR,
      encoding: "utf-8",
    },
  );
  // Wrangler may prepend non-JSON lines (e.g. proxy warnings) to stdout
  const jsonStart = Math.min(
    ...[stdout.indexOf("["), stdout.indexOf("{")].filter((i) => i !== -1),
  );
  const parsed = JSON.parse(jsonStart > 0 ? stdout.slice(jsonStart) : stdout);
  const statement = Array.isArray(parsed) ? parsed[0] : parsed;
  return Number(statement?.results?.[0]?.count ?? 0);
}

/**
 * `v0.3.39` is the oldest release docs/compatibility.md says upgrades in
 * place, written by that release itself. `pinned-reply-memberships` starts
 * later, from data that release couldn't hold. The rehearsal command checks
 * each manifest's assertions; this checks it ran to the end.
 */
const FIXTURES = ["v0.3.39", "pinned-reply-memberships"];

describe.concurrent("migration rehearsal", () => {
  it.each(FIXTURES)(
    "upgrades a local D1 from the %s seed",
    async (fixture) => {
      const persistDir = mkdtempSync(
        join(tmpdir(), `jant-rehearsal-${fixture}-`),
      );

      try {
        await execFileAsync(
          process.execPath,
          [
            "./bin/jant.js",
            "db",
            "rehearse",
            "--local",
            "--persist-to",
            persistDir,
            "--fixture",
            `src/db/rehearsal-fixtures/${fixture}.json`,
          ],
          { cwd: CORE_DIR },
        );

        expect(
          queryLocalCount(persistDir, "SELECT COUNT(*) AS count FROM post"),
        ).toBeGreaterThan(0);
        expect(
          queryLocalCount(persistDir, "SELECT COUNT(*) AS count FROM post_fts"),
        ).toBeGreaterThan(0);
      } finally {
        rmSync(persistDir, { recursive: true, force: true });
      }
    },
    600_000,
  );
});
