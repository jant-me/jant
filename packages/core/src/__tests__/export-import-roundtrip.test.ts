/**
 * Round-trip test for the Hugo export + import pipeline.
 *
 * Builds a small fixture (multi-post thread with reply, featured + pinned,
 * collection membership with explicit position, media on both root and
 * reply), runs the export service, walks the emitted tree with the import
 * CLI's `walkHugoContent` helper, and asserts that every front-matter value
 * survives intact. Then re-exports on the same fixture and verifies the
 * generated files are stable byte-for-byte, proving our formatter's key
 * order is deterministic and round-trip safe.
 */

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createExportService, type ExportFile } from "../services/export.js";
import { parseFrontMatter } from "../lib/hugo-markdown.js";
import { __test__ as importTestHelpers } from "../../bin/commands/import-site.js";
import type { Collection, Media, Post } from "../types.js";
import {
  makeCollection,
  makeMedia,
  makePost,
  makeSiteConfig,
} from "./helpers/export-fixtures.js";

type ServicesArg = Parameters<typeof createExportService>[0];

function buildRoundtripServices(opts: {
  posts: Post[];
  collections: Collection[];
  mediaByPost: Map<string, Media[]>;
  collectionEntriesByThread: Map<
    string,
    {
      collectionId: string;
      createdAt: number;
      position: number;
      pinnedAt: number | null;
    }[]
  >;
  aliasMap?: Map<string, string[]>;
}): ServicesArg {
  const slugMap = new Map(opts.posts.map((p) => [p.id, p.slug]));
  const collectionSlugMap = new Map(
    opts.collections.map((c) => [c.id, c.slug]),
  );

  return {
    posts: {
      list: async () => opts.posts,
    },
    paths: {
      getPostSlugMap: async () => slugMap,
      getPostAliases: async () => opts.aliasMap ?? new Map(),
      getCollectionSlugMap: async () => collectionSlugMap,
    },
    collections: {
      list: async () => opts.collections,
      listDirectoryData: async () => ({
        collections: [],
        items: opts.collections.map((collection) => ({
          id: `dir-${collection.id}`,
          type: "collection" as const,
          collection: {
            ...collection,
            threadCount: 0,
            recentActivityAt: collection.updatedAt,
          },
        })),
        directoryItems: [],
      }),
      getCollectionsByPostIds: async () => new Map(),
      getCollectionEntriesByThreadIds: async () =>
        opts.collectionEntriesByThread,
    },
    media: {
      getByPostIds: async () => opts.mediaByPost,
    },
  } as unknown as ServicesArg;
}

async function writeExportToDir(
  files: ExportFile[],
  rootDir: string,
): Promise<void> {
  for (const file of files) {
    const target = join(rootDir, file.path);
    await mkdir(dirname(target), { recursive: true });
    const data =
      typeof file.content === "string"
        ? new TextEncoder().encode(file.content)
        : file.content;
    await writeFile(target, data);
  }
}

