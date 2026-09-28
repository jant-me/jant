/**
 * A reply has one address in every feed.
 *
 * The latest and featured feeds named a reply by its custom URL while the
 * archive, collection, and smart collection feeds named it by its slug, so a
 * reader following two of them saw the same reply as two posts. Every feed
 * now builds its entries through one function; this walks the feeds of one
 * site and compares.
 */

import { describe, expect, it } from "vitest";
import { createApp } from "../app.js";
import type { Database } from "../db/index.js";
import { createServices } from "../services/index.js";
import type { Bindings } from "../types.js";
import { createTestDatabase, DEFAULT_TEST_SITE_ID } from "./helpers/db.js";

const executionCtx = {
  waitUntil() {},
  passThroughOnException() {},
  props: {},
} as unknown as Parameters<ReturnType<typeof createApp>["fetch"]>[2];

describe("reply addresses across feeds", () => {
  it("names a reply by its custom URL in every feed", async () => {
    const { db, sqlite } = createTestDatabase();
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
    const collection = await services.collections.create({
      slug: "walks",
      title: "Walks",
    });
    await services.smartCollections.create({
      slug: "notes",
      title: "Notes",
      selection: { format: "note" },
    });
    const root = await services.posts.create({
      format: "note",
      title: "A long walk",
      bodyMarkdown: "Out past the river.",
      collectionIds: [collection.id],
      featuredAt: 1_700_000_000,
    });
    const reply = await services.posts.create({
      format: "note",
      bodyMarkdown: "And back again.",
      replyToId: root.id,
    });
    await services.customUrls.create({
      path: "walks/back-again",
      targetType: "post",
      targetId: reply.id,
    });

    const app = createApp();
    const feed = async (path: string) => {
      const res = await app.fetch(
        new Request(`https://blog.example${path}`),
        {
          SITE_ORIGIN: "https://blog.example",
          AUTH_SECRET: "x".repeat(40),
          NODE_SQLITE: sqlite,
        } as unknown as Bindings,
        executionCtx,
      );
      expect(res.status, path).toBe(200);
      return res.text();
    };

    const replyRows = new Map<string, string[]>();
    for (const path of [
      "/latest/feed",
      "/featured/feed",
      "/archive/feed",
      "/walks/feed",
      "/notes/feed",
    ]) {
      const xml = await feed(path);
      replyRows.set(
        path,
        [...xml.matchAll(/<jant:post href="([^"]+)"/g)]
          .map((match) => match[1] ?? "")
          .filter((href) => href !== "https://blog.example/" + root.slug),
      );
    }

    for (const [path, hrefs] of replyRows) {
      expect(hrefs, path).toEqual(["https://blog.example/walks/back-again"]);
    }
  });
});
