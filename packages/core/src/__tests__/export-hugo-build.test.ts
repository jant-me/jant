/**
 * Spawns the real Hugo binary against a freshly generated export tree to
 * prove the bundled theme actually builds a coherent site. The test skips
 * gracefully when `hugo` is not on PATH so local dev without Hugo installed
 * still keeps the suite green; CI installs the pinned version via mise.
 */

import { spawn, spawnSync } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createExportService } from "../services/export.js";
import {
  makeCollection,
  makeMedia,
  makePost,
  makeSiteConfig,
} from "./helpers/export-fixtures.js";

type ServicesArg = Parameters<typeof createExportService>[0];

function hugoAvailable(): boolean {
  const result = spawnSync("hugo", ["version"], {
    stdio: "ignore",
    shell: false,
  });
  return result.status === 0;
}

function runHugo(
  sourceDir: string,
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(
      "hugo",
      ["--source", sourceDir, "--minify", "--destination", "public"],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (buf) => {
      stdout += buf.toString();
    });
    child.stderr?.on("data", (buf) => {
      stderr += buf.toString();
    });
    child.on("close", (code) => {
      resolve({ code: code ?? -1, stdout, stderr });
    });
  });
}

async function fileExists(path: string): Promise<boolean> {
  const s = await stat(path).catch(() => null);
  return s?.isFile() ?? false;
}

function buildFixtureServices(): ServicesArg {
  const root = makePost({
    id: "pst_root",
    slug: "hello-world",
    title: "Hello World",
    threadId: "pst_root",
  });
  const reply = makePost({
    id: "pst_reply",
    slug: "hello-reply",
    title: "Follow-up",
    replyToId: "pst_root",
    threadId: "pst_root",
    createdAt: 1773020000,
    publishedAt: 1773020000,
    featuredAt: 1773030000,
  });
  const collection = makeCollection({ id: "col-1", slug: "ideas" });
  const media = makeMedia({ id: "med_hero", filename: "hero.webp" });
  return {
    posts: { list: async () => [root, reply] },
    paths: {
      getPostSlugMap: async () =>
        new Map([
          ["pst_root", "hello-world"],
          ["pst_reply", "hello-reply"],
        ]),
      getPostAliases: async () => new Map(),
      getCollectionSlugMap: async () => new Map([["col-1", "ideas"]]),
    },
    collections: {
      list: async () => [collection],
      listDirectoryData: async () => ({
        collections: [],
        items: [
          {
            id: "dir-col-1",
            type: "collection" as const,
            collection: {
              ...collection,
              threadCount: 1,
              recentActivityAt: collection.updatedAt,
            },
          },
        ],
        directoryItems: [],
      }),
      getCollectionsByPostIds: async () =>
        new Map([["pst_root", [collection]]]),
      getCollectionEntriesByThreadIds: async () =>
        new Map([
          [
            "pst_root",
            [
              {
                collectionId: "col-1",
                createdAt: 1773020000,
                position: 0,
                pinnedAt: null,
              },
            ],
          ],
        ]),
    },
    media: {
      getByPostIds: async () => new Map([["pst_root", [media]]]),
    },
  } as unknown as ServicesArg;
}

