#!/usr/bin/env node
/**
 * Build the migration rehearsal seeds from a released Jant.
 *
 * docs/compatibility.md promises that a site installed with 0.3.39 or later
 * upgrades in place. The rehearsals prove that only if they start from what
 * such a site holds, so the seeds come from the release itself: this script
 * installs it from npm, runs its migrations, starts its Node server on SQLite
 * and on Postgres, writes a site through its own API, and dumps the data.
 *
 * Usage:
 *   node dev/scripts/build-rehearsal-seeds.mjs \
 *     --pg-admin-url postgresql://postgres:postgres@127.0.0.1:5432/postgres \
 *     [--version 0.3.39]
 *
 * Writes `src/db/rehearsal-fixtures/v<version>.sql` (SQLite and D1) and
 * `pg-v<version>.sql` (Postgres). The manifests beside them, with the counts
 * the upgrade must end at, are written by hand. A seed is frozen once
 * committed: later migrations are rehearsed against exactly that data, so
 * build a new one for a new baseline rather than rebuilding an old one.
 */

import { spawn, execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import Database from "better-sqlite3";
import pg from "pg";

const coreDir = resolve(import.meta.dirname, "../..");
const fixturesDir = join(coreDir, "src/db/rehearsal-fixtures");

/**
 * Tables a seed leaves out: auth secrets and rate limits, the migration
 * bookkeeping each runtime keeps for itself, and the SQLite full-text index,
 * which triggers fill from `post`. `data_migration` is left out too, so every
 * rehearsal reruns every backfill over the data; backfills must be idempotent.
 */
const EXCLUDED_TABLES = new Set([
  "account",
  "session",
  "verification",
  "api_token",
  "rate_limit",
  "data_migration",
  "d1_migrations",
  "__drizzle_migrations",
  "sqlite_sequence",
]);

function isExcluded(table) {
  return (
    EXCLUDED_TABLES.has(table) ||
    table === "post_fts" ||
    table.startsWith("post_fts_") ||
    table.startsWith("_cf_")
  );
}

const DEV_API_TOKEN = "jnt_rehearsal_seed_dev_token";

async function freePort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolvePort(port));
    });
  });
}

function installRelease(version) {
  const dir = mkdtempSync(join(tmpdir(), `jant-${version}-`));
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({
      private: true,
      dependencies: { "@jant/core": version },
      // Its SQLite driver builds on install.
      allowScripts: { "better-sqlite3": true },
    }),
  );
  console.log(`Installing @jant/core@${version}...`);
  execFileSync("npm", ["install", "--no-audit", "--no-fund"], {
    cwd: dir,
    stdio: "inherit",
  });
  return dir;
}

/** Run the release's CLI with `env`, from its install directory. */
function releaseCli(installDir, args, env) {
  execFileSync(
    process.execPath,
    [join(installDir, "node_modules/@jant/core/bin/jant.js"), ...args],
    { cwd: installDir, env: { ...process.env, ...env }, stdio: "inherit" },
  );
}

async function startRelease(installDir, env) {
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  const child = spawn(
    process.execPath,
    [join(installDir, "node_modules/@jant/core/bin/jant.js"), "start"],
    {
      cwd: installDir,
      env: {
        ...process.env,
        ...env,
        HOST: "127.0.0.1",
        PORT: String(port),
        SITE_ORIGIN: origin,
        AUTH_SECRET: "rehearsal-seed-secret-with-enough-entropy",
        DEV_API_TOKEN,
      },
      stdio: ["ignore", "inherit", "inherit"],
    },
  );

  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (child.exitCode !== null) {
      throw new Error(`jant start exited with ${child.exitCode}.`);
    }
    try {
      const response = await fetch(`${origin}/health`);
      if (response.ok) return { origin, child };
    } catch {
      // Not listening yet.
    }
    await new Promise((done) => setTimeout(done, 200));
  }
  child.kill();
  throw new Error("jant start did not answer /health.");
}

async function stopRelease(child) {
  if (child.exitCode !== null) return;
  const exited = new Promise((done) => child.once("exit", done));
  child.kill("SIGTERM");
  await exited;
}

