import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  renameSync,
  rmSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadDemoWorkflowEnv } from "../demo-shared/env.mjs";
import { resolveDemoSourceSiteUrl } from "./lib/runtime.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "../..");
const demoSourceDir = resolve(repoRoot, "sites/demo-source");
const canonicalDir = resolve(demoSourceDir, "canonical");
const outputDir = resolve(canonicalDir, "site-export");
const runJantScript = resolve(__dirname, "../run-jant.mjs");
const checkOnly = process.argv.includes("--check");

loadDemoWorkflowEnv({ sites: ["demo-source"] });

const siteUrl = resolveDemoSourceSiteUrl();
const apiToken = process.env.JANT_API_TOKEN?.trim();

if (!apiToken) {
  throw new Error(
    [
      "JANT_API_TOKEN is required for demo-source site export.",
      "Mint one in demo-source Settings → API Tokens and export it in .env.local",
      "(or your shell) before running this task.",
    ].join("\n"),
  );
}

if (checkOnly) {
  console.log("demo-source site-export prerequisites look good.");
  console.log(`  Source URL:    ${siteUrl}`);
  console.log(`  Output dir:    ${outputDir}`);
  process.exit(0);
}

mkdirSync(canonicalDir, { recursive: true });
const tempOutputDir = mkdtempSync(join(canonicalDir, ".site-export-build-"));

console.log(`Exporting canonical demo site-export from ${siteUrl}...`);

try {
  // The CLI's --directory check requires an empty directory; mkdtempSync gives
  // us a fresh one. Remove it so the CLI can recreate cleanly (it does
  // mkdirSync(recursive)).
  if (readdirSync(tempOutputDir).length === 0) {
    rmSync(tempOutputDir, { recursive: true, force: true });
  }

  execFileSync(
    process.execPath,
    [runJantScript, "site", "export", siteUrl, "--directory", tempOutputDir],
    {
      cwd: demoSourceDir,
      env: process.env,
      stdio: "inherit",
    },
  );

  if (existsSync(outputDir)) {
    rmSync(outputDir, { recursive: true, force: true });
  }

  renameSync(tempOutputDir, outputDir);
  console.log(`Canonical demo site-export updated at ${outputDir}`);
} catch (error) {
  rmSync(tempOutputDir, { recursive: true, force: true });
  throw error;
}
