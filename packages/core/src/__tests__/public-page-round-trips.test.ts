/**
 * Round-trip budget for public pages on Workers + D1.
 *
 * A Worker waits the full Worker↔D1 distance for every read it cannot start
 * alongside another one, and that wait is nearly all a public page costs: the
 * render itself is a few milliseconds. From a Tokyo edge a D1 primary in the
 * US is ~125 ms away, so each round a page adds here is ~125 ms a reader
 * waits there. The budgets below are that cost made visible: a change that
 * makes a page wait on one more read fails here and has to say why.
 *
 * The site is served by the real `createApp()` with a D1 binding, and seeded
 * with what makes a page do its full work: threads with replies past the
 * preview fold, collections, media, custom URLs, and navigation.
 */

import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../app.js";
import type { Database } from "../db/index.js";
import { createServices, type Services } from "../services/index.js";
import type { Bindings } from "../types.js";
import {
  createRoundTripD1,
  formatRoundTripTrace,
} from "./helpers/d1-round-trips.js";
import { createTestDatabase, DEFAULT_TEST_SITE_ID } from "./helpers/db.js";

const ORIGIN = "https://blog.example";

const executionCtx = {
  waitUntil() {},
  passThroughOnException() {},
  props: {},
} as unknown as Parameters<ReturnType<typeof createApp>["fetch"]>[2];

async function seedSite(services: Services) {
  await services.settings.completeOnboarding();

  const reading = await services.collections.create({
    slug: "reading",
    title: "Reading",
  });
  const tools = await services.collections.create({
    slug: "tools",
    title: "Tools",
  });
  await services.navItems.create({
    type: "collection",
    collectionId: reading.id,
  });
  await services.navItems.create({
    type: "link",
    label: "Elsewhere",
    url: "https://example.net",
  });

  const start = 1_760_000_000;
  let root = null;
  for (let index = 0; index < 30; index++) {
    const post = await services.posts.create({
      format: index % 3 === 0 ? "link" : "note",
      language: "en",
      title: `Post ${index}`,
      url: index % 3 === 0 ? `https://example.com/${index}` : undefined,
      bodyMarkdown: `Body of post ${index}.`,
      status: "published",
      publishedAt: start + index * 3600,
      collectionIds:
        index % 2 === 0 ? [reading.id] : index % 5 === 0 ? [tools.id] : [],
    });
    if (index % 4 === 0) {
      await services.media.create({
        postId: post.id,
        filename: `photo-${index}.jpg`,
        originalName: `photo-${index}.jpg`,
        mimeType: "image/jpeg",
        size: 1024,
        storageKey: `media/${DEFAULT_TEST_SITE_ID}/photo-${index}.jpg`,
        width: 800,
        height: 600,
      });
    }
    root = post;
  }

  // The newest post leads a thread long enough to fold, so the home page
  // renders leading and trailing replies with a gap between them.
  if (!root) throw new Error("no posts seeded");
  let parent = root;
  for (let index = 0; index < 8; index++) {
    parent = await services.posts.create({
      format: "note",
      bodyMarkdown: `Reply ${index}.`,
      status: "published",
      replyToId: parent.id,
      publishedAt: start + 40 * 3600 + index * 60,
    });
    if (index === 6) {
      await services.media.create({
        postId: parent.id,
        filename: "reply.jpg",
        originalName: "reply.jpg",
        mimeType: "image/jpeg",
        size: 1024,
        storageKey: `media/${DEFAULT_TEST_SITE_ID}/reply.jpg`,
        width: 800,
        height: 600,
      });
    }
  }
  await services.customUrls.create({
    path: "thread-start",
    targetType: "post",
    targetId: root.id,
  });

  // Translated, so the post page also builds its language alternates.
  const translation = await services.posts.create({
    format: "note",
    language: "ja",
    title: "翻訳",
    bodyMarkdown: "本文。",
    status: "published",
    publishedAt: start - 3600,
  });
  await services.posts.linkTranslation(root.id, translation.id);
}

async function createSite() {
  const { db, sqlite } = createTestDatabase();
  const services = createServices(
    db as unknown as Database,
    { query: async () => [] } as unknown as Parameters<
      typeof createServices
    >[1],
    DEFAULT_TEST_SITE_ID,
    { slugIdLength: 5 },
  );
  await seedSite(services);

  const d1 = createRoundTripD1(sqlite);
  const app = createApp();
  const env = {
    DB: d1.binding,
    SITE_ORIGIN: ORIGIN,
    AUTH_SECRET: "x".repeat(40),
  } as unknown as Bindings;

  async function request(path: string) {
    return d1.measure(async () => {
      const res = await app.fetch(
        new Request(`${ORIGIN}${path}`, { redirect: "manual" }),
        env,
        executionCtx,
      );
      await res.arrayBuffer();
      return res;
    });
  }

  // The first request in an isolate learns that setup is finished and keeps
  // that answer; every later reader's request is the one worth budgeting.
  await request("/");

  return { request };
}

describe("public page round trips", () => {
  let site: Awaited<ReturnType<typeof createSite>>;

  beforeAll(async () => {
    site = await createSite();
  });

  // [page, path, expected status, budget]. Every page starts with two rounds:
  // the site, then its settings alongside the requested address. Lower a
  // budget when a page gets cheaper, so the saving cannot quietly come undone.
  const cases: Array<[string, string, number, number]> = [
    // + the page of thread roots, its media, collections and reply previews,
    // and the previews' own media.
    ["home", "/", 200, 5],
    // Nothing on the second page has replies to preview.
    ["home, page 2", "/?page=2", 200, 4],
    // + the post, its thread and translations, their media and addresses.
    ["post page", "/thread-start", 200, 5],
    ["archive", "/archive", 200, 5],
    ["archive, grid", "/archive?layout=grid", 200, 4],
    ["collections directory", "/collections", 200, 4],
    // + the collection, the page of thread ids, the threads, their media.
    ["collection page", "/reading", 200, 6],
    ["not found", "/no-such-page", 404, 2],
  ];

  for (const [name, path, status, budget] of cases) {
    it(`${name} waits on at most ${budget} D1 round trips`, async () => {
      const trace = await site.request(path);
      expect(trace.result.status).toBe(status);
      expect(
        trace.waves.length,
        `${name} took ${trace.waves.length} round trips:\n${formatRoundTripTrace(trace)}`,
      ).toBeLessThanOrEqual(budget);
    });
  }
});