/** Images from the demo site: the release stores images only as WebP. */
const demoMediaDir = resolve(
  coreDir,
  "../../sites/demo-source/canonical/site-export/static/media",
);

/** A WebP's pixel size, from its VP8, VP8L, or VP8X header. */
function webpSize(bytes) {
  const chunk = bytes.toString("ascii", 12, 16);
  if (chunk === "VP8X") {
    return [1 + bytes.readUIntLE(24, 3), 1 + bytes.readUIntLE(27, 3)];
  }
  if (chunk === "VP8 ") {
    return [bytes.readUInt16LE(26) & 0x3fff, bytes.readUInt16LE(28) & 0x3fff];
  }
  const bits = bytes.readUInt32LE(21);
  return [(bits & 0x3fff) + 1, ((bits >> 14) & 0x3fff) + 1];
}

/**
 * Write a site through the release's own API: every post format, a Thread
 * with replies, each visibility and a draft, a deleted post, collections in
 * each sort order with a reply that belongs to one its root doesn't,
 * attachments, navigation, and custom URLs.
 */
async function writeSite(origin) {
  const api = async (method, path, body) => {
    const response = await fetch(`${origin}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${DEV_API_TOKEN}`,
        ...(body instanceof FormData
          ? {}
          : { "Content-Type": "application/json" }),
      },
      body:
        body === undefined || body instanceof FormData
          ? body
          : JSON.stringify(body),
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`${method} ${path} → ${response.status}: ${text}`);
    }
    return text ? JSON.parse(text) : null;
  };

  const setup = await fetch(`${origin}/setup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      siteName: "Rehearsal",
      email: "rehearsal@example.com",
      password: "rehearsal-password",
      timezone: "Asia/Shanghai",
      language: "en",
    }),
  });
  if (!setup.ok) throw new Error(`Setup failed with ${setup.status}.`);
  await setup.text();

  await api("PUT", "/api/settings", {
    SITE_DESCRIPTION:
      "A site written by the release the rehearsal starts from.",
    SITE_FOOTER: "Written for the migration rehearsal.",
  });

  const reading = await api("POST", "/api/collections", {
    slug: "reading",
    title: "Reading",
    description: "Books and **long reads**.",
    sortOrder: "newest",
  });
  const ratings = await api("POST", "/api/collections", {
    slug: "ratings",
    title: "Ratings",
    sortOrder: "rating_desc",
  });
  const fieldNotes = await api("POST", "/api/collections", {
    slug: "field-notes",
    title: "Field Notes",
    sortOrder: "oldest",
  });
  const divider = await api("POST", "/api/collections/sidebar-items");
  await api("PUT", `/api/collections/sidebar-items/${divider.id}`, {
    label: "Topics",
  });

  const upload = async (name, type, bytes, fields = {}) => {
    const form = new FormData();
    form.set("file", new Blob([bytes], { type }), name);
    for (const [key, value] of Object.entries(fields)) form.set(key, value);
    return api("POST", "/api/upload", form);
  };
  const image = async (file, alt) => {
    const bytes = readFileSync(join(demoMediaDir, file));
    const [width, height] = webpSize(bytes);
    return upload(file.replace(/^.*-(med_)/, "$1"), "image/webp", bytes, {
      width: String(width),
      height: String(height),
      alt,
    });
  };
  const harbor = await image(
    "0f868ce9ac84-med_01kn8jtx8qenf98tm9ahxr48sw.webp",
    "Boats in a harbor",
  );
  const field = await image(
    "7a91f0960491-med_01kn8jvq58enf98v538w5vsqp4.webp",
    "A field in spring",
  );
  const notes = await upload(
    "notes.txt",
    "text/plain",
    Buffer.from("Plain text notes.\nSecond line; with <angle> & ampersand.\n"),
  );
  const paper = await upload(
    "paper.pdf",
    "application/pdf",
    Buffer.from(
      "%PDF-1.4\n1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n2 0 obj << /Type /Pages /Kids [] /Count 0 >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n",
    ),
  );

  const day = 24 * 60 * 60;
  const start = Math.floor(Date.UTC(2026, 2, 1) / 1000);
  let dayIndex = 0;
  // Published posts a day apart, so each order a collection offers differs.
  const post = (fields) =>
    api("POST", "/api/posts", {
      ...(fields.status === "draft"
        ? {}
        : { publishedAt: start + day * dayIndex++ }),
      ...fields,
    });

  await post({
    format: "note",
    title: "Hello, world",
    slug: "hello-world",
    bodyMarkdown:
      "The first post, with a [link](https://example.com) and `code`.",
    featured: true,
    collectionIds: [reading.id],
  });
  await post({
    format: "note",
    bodyMarkdown: "An untitled note, pinned to the top.",
    pinned: true,
  });
  await post({
    format: "link",
    title: "A long read",
    url: "https://example.com/long-read",
    bodyMarkdown: "Worth the time.",
    rating: 4,
    collectionIds: [reading.id, ratings.id],
  });
  await post({
    format: "quote",
    quoteText: "The quiet tools are the ones you keep.",
    sourceName: "Someone",
    sourceUrl: "https://example.com/quote",
    rating: 5,
    collectionIds: [ratings.id],
  });
  await post({
    format: "note",
    title: "Two pictures",
    bodyMarkdown: "A harbor and a field.",
    attachments: [
      { type: "media", mediaId: harbor.id, alt: "Boats in a harbor" },
      { type: "media", mediaId: field.id, alt: "A field in spring" },
    ],
    collectionIds: [fieldNotes.id],
  });
  await post({
    format: "note",
    title: "Notes with attachments",
    bodyMarkdown: "The details are attached.",
    attachments: [
      { type: "media", mediaId: notes.id },
      { type: "media", mediaId: paper.id },
      {
        type: "text",
        contentFormat: "markdown",
        content: "# Details\n\n| Key | Value |\n| --- | --- |\n| a | 1 |\n",
        summary: "A table of details",
      },
    ],
  });
  await post({
    format: "note",
    title: "Written in a custom path",
    path: "notes/custom-path",
    bodyMarkdown: "This post lives at a path, not a slug.",
  });
  await post({
    format: "note",
    bodyMarkdown: "中文笔记：搜索索引也要能找到这一段。",
  });
  await post({
    format: "note",
    title: "Code and lists",
    bodyMarkdown:
      "```js\nconsole.log('hi');\n```\n\n- one\n- two\n\n> A quoted line; with a semicolon.",
  });

  const root = await post({
    format: "note",
    title: "A Thread",
    bodyMarkdown: "The start of a Thread.",
    collectionIds: [fieldNotes.id],
  });
  const firstReply = await post({
    format: "note",
    bodyMarkdown: "A reply.",
    replyToId: root.id,
  });
  const secondReply = await post({
    format: "note",
    bodyMarkdown: "A reply to the reply, filed under Ratings.",
    replyToId: firstReply.id,
    rating: 3,
  });
  // A reply in a collection its root isn't in: the Thread's memberships
  // must end up as the union.
  await api("POST", `/api/collections/${ratings.id}/posts`, {
    postId: secondReply.id,
  });

  await post({
    format: "note",
    bodyMarkdown: "A private note.",
    visibility: "private",
  });
  await post({
    format: "note",
    title: "Hidden from Latest",
    bodyMarkdown: "Reachable by its address only.",
    visibility: "latest_hidden",
  });
  await post({
    format: "note",
    title: "A draft",
    bodyMarkdown: "Not published yet.",
    status: "draft",
  });
  const deleted = await post({
    format: "note",
    bodyMarkdown: "Deleted after publishing.",
  });
  await api("DELETE", `/api/posts/${deleted.id}`);

  // Setup adds some built-in items; add the rest.
  const { navItems } = await api("GET", "/api/nav-items");
  for (const systemKey of ["archive", "collections", "rss"]) {
    if (!navItems.some((item) => item.systemKey === systemKey)) {
      await api("POST", "/api/nav-items", { type: "system", systemKey });
    }
  }
  await api("POST", "/api/nav-items", {
    type: "link",
    label: "Elsewhere",
    url: "https://example.com/elsewhere",
  });

  await api("POST", "/api/custom-urls", {
    path: "/old-hello",
    targetType: "redirect",
    toPath: "/hello-world",
    redirectType: "301",
  });
  await api("POST", "/api/custom-urls", {
    path: "/books",
    targetType: "collection",
    // This release names the target by slug.
    targetId: reading.slug,
  });
}

function sqlString(value) {
  return `'${value.replaceAll("'", "''")}'`;
}

