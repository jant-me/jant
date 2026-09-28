#!/usr/bin/env node

import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";
import { PUBLIC_COMMAND_GROUPS } from "./lib/command-registry.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const commandsDir = join(__dirname, "commands");

async function listCommands() {
  const commands = [];

  async function walk(dir) {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith(".js")) {
        continue;
      }
      const commandPath = relative(commandsDir, fullPath)
        .replace(/\\/g, "/")
        .replace(/\.js$/, "");
      commands.push(commandPath.split("/"));
    }
  }

  await walk(commandsDir);
  return commands;
}

function showHelp() {
  const width = Math.max(
    ...PUBLIC_COMMAND_GROUPS.flatMap((group) =>
      group.commands.map((command) => command.name.length),
    ),
  );
  console.log("Usage: jant <command> [options]");
  for (const group of PUBLIC_COMMAND_GROUPS) {
    console.log("");
    console.log(`${group.title}:`);
    for (const command of group.commands) {
      console.log(`  ${command.name.padEnd(width)}  ${command.summary}`);
    }
  }
  console.log("");
  console.log("Run 'jant <command> --help' for command-specific help.");
  console.log("Run 'jant --version' for the installed version.");
}

const argv = process.argv.slice(2);
const commandStart = argv.findIndex((arg) => !arg.startsWith("-"));
if (commandStart === -1) {
  const [option] = argv;
  if (option === "--version" || option === "-v") {
    const packageJson = JSON.parse(
      await readFile(join(__dirname, "../package.json"), "utf8"),
    );
    console.log(packageJson.version);
    process.exit(0);
  }
  if (option === undefined || option === "--help" || option === "-h") {
    showHelp();
    process.exit(0);
  }
  console.error(`Unknown option: ${option}`);
  console.error("Run 'jant --help' for the list of commands.");
  process.exit(1);
}

const commands = await listCommands();

/**
 * The longest known command named by the arguments from `start`, such as
 * `["site", "export"]`, or null.
 */
function matchCommand(start) {
  const positionalTail = [];
  for (let i = start; i < argv.length; i += 1) {
    if (argv[i].startsWith("-")) break;
    positionalTail.push(argv[i]);
  }
  for (let length = positionalTail.length; length >= 1; length -= 1) {
    const candidate = positionalTail.slice(0, length);
    if (
      commands.some(
        (segments) =>
          segments.length === candidate.length &&
          segments.every((segment, idx) => segment === candidate[idx]),
      )
    ) {
      return candidate;
    }
  }
  return null;
}

// A command reads only the options after its name. Ones written before it
// used to be dropped without a word: `jant --remote migrate` migrated the
// local database, and `jant --help deploy` deployed.
if (commandStart > 0) {
  const named = argv.findIndex((_, index) => matchCommand(index));
  const nameIndex = named === -1 ? commandStart : named;
  const name = (matchCommand(nameIndex) ?? [argv[nameIndex]]).join(" ");
  const leading = argv.slice(0, nameIndex).join(" ");
  console.error(
    `Options go after the command: jant <command> [options]. Move "${leading}" after "${name}".`,
  );
  process.exit(1);
}

const matched = matchCommand(commandStart);
if (!matched) {
  console.error(`Unknown command: ${argv[commandStart]}`);
  console.error("");
  showHelp();
  process.exit(1);
}

/**
 * The codes `node:util`'s `parseArgs` throws for arguments a command doesn't
 * take. They are the user's mistake, so they get one line and a pointer to the
 * command's help, not a stack trace.
 */
const ARGUMENT_ERROR_CODES = new Set([
  "ERR_PARSE_ARGS_UNKNOWN_OPTION",
  "ERR_PARSE_ARGS_INVALID_OPTION_VALUE",
  "ERR_PARSE_ARGS_UNEXPECTED_POSITIONAL",
]);

const commandIndex = commandStart + matched.length - 1;
const mod = await import(join(commandsDir, `${matched.join("/")}.js`));
try {
  await mod.run(argv.slice(commandIndex + 1));
} catch (error) {
  if (!ARGUMENT_ERROR_CODES.has(error?.code)) throw error;
  // parseArgs appends its own advice about `--`, which names none of Jant's
  // options; the first sentence is the part that says what went wrong.
  const [reason] = String(error.message).split(/\. (?=To specify|Did you)/);
  console.error(`Error: ${reason.replace(/\.$/, "")}.`);
  console.error(`Run 'jant ${matched.join(" ")} --help' for its options.`);
  process.exit(1);
}
