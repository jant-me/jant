/**
 * The `jant` CLI's public surface matches its registry, its help, and its
 * documentation.
 *
 * `bin/lib/command-registry.js` sorts every command into public (part of the
 * compatibility promise, documented in `docs/cli.md`) or internal (build and
 * operations tooling, left out of help). The CLI dispatches whatever file
 * exists under `bin/commands/`, so without this test a new command would ship
 * unclassified, and a renamed option would leave the documentation describing
 * one that no longer parses.
 *
 * Options are compared as help prints them: a line of `jant <command> --help`
 * that opens with an option defines it. In `docs/cli.md`, the first cell of an
 * option table row lists the options it describes.
 */

import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import {
  INTERNAL_COMMANDS,
  listPublicCommandNames,
} from "../../bin/lib/command-registry.js";

const CORE_DIR = resolve(import.meta.dirname, "../..");
const REPO_ROOT = resolve(CORE_DIR, "../..");
const COMMANDS_DIR = join(CORE_DIR, "bin/commands");
const CLI_DOCS = ["docs/cli.md", "docs/zh-Hans/cli.md"];

function listCommandFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) return listCommandFiles(fullPath);
    if (!entry.isFile() || !entry.name.endsWith(".js")) return [];
    return [
      relative(COMMANDS_DIR, fullPath)
        .replace(/\\/g, "/")
        .replace(/\.js$/, "")
        .split("/")
        .join(" "),
    ];
  });
}

function readHelp(command: string): string {
  return execFileSync(
    "node",
    ["bin/jant.js", ...command.split(" "), "--help"],
    {
      cwd: CORE_DIR,
      encoding: "utf8",
      env: { ...process.env, JANT_ENV_FILE: "" },
    },
  );
}

function optionsInHelp(help: string): string[] {
  const options = new Set<string>();
  for (const line of help.split("\n")) {
    const match = /^\s+(?:-[a-zA-Z], )?(--[a-z][a-z-]*)/.exec(line);
    if (match?.[1] && match[1] !== "--help") options.add(match[1]);
  }
  return [...options].sort();
}

/** Documented options per command, keyed by the name in its `### jant …` heading. */
function readDocumentedCommands(path: string): Map<string, string[]> {
  const commands = new Map<string, Set<string>>();
  let current: Set<string> | null = null;
  for (const line of readFileSync(join(REPO_ROOT, path), "utf8").split("\n")) {
    const heading = /^#{2,3} /.test(line);
    if (heading) {
      const match = /^### `jant (.+)`$/.exec(line);
      current = match?.[1] ? new Set() : null;
      if (match?.[1]) commands.set(match[1], current as Set<string>);
      continue;
    }
    if (!current || !line.startsWith("|")) continue;
    const firstCell = line.split("|")[1] ?? "";
    for (const option of firstCell.matchAll(/`(--[a-z][a-z-]*)`/g)) {
      if (option[1]) current.add(option[1]);
    }
  }
  return new Map(
    [...commands].map(([name, options]) => [name, [...options].sort()]),
  );
}

describe("jant CLI surface", () => {
  const publicCommands = listPublicCommandNames();
  const helpByCommand = new Map<string, string>();

  beforeAll(() => {
    for (const command of publicCommands) {
      helpByCommand.set(command, readHelp(command));
    }
  });

  it("classifies every command file as public or internal, once", () => {
    const classified = [...publicCommands, ...INTERNAL_COMMANDS];
    expect(new Set(classified).size).toBe(classified.length);
    expect(listCommandFiles(COMMANDS_DIR).sort()).toEqual(
      [...classified].sort(),
    );
  });

  it("prints each public command's usage under its own name", () => {
    for (const command of publicCommands) {
      expect(helpByCommand.get(command)?.split("\n")[0]).toMatch(
        new RegExp(`^Usage: jant ${command}( |$)`),
      );
    }
  });

  it("lists only public commands in jant --help", () => {
    const help = execFileSync("node", ["bin/jant.js", "--help"], {
      cwd: CORE_DIR,
      encoding: "utf8",
    });
    for (const command of publicCommands) {
      expect(help).toContain(`  ${command} `);
    }
    for (const command of INTERNAL_COMMANDS) {
      expect(help).not.toContain(`  ${command} `);
    }
  });

  for (const path of CLI_DOCS) {
    it(`${path} documents each public command with the options its help lists`, () => {
      const documented = readDocumentedCommands(path);
      expect([...documented.keys()]).toEqual(publicCommands);
      for (const command of publicCommands) {
        expect(
          { command, options: documented.get(command) },
          `${path}: jant ${command}`,
        ).toEqual({
          command,
          options: optionsInHelp(helpByCommand.get(command) ?? ""),
        });
      }
    });
  }
});
