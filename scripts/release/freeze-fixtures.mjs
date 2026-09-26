#!/usr/bin/env node
//
// Freeze a release's canonical snapshot and site export as test fixtures.
//
// Usage: node scripts/release/freeze-fixtures.mjs <version>
//
// Reads sites/demo-source/canonical/ at the tag v<version> and writes
// packages/core/src/__tests__/fixtures/releases/<version>/:
//
//   snapshot/meta.json, snapshot/db.sql   (no objects: the replay reads SQL)
//   site-export/                          (without themes/, except the three
//                                          files `jant site import` reads)
//
// `src/__tests__/release-fixtures.test.ts` restores and imports every
// directory there at head. A fixture is never edited once written.

import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const [, , version] = process.argv;
if (!version || !/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(version)) {
  console.error("Usage: node scripts/release/freeze-fixtures.mjs <version>");
  process.exit(1);
}

const repoRoot = resolve(import.meta.dirname, "../..");
const tag = `v${version}`;
const canonical = "sites/demo-source/canonical";
const target = join(
  repoRoot,
  "packages/core/src/__tests__/fixtures/releases",
  version,
);
const importedThemeFiles = [
  "favicon.ico",
  "apple-touch-icon.png",
  "custom.css",
];

if (existsSync(target)) {
  console.error(`Fixtures for ${version} already exist: ${target}`);
  process.exit(1);
}

try {
  execFileSync("git", ["rev-parse", "--verify", `${tag}^{commit}`], {
    cwd: repoRoot,
    stdio: "ignore",
  });
} catch {
  console.error(`No tag ${tag}. Run this after the release is tagged.`);
  process.exit(1);
}

const work = mkdtempSync(join(tmpdir(), "jant-freeze-fixtures-"));
try {
  const archive = execFileSync("git", ["archive", tag, canonical], {
    cwd: repoRoot,
    maxBuffer: 256 * 1024 * 1024,
  });
  execFileSync("tar", ["-x", "-C", work], { input: archive });
  const source = join(work, canonical);

  mkdirSync(join(target, "snapshot"), { recursive: true });
  for (const file of ["meta.json", "db.sql"]) {
    cpSync(join(source, "snapshot", file), join(target, "snapshot", file));
  }

  const exportSource = join(source, "site-export");
  cpSync(exportSource, join(target, "site-export"), {
    recursive: true,
    filter: (path) =>
      !path.startsWith(join(exportSource, "themes")) ||
      path === join(exportSource, "themes"),
  });
  const themeStatic = join("themes", "jant", "static");
  mkdirSync(join(target, "site-export", themeStatic), { recursive: true });
  for (const file of importedThemeFiles) {
    const from = join(exportSource, themeStatic, file);
    if (existsSync(from)) {
      cpSync(from, join(target, "site-export", themeStatic, file));
    }
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}

console.log(`Froze ${tag} fixtures into ${target}`);
