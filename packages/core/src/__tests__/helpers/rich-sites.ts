/**
 * Sites with every kind of content a feed or an export writes something for.
 *
 * `feed-docs.test.ts` and `export-docs.test.ts` hold the docs to what these
 * produce, and `public-surface.ts` records the same names in the public
 * surface manifest, so both read one fixture. Kept outside the
 * `__tests__/*.test.ts` glob so importing them doesn't re-run another file's
 * tests.
 */

import { eq } from "drizzle-orm";
import { createApp } from "../../app.js";
import type { Database } from "../../db/index.js";
import { posts } from "../../db/schema.js";
import type { StorageDriver } from "../../lib/storage.js";
import {
  createExportService,
  isStoredExportFile,
  type ExportContentFile,
} from "../../services/export.js";
import { createServices } from "../../services/index.js";
import type { Bindings, CreatePost } from "../../types.js";
import { createTestApp } from "./app.js";
import { createTestDatabase, DEFAULT_TEST_SITE_ID } from "./db.js";
import { makeSiteConfig } from "./export-fixtures.js";

/** The origin the rich feed site answers on. */
export const RICH_FEED_SITE_ORIGIN = "https://blog.example";

const executionCtx = {
  waitUntil() {},
  passThroughOnException() {},
  props: {},
} as unknown as Parameters<ReturnType<typeof createApp>["fetch"]>[2];

/** Storage that accepts writes; the feed only needs the keys. */
const feedStorage = {
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
 *
 * @returns A `request(path)` that fetches a path from the site through
 *   `createApp()`
 * @example
 * ```ts
 * const { request } = await createRichFeedSite();
 * const xml = await (await request("/latest/feed")).text();
 * ```
 */
export async function createRichFeedSite() {
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
      storage: feedStorage,
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
      new Request(`${RICH_FEED_SITE_ORIGIN}${path}`),
      {
        SITE_ORIGIN: RICH_FEED_SITE_ORIGIN,
        AUTH_SECRET: "x".repeat(40),
        NODE_SQLITE: sqlite,
      } as unknown as Bindings,
      executionCtx,
    );

  return { request };
}

function memoryStorage(): StorageDriver {
  const files = new Map<string, Uint8Array>();
  return {
    async put(key: string, body: Uint8Array | ReadableStream) {
      files.set(
        key,
        body instanceof Uint8Array
          ? body
          : new Uint8Array(await new Response(body).arrayBuffer()),
      );
    },
    async get(key: string) {
      const bytes = files.get(key);
      return bytes
        ? {
            body: new Response(bytes).body as ReadableStream,
            size: bytes.length,
          }
        : null;
    },
    async delete(key: string) {
      files.delete(key);
    },
  } as unknown as StorageDriver;
}

/**
 * The files `site export` writes for a site with every kind of content an
 * export writes something for: each format, a draft, a translation, a quiet
 * reply, every attachment kind, a collection and a smart collection, custom
 * URLs and a redirect, every kind of navigation item, and directory items.
 * Stored files (media bytes) are left out.
 *
 * @returns The generated export files whose content the exporter wrote
 * @example
 * ```ts
 * const files = await exportRichSite();
 * const data = files.find((file) => file.path === "data/jant.toml");
 * ```
 */
export async function exportRichSite(): Promise<ExportContentFile[]> {
  const storage = memoryStorage();
  const { services } = createTestApp({ storage });
  const deps = {
    media: services.media,
    storage,
    storageDriver: "local" as const,
    maxFileSizeMB: 10,
  };
  const ideas = await services.collections.create({
    slug: "ideas",
    title: "Ideas",
    description: "Thinking",
    sortOrder: "oldest",
  });
  const shelf = await services.smartCollections.create({
    slug: "quote-shelf",
    title: "Quotes",
    description: "Kept",
    selection: { format: "quote", collection: [ideas.id] },
    sort: "rating_desc",
    layout: "grid",
  });
  const root = await services.posts.createWithAttachments(
    {
      format: "note",
      title: "Root",
      bodyMarkdown: `${"A long paragraph of words. ".repeat(80)}\n\nMore.`,
      featured: true,
      pinned: true,
      collectionIds: [ideas.id],
      language: "en",
      createdAt: 1_700_000_000,
      updatedAt: 1_700_100_000,
      publishedAt: 1_700_050_000,
    },
    [{ type: "text", contentFormat: "markdown", content: "# Notes" }],
    deps,
  );
  const reply = await services.posts.create({
    format: "quote",
    quoteText: "Words",
    title: "Someone",
    url: "https://example.org/q",
    rating: 4,
    featured: true,
    replyToId: root.id,
    quietReply: true,
  });
  await storage.put("media/site/img.webp", new Uint8Array([1, 2, 3]));
  await services.media.create({
    filename: "img.webp",
    originalName: "img.webp",
    mimeType: "image/webp",
    size: 3,
    storageKey: "media/site/img.webp",
    postId: reply.id,
    width: 10,
    height: 10,
    alt: "Alt",
    blurhash: "LEHV6nWB2yk8pyo0adR*.7kCMdnj",
  });
  await storage.put("media/site/v.mp4", new Uint8Array([1]));
  await storage.put("media/site/v-poster.jpg", new Uint8Array([1]));
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
  await storage.put("media/site/a.m4a", new Uint8Array([1]));
  await services.media.create({
    filename: "a.m4a",
    originalName: "a.m4a",
    mimeType: "audio/mp4",
    size: 1,
    storageKey: "media/site/a.m4a",
    postId: root.id,
    durationSeconds: 3,
    waveform: "[0,0.5,1]",
  });
  await services.posts.create({
    format: "link",
    title: "A link",
    url: "https://example.org",
    bodyMarkdown: "Why",
  });
  await services.posts.create({
    format: "note",
    bodyMarkdown: "中文",
    language: "zh-Hans",
    translationOfId: root.id,
  });
  await services.posts.create({
    format: "note",
    bodyMarkdown: "Draft",
    status: "draft",
  });
  const page = await services.posts.create({
    format: "note",
    title: "About",
    bodyMarkdown: "About me",
  });
  await services.customUrls.create({
    path: "old-root",
    targetType: "post",
    targetId: root.id,
  });
  await services.customUrls.create({
    path: "thinking",
    targetType: "collection",
    targetId: ideas.id,
  });
  await services.customUrls.create({
    path: "gone",
    targetType: "redirect",
    toPath: "/root",
    redirectType: 301,
  });
  await services.navItems.create({
    type: "link",
    label: "Elsewhere",
    url: "https://example.net",
  });
  await services.navItems.create({
    type: "collection",
    collectionId: ideas.id,
  });
  await services.navItems.create({ type: "page", postId: page.id });
  await services.navItems.create({
    type: "smart_collection",
    smartCollectionId: shelf.id,
  });
  await services.collections.createDirectoryItem({
    type: "divider",
    label: "More",
  });
  await services.collections.createDirectoryItem({
    type: "link",
    label: "Friends",
    url: "https://example.com/friends",
    description: "People",
  });

  const files = await createExportService(
    services as never,
    makeSiteConfig({
      navItems: await services.navItems.list(),
      multilingualEnabled: true,
      additionalLanguages: ["zh-Hans"],
      siteFooter: "Made by **me**",
      siteAvatarUrl: "https://example.com/avatar.png",
      faviconVersion: "202609280000",
    }),
    { storage },
  ).generateHugoFiles();
  return files.filter(
    (file): file is ExportContentFile => !isStoredExportFile(file),
  );
}
