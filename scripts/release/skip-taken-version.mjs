#!/usr/bin/env node
//
// Move a release off a version number npm has already taken.
//
// `@jant/core@1.0.0` was published by accident in April 2026, and npm never
// accepts a version number twice. A major changeset still makes Changesets
// propose 1.0.0, and the Changesets action runs `release-version` again on
// every push to main, so a hand edit to the Release PR doesn't last. Run after
// `changeset version`, this moves both packages, which release together, and
// their changelog headings to the next free patch version, so the Release PR
// says 1.0.1 by itself.
//
// Usage: node scripts/release/skip-taken-version.mjs

import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Versions npm holds for these packages that no release may reuse. */
export const TAKEN_VERSIONS = new Set(["1.0.0"]);

const PACKAGE_DIRS = ["packages/core", "packages/create-jant"];

/**
 * The first version from `version` on, by patch steps, that isn't taken.
 *
 * @param {string} version - The version Changesets proposed
 * @param {Set<string>} [taken] - Versions that can't be used
 * @returns {string} The version to release
 * @example
 * nextFreeVersion("1.0.0"); // "1.0.1"
 * nextFreeVersion("0.11.0"); // "0.11.0"
 */
export function nextFreeVersion(version, taken = TAKEN_VERSIONS) {
  let next = version;
  while (taken.has(next)) {
    const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(next);
    if (!match) throw new Error(`Can't step past version ${next}`);
    next = `${match[1]}.${match[2]}.${Number(match[3]) + 1}`;
  }
  return next;
}

/**
 * Rewrite a taken version in each package's `package.json` and in the top
 * heading of its `CHANGELOG.md`.
 *
 * @param {string} root - The repository root
 * @param {Set<string>} [taken] - Versions that can't be used
 * @returns {string | null} The version moved to, or null when none was taken
 * @example
 * skipTakenVersion(process.cwd()); // "1.0.1" after a major changeset
 */
export function skipTakenVersion(root, taken = TAKEN_VERSIONS) {
  let movedTo = null;
  for (const dir of PACKAGE_DIRS) {
    const manifestPath = join(root, dir, "package.json");
    const manifest = readFileSync(manifestPath, "utf8");
    const current = JSON.parse(manifest).version;
    const next = nextFreeVersion(current, taken);
    if (next === current) continue;

    // Replace the text rather than reserializing, so the file keeps its
    // formatting.
    writeFileSync(
      manifestPath,
      manifest.replace(`"version": "${current}"`, `"version": "${next}"`),
    );
    const changelogPath = join(root, dir, "CHANGELOG.md");
    const changelog = readFileSync(changelogPath, "utf8");
    writeFileSync(
      changelogPath,
      changelog.replace(`\n## ${current}\n`, `\n## ${next}\n`),
    );
    movedTo = next;
  }
  return movedTo;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = resolve(fileURLToPath(import.meta.url), "../../..");
  const movedTo = skipTakenVersion(root);
  if (movedTo) {
    console.log(`npm already holds that version; releasing ${movedTo}.`);
  }
}