/**
 * Tables in an order that satisfies their foreign keys, parents first.
 * Self-references are left to the row order.
 */
function orderByForeignKeys(tables, parentsOf) {
  const ordered = [];
  const state = new Map();
  const visit = (table) => {
    if (state.get(table) === "done") return;
    if (state.get(table) === "visiting") {
      throw new Error(`Foreign keys form a cycle through ${table}.`);
    }
    state.set(table, "visiting");
    for (const parent of parentsOf(table)) {
      if (parent !== table && tables.includes(parent)) visit(parent);
    }
    state.set(table, "done");
    ordered.push(table);
  };
  for (const table of [...tables].sort()) visit(table);
  return ordered;
}

function dumpSqlite(file) {
  const db = new Database(file, { readonly: true });
  db.defaultSafeIntegers(true);
  try {
    const tables = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      )
      .all()
      .map((row) => row.name)
      .filter((name) => !isExcluded(name));
    const ordered = orderByForeignKeys(tables, (table) =>
      db
        .prepare(`SELECT "table" FROM pragma_foreign_key_list(?)`)
        .all(table)
        .map((row) => row.table),
    );

    const statements = [];
    for (const table of ordered) {
      // Hidden and generated columns (xinfo `hidden` > 0) can't be inserted.
      const columns = db
        .prepare("SELECT name FROM pragma_table_xinfo(?) WHERE hidden = 0")
        .all(table)
        .map((row) => row.name);
      const list = columns.map((name) => `"${name}"`).join(", ");
      // TypeIDs sort by creation time, so a Thread's root comes before its
      // replies; tables without an id keep insertion order.
      const orderBy = columns.includes("id") ? "id" : "rowid";
      for (const row of db
        .prepare(`SELECT ${list} FROM "${table}" ORDER BY ${orderBy}`)
        .all()) {
        const values = columns.map((name) => {
          const value = row[name];
          if (value === null) return "NULL";
          if (typeof value === "bigint" || typeof value === "number") {
            return String(value);
          }
          if (Buffer.isBuffer(value)) return `X'${value.toString("hex")}'`;
          return sqlString(value);
        });
        statements.push(
          `INSERT INTO "${table}" (${list}) VALUES (${values.join(", ")});`,
        );
      }
    }
    return statements;
  } finally {
    db.close();
  }
}

