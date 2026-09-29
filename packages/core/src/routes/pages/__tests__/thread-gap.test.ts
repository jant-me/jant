/**
 * Where a folded Thread's gap leads, on the page and in the feed.
 *
 * Both surfaces fold through `lib/thread-fold.ts`, but they reach it by
 * different paths: the feed slices the chain it holds, while the page ranks in
 * SQL and hands the gap's address through `TimelineItemView` into
 * `ThreadPreview`. A field dropped anywhere on that second path went unnoticed
 * by the fold's own tests, so this compares what each surface actually serves.
 *
 * The Featured page folds differently — the root, the featured posts and the
 * last post, with a gap wherever that leaves a run out — but by the same rule:
 * each gap opens the first post of its run. That post is never loaded whole,
 * so its address is read on its own and has to come out right.
 */

import { describe, expect, it } from "vitest";
import { createTestApp } from "../../../__tests__/helpers/app.js";
import type { Post } from "../../../types.js";
import { featuredRoutes } from "../featured.js";
import { homeRoutes } from "../home.js";
import { latestRoutes } from "../latest.js";

function createThreadGapTestApp(options: { sitePathPrefix?: string } = {}) {
  const testApp = createTestApp(options);
  const { app } = testApp;

  app.use("*", async (c, next) => {
    c.set("publicPath", c.req.path);
    c.set("publicRequestUrl", c.req.url);
    await next();
  });

  app.route("/featured", featuredRoutes);
  app.route("/latest", latestRoutes);
  app.route("/", homeRoutes);

  return testApp;
}

/**
 * A root and nine replies. The fold shows two leading, two trailing and the
 * newest, so replies 3–6 are hidden.
 */
async function createLongThread(
  services: ReturnType<typeof createTestApp>["services"],
) {
  const root = await services.posts.create({
    format: "note",
    bodyMarkdown: "Root",
    publishedAt: 1000,
  });
  const replies = [];
  let parentId = root.id;
  for (let index = 1; index <= 9; index++) {
    const reply = await services.posts.create({
      format: "note",
      bodyMarkdown: `Reply ${index}`,
      replyToId: parentId,
      publishedAt: 1000 + index,
    });
    replies.push(reply);
    parentId = reply.id;
  }
  return replies;
}

describe("Thread gap link", () => {
  it("opens the first hidden reply on the homepage, as the Latest feed does", async () => {
    const { app, services } = createThreadGapTestApp();
    const replies = await createLongThread(services);
    const firstHidden = replies[2];
    const latest = replies[8];
    if (!firstHidden || !latest) throw new Error("thread not created");

    const html = await (await app.request("/")).text();
    const gapLinks = [
      ...html.matchAll(/<a\b[^>]*\bclass="thread-gap-link"[^>]*>([^<]*)</g),
    ];
    expect(gapLinks).toHaveLength(1);
    const [gapTag, gapLabel] = gapLinks[0] ?? [];
    expect(gapTag).toContain(`href="/${firstHidden.slug}"`);
    expect(gapTag).not.toContain(`href="/${latest.slug}"`);
    expect(gapLabel).toBe("4 more posts");

    const atom = await (await app.request("/latest/feed")).text();
    const thread = atom.match(/<jant:thread\b[^>]*>/)?.[0] ?? "";
    expect(thread).toContain('hidden="4"');
    expect(thread).toMatch(new RegExp(`\\bgap="[^"]*/${firstHidden.slug}"`));
  });

  it("opens the first hidden reply at its custom path", async () => {
    const { app, services } = createThreadGapTestApp();
    const replies = await createLongThread(services);
    const firstHidden = replies[2];
    if (!firstHidden) throw new Error("thread not created");
    await services.paths.create({
      path: "notes/the-gap",
      kind: "alias",
      postId: firstHidden.id,
    });

    const html = await (await app.request("/")).text();
    const gapTag = html.match(/<a\b[^>]*\bclass="thread-gap-link"[^>]*>/)?.[0];
    // A custom path already starts with "/"; another makes a protocol-relative
    // URL that leaves the site.
    expect(gapTag).toContain('href="/notes/the-gap"');
    expect(gapTag).not.toContain("//notes/the-gap");
  });
});

/**
 * A root and a chain of replies, one post per entry of `featured`, each
 * published a second after the one before it.
 */
async function createFeaturedThread(
  services: ReturnType<typeof createTestApp>["services"],
  featured: boolean[],
): Promise<Post[]> {
  const thread: Post[] = [];
  for (const [index, isFeatured] of featured.entries()) {
    thread.push(
      await services.posts.create({
        format: "note",
        bodyMarkdown: `Post ${index}`,
        featured: isFeatured,
        replyToId: thread.at(-1)?.id,
        publishedAt: 1000 + index,
      }),
    );
  }
  return thread;
}

/** Every gap link on the page, with its label, in page order. */
async function featuredGapLinks(
  app: ReturnType<typeof createTestApp>["app"],
): Promise<Array<{ href: string; label: string }>> {
  const html = await (await app.request("/featured")).text();
  return [
    ...html.matchAll(/<a\b[^>]*\bclass="thread-gap-link"[^>]*>([^<]*)</g),
  ].map(([tag, label]) => ({
    href: tag.match(/\bhref="([^"]*)"/)?.[1] ?? "",
    label: (label ?? "").trim(),
  }));
}

describe("Featured gap link", () => {
  it("opens the first post of each hidden run", async () => {
    const { app, services } = createThreadGapTestApp();
    // root · [1] · 2★ · [3 · 4] · 5
    const thread = await createFeaturedThread(services, [
      false,
      false,
      true,
      false,
      false,
      false,
    ]);

    expect(await featuredGapLinks(app)).toEqual([
      { href: `/${thread[1]?.slug}`, label: "1 hidden post" },
      { href: `/${thread[3]?.slug}`, label: "2 hidden posts" },
    ]);
  });

  it("leaves no gap between posts shown back to back", async () => {
    const { app, services } = createThreadGapTestApp();
    // root★ · 1★ · [2] · 3
    const thread = await createFeaturedThread(services, [
      true,
      true,
      false,
      false,
    ]);

    expect(await featuredGapLinks(app)).toEqual([
      { href: `/${thread[2]?.slug}`, label: "1 hidden post" },
    ]);
  });

  it("opens the first hidden post at its custom path", async () => {
    const { app, services } = createThreadGapTestApp();
    const thread = await createFeaturedThread(services, [true, false, false]);
    const firstHidden = thread[1];
    if (!firstHidden) throw new Error("thread not created");
    await services.paths.create({
      path: "notes/the-gap",
      kind: "alias",
      postId: firstHidden.id,
    });

    expect(await featuredGapLinks(app)).toEqual([
      { href: "/notes/the-gap", label: "1 hidden post" },
    ]);
  });

  it("carries the site path prefix", async () => {
    const { app, services } = createThreadGapTestApp({
      sitePathPrefix: "/blog",
    });
    const thread = await createFeaturedThread(services, [true, false, false]);

    expect(await featuredGapLinks(app)).toEqual([
      { href: `/blog/${thread[1]?.slug}`, label: "1 hidden post" },
    ]);
  });
});
