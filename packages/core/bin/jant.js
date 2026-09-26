#!/usr/bin/env node

import { readdir } from "node:fs/promises";
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
}

const argv = process.argv.slice(2);
const commandStart = argv.findIndex((arg) => !arg.startsWith("-"));
if (commandStart === -1) {
  showHelp();
  process.exit(0);
}

const commands = await listCommands();

const positionalTail = [];
for (let i = commandStart; i < argv.length; i += 1) {
  const arg = argv[i];
  if (arg.startsWith("-")) break;
  positionalTail.push(arg);
}

let matched = null;
for (let length = positionalTail.length; length >= 1; length -= 1) {
  const candidate = positionalTail.slice(0, length);
  if (
    commands.some(
      (segments) =>
        segments.length === candidate.length &&
        segments.every((segment, idx) => segment === candidate[idx]),
    )
  ) {
    matched = candidate;
    break;
  }
}

if (!matched) {
  console.error(`Unknown command: ${positionalTail[0]}`);
  console.error("");
  showHelp();
  process.exit(1);
}

const commandIndex = commandStart + matched.length - 1;
const mod = await import(join(commandsDir, `${matched.join("/")}.js`));
await mod.run(argv.slice(commandIndex + 1));
