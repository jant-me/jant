/**
 * Round-trip budget for the post page.
 *
 * On Workers a public page's cost is almost entirely the number of sequential
 * D1 reads it makes — the same render against local SQLite is about a
 * millisecond. Serving `/{slug}` used to read `path_registry` twice for one
 * address and the `post` table four times for one post, and nothing failed
 * when it did. These tests are that missing failure.
 */

import { describe, expect, it, vi } from "vitest";
import { createTestApp } from "../../../__tests__/helpers/app.js";
import { withConfig } from "../../../middleware/config.js";
import { i18nMiddleware } from "../../../i18n/index.js";
import { normalizePath, toPublicHref } from "../../../lib/url.js";
import { pageRoutes } from "../page.js";

/**
 * Mount the catch-all behind the middleware `createApp()` puts in front of it.
 *
 * The stored-redirect middleware is reproduced rather than imported because it
 * is defined inline in `app.tsx`; what is under test is that it hands its
 * lookup on and the route takes it, so the stash is the part that must match.
 */
function createPostPageApp() {
  const testApp = createTestApp();
  const { app } = testApp;

  app.use("*", async (c, next) => {
    c.set("publicPath", c.req.path);
    c.set("publicRequestUrl", c.req.url);
    await next();
  });

  app.use("*", async (c, next) => {
    const storedPath = normalizePath(new URL(c.req.url).pathname);
    const record = await c.var.services.paths.resolve(storedPath);
    c.set("pathLookup", { path: storedPath, record });
    if (record?.kind === "redirect" && record.redirectToPath) {
      return c.redirect(
        toPublicHref(`/${record.redirectToPath}`),
        record.redirectType ?? 301,
      );
    }
    await next();
  });
  app.use("*", withConfig());
  app.use("*", i18nMiddleware());
  app.route("/", pageRoutes);

  return testApp;
}

/** Every SQL statement prepared while `run` executes. */
async function captureStatements<T>(
  sqlite: ReturnType<typeof createTestApp>["sqlite"],
  run: () => Promise<T>,
): Promise<[T, string[]]> {
  const original = sqlite.prepare.bind(sqlite);
  const statements: string[] = [];
  const spy = vi.spyOn(sqlite, "prepare").mockImplementation(((
    source: string,
  ) => {
    statements.push(source.replace(/\s+/g, " "));
    return original(source);
  }) as typeof sqlite.prepare);
  try {
    return [await run(), statements];
  } finally {
    spy.mockRestore();
  }
}

/** Reads that resolve one address, i.e. filter `path_registry` by `path`. */
function countAddressLookups(statements: string[]): number {
  return statements.filter(
    (sql) =>
      /from "path_registry"/i.test(sql) &&
      /"path_registry"\."path" = \?/i.test(sql),
  ).length;
}

/** Reads that scan the `post` table. */
function countPostReads(statements: string[]): number {
  return statements.filter((sql) => /from "post"/i.test(sql)).length;
}

describe("post page round trips", () => {
  it("resolves the requested address once, and keeps its post reads to three", async () => {
    const { app, services, sqlite } = createPostPageApp();
    const post = await services.posts.create({
      format: "note",
      title: "Budget",
      bodyMarkdown: "Body",
      status: "published",
    });

    const [res, statements] = await captureStatements(sqlite, () =>
      app.request(`/${post.slug}`),
    );
    expect(res.status).toBe(200);

    // The middleware's lookup is the route's lookup.
    expect(countAddressLookups(statements)).toBe(1);

    // Three reads, and each is for something different: the post with its
    // canonical alias, its thread, and the thread ids that collection
    // membership is keyed by. A root post's visibility rides along in its own
    // row, so nothing goes back for that.
    expect(countPostReads(statements)).toBe(3);
  });

  it("redirects a slug to its custom URL without a separate alias lookup", async () => {
    const { app, services, sqlite } = createPostPageApp();
    const post = await services.posts.create({
      format: "note",
      title: "Renamed",
      bodyMarkdown: "Body",
      status: "published",
    });
    await services.customUrls.create({
      path: "renamed-url",
      targetType: "post",
      targetId: post.id,
    });

    const [res, statements] = await captureStatements(sqlite, () =>
      app.request(`/${post.slug}`),
    );
    expect(res.status).toBe(301);
    expect(res.headers.get("location")).toBe("/renamed-url");

    // The address lookup, and nothing more: the alias came back with the post.
    expect(countAddressLookups(statements)).toBe(1);
    expect(countPostReads(statements)).toBe(1);
  });

  it("takes the newest alias as the canonical address", async () => {
    const { app, services } = createPostPageApp();
    const post = await services.posts.create({
      format: "note",
      title: "Renamed twice",
      bodyMarkdown: "Body",
      status: "published",
    });
    await services.customUrls.create({
      path: "first-name",
      targetType: "post",
      targetId: post.id,
    });
    await services.customUrls.create({
      path: "second-name",
      targetType: "post",
      targetId: post.id,
    });

    const res = await app.request(`/${post.slug}`);
    expect(res.status).toBe(301);
    expect(res.headers.get("location")).toBe("/second-name");
  });
});

describe("post list round trips", () => {
  it("reads thread-root visibility from the rows it already loaded", async () => {
    const { services, sqlite } = createTestApp();
    for (let i = 0; i < 3; i++) {
      await services.posts.create({
        format: "note",
        title: `Post ${i}`,
        bodyMarkdown: "Body",
        status: "published",
      });
    }

    const [listed, statements] = await captureStatements(sqlite, () =>
      services.posts.list({ status: "published", excludeReplies: true }),
    );

    expect(listed).toHaveLength(3);
    // A list of thread roots carries its own visibility, so the only `post`
    // read is the list itself.
    expect(countPostReads(statements)).toBe(1);
  });

  it("still looks up the root for a reply loaded on its own", async () => {
    const { services, sqlite } = createTestApp();
    const root = await services.posts.create({
      format: "note",
      title: "Root",
      bodyMarkdown: "Body",
      status: "published",
      visibility: "private",
    });
    const reply = await services.posts.create({
      format: "note",
      bodyMarkdown: "Reply",
      replyToId: root.id,
      status: "published",
    });

    const [loaded, statements] = await captureStatements(sqlite, () =>
      services.posts.getById(reply.id),
    );

    // A reply's own visibility column is null — it inherits the root's — and
    // the root is not among the rows loaded here, so the second read is what
    // makes the reply private too.
    expect(countPostReads(statements)).toBe(2);
    expect(loaded?.visibility).toBe("private");
  });
});
