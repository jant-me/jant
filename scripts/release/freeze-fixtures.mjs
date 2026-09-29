#!/usr/bin/env node
//
// Freeze what a release writes as test fixtures.
//
// Usage: node scripts/release/freeze-fixtures.mjs <version>
//        node scripts/release/freeze-fixtures.mjs --rehearse <dir>
//
// Installs the published @jant/core@<version>, loads the canonical demo
// content at the tag v<version> into a temporary Node site, adds what the
// demo lacks (see addFixtureContent), and writes what that release exports
// from it into packages/core/src/__tests__/fixtures/releases/<version>/:
//
//   snapshot/meta.json, snapshot/db.sql   (`jant site snapshot export
//                                          --skip-objects`: the replay reads
//                                          SQL, not objects)
//   site-export/                          (`jant site export`, without themes/
//                                          except the three files `jant site
//                                          import` reads)
//
// sites/demo-source/canonical/ is re-exported only when the demo changes, so
// copying it would record whichever version last exported it. The temporary
// site runs on SQLite and local storage, so media rows record provider
// `local`, and the site export's baseURL and feed IDs name the temporary
// server. SITE_ORIGIN stays unset on purpose: the export writes media URLs
// against it, and `jant site export` downloads from there.
//
// `src/__tests__/release-fixtures.test.ts` restores and imports every
// directory there at head. A fixture is never edited once written.
//
// --rehearse <dir> runs the same steps with this checkout's build and
// canonical content, and writes into <dir>: a way to try a change to this
// script before a release depends on it. Build @jant/core first.

import { execFileSync, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const usage = `Usage: node scripts/release/freeze-fixtures.mjs <version>
       node scripts/release/freeze-fixtures.mjs --rehearse <dir>`;
const repoRoot = resolve(import.meta.dirname, "../..");
const rehearseDir =
  process.argv[2] === "--rehearse" ? process.argv[3] : undefined;
if (process.argv[2] === "--rehearse" && !rehearseDir) {
  console.error(usage);
  process.exit(1);
}
const version = rehearseDir
  ? JSON.parse(
      readFileSync(join(repoRoot, "packages/core/package.json"), "utf8"),
    ).version
  : process.argv[2];
if (!version || !/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(version)) {
  console.error(usage);
  process.exit(1);
}

const tag = `v${version}`;
const canonical = "sites/demo-source/canonical";
const target = rehearseDir
  ? resolve(rehearseDir)
  : join(repoRoot, "packages/core/src/__tests__/fixtures/releases", version);
const importedThemeFiles = [
  "favicon.ico",
  "apple-touch-icon.png",
  "custom.css",
];

if (existsSync(target)) {
  console.error(`Fixtures for ${version} already exist: ${target}`);
  process.exit(1);
}

if (!rehearseDir) {
  try {
    execFileSync("git", ["rev-parse", "--verify", `${tag}^{commit}`], {
      cwd: repoRoot,
      stdio: "ignore",
    });
  } catch {
    console.error(`No tag ${tag}. Run this after the release is tagged.`);
    process.exit(1);
  }
}

const work = mkdtempSync(join(tmpdir(), "jant-freeze-fixtures-"));
let server = null;
try {
  const source = rehearseDir
    ? join(repoRoot, canonical)
    : extractCanonical(work);
  const jantBin = rehearseDir
    ? join(repoRoot, "packages/core/bin/jant.js")
    : installRelease(join(work, "package"));

  const siteId = readSnapshotSiteId(join(source, "snapshot"));
  const devApiToken = randomBytes(24).toString("hex");
  const port = await findFreePort();
  // Only what the CLI needs, so nothing from the caller's shell (a
  // DATABASE_URL, a STORAGE_DRIVER) reaches the temporary site.
  const env = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    TMPDIR: process.env.TMPDIR,
    JANT_ENV_FILE: "",
    DATA_DIR: join(work, "data"),
    SITE_RESOLUTION_MODE: "single-site",
    AUTH_SECRET: randomBytes(32).toString("hex"),
    DEV_API_TOKEN: devApiToken,
    HOST: "127.0.0.1",
    PORT: String(port),
  };
  const jant = (args, input) =>
    execFileSync(process.execPath, [jantBin, ...args], {
      cwd: work,
      env,
      input,
      stdio: [input === undefined ? "ignore" : "pipe", "inherit", "inherit"],
    });

  jant(["migrate", "--node"]);
  jant(
    [
      "setup",
      "--node",
      "--email",
      "release-fixtures@example.com",
      "--password-stdin",
      "--site-id",
      siteId,
    ],
    randomBytes(24).toString("hex"),
  );
  jant([
    "site",
    "snapshot",
    "import",
    "--node",
    "--path",
    join(source, "snapshot"),
    "--replace",
  ]);

  const baseUrl = `http://127.0.0.1:${port}`;
  server = await startServer(jantBin, env, work, port);
  await addFixtureContent(baseUrl, devApiToken);

  const snapshotOut = join(work, "snapshot-export");
  jant([
    "site",
    "snapshot",
    "export",
    "--node",
    "--skip-objects",
    "--output",
    snapshotOut,
  ]);

  const siteExportOut = join(work, "site-export");
  jant([
    "site",
    "export",
    "--url",
    baseUrl,
    "--token",
    devApiToken,
    "--output",
    siteExportOut,
  ]);
  await server.stop();
  server = null;

  writeFixtures(snapshotOut, siteExportOut);
} catch (error) {
  rmSync(target, { recursive: true, force: true });
  throw error;
} finally {
  await server?.stop();
  rmSync(work, { recursive: true, force: true });
}

