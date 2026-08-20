import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { createApp } from "../../dist/index.js";
import { createNodeRequestHandler } from "../../dist/node.js";

const nodeBin = process.execPath;
const jantBin = fileURLToPath(new URL("../../bin/jant.js", import.meta.url));

function getRequiredEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} must be set.`);
  }
  return value;
}

function getDatabaseName(databaseUrl) {
  const url = new URL(databaseUrl);
  const databaseName = url.pathname.replace(/^\/+/, "");
  if (!databaseName) {
    throw new Error("PG_SMOKE_DATABASE_URL must include a database name.");
  }
  return databaseName;
}

function quoteIdentifier(identifier) {
  return `"${identifier.replaceAll('"', '""')}"`;
}

function cookieHeaderFromSetCookies(cookies) {
  return cookies
    .map((cookie) => cookie.split(";", 1)[0]?.trim())
    .filter(Boolean)
    .join("; ");
}

async function recreateDatabase(adminDatabaseUrl, databaseName) {
  const adminPool = new Pool({
    connectionString: adminDatabaseUrl,
  });

  try {
    await adminPool.query(
      `
        SELECT pg_terminate_backend(pid)
        FROM pg_stat_activity
        WHERE datname = $1
          AND pid <> pg_backend_pid()
      `,
      [databaseName],
    );
    await adminPool.query(
      `DROP DATABASE IF EXISTS ${quoteIdentifier(databaseName)}`,
    );
    await adminPool.query(`CREATE DATABASE ${quoteIdentifier(databaseName)}`);
  } finally {
    await adminPool.end();
  }
}

async function dropDatabase(adminDatabaseUrl, databaseName) {
  const adminPool = new Pool({
    connectionString: adminDatabaseUrl,
  });

  try {
    await adminPool.query(
      `
        SELECT pg_terminate_backend(pid)
        FROM pg_stat_activity
        WHERE datname = $1
          AND pid <> pg_backend_pid()
      `,
      [databaseName],
    );
    await adminPool.query(
      `DROP DATABASE IF EXISTS ${quoteIdentifier(databaseName)}`,
    );
  } finally {
    await adminPool.end();
  }
}

async function resetPublicSchema(databaseUrl) {
  const pool = new Pool({
    connectionString: databaseUrl,
  });

  try {
    await pool.query("DROP SCHEMA IF EXISTS drizzle CASCADE");
    await pool.query("DROP SCHEMA IF EXISTS public CASCADE");
    await pool.query("CREATE SCHEMA public");
  } finally {
    await pool.end();
  }
}

