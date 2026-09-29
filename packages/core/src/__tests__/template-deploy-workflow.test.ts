/**
 * The deploy workflow a `create-jant` project ships deploys once its secrets
 * and D1 database are set.
 *
 * Its preflight step reads `database_id` from `wrangler.toml` with sed, and
 * skips the deploy, green, when it finds none. The pattern was escaped twice
 * (`\\(`), so it never matched a real ID: every push was skipped, and sites
 * that relied on the workflow never got an upgrade. Running the step itself
 * is the only check that catches that.
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parse } from "yaml";

const REPO_ROOT = resolve(import.meta.dirname, "../../../..");
const WORKFLOW = "sites/demo/.github/workflows/deploy.yml";

interface WorkflowStep {
  id?: string;
  run?: string;
}

function preflightScript(): string {
  const workflow = parse(readFileSync(join(REPO_ROOT, WORKFLOW), "utf8")) as {
    jobs: Record<string, { steps: WorkflowStep[] }>;
  };
  const step = Object.values(workflow.jobs)
    .flatMap((job) => job.steps)
    .find((candidate) => candidate.id === "preflight");
  if (!step?.run) throw new Error(`No preflight step in ${WORKFLOW}`);
  return step.run;
}

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true });
});

function runPreflight(
  wranglerToml: string,
  secrets: { CF_API_TOKEN: string; CF_ACCOUNT_ID: string },
): string {
  const dir = mkdtempSync(join(tmpdir(), "jant-deploy-preflight-"));
  dirs.push(dir);
  writeFileSync(join(dir, "wrangler.toml"), wranglerToml);
  const output = join(dir, "output");
  writeFileSync(output, "");
  execFileSync("bash", ["-c", preflightScript()], {
    cwd: dir,
    env: {
      PATH: process.env.PATH,
      ...secrets,
      GITHUB_OUTPUT: output,
      GITHUB_STEP_SUMMARY: join(dir, "summary"),
    },
  });
  return readFileSync(output, "utf8").trim();
}

const secrets = { CF_API_TOKEN: "token", CF_ACCOUNT_ID: "account" };

function wranglerToml(databaseId: string): string {
  return [
    'name = "my-blog"',
    "",
    "[[d1_databases]]",
    'binding = "DB"',
    'database_name = "my-blog-db"',
    `database_id = "${databaseId}"`,
    "",
  ].join("\n");
}

describe("template deploy workflow", () => {
  it("deploys once the secrets and a D1 database ID are set", () => {
    expect(
      runPreflight(
        wranglerToml("76329154-291d-4580-af73-aa77397649f1"),
        secrets,
      ),
    ).toBe("ready=true");
  });

  it("skips while wrangler.toml still has the placeholder ID", () => {
    expect(runPreflight(wranglerToml("local"), secrets)).toBe("ready=false");
  });

  it("skips without the Cloudflare secrets", () => {
    expect(
      runPreflight(wranglerToml("76329154-291d-4580-af73-aa77397649f1"), {
        CF_API_TOKEN: "",
        CF_ACCOUNT_ID: "",
      }),
    ).toBe("ready=false");
  });
});
