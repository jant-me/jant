#!/usr/bin/env tsx
/**
 * Custom i18n Extraction Script
 *
 * Scans source files for t({ message, comment }) calls and generates PO files.
 * This replaces `lingui extract` since we use a custom runtime `t` function
 * instead of Lingui macros.
 *
 * Usage:
 *   pnpm i18n:extract
 */

import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { locales, type Locale } from "../src/i18n/locales.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = join(__dirname, "..");
const LOCALES_DIR = join(ROOT_DIR, "src/i18n/locales");
const SOURCE_DIR = join(ROOT_DIR, "src");

interface ExtractedMessage {
  id: string;
  locations: string[];
  comment?: string;
}

/**
 * Recursively find all .ts and .tsx files
 */
function findSourceFiles(dir: string): string[] {
  const files: string[] = [];

  if (!existsSync(dir)) return files;

  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);

    if (stat.isDirectory()) {
      // Skip node_modules and locales
      if (entry === "node_modules" || entry === "locales") continue;
      files.push(...findSourceFiles(fullPath));
    } else if (entry.endsWith(".ts") || entry.endsWith(".tsx")) {
      files.push(fullPath);
    }
  }

  return files;
}

/**
 * Extract messages from a source file
 *
 * Parses t({ message: "...", comment: "..." }) calls
 */