async function main() {
  const databaseUrl = getRequiredEnv("PG_SMOKE_DATABASE_URL");
  const adminDatabaseUrl = process.env.PG_SMOKE_ADMIN_DATABASE_URL;
  const databaseName = getDatabaseName(databaseUrl);
  const dataDir = await mkdtemp(join(tmpdir(), "jant-pg-smoke-"));
  let assertPool;
  let handler;

  try {
    if (adminDatabaseUrl) {
      await recreateDatabase(adminDatabaseUrl, databaseName);
    } else {
      await resetPublicSchema(databaseUrl);
    }

    execFileSync(nodeBin, [jantBin, "migrate"], {
      cwd: fileURLToPath(new URL("../../", import.meta.url)),
      env: {
        ...process.env,
        DATABASE_URL: databaseUrl,
      },
      stdio: "inherit",
    });

    handler = await createNodeRequestHandler({
      env: {
        DATABASE_URL: databaseUrl,
        AUTH_SECRET: "test-secret-with-enough-entropy-for-pg-smoke",
        DATA_DIR: dataDir,
        SITE_RESOLUTION_MODE: "single-site",
        SITE_ORIGIN: "http://127.0.0.1:3000",
      },
      app: createApp(),
      assetRoot: null,
    });

    assertPool = new Pool({ connectionString: databaseUrl });

    const initialSiteCount = await assertPool.query(
      'SELECT COUNT(*)::text AS "count" FROM "site"',
    );
    assert.equal(initialSiteCount.rows[0]?.count, "0");

    const setupPage = await handler.fetch(
      new Request("http://127.0.0.1:3000/setup"),
    );
    assert.equal(setupPage.status, 200);

    const siteCountAfterGet = await assertPool.query(
      'SELECT COUNT(*)::text AS "count" FROM "site"',
    );
    assert.equal(siteCountAfterGet.rows[0]?.count, "0");

    const setupResponse = await handler.fetch(
      new Request("http://127.0.0.1:3000/setup", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          siteName: "PG Smoke",
          email: "pg-smoke@example.com",
          password: "pg-smoke-password",
          timezone: "Asia/Shanghai",
          language: "en-US",
        }),
      }),
    );

    assert.equal(setupResponse.status, 200);
    assert.match(await setupResponse.text(), /\/signin\?setup/);

    const siteCountAfterSetup = await assertPool.query(
      'SELECT COUNT(*)::text AS "count" FROM "site"',
    );
    assert.equal(siteCountAfterSetup.rows[0]?.count, "1");

    const signinResponse = await handler.fetch(
      new Request("http://127.0.0.1:3000/signin", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email: "pg-smoke@example.com",
          password: "pg-smoke-password",
        }),
      }),
    );

    assert.equal(signinResponse.status, 200);
    const cookieHeader = cookieHeaderFromSetCookies(
      signinResponse.headers.getSetCookie(),
    );
    assert.match(cookieHeader, /better-auth\.session_token=/);

    const composeResponse = await handler.fetch(
      new Request("http://127.0.0.1:3000/compose", {
        method: "POST",
        headers: {
          Accept: "application/json",
          Cookie: cookieHeader,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          format: "note",
          bodyMarkdown: "Hello from Postgres smoke.",
          status: "published",
        }),
      }),
    );

    assert.equal(composeResponse.status, 200);
    const composeBody = await composeResponse.json();
    assert.equal(composeBody.status, "published");
    assert.match(composeBody.permalink, /^\/.+/);

    const postPage = await handler.fetch(
      new Request(`http://127.0.0.1:3000${composeBody.permalink}`),
    );
    assert.equal(postPage.status, 200);
    assert.match(await postPage.text(), /Hello from Postgres smoke\./);

    const archivePage = await handler.fetch(
      new Request("http://127.0.0.1:3000/archive"),
    );
    assert.equal(archivePage.status, 200);
    assert.match(await archivePage.text(), /Hello from Postgres smoke\./);

    // The collections directory aggregates with COUNT(DISTINCT) under a LEFT
    // JOIN whose ON clause carries the reader's visibility, plus a correlated
    // subquery inside MAX(). That combination is where the two dialects are
    // most likely to part ways, and the number it produces is shown to
    // signed-out readers — a wrong one leaks how much is unpublished.
    const collectionResponse = await handler.fetch(
      new Request("http://127.0.0.1:3000/api/collections", {
        method: "POST",
        headers: {
          Cookie: cookieHeader,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ slug: "smoke", title: "Smoke" }),
      }),
    );
    assert.equal(collectionResponse.status, 201);
    const collection = await collectionResponse.json();

    const publishedResponse = await handler.fetch(
      new Request("http://127.0.0.1:3000/api/posts", {
        method: "POST",
        headers: {
          Cookie: cookieHeader,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          format: "note",
          bodyMarkdown: "Published thread in the smoke collection.",
          status: "published",
        }),
      }),
    );
    const publishedForCollection = await publishedResponse.json();

    const draftResponse = await handler.fetch(
      new Request("http://127.0.0.1:3000/api/posts", {
        method: "POST",
        headers: {
          Cookie: cookieHeader,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          format: "note",
          bodyMarkdown: "Draft that must not be counted.",
          status: "draft",
        }),
      }),
    );
    const draft = await draftResponse.json();

    for (const threadId of [publishedForCollection.id, draft.id]) {
      const attach = await handler.fetch(
        new Request(
          `http://127.0.0.1:3000/api/collections/${collection.id}/threads`,
          {
            method: "POST",
            headers: {
              Cookie: cookieHeader,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ threadId }),
          },
        ),
      );
      assert.equal(attach.status, 201);
    }

    const directoryResponse = await handler.fetch(
      new Request("http://127.0.0.1:3000/api/collections"),
    );
    assert.equal(directoryResponse.status, 200);
    const directory = await directoryResponse.json();
    const smokeRow = directory.collections.find(
      (entry) => entry.slug === "smoke",
    );
    assert.equal(smokeRow?.threadCount, 1);

    // A smart collection's count comes from `SUM(CASE …)` over one scan, and
    // its conditions are read back out of columns that are integers on SQLite
    // and real booleans on Postgres. Both are places the dialects can part
    // ways silently, and both feed a number a signed-out reader is shown.
    const smartResponse = await handler.fetch(
      new Request("http://127.0.0.1:3000/api/smart-collections", {
        method: "POST",
        headers: {
          Cookie: cookieHeader,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          slug: "smoke-notes",
          title: "Smoke Notes",
          selection: { format: "note", title: false },
        }),
      }),
    );
    assert.equal(smartResponse.status, 201);
    const smartBody = await smartResponse.json();
    // Round-tripped through the boolean column, not merely echoed back.
    assert.deepEqual(smartBody.smartCollection.selection, {
      format: "note",
      title: false,
    });

    const smartPreview = await handler.fetch(
      new Request("http://127.0.0.1:3000/api/smart-collections/preview", {
        method: "POST",
        headers: {
          Cookie: cookieHeader,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ selection: { format: "note" } }),
      }),
    );
    assert.equal(smartPreview.status, 200);
    const previewBody = await smartPreview.json();
    assert.ok(previewBody.count >= 1);
    assert.ok(previewBody.baseline >= previewBody.count);

    const smartPage = await handler.fetch(
      new Request("http://127.0.0.1:3000/smoke-notes"),
    );
    assert.equal(smartPage.status, 200);
    const smartHtml = await smartPage.text();
    assert.match(smartHtml, /Smoke Notes/);
    assert.match(smartHtml, /Automatically collects/);

    const smartFeed = await handler.fetch(
      new Request("http://127.0.0.1:3000/smoke-notes/feed"),
    );
    assert.equal(smartFeed.status, 200);

    const smartDirectory = await handler.fetch(
      new Request("http://127.0.0.1:3000/api/collections", {
        headers: { Cookie: cookieHeader },
      }),
    );
    const smartDirectoryBody = await smartDirectory.json();
    const smartRow = smartDirectoryBody.smartCollections.find(
      (entry) => entry.slug === "smoke-notes",
    );
    // Three untitled notes exist by now; one of them is the draft seeded
    // above, and a draft is never counted for anyone.
    assert.equal(smartRow?.threadCount, 2);

    // A collection slug that names nothing is answered, not dropped — the
    // whole archive under the reader's own word is never the right response.
    const missingCollection = await handler.fetch(
      new Request("http://127.0.0.1:3000/archive?collection=no-such-thing"),
    );
    assert.equal(missingCollection.status, 404);

    const searchPage = await handler.fetch(
      new Request("http://127.0.0.1:3000/search?q=Postgres"),
    );
    assert.equal(searchPage.status, 200);
    assert.match(await searchPage.text(), /<mark>Postgres<\/mark>/);

    const settingsResponse = await handler.fetch(
      new Request("http://127.0.0.1:3000/api/settings", {
        method: "PUT",
        headers: {
          Cookie: cookieHeader,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          SITE_NAME: "PG Smoke Updated",
        }),
      }),
    );

    assert.equal(settingsResponse.status, 200);
    const settingsBody = await settingsResponse.json();
    assert.equal(settingsBody.settings.SITE_NAME, "PG Smoke Updated");

    console.log("Postgres smoke passed.");
  } finally {
    await handler?.close();
    await assertPool?.end();
    if (adminDatabaseUrl) {
      await dropDatabase(adminDatabaseUrl, databaseName).catch(() => undefined);
    }
    await rm(dataDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
