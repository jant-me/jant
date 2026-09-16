/**
 * Every TypeScript dev script loads, and loads the way its task runs it.
 *
 * `db-node-rebuild-demo` and `db-node-load-demo` ran their scripts with tsx,
 * which hands Node `src/` untransformed. When `lib/filter-dimensions.ts` began
 * declaring its names with the Lingui macro (539cd1bf), both scripts died on
 * their import lines — and stayed broken for a month, because nothing in CI
 * ever loaded a dev script. The scripts now run through `dev/run-script.mjs`,
 * which compiles `src/` the way the builds do. This file holds both halves:
 * no task goes around the runner, and every script loads through it.
 *
 * Loading is not running. A dev script's work sits behind its default export,
 * so importing one evaluates every module it reaches — where a missing file, an
 * untransformed macro, or an undefined `define` global fails — without
 * resetting a database. That contract is checked here too, before anything is
 * loaded, because a script that broke it would do its work inside this test.
 *
 * What loading cannot see: a named import the module no longer exports. Vite's
 * runner leaves it `undefined` until the script calls it, so a renamed export
 * is a type error to catch, not a load error.
 */

import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parse } from "smol-toml";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const CORE_DIR = resolve(import.meta.dirname, "../..");
const REPO_ROOT = resolve(CORE_DIR, "../..");
const RUNNER = "dev/run-script.mjs";

/** Every TypeScript dev script, relative to the core package. */
const SCRIPTS = readdirSync(resolve(CORE_DIR, "dev/scripts"))
  .filter((name) => name.endsWith(".ts"))
  .sort()
  .map((name) => `dev/scripts/${name}`);

/** A dev script path as a command names it, with the word before it. */
const SCRIPT_INVOCATION = /(\S+)\s+(\S*dev\/scripts\/[\w.-]+\.ts)\b/g;

interface MiseConfig {
  tasks?: Record<string, { run?: string | string[] }>;
}

/**
 * Every shell command the repo defines: mise tasks and core's package scripts.
 *
 * @returns Each command with the name of the task or script that runs it
 */
function collectCommands(): { name: string; command: string }[] {
  const mise = parse(
    readFileSync(resolve(REPO_ROOT, "mise.toml"), "utf8"),
  ) as MiseConfig;
  const pkg = JSON.parse(
    readFileSync(resolve(CORE_DIR, "package.json"), "utf8"),
  ) as { scripts?: Record<string, string> };

  return [
    ...Object.entries(mise.tasks ?? {}).flatMap(([name, task]) =>
      [task.run ?? []].flat().map((command) => ({
        name: `mise task ${name}`,
        command,
      })),
    ),
    ...Object.entries(pkg.scripts ?? {}).map(([name, command]) => ({
      name: `package script ${name}`,
      command,
    })),
  ];
}

/**
 * Top-level statements in a dev script that do work when it is imported.
 *
 * Declarations are allowed, initializers included — resolving a path at module
 * scope is fine. A statement of its own at the top level is not: that is where
 * `await main();` lives.
 *
 * @param script - Script path relative to the core package
 * @returns `path:line` and source text for each offending statement
 */
function findTopLevelWork(script: string): string[] {
  const source = ts.createSourceFile(
    script,
    readFileSync(resolve(CORE_DIR, script), "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );

  return source.statements
    .filter(
      (statement) =>
        !ts.isImportDeclaration(statement) &&
        !ts.isExportDeclaration(statement) &&
        !ts.isExportAssignment(statement) &&
        !ts.isFunctionDeclaration(statement) &&
        !ts.isClassDeclaration(statement) &&
        !ts.isVariableStatement(statement) &&
        !ts.isTypeAliasDeclaration(statement) &&
        !ts.isInterfaceDeclaration(statement) &&
        !ts.isEnumDeclaration(statement),
    )
    .map((statement) => {
      const { line } = source.getLineAndCharacterOfPosition(
        statement.getStart(),
      );
      return `${script}:${line + 1}: ${statement.getText()}`;
    });
}

describe("dev scripts", () => {
  it("runs every TypeScript dev script through the runner", () => {
    const invocations = collectCommands().flatMap(({ name, command }) =>
      [...command.matchAll(SCRIPT_INVOCATION)].map(([, runner, script]) => ({
        name,
        runner,
        script,
      })),
    );

    expect(invocations.map(({ script }) => script)).toEqual(
      expect.arrayContaining([
        "dev/scripts/reset-node-dev.ts",
        "dev/scripts/import-node-demo-site-export.ts",
      ]),
    );
    expect(
      invocations.filter(({ runner }) => !runner.endsWith(RUNNER)),
    ).toEqual([]);
  });

  it("keeps each script's work behind its default export", () => {
    expect(SCRIPTS.flatMap(findTopLevelWork)).toEqual([]);
  });

  it(
    "loads every script and everything it imports",
    { timeout: 150_000 },
    () => {
      // Loading evaluates each script. One that works at its top level would
      // do that work here, so it is refused before anything runs.
      expect(SCRIPTS.flatMap(findTopLevelWork)).toEqual([]);

      // From the repo root, where `brand-export` runs: SWC once resolved its
      // Lingui plugin against the working directory and failed from there.
      const fromRoot = (path: string) => `packages/core/${path}`;
      const result = spawnSync(
        process.execPath,
        [fromRoot(RUNNER), "--check", ...SCRIPTS.map(fromRoot)],
        { cwd: REPO_ROOT, encoding: "utf8", timeout: 120_000 },
      );

      expect(result.error).toBeUndefined();
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout.trim().split("\n")).toEqual(
        SCRIPTS.map((script) => `Loaded ${fromRoot(script)}`),
      );
    },
  );

  it(
    "gives a script the NODE_ENV it was started with",
    { timeout: 150_000 },
    () => {
      // Vite sets NODE_ENV=development when it starts, and a script's child
      // processes inherit it: `db-node-load-demo`'s build produced Lit's
      // development bundle that way.
      const dir = mkdtempSync(join(tmpdir(), "jant-dev-script-"));
      try {
        const script = join(dir, "print-node-env.ts");
        writeFileSync(
          script,
          "export default function main(): void {\n  console.log(String(process.env.NODE_ENV));\n}\n",
        );
        const env = { ...process.env };
        delete env.NODE_ENV;

        const result = spawnSync(process.execPath, [RUNNER, script], {
          cwd: CORE_DIR,
          encoding: "utf8",
          env,
          timeout: 120_000,
        });

        expect(result.status, result.stderr).toBe(0);
        expect(result.stdout.trim()).toBe("undefined");
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
  );
});
