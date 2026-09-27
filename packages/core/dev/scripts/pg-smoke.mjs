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

async function readSetting(pool, key) {
  const result = await pool.query(
    'SELECT "value" FROM "site_setting" WHERE "key" = $1',
    [key],
  );
  return result.rows[0]?.value;
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

    // Setup is two screens. The first opens the account through better-auth,
    // stands the site row up around it, and signs the owner in; the second is
    // answered from that session and closes onboarding. Each is checked against
    // the database rather than the redirect alone, since a Postgres-only failure
    // would show up as a status that never advanced.
    const accountResponse = await handler.fetch(
      new Request("http://127.0.0.1:3000/setup", {
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

    assert.equal(accountResponse.status, 200);
    assert.match(await accountResponse.text(), /href='\/setup'/);
    const setupCookieHeader = cookieHeaderFromSetCookies(
      accountResponse.headers.getSetCookie(),
    );
    assert.match(setupCookieHeader, /better-auth\.session_token=/);

    const siteCountAfterAccount = await assertPool.query(
      'SELECT COUNT(*)::text AS "count" FROM "site"',
    );
    assert.equal(siteCountAfterAccount.rows[0]?.count, "1");
    assert.equal(
      await readSetting(assertPool, "ONBOARDING_STATUS"),
      "provisioned",
    );

    const siteResponse = await handler.fetch(
      new Request("http://127.0.0.1:3000/setup", {
        method: "POST",
        headers: {
          Cookie: setupCookieHeader,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          siteName: "PG Smoke",
          contentLanguage: "en",
          language: "en-US",
          timezone: "Asia/Shanghai",
        }),
      }),
    );

    assert.equal(siteResponse.status, 200);
    assert.match(await siteResponse.text(), /href='\/'/);
    assert.equal(
      await readSetting(assertPool, "ONBOARDING_STATUS"),
      "completed",
    );
    assert.equal(await readSetting(assertPool, "SITE_NAME"), "PG Smoke");

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
    assert.deepEqual(smartBody.selection, {
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

    // Paging reads its cursor back out of SQL: the ORDER BY keys are selected
    // as columns beside the row, NULLs folded by `coalesce(…, -1)`, and the
    // next page compares against them. Postgres sorts NULLs first under DESC
    // where SQLite sorts them last, so a key left unwrapped would reorder the
    // walk here and nowhere else. Ties and a pinned post put page breaks on
    // every key.
    const createPost = async (fields) => {
      const response = await handler.fetch(
        new Request("http://127.0.0.1:3000/api/posts", {
          method: "POST",
          headers: {
            Cookie: cookieHeader,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            format: "note",
            status: "published",
            ...fields,
          }),
        }),
      );
      assert.equal(response.status, 201);
      return response.json();
    };
    for (const bodyMarkdown of ["Tie one.", "Tie two.", "Tie three."]) {
      await createPost({ bodyMarkdown, publishedAt: 1_700_000_000 });
    }
    await createPost({
      bodyMarkdown: "Pinned.",
      publishedAt: 1_600_000_000,
      pinned: true,
    });
    const privatePost = await createPost({
      bodyMarkdown: "Private.",
      visibility: "private",
    });

    // A collection's keys are aggregates over each Thread's members, read
    // back out of a grouped subquery: a Collection pin, the first publication
    // (oldest), Thread activity, and the highest rating (rating_desc).
    const walkCollectionResponse = await handler.fetch(
      new Request("http://127.0.0.1:3000/api/collections", {
        method: "POST",
        headers: {
          Cookie: cookieHeader,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ slug: "smoke-walk", title: "Smoke walk" }),
      }),
    );
    assert.equal(walkCollectionResponse.status, 201);
    const walkCollection = await walkCollectionResponse.json();
    const inWalk = { collectionIds: [walkCollection.id] };
    for (const bodyMarkdown of ["Walk tie one.", "Walk tie two."]) {
      await createPost({
        ...inWalk,
        bodyMarkdown,
        publishedAt: 1_700_000_000,
        rating: 3,
      });
    }
    const walkBumped = await createPost({
      ...inWalk,
      bodyMarkdown: "Walk root with a later reply.",
      publishedAt: 1_650_000_000,
    });
    await createPost({
      bodyMarkdown: "Walk reply.",
      replyToId: walkBumped.id,
      publishedAt: 1_750_000_000,
      rating: 5,
    });
    const walkPinned = await createPost({
      ...inWalk,
      bodyMarkdown: "Walk pinned.",
      publishedAt: 1_600_000_000,
    });
    const pinResponse = await handler.fetch(
      new Request(
        `http://127.0.0.1:3000/api/collections/${walkCollection.id}/threads/${walkPinned.id}/pin`,
        { method: "PUT", headers: { Cookie: cookieHeader } },
      ),
    );
    assert.equal(pinResponse.status, 200);
    await createPost({ ...inWalk, bodyMarkdown: "Walk unrated." });
    const walkPrivate = await createPost({
      ...inWalk,
      bodyMarkdown: "Walk private.",
      visibility: "private",
    });

    const readIds = async (path, headers = {}) => {
      const response = await handler.fetch(
        new Request(`http://127.0.0.1:3000${path}`, { headers }),
      );
      assert.equal(response.status, 200, path);
      const body = await response.json();
      const items = body.posts ?? body.threads;
      return { ids: items.map((item) => item.id), next: body.nextCursor };
    };
    const walkedOrders = new Map();
    for (const [path, headers] of [
      ["/api/posts?", { Cookie: cookieHeader }],
      ["/api/posts?status=draft&", { Cookie: cookieHeader }],
      ["/api/public/posts?", {}],
      ["/api/public/archive?", {}],
      ["/api/public/posts?collection=smoke-walk&sort=newest&", {}],
      ["/api/public/posts?collection=smoke-walk&sort=oldest&", {}],
      ["/api/public/posts?collection=smoke-walk&sort=rating_desc&", {}],
      // The Thread lists: every order on the plain list, a collection's own
      // orders with the other dimensions pushed into a root subquery (the
      // `replies` one correlates an EXISTS inside it), and one Thread's posts.
      ["/api/threads?", { Cookie: cookieHeader }],
      ["/api/public/threads?", {}],
      ["/api/public/threads?visibility=any&sort=published&", {}],
      ["/api/public/threads?sort=updated&", {}],
      ["/api/public/threads?sort=oldest&", {}],
      ["/api/public/threads?sort=rating&include=fold&", {}],
      ["/api/public/threads?collection=smoke-walk&", {}],
      ["/api/public/threads?collection=smoke-walk&sort=rating&", {}],
      ["/api/public/threads?collection=smoke-walk&replies=any&", {}],
      ["/api/public/threads?collection=smoke-walk&sort=published&", {}],
      [`/api/public/threads/${walkBumped.slug}/posts?`, {}],
    ]) {
      const expected = (await readIds(`${path}limit=100`, headers)).ids;
      assert.ok(expected.length >= 1, path);
      const walked = [];
      let cursor = null;
      for (let page = 0; page <= expected.length; page++) {
        const query = cursor
          ? `limit=1&cursor=${encodeURIComponent(cursor)}`
          : "limit=1";
        const { ids, next } = await readIds(`${path}${query}`, headers);
        walked.push(...ids);
        cursor = next;
        if (cursor === null) break;
      }
      assert.equal(cursor, null, path);
      assert.deepEqual(walked, expected, path);
      walkedOrders.set(path, expected);
    }
    // Each sort reads its own keys: the pinned Thread leads all three, then
    // activity, first publication, and rating put the rest in three orders.
    assert.deepEqual(
      walkedOrders.get(
        "/api/public/threads?collection=smoke-walk&replies=any&",
      ),
      [walkBumped.id],
    );
    assert.equal(
      walkedOrders.get(`/api/public/threads/${walkBumped.slug}/posts?`)?.length,
      2,
    );
    const collectionOrders = [...walkedOrders]
      .filter(([path]) => path.startsWith("/api/public/posts?collection="))
      .map(([, ids]) => ids);
    assert.equal(collectionOrders.length, 3);
    for (const ids of collectionOrders) {
      assert.equal(ids.length, 5);
      assert.equal(ids[0], walkPinned.id);
    }
    assert.equal(
      new Set(collectionOrders.map((ids) => ids.join())).size,
      3,
      "collection sort orders",
    );

    // A private post's ID, the old cursor format, answers as an unknown one.
    const privateCursor = await handler.fetch(
      new Request(
        `http://127.0.0.1:3000/api/public/archive?cursor=${privatePost.id}`,
      ),
    );
    assert.equal(privateCursor.status, 400);
    const privateCollectionCursor = await handler.fetch(
      new Request(
        `http://127.0.0.1:3000/api/public/posts?collection=smoke-walk&cursor=${walkPrivate.id}`,
      ),
    );
    assert.equal(privateCollectionCursor.status, 400);

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

    // Search keeps private posts, and replies that inherit a private root's
    // visibility, from anyone signed out, and finds them for the author.
    // `lanterns` takes the full-text statement and then its ILIKE fallback;
    // `灯笼` is short enough to go straight to ILIKE. Each is its own SQL, and
    // each has to apply the rule.
    const privateSearchRoot = await createPost({
      title: "Secret diary",
      bodyMarkdown: "Private root lanterns 灯笼.",
      visibility: "private",
    });
    await createPost({
      bodyMarkdown: "Private reply lanterns 灯笼.",
      replyToId: privateSearchRoot.id,
    });
    for (const query of ["lanterns", "灯笼"]) {
      const q = encodeURIComponent(query);
      // The search API is the author's: a signed-out caller gets nothing.
      const anonymousApi = await handler.fetch(
        new Request(`http://127.0.0.1:3000/api/search?q=${q}`),
      );
      assert.equal(anonymousApi.status, 401);

      const authorApi = await handler.fetch(
        new Request(`http://127.0.0.1:3000/api/search?q=${q}`, {
          headers: { Cookie: cookieHeader },
        }),
      );
      assert.equal(authorApi.status, 200);
      const authorApiBody = await authorApi.json();
      assert.equal(authorApiBody.count, 2);
      assert.deepEqual(
        authorApiBody.results.map((result) => result.visibility),
        ["private", "private"],
      );

      const anonymousPage = await handler.fetch(
        new Request(`http://127.0.0.1:3000/search?q=${q}`),
      );
      assert.equal(anonymousPage.status, 200);
      assert.doesNotMatch(
        await anonymousPage.text(),
        /Secret diary|Private root|Private reply/,
      );

      const authorPage = await handler.fetch(
        new Request(`http://127.0.0.1:3000/search?q=${q}`, {
          headers: { Cookie: cookieHeader },
        }),
      );
      assert.equal(authorPage.status, 200);
      const authorHtml = await authorPage.text();
      assert.match(authorHtml, /Secret diary/);
      assert.match(authorHtml, /Private reply/);
    }

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