async function dumpPostgres(databaseUrl) {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const { rows: tableRows } = await client.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name",
    );
    const tables = tableRows
      .map((row) => row.table_name)
      .filter((name) => !isExcluded(name));
    const { rows: keyRows } = await client.query(`
      SELECT child.relname AS child, parent.relname AS parent
      FROM pg_constraint c
      JOIN pg_class child ON child.oid = c.conrelid
      JOIN pg_class parent ON parent.oid = c.confrelid
      JOIN pg_namespace n ON n.oid = child.relnamespace
      WHERE c.contype = 'f' AND n.nspname = 'public'
    `);
    const ordered = orderByForeignKeys(tables, (table) =>
      keyRows.filter((row) => row.child === table).map((row) => row.parent),
    );

    const statements = [];
    for (const table of ordered) {
      const { rows: columnRows } = await client.query(
        "SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 AND is_generated = 'NEVER' ORDER BY ordinal_position",
        [table],
      );
      const columns = columnRows.map((row) => row.column_name);
      const list = columns.map((name) => `"${name}"`).join(", ");
      const orderBy = columns.includes("id") ? `"id"` : list;
      // Every value as text: an untyped literal takes the column's type on
      // insert, so booleans, JSON, and numbers load as they were.
      const { rows } = await client.query(
        `SELECT ${columns.map((name) => `"${name}"::text AS "${name}"`).join(", ")} FROM public."${table}" ORDER BY ${orderBy}`,
      );
      for (const row of rows) {
        const values = columns.map((name) =>
          row[name] === null ? "NULL" : sqlString(row[name]),
        );
        statements.push(
          `INSERT INTO public."${table}" (${list}) VALUES (${values.join(", ")});`,
        );
      }
    }
    return statements;
  } finally {
    await client.end();
  }
}