console.log(`Froze ${tag} fixtures into ${target}`);

/**
 * Add what the canonical demo content lacks, through the release's own API.
 *
 * The demo has no drafts, private posts, text attachments, custom URLs,
 * redirects, or smart collections, so fixtures frozen from it alone could
 * never show an importer dropping them. One of each, and a navigation item
 * pointing at the smart collection.
 *
 * @param {string} baseUrl - The temporary site
 * @param {string} token - Its API token
 * @returns {Promise<void>}
 */
async function addFixtureContent(baseUrl, token) {
  const api = async (method, path, body) => {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!response.ok) {
      throw new Error(
        `${method} ${path} answered ${response.status}: ${await response.text()}`,
      );
    }
    return response.json();
  };

  await api("POST", "/api/posts", {
    format: "note",
    title: "Fixture draft",
    bodyMarkdown: "A draft, kept by every backup and export.",
    status: "draft",
  });
  await api("POST", "/api/posts", {
    format: "note",
    bodyMarkdown: "A private note, kept by every backup and export.",
    visibility: "private",
  });
  const withText = await api("POST", "/api/posts", {
    format: "note",
    title: "Fixture text attachment",
    bodyMarkdown: "A post with a text attachment and a second address.",
    attachments: [
      {
        type: "text",
        contentFormat: "markdown",
        content: "# Attached\n\nText kept as a file of its own.",
      },
    ],
  });
  await api("POST", "/api/custom-urls", {
    path: "/fixture-alias",
    targetType: "post",
    targetId: withText.id,
  });

  const { collections } = await api("GET", "/api/collections");
  const collection = collections[0];
  if (!collection) throw new Error("The canonical content has no collection.");
  await api("POST", "/api/custom-urls", {
    path: "/fixture-collection",
    targetType: "collection",
    targetId: collection.id,
  });
  await api("POST", "/api/custom-urls", {
    path: "/fixture-notes",
    targetType: "redirect",
    toPath: "/archive?format=note",
    redirectType: 302,
  });
  await api("POST", "/api/custom-urls", {
    path: "/fixture-elsewhere",
    targetType: "redirect",
    toPath: "https://example.com/Elsewhere?ref=Jant",
  });

  const smartCollection = await api("POST", "/api/smart-collections", {
    slug: "fixture-quotes",
    title: "Fixture quotes",
    description: "Every quote, oldest first.",
    selection: { format: "quote" },
    sortOrder: "oldest",
  });
  await api("POST", "/api/nav-items", {
    type: "smart_collection",
    smartCollectionId: smartCollection.id,
    placement: "more",
  });
}

function extractCanonical(dir) {
  const archive = execFileSync("git", ["archive", tag, canonical], {
    cwd: repoRoot,
    maxBuffer: 256 * 1024 * 1024,
  });
  execFileSync("tar", ["-x", "-C", dir], { input: archive });
  return join(dir, canonical);
}

function installRelease(dir) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "package.json"), '{ "private": true }\n');
  console.log(`Installing @jant/core@${version} from npm...`);
  try {
    execFileSync(
      "npm",
      [
        "install",
        "--no-audit",
        "--no-fund",
        "--loglevel=error",
        `@jant/core@${version}`,
      ],
      { cwd: dir, stdio: "inherit" },
    );
  } catch {
    throw new Error(
      `Couldn't install @jant/core@${version}. Run this after the release is published to npm.`,
    );
  }
  return join(dir, "node_modules/@jant/core/bin/jant.js");
}

function readSnapshotSiteId(snapshotDir) {
  const meta = JSON.parse(readFileSync(join(snapshotDir, "meta.json"), "utf8"));
  const siteId = meta.site?.id;
  if (typeof siteId !== "string" || !siteId) {
    throw new Error(`${canonical}/snapshot/meta.json at ${tag} names no site.`);
  }
  return siteId;
}

function findFreePort() {
  return new Promise((resolvePort, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => resolvePort(port));
    });
  });
}

async function startServer(jantBin, env, cwd, port) {
  const child = spawn(process.execPath, [jantBin, "start"], {
    cwd,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (chunk) => (output += chunk));
  child.stderr.on("data", (chunk) => (output += chunk));
  const exited = new Promise((resolveExit) => child.once("exit", resolveExit));
  let running = true;
  exited.then(() => (running = false));

  const stop = async () => {
    if (running) child.kill("SIGTERM");
    await exited;
  };

  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (!running) {
      throw new Error(`jant start exited before it was ready:\n${output}`);
    }
    try {
      const response = await fetch(`http://127.0.0.1:${port}/readyz`);
      if (response.ok) return { stop };
    } catch {
      // Not listening yet.
    }
    await new Promise((wait) => setTimeout(wait, 250));
  }
  await stop();
  throw new Error(`jant start wasn't ready after 60 seconds:\n${output}`);
}

function writeFixtures(snapshotOut, siteExportOut) {
  mkdirSync(join(target, "snapshot"), { recursive: true });
  for (const file of ["meta.json", "db.sql"]) {
    cpSync(join(snapshotOut, file), join(target, "snapshot", file));
  }

  cpSync(siteExportOut, join(target, "site-export"), {
    recursive: true,
    filter: (path) =>
      !path.startsWith(join(siteExportOut, "themes")) ||
      path === join(siteExportOut, "themes"),
  });
  const themeStatic = join("themes", "jant", "static");
  mkdirSync(join(target, "site-export", themeStatic), { recursive: true });
  for (const file of importedThemeFiles) {
    const from = join(siteExportOut, themeStatic, file);
    if (existsSync(from)) {
      cpSync(from, join(target, "site-export", themeStatic, file));
    }
  }
}
