/**
 * Thread order on the public surfaces when a reply is older than its root.
 *
 * A post moved into a Thread keeps its own creation time, and an export
 * without `created` dates every post by its publication, so a Thread's replies
 * can carry a `createdAt` earlier than the root's. Thread order still opens on
 * the root: every page and feed that reads the first post as the root has to
 * find it there, or the Thread drops out of Featured and Collections and its
 * page canonicalizes to a reply.
 */

import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createTestApp } from "../../../__tests__/helpers/app.js";
import { posts as postTable } from "../../../db/schema.js";
import { toISOString } from "../../../lib/time.js";
import { collectionRoutes } from "../collection.js";
import { collectionsPageRoutes } from "../collections.js";
import { featuredRoutes } from "../featured.js";
import { pageRoutes } from "../page.js";

const ROOT_TEXT = "Root body text";
const FIRST_TEXT = "First reply text";
const SECOND_TEXT = "Second reply text";

function createThreadOrderTestApp(options: { authenticated?: boolean } = {}) {
  const testApp = createTestApp(options);
  const { app } = testApp;

  app.use("*", async (c, next) => {
    c.set("publicPath", c.req.path);
    c.set("publicRequestUrl", c.req.url);
    await next();
  });

  app.route("/featured", featuredRoutes);
  app.route("/collections", collectionsPageRoutes);
  app.route("/collections", collectionRoutes);
  app.route("/", pageRoutes);

  return testApp;
}

/**
 * A featured root published after its two replies, with creation times to
 * match — the shape a site rebuilt from a pre-`created` export holds.
 */
async function createThreadWithOlderReplies(
  testApp: ReturnType<typeof createThreadOrderTestApp>,
) {
  const { services, db } = testApp;
  const root = await services.posts.create({
    format: "note",
    title: "Thread root",
    bodyMarkdown: ROOT_TEXT,
    featured: true,
    publishedAt: 3000,
  });
  const first = await services.posts.create({
    format: "note",
    bodyMarkdown: FIRST_TEXT,
    replyToId: root.id,
    publishedAt: 1000,
  });
  const second = await services.posts.create({
    format: "note",
    bodyMarkdown: SECOND_TEXT,
    replyToId: first.id,
    publishedAt: 2000,
  });
  for (const [id, createdAt] of [
    [root.id, 3000],
    [first.id, 1000],
    [second.id, 2000],
  ] as const) {
    await db.update(postTable).set({ createdAt }).where(eq(postTable.id, id));
  }
  return { root, first, second };
}

/**
 * Assert the three posts appear root first, in Thread order. A page's `<head>`
 * repeats the visited post's text, so only the body counts.
 */
function expectRootFirst(markup: string) {
  const bodyStart = markup.indexOf("<body");
  const body = bodyStart === -1 ? markup : markup.slice(bodyStart);
  const root = body.indexOf(ROOT_TEXT);
  const first = body.indexOf(FIRST_TEXT);
  const second = body.indexOf(SECOND_TEXT);
  expect(root).toBeGreaterThan(-1);
  expect(first).toBeGreaterThan(root);
  expect(second).toBeGreaterThan(first);
}

/** The post whose `<article>` holds the markup at `index`. */
function postIdAt(html: string, index: number): string | undefined {
  const articles = html
    .slice(0, index)
    .matchAll(/<article\b[^>]*\bdata-post-id="([^"]+)"/g);
  return [...articles].at(-1)?.[1];
}

function extractCanonicalHref(html: string): string | null {
  const match = html.match(/<link\s+rel="canonical"\s+href="([^"]+)"\s*\/?>/i);
  return match?.[1] ?? null;
}

describe("Thread order with replies older than the root", () => {
  it("opens the Thread page on the root and points its canonical there", async () => {
    const testApp = createThreadOrderTestApp();
    const { root, second } = await createThreadWithOlderReplies(testApp);

    const res = await testApp.app.request(`/${second.slug}`);
    expect(res.status).toBe(200);
    const html = await res.text();

    expectRootFirst(html);
    expect(extractCanonicalHref(html)).toMatch(new RegExp(`/${root.slug}$`));
    // The page describes the Thread as one article, dated by its root.
    expect(html).toContain(
      `<meta property="article:published_time" content="${toISOString(3000)}"/>`,
    );
    expect(html).toContain(`"datePublished":"${toISOString(3000)}"`);
  });

  it("offers the author a reply on the newest reply, not the root", async () => {
    const testApp = createThreadOrderTestApp({ authenticated: true });
    const { root, second } = await createThreadWithOlderReplies(testApp);

    const html = await (await testApp.app.request(`/${root.slug}`)).text();

    expect(html.match(/data-reply-trigger/g)).toHaveLength(1);
    expect(postIdAt(html, html.indexOf("data-reply-trigger"))).toBe(second.id);
  });

  it("keeps the Thread on the Featured page", async () => {
    const testApp = createThreadOrderTestApp();
    await createThreadWithOlderReplies(testApp);

    const res = await testApp.app.request("/featured");
    expect(res.status).toBe(200);
    const html = await res.text();

    // The curated view shows the root and the Thread's final post, with the
    // reply between them folded into a gap.
    expect(html).toContain(ROOT_TEXT);
    expect(html).not.toContain(FIRST_TEXT);
    expect(html.indexOf(SECOND_TEXT)).toBeGreaterThan(html.indexOf(ROOT_TEXT));
  });

  it("keeps the Thread in the Featured feed", async () => {
    const testApp = createThreadOrderTestApp();
    const { root } = await createThreadWithOlderReplies(testApp);

    const res = await testApp.app.request("/featured/feed");
    expect(res.status).toBe(200);
    const xml = await res.text();

    expect(xml.match(/<entry>/g)).toHaveLength(1);
    expect(xml).toContain(`/${root.slug}`);
    expectRootFirst(xml);
  });

  it("opens the Thread on its root on a Collection page", async () => {
    const testApp = createThreadOrderTestApp();
    const collection = await testApp.services.collections.create({
      slug: "reading",
      title: "Reading",
    });
    const { root } = await createThreadWithOlderReplies(testApp);
    await testApp.services.collections.addThread(collection.id, root.id);

    const res = await testApp.app.request(`/${collection.slug}`);
    expect(res.status).toBe(200);

    expectRootFirst(await res.text());
  });
});
