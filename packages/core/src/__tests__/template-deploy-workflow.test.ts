/**
 * The deploy workflow a `create-jant` project ships keeps no logic of its own.
 *
 * The workflow lives in the author's repo, and no upgrade of `@jant/core`
 * reaches it. Its old preflight step read `database_id` from `wrangler.toml`
 * with a sed pattern escaped twice, so every push skipped the deploy, green,
 * and the only fix was for each author to edit the file. The checks now live
 * in `jant deploy --ci`, which runs the version in the project's lockfile; the
 * workflow only installs and calls it.
 */

import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const REPO_ROOT = resolve(import.meta.dirname, "../../../..");
const WORKFLOW = "sites/demo/.github/workflows/deploy.yml";

interface WorkflowStep {
  name?: string;
  uses?: string;
  run?: string;
  env?: Record<string, string>;
}

function steps(): WorkflowStep[] {
  const workflow = parse(readFileSync(join(REPO_ROOT, WORKFLOW), "utf8")) as {
    jobs: Record<string, { steps: WorkflowStep[] }>;
  };
  return Object.values(workflow.jobs).flatMap((job) => job.steps);
}

describe("template deploy workflow", () => {
  it("installs and hands the deploy to jant deploy --ci", () => {
    expect(steps().map((step) => step.name)).toEqual([
      "Checkout",
      "Setup Node.js",
      "Install dependencies",
      "Deploy",
    ]);

    const deploy = steps().find((step) => step.name === "Deploy");
    expect(deploy?.run).toBe("npx jant deploy --ci");
    expect(deploy?.env).toEqual({
      CLOUDFLARE_API_TOKEN: "${{ secrets.CF_API_TOKEN }}",
      CLOUDFLARE_ACCOUNT_ID: "${{ secrets.CF_ACCOUNT_ID }}",
    });
  });

  it("runs no script of its own", () => {
    for (const step of steps()) {
      expect(step.run ?? "", step.name).not.toContain("\n");
      expect(step, step.name).not.toHaveProperty("if");
    }
  });
});
