/**
 * An Unlisted Thread, end to end through `createApp()`.
 *
 * Unlisted splits two questions that used to share one answer: whether a
 * reader can open a post, and whether a list a reader sees includes it. A
 * query that forgets the second one doesn't fail — it lists the post — so
 * every reader-facing list is asked here, with a Public post beside it to
 * prove the list was really read.
 */

import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../app.js";
import type { Database } from "../db/index.js";
import { createServices } from "../services/index.js";
import type { Bindings, Post } from "../types.js";
import { createTestApp } from "./helpers/app.js";
import { createTestDatabase, DEFAULT_TEST_SITE_ID } from "./helpers/db.js";
import { pageRoutes } from "../routes/pages/page.js";

const ORIGIN = "https://blog.example";
const SECRET = "lanterns-unlisted-marker";
const CONTROL = "lanterns-public-marker";

const executionCtx = {
  waitUntil() {},
  passThroughOnException() {},
  props: {},
} as unknown as Parameters<ReturnType<typeof createApp>["fetch"]>[2];

async function createSite() {
  const { db, sqlite } = createTestDatabase({ fts: true });
  const services = createServices(
    db as unknown as Database,
    { query: async () => [] } as unknown as Parameters<
      typeof createServices
    >[1],
    DEFAULT_TEST_SITE_ID,
    { slugIdLength: 5 },
  );
  await services.settings.completeOnboarding();
  await services.settings.set("RSS_PUBLISH_DELAY_SECONDS", "0");
  await services.settings.set("DISCOVER", "latest");

  const reading = await services.collections.create({
    slug: "reading",
    title: "Reading",
  });
  await services.smartCollections.create({
    slug: "notes",
    title: "Notes",
    selection: { format: "note" },
  });

  const control = await services.posts.create({
    format: "note",
    title: "Public control",
    bodyMarkdown: `Words with ${CONTROL}.`,
    collectionIds: [reading.id],
    featured: true,
  });
  // Hidden from Latest is listed everywhere but Latest, so the lists that
  // take `visibility=hidden` have a control of their own.
  await services.posts.create({
    format: "note",
    title: "Hidden control",
    bodyMarkdown: `Words with ${CONTROL}.`,
    visibility: "latest_hidden",
  });
  const root = await services.posts.create({
    format: "note",
    title: "Unlisted root",
    bodyMarkdown: `Words with ${SECRET}.`,
    collectionIds: [reading.id],
    featured: true,
    visibility: "unlisted",
  });
  const reply = await services.posts.create({
    format: "note",
    bodyMarkdown: `A reply with ${SECRET}.`,
    replyToId: root.id,
  });

  const app = createApp();
  const request = (path: string) =>
    app.fetch(
      new Request(`${ORIGIN}${path}`),
      {
        SITE_ORIGIN: ORIGIN,
        AUTH_SECRET: "x".repeat(40),
        NODE_SQLITE: sqlite,
      } as unknown as Bindings,
      executionCtx,
    );

  return { services, request, control, root, reply };
}

describe("an Unlisted Thread", () => {
  let site: Awaited<ReturnType<typeof createSite>>;
  let root: Post;

  beforeAll(async () => {
    site = await createSite();
    root = site.root;
  });

  it("opens at its address, kept out of search engines", async () => {
    const res = await site.request(`/${root.slug}`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain(SECRET);
    expect(html).toContain('<meta name="robots" content="noindex');
    expect(html).not.toContain("application/ld+json");
    // The one visibility a reader can meet carries its badge.
    expect(html).toContain("post-status-unlisted");
  });

  it("opens at its reply's address too", async () => {
    const reply = await site.request(`/${site.reply.slug}`);
    expect(reply.status).not.toBe(404);
  });

  it("answers single reads in the public API", async () => {
    expect((await site.request(`/api/public/posts/${root.slug}`)).status).toBe(
      200,
    );
    expect(
      (await site.request(`/api/public/threads/${root.slug}`)).status,
    ).toBe(200);
  });

  it.each([
    "/",
    "/featured",
    "/archive",
    "/archive?visibility=hidden",
    `/search?q=lanterns`,
    "/reading",
    "/notes",
    "/collections",
    "/feed",
    "/latest/feed",
    "/featured/feed",
    "/archive/feed",
    "/reading/feed",
    "/sitemap.xml",
    "/sitemap-posts-1.xml",
    "/api/public/threads",
    "/api/public/threads?visibility=any",
    "/api/public/threads?visibility=featured",
  ])("stays out of %s", async (path) => {
    const res = await site.request(path);
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).not.toContain(SECRET);
    expect(body).not.toContain(root.slug);
    if (path !== "/collections" && !path.startsWith("/sitemap")) {
      // The list was really read: the Public post beside it is there.
      expect(body).toContain(
        path.startsWith("/search") ? "Public control" : CONTROL,
      );
    }
  });

  it("is not a value a reader can ask a list for", async () => {
    expect(
      (await site.request("/api/public/threads?visibility=unlisted")).status,
    ).toBe(400);

    const archive = await site.request("/archive?visibility=unlisted");
    expect(archive.status).toBe(302);
    expect(archive.headers.get("Location")).toBe("/archive");
  });

  it("reads as gone to a directory asking about it", async () => {
    const res = await site.request(
      `/api/discover/posts?id=${root.id}&id=${site.control.id}`,
    );
    expect(res.status).toBe(200);
    const { posts } = (await res.json()) as {
      posts: { id: string; latest: boolean; featured: boolean }[];
    };
    expect(posts).toEqual([
      { id: root.id, latest: false, featured: false },
      { id: site.control.id, latest: true, featured: true },
    ]);
  });
});

describe("turning an Unlisted link off", () => {
  it("answers 404 once the post is Private", async () => {
    const site = await createSite();
    await site.services.posts.update(site.root.id, { visibility: "private" });

    expect((await site.request(`/${site.root.slug}`)).status).toBe(404);
  });

  it("retires the old address when the slug changes", async () => {
    const site = await createSite();
    await site.services.posts.update(site.root.id, { slug: "new-link" });

    expect((await site.request(`/${site.root.slug}`)).status).toBe(404);
    expect((await site.request("/new-link")).status).toBe(200);
  });
});

describe("an Unlisted Thread for the signed-in author", () => {
  it("shows on its Collection page", async () => {
    const { app, services } = createTestApp({ authenticated: true });
    app.route("/", pageRoutes);
    const reading = await services.collections.create({
      slug: "reading",
      title: "Reading",
    });
    await services.posts.create({
      format: "note",
      bodyMarkdown: `Words with ${SECRET}.`,
      collectionIds: [reading.id],
      visibility: "unlisted",
    });

    const res = await app.request("/reading");
    expect(res.status).toBe(200);
    expect(await res.text()).toContain(SECRET);
  });
});