function seedHeader(version, dialect, baseline) {
  return [
    `-- Migration rehearsal seed: a site written by @jant/core@${version} on ${dialect}`,
    `-- (baseline ${baseline}), built by dev/scripts/build-rehearsal-seeds.mjs.`,
    "-- Auth secrets, rate limits, migration bookkeeping, and data_migration are",
    "-- left out; see the script. Never edit it: later migrations are rehearsed",
    "-- against exactly this.",
    "",
  ].join("\n");
}

async function main() {
  const { values } = parseArgs({
    options: {
      version: { type: "string", default: "0.3.39" },
      "pg-admin-url": { type: "string" },
    },
  });
  const version = values.version;
  const adminUrl = values["pg-admin-url"];
  if (!adminUrl) {
    throw new Error(
      "--pg-admin-url is required, for a Postgres to write into.",
    );
  }

  const installDir = installRelease(version);
  /** The last migration the release ships for a dialect: the seed's baseline. */
  const journal = (dialect) =>
    JSON.parse(
      readFileSync(
        join(
          installDir,
          "node_modules/@jant/core/src/db/migrations",
          dialect === "pg" ? "pg" : "",
          "meta/_journal.json",
        ),
        "utf8",
      ),
    ).entries.at(-1).tag;

  try {
    // SQLite, as the Node runtime and D1 both hold it.
    const dataDir = join(installDir, "data");
    const sqliteFile = join(dataDir, "jant.sqlite");
    const sqliteEnv = {
      DATABASE_URL: `file:${sqliteFile}`,
      DATA_DIR: dataDir,
    };
    releaseCli(installDir, ["migrate"], sqliteEnv);
    const sqliteServer = await startRelease(installDir, sqliteEnv);
    try {
      await writeSite(sqliteServer.origin);
    } finally {
      await stopRelease(sqliteServer.child);
    }
    const sqliteBaseline = journal("sqlite");
    writeFileSync(
      join(fixturesDir, `v${version}.sql`),
      `${seedHeader(version, "SQLite", sqliteBaseline)}\n${dumpSqlite(sqliteFile).join("\n")}\n`,
    );
    console.log(`Wrote v${version}.sql (baseline ${sqliteBaseline}).`);

    // Postgres, in a database created for this run.
    const databaseName = `jant_seed_${version.replaceAll(".", "_")}`;
    const databaseUrl = new URL(adminUrl);
    databaseUrl.pathname = `/${databaseName}`;
    const admin = new pg.Client({ connectionString: adminUrl });
    await admin.connect();
    await admin.query(`DROP DATABASE IF EXISTS "${databaseName}"`);
    await admin.query(`CREATE DATABASE "${databaseName}"`);
    try {
      const pgEnv = {
        DATABASE_URL: databaseUrl.toString(),
        DATA_DIR: join(installDir, "pg-data"),
      };
      releaseCli(installDir, ["migrate"], pgEnv);
      const pgServer = await startRelease(installDir, pgEnv);
      try {
        await writeSite(pgServer.origin);
      } finally {
        await stopRelease(pgServer.child);
      }
      const pgBaseline = journal("pg");
      writeFileSync(
        join(fixturesDir, `pg-v${version}.sql`),
        `${seedHeader(version, "Postgres", pgBaseline)}\n${(await dumpPostgres(databaseUrl.toString())).join("\n")}\n`,
      );
      console.log(`Wrote pg-v${version}.sql (baseline ${pgBaseline}).`);
    } finally {
      await admin.query(`DROP DATABASE IF EXISTS "${databaseName}"`);
      await admin.end();
    }
  } finally {
    rmSync(installDir, { recursive: true, force: true });
  }
}

await main();
