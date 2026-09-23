import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "smol-toml";

const REPO_ROOT = resolve(import.meta.dirname, "../../../..");

interface MiseConfig {
  tasks?: Record<
    string,
    {
      env?: Record<string, string>;
      run?: string | string[];
    }
  >;
}

function readMiseConfig(): MiseConfig {
  return parse(
    readFileSync(resolve(REPO_ROOT, "mise.toml"), "utf8"),
  ) as MiseConfig;
}

/**
 * Every shell command the repo defines: mise tasks and the scripts of each
 * workspace package.
 *
 * @returns Each command with the name of the task or script that runs it
 */
function collectCommands(): { name: string; command: string }[] {
  const packageDirs = ["packages", "sites"].flatMap((parent) =>
    readdirSync(resolve(REPO_ROOT, parent), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => `${parent}/${entry.name}`),
  );

  return [
    ...Object.entries(readMiseConfig().tasks ?? {}).flatMap(([name, task]) =>
      [task.run ?? []].flat().map((command) => ({
        name: `mise task ${name}`,
        command,
      })),
    ),
    ...packageDirs.flatMap((dir) => {
      const pkg = JSON.parse(
        readFileSync(resolve(REPO_ROOT, dir, "package.json"), "utf8"),
      ) as { scripts?: Record<string, string> };
      return Object.entries(pkg.scripts ?? {}).map(([name, command]) => ({
        name: `${dir} script ${name}`,
        command,
      }));
    }),
  ];
}

/** A `jant migrate` call and its arguments, up to the end of that command. */
const MIGRATE_INVOCATION =
  /(?:\bjant(?:\.js)?|run-jant\.mjs)\s+migrate(?![\w-])([^\n;&|]*)/g;

const RUNTIME_FLAG = /(?:^|\s)--(local|remote|node)(?=\s|$)/;

describe("mise tasks", () => {
  it("enables environment proxy support before the Node dev runtime starts", () => {
    expect(readMiseConfig().tasks?.["dev-node"]?.env?.NODE_USE_ENV_PROXY).toBe(
      "1",
    );
  });

  // Without a runtime flag, `jant migrate` loads packages/core/.env.node and
  // targets the Node database whenever that file sets DATABASE_URL or DATA_DIR.
  // `db-wrangler-migrate` once ran that way: in a worktree with a Postgres
  // `.env.node` it migrated Postgres and left local D1 empty.
  it("names the runtime on every scripted jant migrate", () => {
    const invocations = collectCommands().flatMap(({ name, command }) =>
      [...command.matchAll(MIGRATE_INVOCATION)].map(([, args]) => ({
        name,
        runtime: RUNTIME_FLAG.exec(args)?.[1] ?? null,
      })),
    );

    expect(invocations).toContainEqual({
      name: "mise task db-wrangler-migrate",
      runtime: "local",
    });
    expect(invocations.filter(({ runtime }) => runtime === null)).toEqual([]);
    expect(
      invocations.filter(
        ({ name, runtime }) =>
          name.startsWith("mise task db-wrangler-") && runtime !== "local",
      ),
    ).toEqual([]);
  });
});