describe("Hugo smoke build", () => {
  let tempDir: string;
  let hugoOk = false;

  beforeAll(async () => {
    hugoOk = hugoAvailable();
    tempDir = await mkdtemp(join(tmpdir(), "jant-hugo-build-"));
  });

  afterAll(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("hugo builds the generated site tree without ERROR or FATAL", async () => {
    if (!hugoOk) {
      // Hugo required in CI; skip locally if unavailable.
      console.log("hugo binary not found on PATH — skipping hugo build test");
      return;
    }

    const services = buildFixtureServices();
    const exportService = createExportService(services, makeSiteConfig());
    const files = await exportService.generateHugoFiles();

    for (const file of files) {
      const target = join(tempDir, file.path);
      await mkdir(dirname(target), { recursive: true });
      const data =
        typeof file.content === "string"
          ? new TextEncoder().encode(file.content)
          : file.content;
      await writeFile(target, data);
    }
    // Emit real bytes for the sibling page resource so Hugo's resource
    // processing doesn't warn.
    await writeFile(
      join(tempDir, "content/hello-world/med_hero.webp"),
      "PHOTO",
    );

    const { code, stdout, stderr } = await runHugo(tempDir);
    if (code !== 0) {
      console.error("hugo stdout:", stdout);
      console.error("hugo stderr:", stderr);
    }
    expect(code).toBe(0);
    expect(stderr).not.toMatch(/\bERROR\b/);
    expect(stderr).not.toMatch(/\bFATAL\b/);

    // Expected generated URLs.
    for (const rel of [
      "public/index.html",
      "public/featured/index.html",
      "public/featured/index.xml",
      "public/archive/index.html",
      "public/collections/index.html",
      "public/ideas/index.html",
      "public/ideas/index.xml",
      "public/hello-world/index.html",
      // Alias page for the reply slug (root aliases include /hello-reply/).
      "public/hello-reply/index.html",
      // The feed redirects are useless unless Hugo copies them to the root of
      // the published directory, where Cloudflare Pages and Netlify look.
      "public/_redirects",
    ]) {
      expect(await fileExists(join(tempDir, rel)), `missing ${rel}`).toBe(true);
    }

    const collectionHtml = await readFile(
      join(tempDir, "public/ideas/index.html"),
      "utf-8",
    );
    expect(collectionHtml).toContain("Hello World");
    expect(collectionHtml).toContain("Follow-up");
    expect(collectionHtml).toMatch(
      /class="thread thread-full thread-has-replies"/,
    );

    const collectionFeed = await readFile(
      join(tempDir, "public/ideas/index.xml"),
      "utf-8",
    );
    expect(collectionFeed).toContain("Hello World");
    expect(collectionFeed).toContain("Follow-up");
    expect(collectionFeed.match(/<entry>/g)).toHaveLength(1);

    // The exported feed carries the same entry payload the served one does,
    // minus what Known Limits in docs/internal/feed-contract.md records. A
    // template that stops compiling these silently drops them from every
    // self-hosted export.
    expect(collectionFeed).toContain('xmlns:jant="https://jant.me/ns"');
    expect(collectionFeed).toContain(
      'xmlns:media="http://search.yahoo.com/mrss/"',
    );
    expect(collectionFeed).toContain("<jant:format>note</jant:format>");
    // Nothing in this thread is cut, so the flag stays absent.
    expect(collectionFeed).not.toContain("<jant:truncated/>");
    expect(collectionFeed).toContain(
      '<category term="ideas" label="Ideas" jant:page="https://example.com/ideas/"/>',
    );
    // Media RSS describes the attachment; the content shows it in the same
    // `data-post-media` container the site marks its gallery strip with.
    expect(collectionFeed).toContain('medium="image"');
    expect(collectionFeed).toContain('width="800" height="600"');
    expect(collectionFeed).toContain(
      '<media:description type="plain">A photo</media:description>',
    );
    expect(collectionFeed).toContain("<div data-post-media>");
    // An image is already shown full size inside a link to the original, so it
    // gets no enclosure.
    expect(collectionFeed).not.toContain('rel="enclosure"');

    const featuredHtml = await readFile(
      join(tempDir, "public/featured/index.html"),
      "utf-8",
    );
    expect(featuredHtml).toContain("Hello World");
    expect(featuredHtml).toContain("Follow-up");
    expect(featuredHtml).toContain("thread-item-featured");

    const featuredFeed = await readFile(
      join(tempDir, "public/featured/index.xml"),
      "utf-8",
    );
    expect(featuredFeed).toContain("Hello World");
    expect(featuredFeed).toContain("Follow-up");
    expect(featuredFeed.match(/<entry>/g)).toHaveLength(1);
  }, 60_000);

  // Two feed details the served feed gets right and the template has to
  // match by hand: author text inside an attribute, and the entry-level
  // truncation flag on a thread.
  it("escapes image alt in the feed and marks a thread truncated by a folded-in reply", async () => {
    if (!hugoOk) {
      console.log("hugo binary not found on PATH — skipping hugo build test");
      return;
    }

    const para = (text: string) => ({
      type: "paragraph",
      content: [{ type: "text", text }],
    });
    const root = makePost({
      id: "pst_blue",
      slug: "blue-room",
      title: "The blue room",
      threadId: "pst_blue",
    });
    // The leading reply is cut by the timeline; the newest is not. The old
    // rule looked only at the newest reply and would have left the entry
    // unmarked. A titleless note is cut at NOTE_SUMMARY_MAX_CHARS with at
    // least NOTE_SUMMARY_MIN_HIDDEN_CHARS left over, so four long paragraphs.
    const longReply = makePost({
      id: "pst_long",
      slug: "blue-long",
      title: null,
      replyToId: "pst_blue",
      threadId: "pst_blue",
      createdAt: 1773020000,
      publishedAt: 1773020000,
      body: JSON.stringify({
        type: "doc",
        content: ["Alpha", "Beta", "Gamma", "Omega"].map((word) =>
          para(`${word} `.repeat(90).trim()),
        ),
      }),
    });
    const shortReply = makePost({
      id: "pst_short",
      slug: "blue-short",
      title: null,
      replyToId: "pst_blue",
      threadId: "pst_blue",
      createdAt: 1773030000,
      publishedAt: 1773030000,
      body: JSON.stringify({ type: "doc", content: [para("Short enough.")] }),
    });
    // A quote and a backslash: Go's `%q` would turn both into `\"` and `\\`.
    const alt = 'The "Blue" room, C:\\photos';
    const media = makeMedia({ id: "med_blue", filename: "blue.webp", alt });

    const services = {
      posts: { list: async () => [root, longReply, shortReply] },
      paths: {
        getPostSlugMap: async () =>
          new Map([
            ["pst_blue", "blue-room"],
            ["pst_long", "blue-long"],
            ["pst_short", "blue-short"],
          ]),
        getPostAliases: async () => new Map(),
        getCollectionSlugMap: async () => new Map(),
      },
      collections: {
        list: async () => [],
        listDirectoryData: async () => ({
          collections: [],
          items: [],
          directoryItems: [],
        }),
        getCollectionsByPostIds: async () => new Map(),
        getCollectionEntriesByThreadIds: async () => new Map(),
      },
      media: {
        getByPostIds: async () => new Map([["pst_blue", [media]]]),
      },
    } as unknown as ServicesArg;

    const siteDir = await mkdtemp(join(tmpdir(), "jant-hugo-feed-"));
    try {
      const files = await createExportService(
        services,
        makeSiteConfig(),
      ).generateHugoFiles();
      for (const file of files) {
        const target = join(siteDir, file.path);
        await mkdir(dirname(target), { recursive: true });
        const data =
          typeof file.content === "string"
            ? new TextEncoder().encode(file.content)
            : file.content;
        await writeFile(target, data);
      }
      await writeFile(
        join(siteDir, "content/blue-room/med_blue.webp"),
        "PHOTO",
      );

      const { code, stdout, stderr } = await runHugo(siteDir);
      if (code !== 0) {
        console.error("hugo stdout:", stdout);
        console.error("hugo stderr:", stderr);
      }
      expect(code).toBe(0);
      expect(stderr).not.toMatch(/\bERROR\b/);

      const feed = await readFile(join(siteDir, "public/index.xml"), "utf-8");
      expect(feed.match(/<entry>/g)).toHaveLength(1);

      // The attribute is XML-escaped like the caption next to it, not
      // Go-quoted: `"` becomes a character reference and `\` stays itself.
      const escapedAlt = "The &#34;Blue&#34; room, C:\\photos";
      expect(feed).toContain(`alt="${escapedAlt}"`);
      expect(feed).toContain(`<figcaption>${escapedAlt}</figcaption>`);
      expect(feed).not.toContain('alt="The \\"');

      expect(feed).toContain("<jant:truncated/>");
    } finally {
      await rm(siteDir, { recursive: true, force: true });
    }
  }, 60_000);

  it("never emits an alias page that redirects to nowhere", async () => {
    if (!hugoOk) {
      console.log("hugo binary not found on PATH — skipping hugo build test");
      return;
    }

    const root = makePost({
      id: "pst_root",
      slug: "hello-world",
      title: "Hello World",
      threadId: "pst_root",
    });
    const draft = makePost({
      id: "pst_draft",
      slug: "secret-plan",
      title: "Secret Plan",
      threadId: "pst_draft",
      status: "draft",
    });
    const services = {
      posts: { list: async () => [root, draft] },
      paths: {
        getPostSlugMap: async () =>
          new Map([
            ["pst_root", "hello-world"],
            ["pst_draft", "secret-plan"],
          ]),
        getPostAliases: async () =>
          new Map([
            ["pst_root", ["/blog/hello-world/"]],
            ["pst_draft", ["/blog/nixos-setup/"]],
          ]),
        getCollectionSlugMap: async () => new Map(),
      },
      collections: {
        list: async () => [],
        listDirectoryData: async () => ({
          collections: [],
          items: [],
          directoryItems: [],
        }),
        getCollectionsByPostIds: async () => new Map(),
        getCollectionEntriesByThreadIds: async () => new Map(),
      },
      media: { getByPostIds: async () => new Map() },
    } as unknown as ServicesArg;

    const siteDir = await mkdtemp(join(tmpdir(), "jant-hugo-alias-"));
    try {
      const files = await createExportService(
        services,
        makeSiteConfig(),
      ).generateHugoFiles();
      for (const file of files) {
        const target = join(siteDir, file.path);
        await mkdir(dirname(target), { recursive: true });
        const data =
          typeof file.content === "string"
            ? new TextEncoder().encode(file.content)
            : file.content;
        await writeFile(target, data);
      }
      // A page whose `aliases:` were written by hand rather than by Jant —
      // editing content on GitHub is a supported workflow, so the theme
      // cannot assume every alias came from the exporter.
      await mkdir(join(siteDir, "content/hand-written"), { recursive: true });
      await writeFile(
        join(siteDir, "content/hand-written/_index.md"),
        [
          "---",
          'title: "Hand written"',
          'date: "2026-03-09T00:00:00.000Z"',
          'slug: "hand-written"',
          'type: "post"',
          "draft: true",
          "aliases:",
          '  - "/blog/hand-written/"',
          "---",
          "",
          "Body.",
          "",
        ].join("\n"),
      );

      const { code, stdout, stderr } = await runHugo(siteDir);
      if (code !== 0) {
        console.error("hugo stdout:", stdout);
        console.error("hugo stderr:", stderr);
      }
      expect(code).toBe(0);

      // The published thread's alias redirects where it always did.
      const liveAlias = await readFile(
        join(siteDir, "public/blog/hello-world/index.html"),
        "utf-8",
      );
      expect(liveAlias).toContain(
        'content="0; url=https://example.com/hello-world/"',
      );
      // `jsonify` alone is escaped into a JS string by Hugo's contextual
      // escaping, which leaves the historical-root-alias branch comparing
      // single characters and never taking. `safeJS` keeps it an array.
      expect(liveAlias).toContain('["/blog/hello-world/"]');
      expect(liveAlias).not.toContain("'[\"/blog/hello-world/\"]'");

      // The unpublished thread gets no alias page at all: the exporter left
      // `aliases:` off a root Hugo was never going to build.
      expect(
        await fileExists(join(siteDir, "public/blog/nixos-setup/index.html")),
      ).toBe(false);

      // The hand-written one does get a page, and it has to be inert. An
      // empty `url=` is read as "reload this page", so the alias would
      // refresh itself forever.
      const orphanAlias = await readFile(
        join(siteDir, "public/blog/hand-written/index.html"),
        "utf-8",
      );
      expect(orphanAlias).not.toContain("http-equiv");
      expect(orphanAlias).toContain("This page is not available");
      expect(orphanAlias).toContain('content="noindex,nofollow"');
    } finally {
      await rm(siteDir, { recursive: true, force: true });
    }
  }, 60_000);

  it("folds a long thread's preview the way the site does", async () => {
    if (!hugoOk) {
      console.log("hugo binary not found on PATH — skipping hugo build test");
      return;
    }

    const words = ["one", "two", "three", "four", "five", "six", "seven"];
    const root = makePost({
      id: "pst_fold",
      slug: "fold-root",
      title: "A long thread",
      threadId: "pst_fold",
    });
    const replies = words.map((word, index) =>
      makePost({
        id: `pst_fold_${word}`,
        slug: `fold-${word}`,
        title: null,
        replyToId: "pst_fold",
        threadId: "pst_fold",
        createdAt: 1773020000 + index * 1000,
        publishedAt: 1773020000 + index * 1000,
        body: JSON.stringify({
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: `Reply ${word} of the fold.` }],
            },
          ],
        }),
      }),
    );

    const services = {
      posts: { list: async () => [root, ...replies] },
      paths: {
        getPostSlugMap: async () =>
          new Map([
            ["pst_fold", "fold-root"],
            ...words.map((word): [string, string] => [
              `pst_fold_${word}`,
              `fold-${word}`,
            ]),
          ]),
        getPostAliases: async () => new Map(),
        getCollectionSlugMap: async () => new Map(),
      },
      collections: {
        list: async () => [],
        listDirectoryData: async () => ({
          collections: [],
          items: [],
          directoryItems: [],
        }),
        getCollectionsByPostIds: async () => new Map(),
        getCollectionEntriesByThreadIds: async () => new Map(),
      },
      media: { getByPostIds: async () => new Map() },
    } as unknown as ServicesArg;

    const siteDir = await mkdtemp(join(tmpdir(), "jant-hugo-fold-"));
    try {
      const files = await createExportService(
        services,
        makeSiteConfig(),
      ).generateHugoFiles();
      for (const file of files) {
        const target = join(siteDir, file.path);
        await mkdir(dirname(target), { recursive: true });
        const data =
          typeof file.content === "string"
            ? new TextEncoder().encode(file.content)
            : file.content;
        await writeFile(target, data);
      }

      const { code, stdout, stderr } = await runHugo(siteDir);
      if (code !== 0) {
        console.error("hugo stdout:", stdout);
        console.error("hugo stderr:", stderr);
      }
      expect(code).toBe(0);

      const html = await readFile(join(siteDir, "public/index.html"), "utf-8");
      // Core's fold: the first two replies, a gap, the two before the newest,
      // and the newest as the hero. Seven replies hide two.
      for (const shown of ["one", "two", "five", "six", "seven"]) {
        expect(html).toContain(`Reply ${shown} of the fold.`);
      }
      for (const hidden of ["three", "four"]) {
        expect(html).not.toContain(`Reply ${hidden} of the fold.`);
      }
      expect(html).toContain("2 more posts");
      // The gap leads to the first hidden reply, as the site's does. The
      // build is minified, so attribute quotes are not guaranteed.
      expect(html).toMatch(/thread-preview-gap"? href="?[^" >]*\/fold-three\//);
      // A reply's card links to the reply's own address — its alias on the
      // root — not to an empty href, since reply pages are never rendered.
      expect(html).toMatch(
        /post-card-permalink"? href="?[^" >]*\/fold-seven\//,
      );
      expect(html).not.toMatch(/post-card-permalink"? href(?=[ >])/);
    } finally {
      await rm(siteDir, { recursive: true, force: true });
    }
  }, 60_000);
});
