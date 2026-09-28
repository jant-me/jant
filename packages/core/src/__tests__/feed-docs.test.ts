/**
 * The feed docs describe the feeds a site actually serves.
 *
 * `docs/feed-reading.md` is the public contract for the `https://jant.me/ns`
 * elements and attributes; `docs/feeds.md` covers `jant:discover` and every
 * feed address. Scanning the renderer's source for `jant:` found element names
 * but not the attributes on them, and nothing checked that an address in the
 * docs resolved at all. These render a site with every kind of content a feed
 * writes something for, and request every address the docs name.
 */

import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createApp } from "../app.js";
import type { Database } from "../db/index.js";
import { posts } from "../db/schema.js";
import type { StorageDriver } from "../lib/storage.js";
import { createServices } from "../services/index.js";
import type { Bindings, CreatePost } from "../types.js";
import { createTestDatabase, DEFAULT_TEST_SITE_ID } from "./helpers/db.js";

const REPO_ROOT = resolve(import.meta.dirname, "../../../..");
const ORIGIN = "https://blog.example";

const executionCtx = {
  waitUntil() {},
  passThroughOnException() {},
  props: {},
} as unknown as Parameters<ReturnType<typeof createApp>["fetch"]>[2];

function readDoc(path: string): string {
  return readFileSync(join(REPO_ROOT, path), "utf8");
}

/** Storage that accepts writes; the feed only needs the keys. */
const storage = {
  async put() {},
  async get() {
    return null;
  },
  async delete() {},
} as unknown as StorageDriver;

/**
 * A multilingual site with Discover on, collections, and a thread long enough
 * to fold, whose posts carry every attachment kind, a Link preview image, and
 * a summary cut short.
 */
