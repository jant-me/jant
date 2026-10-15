import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { asksForDryRun, ciPreflight } from "../../../bin/commands/deploy.js";

const JANT_BIN = resolve(import.meta.dirname, "../../../bin/jant.js");
const DATABASE_ID = "76329154-291d-4580-af73-aa77397649f1";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true });
});

function wranglerToml(databaseId: string): string {
  return [
    'name = "my-blog"',
    'main = "index.js"',
    "",
    "[[d1_databases]]",
    'binding = "DB"',
    'database_name = "my-blog-db"',
    `database_id = "${databaseId}"`,
    "",
  ].join("\n");
}

/**
 * Run `jant deploy` in a project holding only `wrangler.toml`, with an
 * environment that has nothing from this machine's Cloudflare setup.
 */
function runDeploy(
  args: string[],
  options: { databaseId: string; env?: Record<string, string> },
) {
  const dir = mkdtempSync(join(tmpdir(), "jant-deploy-"));
  dirs.push(dir);
  const config = wranglerToml(options.databaseId);
  writeFileSync(join(dir, "wrangler.toml"), config);
  const summary = join(dir, "summary.md");
  const result = spawnSync(process.execPath, [JANT_BIN, "deploy", ...args], {
    cwd: dir,
    encoding: "utf8",
    env: {
      PATH: process.env.PATH,
      HOME: dir,
      GITHUB_STEP_SUMMARY: summary,
      ...options.env,
    },
  });
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
    summary: existsSync(summary) ? readFileSync(summary, "utf8") : "",
    configUnchanged:
      readFileSync(join(dir, "wrangler.toml"), "utf8") === config,
  };
}

describe("ciPreflight", () => {
  it("skips when neither credential is set", () => {
    for (const env of [
      {},
      { CLOUDFLARE_API_TOKEN: "", CLOUDFLARE_ACCOUNT_ID: "" },
      { CLOUDFLARE_API_TOKEN: " ", CLOUDFLARE_ACCOUNT_ID: "\n" },
    ]) {
      expect(ciPreflight({ env, needsSetup: false }).action).toBe("skip");
    }
  });

  it("fails with an account ID but no token", () => {
    const result = ciPreflight({
      env: { CLOUDFLARE_ACCOUNT_ID: "account" },
      needsSetup: false,
    });
    expect(result.action).toBe("fail");
  });

  it("fails instead of running the first deploy", () => {
    const result = ciPreflight({
      env: { CLOUDFLARE_API_TOKEN: "token", CLOUDFLARE_ACCOUNT_ID: "account" },
      needsSetup: true,
    });
    expect(result).toMatchObject({ action: "fail" });
    expect(result.action === "fail" && result.message).toContain(
      'database_id = "local"',
    );
  });

  it("deploys with a token and a real database ID", () => {
    for (const env of [
      { CLOUDFLARE_API_TOKEN: "token", CLOUDFLARE_ACCOUNT_ID: "account" },
      { CLOUDFLARE_API_TOKEN: "token" },
    ]) {
      expect(ciPreflight({ env, needsSetup: false })).toEqual({
        action: "deploy",
      });
    }
  });
});

describe("asksForDryRun", () => {
  it("finds Wrangler's --dry-run among the passed-on arguments", () => {
    expect(asksForDryRun(["--dry-run"])).toBe(true);
    expect(asksForDryRun(["--minify", "--dry-run=true"])).toBe(true);
    expect(asksForDryRun(["--minify"])).toBe(false);
    expect(asksForDryRun([])).toBe(false);
  });
});

describe("jant deploy", () => {
  it("--ci skips without credentials and says so in the run summary", () => {
    const result = runDeploy(["--ci"], { databaseId: DATABASE_ID });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Deploy skipped");
    expect(result.summary).toContain("CF_API_TOKEN");
    expect(result.stdout).not.toContain("Running remote migrations");
  });

  it('--ci fails on database_id = "local" and leaves wrangler.toml alone', () => {
    const result = runDeploy(["--ci"], {
      databaseId: "local",
      env: { CLOUDFLARE_API_TOKEN: "token", CLOUDFLARE_ACCOUNT_ID: "account" },
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('database_id = "local"');
    expect(result.summary).toContain('database_id = "local"');
    expect(result.configUnchanged).toBe(true);
  });

  it("refuses Wrangler's --dry-run while migrations would still run", () => {
    const result = runDeploy(["--", "--dry-run"], {
      databaseId: DATABASE_ID,
      env: { CLOUDFLARE_API_TOKEN: "token", CLOUDFLARE_ACCOUNT_ID: "account" },
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("--skip-migrate");
    expect(result.stdout).not.toContain("Running remote migrations");
  });

  it("refuses a dry run of the first deploy", () => {
    const result = runDeploy(["--skip-migrate", "--", "--dry-run"], {
      databaseId: "local",
      env: { CLOUDFLARE_API_TOKEN: "token", CLOUDFLARE_ACCOUNT_ID: "account" },
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("first deploy");
    expect(result.configUnchanged).toBe(true);
  });
});
