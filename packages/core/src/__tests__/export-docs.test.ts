/**
 * The export's file reference lists every field `site export` writes.
 *
 * docs/export-and-import.md promises that the fields it lists change only in
 * a major release, and marks the rest "theme only". Before this test, the page
 * named a handful of fields in prose; everything else — `title`, `format`,
 * `media`, the keys of `data/jant.toml` — was outside the contract by
 * omission. This builds a site with every kind of content, exports it, and
 * requires each front-matter field and data key to appear in the reference;
 * each field the tables name must still exist in the exporter.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { createTestApp } from "./helpers/app.js";
import { makeSiteConfig } from "./helpers/export-fixtures.js";
import { createExportService, isStoredExportFile } from "../services/export.js";
import { parseFrontMatter } from "../lib/hugo-markdown.js";
import type { StorageDriver } from "../lib/storage.js";

const CORE_DIR = resolve(import.meta.dirname, "../..");

/** The "File reference" section of one language's export page. */
function readReference(docPath: string, heading: string): string {
  const doc = readFileSync(resolve(CORE_DIR, "../..", docPath), "utf8");
  const start = doc.indexOf(`${heading}\n`);
  const end = doc.indexOf("\n### ", start + 1);
  return doc.slice(start, end);
}

/** Every backticked field name in a reference's table rows, prose left out. */
function tableNames(reference: string): Set<string> {
  return new Set(
    reference
      .split("\n")
      .filter((line) => line.startsWith("| `"))
      .flatMap((line) =>
        [...line.matchAll(/`([a-z][a-z_]*)`/g)].map((match) => match[1]!),
      ),
  );
}

const REFERENCE = readReference(
  "docs/export-and-import.md",
  "### File reference",
);
const REFERENCE_ZH = readReference(
  "docs/zh-Hans/export-and-import.md",
  "### 文件字段一览",
);

/** Every field the tables name, in either column: the documented fields. */
const documented = tableNames(REFERENCE);

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

/** A site with every kind of content an export writes something for. */
async function exportRichSite() {
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

  return createExportService(
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
}

/** Every key in a parsed value, nested objects and arrays of objects included. */
function keysOf(value: unknown, into: Set<string>): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) keysOf(item, into);
  } else if (value && typeof value === "object") {
    for (const [key, nested] of Object.entries(value)) {
      into.add(key);
      // A smart collection's conditions are the filter vocabulary, which
      // the archive documents; the reference names only `selection`.
      if (key !== "selection") keysOf(nested, into);
    }
  }
  return into;
}

/** Every front-matter field and data key a rich site's export writes. */
async function writtenKeys(): Promise<Set<string>> {
  const written = new Set<string>();
  for (const file of await exportRichSite()) {
    if (isStoredExportFile(file)) continue;
    const content =
      typeof file.content === "string"
        ? file.content
        : new TextDecoder().decode(file.content);
    if (file.path.startsWith("content/") && file.path.endsWith(".md")) {
      keysOf((await parseFrontMatter(content)).frontMatter, written);
    } else if (file.path === "data/jant.toml") {
      const { parse } = await import("smol-toml");
      keysOf(parse(content), written);
    }
  }
  return written;
}

/**
 * Documented names the rich site doesn't produce. Each is written only under
 * a condition the fixture doesn't meet, or names a value rather than a key.
 */
const NOT_IN_FIXTURE = new Set([
  // Values named in a field's notes, not keys.
  "post",
  "note",
  "link",
  "quote",
  "published",
  "draft",
  "public",
  "latest_hidden",
  "private",
  "image",
  "video",
  "audio",
  "text",
  "document",
  "collection",
  "smart_collection",
  "newest",
  "oldest",
  "rating_desc",
  "list",
  "grid",
  "render",
  "true",
  "static",
  // Written only for a custom URL of the retired archive kind, which can
  // no longer be created.
  "archive_query",
]);

describe("export file reference", () => {
  it("lists every field and data key the export writes", async () => {
    const written = await writtenKeys();

    expect(written.size).toBeGreaterThan(60);
    expect([...written].filter((key) => !documented.has(key)).sort()).toEqual(
      [],
    );
  });

  it("lists only fields the export still writes", async () => {
    const written = await writtenKeys();

    expect(
      [...documented]
        .filter((name) => !written.has(name) && !NOT_IN_FIXTURE.has(name))
        .sort(),
    ).toEqual([]);
  });

  it("names the same fields in the Chinese reference", () => {
    expect([...tableNames(REFERENCE_ZH)].sort()).toEqual(
      [...documented].sort(),
    );
  });
});