async function createRichSite() {
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
  await services.settings.set("DISCOVER", "latest");
  await services.settings.set("MULTILINGUAL_ENABLED", "true");
  await services.settings.set("ADDITIONAL_LANGUAGES", "ja");

  const reading = await services.collections.create({
    slug: "reading",
    title: "Reading",
  });
  await services.collections.create({ slug: "cooking", title: "Cooking" });

  const root = await services.posts.createWithAttachments(
    {
      format: "note",
      title: "Root",
      bodyMarkdown: `${"A long paragraph of words. ".repeat(80)}\n\nMore.`,
      collectionIds: [reading.id],
      featuredAt: 1_700_000_000,
      language: "en",
    },
    [{ type: "text", contentFormat: "markdown", content: "# Notes" }],
    {
      media: services.media,
      storage,
      storageDriver: "local",
      maxFileSizeMB: 10,
    },
  );
  await services.media.create({
    filename: "v.mp4",
    originalName: "v.mp4",
    mimeType: "video/mp4",
    size: 1,
    storageKey: "media/site/v.mp4",
    postId: root.id,
    durationSeconds: 12,
    posterKey: "media/site/v-poster.jpg",
    width: 16,
    height: 9,
  });

  // A thread is a chain: each reply answers the one before it.
  let tail = root;
  const reply = async (data: Omit<CreatePost, "replyToId">) => {
    tail = await services.posts.create({
      ...data,
      language: "en",
      replyToId: tail.id,
    });
    return tail;
  };

  const link = await reply({
    format: "link",
    title: "A link",
    url: "https://example.org",
    bodyMarkdown: "Why",
  });
  await db
    .update(posts)
    .set({ previewImageKey: "media/site/preview.jpg" })
    .where(eq(posts.id, link.id));

  const photo = await reply({ format: "note" });
  await services.media.create({
    filename: "img.webp",
    originalName: "img.webp",
    mimeType: "image/webp",
    size: 3,
    storageKey: "media/site/img.webp",
    postId: photo.id,
    width: 10,
    height: 10,
    alt: "Alt",
  });

  await reply({ format: "quote", quoteText: "Words", title: "Someone" });
  await reply({ format: "note", bodyMarkdown: "Four." });
  await reply({ format: "note", bodyMarkdown: "Five." });
  await reply({
    format: "note",
    title: "Last",
    bodyMarkdown: "The newest reply, cut short. ".repeat(80),
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

  return { request };
}

/**
 * Every name a feed writes in the jant namespace, and every attribute on an
 * element in the jant or Media RSS namespace.
 */
function collectFeedNames(xml: string) {
  const elements = new Map<string, Set<string>>();
  for (const [, name = "", attrs = ""] of xml.matchAll(
    /<((?:jant|media):[a-z]+)((?:\s+[a-zA-Z:]+="[^"]*")*)\s*\/?>/g,
  )) {
    const seen = elements.get(name) ?? new Set<string>();
    for (const [, attr = ""] of attrs.matchAll(/([a-zA-Z:]+)="/g)) {
      seen.add(attr);
    }
    elements.set(name, seen);
  }
  const jantAttributes = new Set(
    [...xml.matchAll(/\s(jant:[a-z]+)="/g)].map((match) => match[1] ?? ""),
  );
  return { elements, jantAttributes };
}

/** Backticked site paths a doc names, placeholders left out. */
function documentedPaths(doc: string): string[] {
  return [
    ...new Set(
      [...doc.matchAll(/`(\/[^`\s]*)`/g)]
        .map((match) => match[1] ?? "")
        .filter((path) => !path.includes("{")),
    ),
  ];
}

describe("feed docs", () => {
  it("document every element and attribute a served feed writes", async () => {
    const { request } = await createRichSite();
    const res = await request("/latest/feed");
    expect(res.status).toBe(200);
    const xml = await res.text();
    const { elements, jantAttributes } = collectFeedNames(xml);

    // The fixture has to reach what it claims to, or the rest passes empty.
    expect([...elements.keys()]).toEqual(
      expect.arrayContaining([
        "jant:discover",
        "jant:id",
        "jant:format",
        "jant:thread",
        "jant:post",
        "jant:truncated",
        "media:content",
        "media:thumbnail",
      ]),
    );
    expect(elements.get("jant:thread")).toEqual(
      new Set(["posts", "hidden", "gap", "latest"]),
    );
    expect([...(elements.get("jant:post") ?? [])]).toEqual(
      expect.arrayContaining(["url", "thumbnail", "folded", "truncated"]),
    );
    expect([...jantAttributes].sort()).toEqual(["jant:page", "jant:post"]);

    const docs = [
      readDoc("docs/feed-reading.md"),
      readDoc("docs/feeds.md"),
    ].join("\n");
    const missing: string[] = [];
    for (const [name, attrs] of elements) {
      if (name.startsWith("jant:") && !docs.includes(name)) missing.push(name);
      for (const attr of attrs) {
        if (!docs.includes(`\`${attr}\``) && !docs.includes(`@${attr}`)) {
          missing.push(`${name}/@${attr}`);
        }
      }
    }
    for (const attr of jantAttributes) {
      if (!docs.includes(attr)) missing.push(`@${attr}`);
    }
    expect(missing).toEqual([]);
  });

  it("carry every jant: name from the feed guide into its translation", () => {
    const names = (doc: string) =>
      new Set([...doc.matchAll(/jant:[a-z]+/g)].map((match) => match[0]));
    const english = names(readDoc("docs/feeds.md"));
    const chinese = names(readDoc("docs/zh-Hans/feeds.md"));

    expect(english.size).toBeGreaterThan(0);
    expect([...english].filter((name) => !chinese.has(name))).toEqual([]);
  });

  it("resolve every address the feed guide names", async () => {
    const { request } = await createRichSite();
    const english = readDoc("docs/feeds.md");
    const paths = new Set([
      ...documentedPaths(english),
      ...documentedPaths(readDoc("docs/zh-Hans/feeds.md")),
    ]);
    expect(paths).toContain("/ja/reading/feed");
    expect(paths).toContain("/collections/reading+cooking/feed");

    const broken: string[] = [];
    for (const path of paths) {
      let res = await request(path);
      for (
        let hops = 0;
        hops < 3 && res.status >= 300 && res.status < 400;
        hops++
      ) {
        const next = new URL(res.headers.get("location") ?? "", ORIGIN);
        res = await request(next.pathname + next.search);
      }
      const isFeed = /\/feed(\?|$)/.test(path);
      const type = res.headers.get("content-type") ?? "";
      if (res.status !== 200 || (isFeed && !type.includes("atom+xml"))) {
        broken.push(`${path} → ${res.status} ${type}`);
      }
    }
    expect(broken).toEqual([]);
  });

  it("redirect every older address to the one the guide names", async () => {
    const { request } = await createRichSite();
    const rows = [
      ...readDoc("docs/feeds.md").matchAll(
        /^\| `(\/[^`]+)` +\| `(\/[^`]+)` +\|$/gm,
      ),
    ];
    expect(rows.length).toBeGreaterThan(5);

    const wrong: string[] = [];
    for (const [, from = "", to = ""] of rows) {
      const res = await request(from);
      const location = res.headers.get("location");
      const target = location ? new URL(location, ORIGIN).pathname : null;
      if (![301, 308].includes(res.status) || target !== to) {
        wrong.push(`${from} → ${res.status} ${target ?? ""}`);
      }
    }
    expect(wrong).toEqual([]);
  });
});