function extractFromFile(filePath: string): ExtractedMessage[] {
  const content = readFileSync(filePath, "utf-8");
  const messages: ExtractedMessage[] = [];
  const relativePath = relative(ROOT_DIR, filePath);

  // Match t({ message: "...", comment: "...", components?: {...} }) patterns
  const regex = /\bt\(\s*\{([^}]+)/g;
  let match;

  while ((match = regex.exec(content)) !== null) {
    const objContent = match[1]!;

    // Extract message property
    const messageMatch = objContent.match(/message\s*:\s*(["'`])([^]*?)\1/);
    if (!messageMatch) {
      continue;
    }

    const message = messageMatch[2]!;

    // Extract comment property
    const commentMatch = objContent.match(/comment\s*:\s*(["'`])([^]*?)\1/);
    if (!commentMatch) {
      console.warn(`  Warning: t() call without comment in ${relativePath}: "${message.slice(0, 30)}..."`);
    }

    const comment = commentMatch ? commentMatch[2] : undefined;

    // Find existing message or create new one
    const existing = messages.find((m) => m.id === message);
    if (existing) {
      existing.locations.push(relativePath);
      if (comment && !existing.comment) {
        existing.comment = comment;
      }
    } else {
      messages.push({
        id: message,
        locations: [relativePath],
        comment,
      });
    }
  }

  return messages;
}

/**
 * Parse an existing PO file
 */
interface POEntry {
  locations: string[];
  msgid: string;
  msgstr: string;
  obsolete: boolean;
}

interface POFile {
  entries: POEntry[];
}

function parsePO(content: string): POFile {
  const entries: POEntry[] = [];
  const lines = content.split("\n");
  let currentEntry: Partial<POEntry> = { locations: [], obsolete: false };
  let inHeader = true;

  for (const line of lines) {
    if (line.trim() === "") {
      if (currentEntry.msgid !== undefined && currentEntry.msgstr !== undefined) {
        entries.push(currentEntry as POEntry);
        currentEntry = { locations: [], obsolete: false };
      }
      continue;
    }

    if (line.startsWith("#: ")) {
      currentEntry.locations = currentEntry.locations || [];
      currentEntry.locations.push(line.slice(3).trim());
      continue;
    }

    if (line.startsWith("#~")) {
      currentEntry.obsolete = true;
      const rest = line.slice(2).trim();
      if (rest.startsWith("msgid ")) {
        const match = rest.match(/^msgid "(.*)"/);
        if (match) currentEntry.msgid = match[1];
      } else if (rest.startsWith("msgstr ")) {
        const match = rest.match(/^msgstr "(.*)"/);
        if (match) currentEntry.msgstr = match[1];
      }
      continue;
    }

    if (line.startsWith("#")) continue;

    if (line === 'msgid ""' && inHeader) continue;
    if (line.startsWith('msgstr ""') && inHeader) {
      inHeader = false;
      continue;
    }
    if (line.startsWith('"') && inHeader) continue;

    if (line.startsWith("msgid ")) {
      inHeader = false;
      const match = line.match(/^msgid "(.*)"/);
      if (match) currentEntry.msgid = match[1];
      continue;
    }

    if (line.startsWith("msgstr ")) {
      const match = line.match(/^msgstr "(.*)"/);
      if (match) currentEntry.msgstr = match[1];
      continue;
    }
  }

  if (currentEntry.msgid !== undefined && currentEntry.msgstr !== undefined) {
    entries.push(currentEntry as POEntry);
  }

  return { entries };
}

/**
 * Generate PO file content
 */
function generatePO(
  locale: Locale,
  messages: ExtractedMessage[],
  existingPO?: POFile
): string {
  const date = new Date().toISOString().replace("T", " ").slice(0, 19) + "+0000";
  const existingMap = new Map(existingPO?.entries.map((e) => [e.msgid, e]) || []);

  let result = `msgid ""
msgstr ""
"POT-Creation-Date: ${date}\\n"
"MIME-Version: 1.0\\n"
"Content-Type: text/plain; charset=utf-8\\n"
"Content-Transfer-Encoding: 8bit\\n"
"X-Generator: jant-extract\\n"
"Language: ${locale}\\n"

`;

  for (const msg of messages) {
    const existing = existingMap.get(msg.id);

    if (msg.comment) {
      result += `#. ${msg.comment}\n`;
    }

    for (const loc of msg.locations) {
      result += `#: ${loc}\n`;
    }

    result += `msgid "${escapePO(msg.id)}"\n`;

    if (locale === "en") {
      result += `msgstr "${escapePO(msg.id)}"\n`;
    } else if (existing && existing.msgstr && !existing.obsolete) {
      result += `msgstr "${escapePO(existing.msgstr)}"\n`;
    } else {
      result += `msgstr ""\n`;
    }

    result += "\n";
  }

  return result;
}

function escapePO(str: string): string {
  return str
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\t/g, "\\t");
}

async function main() {
  console.log("Extracting messages...\n");

  const files = findSourceFiles(SOURCE_DIR);
  console.log(`Found ${files.length} source files\n`);

  const allMessages = new Map<string, ExtractedMessage>();

  for (const file of files) {
    const messages = extractFromFile(file);
    for (const msg of messages) {
      const existing = allMessages.get(msg.id);
      if (existing) {
        existing.locations.push(...msg.locations);
      } else {
        allMessages.set(msg.id, msg);
      }
    }
  }

  const messageList = Array.from(allMessages.values()).sort((a, b) =>
    a.id.localeCompare(b.id)
  );

  console.log(`Extracted ${messageList.length} unique messages\n`);

  for (const locale of locales) {
    const poPath = join(LOCALES_DIR, `${locale}.po`);

    let existingPO: POFile | undefined;
    try {
      existingPO = parsePO(readFileSync(poPath, "utf-8"));
    } catch {
      // File doesn't exist yet
    }

    const poContent = generatePO(locale, messageList, existingPO);
    writeFileSync(poPath, poContent);

    const missing =
      locale === "en"
        ? 0
        : messageList.filter((m) => {
            const existing = existingPO?.entries.find(
              (e) => e.msgid === m.id && e.msgstr && !e.obsolete
            );
            return !existing;
          }).length;

    console.log(
      `  ${locale}: ${messageList.length} messages${locale !== "en" ? `, ${missing} missing` : ""}`
    );
  }

  console.log("\nDone! Run 'pnpm i18n:compile' to compile translations.");
}

main().catch((e) => {
  console.error("Extraction failed:", e);
  process.exit(1);
});