describe("export → import round-trip", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "jant-roundtrip-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("preserves every front-matter value on a thread with media, collection membership, and pinned/featured flags", async () => {
    const collection = makeCollection({
      id: "col-1",
      slug: "ideas",
      title: "Ideas",
    });
    const root = makePost({
      id: "post-root",
      slug: "walk-notes",
      title: "Walk notes",
      featuredAt: 1773100000,
      pinnedAt: 1773200000,
      threadId: "post-root",
    });
    const reply = makePost({
      id: "post-reply",
      slug: "walk-notes-reply",
      title: "Follow-up",
      replyToId: "post-root",
      threadId: "post-root",
      createdAt: 1773020000,
      publishedAt: 1773020000,
    });
    const rootMedia = makeMedia({
      id: "med-root",
      filename: "hero.webp",
      alt: "Hero image",
      width: 1600,
      height: 900,
      blurhash: "LEHV6nWB2yk8pyo0adR*.7kCMdnj",
    });
    const replyMedia = makeMedia({
      id: "med-reply",
      filename: "detail.webp",
      alt: "Detail",
      width: 400,
      height: 400,
      blurhash: "LXXXXXXXXXXXXXXXXXXXXXXXXXXX",
    });
    const entries = new Map<
      string,
      {
        collectionId: string;
        createdAt: number;
        position: number;
        pinnedAt: number | null;
      }[]
    >();
    entries.set("post-root", [
      {
        collectionId: "col-1",
        createdAt: 1773000000,
        position: 2,
        pinnedAt: 1773050000,
      },
    ]);

    const services = buildRoundtripServices({
      posts: [root, reply],
      collections: [collection],
      mediaByPost: new Map([
        ["post-root", [rootMedia]],
        ["post-reply", [replyMedia]],
      ]),
      collectionEntriesByThread: entries,
      aliasMap: new Map([["post-root", ["/historic-slug/"]]]),
    });
    const exportService = createExportService(services, makeSiteConfig());
    const files = await exportService.generateHugoFiles();
    await writeExportToDir(files, tempDir);

    // Fabricate the media files under static/ so the import walker's disk
    // lookups (mediaSpecFromJantMedia) find real bytes.
    await mkdir(join(tempDir, "static", "media"), { recursive: true });
    await writeFile(join(tempDir, "static/media/med-root.webp"), "root");
    await writeFile(join(tempDir, "static/media/med-reply.webp"), "reply");

    // Walk with the import helper.
    const walked = await importTestHelpers.walkHugoContent(tempDir);
    expect(walked.rootBundles).toHaveLength(1);
    const [rootBundle] = walked.rootBundles;
    expect(rootBundle.slug).toBe("walk-notes");
    expect(rootBundle.children).toHaveLength(1);
    expect(rootBundle.children[0].slug).toBe("walk-notes-reply");

    // Front-matter fidelity on the root.
    const rootFm = rootBundle.frontMatter;
    expect(rootFm.featured_at).toBe(new Date(1773100000 * 1000).toISOString());
    expect(rootFm.pinned_at).toBe(new Date(1773200000 * 1000).toISOString());
    expect(rootFm.root_aliases).toEqual(["/historic-slug/"]);
    expect(rootFm.aliases).toEqual(
      expect.arrayContaining(["/historic-slug/", "/walk-notes-reply/"]),
    );
    expect(Array.isArray(rootFm.collections)).toBe(true);
    const collectionEntry = rootFm.collections?.[0];
    expect(collectionEntry).toMatchObject({
      slug: "ideas",
      position: 2,
      collected_at: new Date(1773000000 * 1000).toISOString(),
      pinned_at: new Date(1773050000 * 1000).toISOString(),
    });

    // Flat media: entries with full metadata.
    const rootMediaEntry = rootFm.media?.[0];
    expect(rootMediaEntry?.id).toBe("med-root");
    expect(rootMediaEntry?.src).toBe("/media/med-root.webp");
    expect(rootMediaEntry?.alt).toBe("Hero image");
    expect(rootMediaEntry?.width).toBe(1600);
    expect(rootMediaEntry?.height).toBe(900);
    expect(rootMediaEntry?.blurhash).toBe("LEHV6nWB2yk8pyo0adR*.7kCMdnj");

    // Reply bundle carries build.render: never and its own media entries.
    const replyFm = rootBundle.children[0].frontMatter;
    expect(replyFm.build).toEqual({ render: "never", list: "local" });
    expect(replyFm.collections).toBeUndefined();
    expect(replyFm.media?.[0].src).toBe("/media/med-reply.webp");
    expect(replyFm.media?.[0].alt).toBe("Detail");

    // The import CLI's memberships resolver maps the slug back to the id.
    const slugToId = new Map([["ideas", "col-1"]]);
    const { entries: resolved } =
      importTestHelpers.resolveCollectionMemberships(rootFm, slugToId);
    expect(resolved).toEqual([
      {
        collectionId: "col-1",
        createdAt: 1773000000,
        position: 2,
        pinnedAt: 1773050000,
      },
    ]);

    // Second export pass: identical bytes for every content file (proves
    // stable key ordering in `formatFrontMatter`).
    const filesSecond = await exportService.generateHugoFiles();
    const firstByPath = new Map(files.map((f) => [f.path, f.content]));
    const secondByPath = new Map(filesSecond.map((f) => [f.path, f.content]));
    for (const path of [
      "content/walk-notes/_index.md",
      "content/walk-notes/walk-notes-reply/index.md",
    ]) {
      const a = firstByPath.get(path);
      const b = secondByPath.get(path);
      expect(typeof a).toBe("string");
      expect(typeof b).toBe("string");
      expect(a).toBe(b);
    }

    // parseFrontMatter on both passes yields structurally equal front
    // matter — belt-and-braces guard against any future TOML→YAML drift.
    const { frontMatter: firstFm } = await parseFrontMatter(
      firstByPath.get("content/walk-notes/_index.md") as string,
    );
    const { frontMatter: secondFm } = await parseFrontMatter(
      secondByPath.get("content/walk-notes/_index.md") as string,
    );
    expect(firstFm).toEqual(secondFm);
  });
});
