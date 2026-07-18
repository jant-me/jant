/**
 * Tests for the Hugo-shaped export service.
 *
 * Exercises `createExportService(...).generateHugoFiles()` and
 * `generateHugoSite()` on small hand-built fixtures. Assertions target the
 * actual Hugo output tree: branch bundles, reply leaf bundles, flat YAML
 * front matter with stable key order, section discriminators, the bundled
 * Jant theme, and the `data/*.toml` files consumed by templates.
 */

import { describe, expect, it } from "vitest";
import { unzipSync } from "fflate";
import { createExportService } from "../services/export.js";
import { parseFrontMatter } from "../lib/hugo-markdown.js";
import type { Collection, Media, Post } from "../types.js";
import {
  makeCollection,
  makeMedia,
  makePost,
  makeSiteConfig,
} from "./helpers/export-fixtures.js";

type ServicesArg = Parameters<typeof createExportService>[0];

interface FixtureOptions {
  posts: Post[];
  collections?: Collection[];
  collectionsByPost?: Map<string, Collection[]>;
  collectionEntriesByThread?: Map<
    string,
    {
      collectionId: string;
      createdAt: number;
      position: number;
      pinnedAt: number | null;
    }[]
  >;
  mediaByPost?: Map<string, Media[]>;
  slugMap?: Map<string, string>;
  aliasMap?: Map<string, string[]>;
  collectionSlugMap?: Map<string, string>;
  directoryItems?: unknown[];
}

function buildServices(opts: FixtureOptions): ServicesArg {
  const {
    posts,
    collections = [],
    collectionsByPost = new Map(),
    collectionEntriesByThread = new Map(),
    mediaByPost = new Map(),
    slugMap = new Map(posts.map((p) => [p.id, p.slug])),
    aliasMap = new Map(),
    collectionSlugMap = new Map(collections.map((c) => [c.id, c.slug])),
    directoryItems,
  } = opts;

  return {
    posts: {
      list: async () => posts,
    },
    paths: {
      getPostSlugMap: async () => slugMap,
      getPostAliases: async () => aliasMap,
      getCollectionSlugMap: async () => collectionSlugMap,
    },
    collections: {
      list: async () => collections,
      listDirectoryData: async () => ({
        collections: [],
        items:
          directoryItems ??
          collections.map((collection) => ({
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
      getCollectionsByPostIds: async () => collectionsByPost,
      getCollectionEntriesByThreadIds: async () => collectionEntriesByThread,
    },
    media: {
      getByPostIds: async () => mediaByPost,
    },
  } as unknown as ServicesArg;
}

function filesToMap(
  list: { path: string; content: string | Uint8Array }[],
): Map<string, string | Uint8Array> {
  const map = new Map<string, string | Uint8Array>();
  for (const f of list) map.set(f.path, f.content);
  return map;
}

describe("createExportService (Hugo)", () => {
  it("emits a branch bundle per root post with YAML front matter in stable key order", async () => {
    const root = makePost({
      id: "post-root",
      slug: "hello-world",
      title: "Hello World",
      featuredAt: 1773100000,
      pinnedAt: 1773200000,
      format: "note",
    });

    const service = createExportService(
      buildServices({ posts: [root] }),
      makeSiteConfig(),
    );
    const files = filesToMap(await service.generateHugoFiles());

    const indexPath = "content/hello-world/_index.md";
    const md = files.get(indexPath);
    expect(md).toBeDefined();
    const text = typeof md === "string" ? md : new TextDecoder().decode(md!);

    // Starts with YAML delimiter
    expect(text.startsWith("---\n")).toBe(true);

    // Stable key order: Post fields, Featured projection, then pin metadata.
    const headerLines = text
      .split("\n")
      .slice(1, text.split("\n").indexOf("---", 1))
      .map((line) => line.split(":")[0]);
    const orderedExpected = [
      "id",
      "title",
      "date",
      "slug",
      "type",
      "format",
      "status",
      "visibility",
      "summary_text",
      "featured_at",
      "featured_post_ids",
      "featured_sort_at",
      "pinned_at",
    ];
    let cursor = -1;
    for (const key of orderedExpected) {
      const idx = headerLines.indexOf(key);
      expect(idx).toBeGreaterThan(cursor);
      cursor = idx;
    }

    const { frontMatter } = await parseFrontMatter(text);
    expect(frontMatter.id).toBe("post-root");
    expect(frontMatter.slug).toBe("hello-world");
    expect(frontMatter.type).toBe("post");
    expect(frontMatter.format).toBe("note");
    expect(frontMatter.featured_at).toBe(
      new Date(1773100000 * 1000).toISOString(),
    );
    expect(frontMatter.featured_post_ids).toEqual(["post-root"]);
    expect(frontMatter.featured_sort_at).toBe(
      new Date((root.publishedAt ?? root.createdAt) * 1000).toISOString(),
    );
    expect(frontMatter.pinned_at).toBe(
      new Date(1773200000 * 1000).toISOString(),
    );
  });

  it("emits reply bundles with build.render=never and no aliases key", async () => {
    const root = makePost({
      id: "post-root",
      slug: "thread-root",
      threadId: "post-root",
    });
    const reply = makePost({
      id: "post-reply",
      slug: "reply-one",
      title: "Reply title",
      replyToId: "post-root",
      threadId: "post-root",
      createdAt: 1773018000,
      publishedAt: 1773018000,
    });

    const service = createExportService(
      buildServices({ posts: [root, reply] }),
      makeSiteConfig(),
    );
    const files = filesToMap(await service.generateHugoFiles());

    const rootPath = "content/thread-root/_index.md";
    const replyPath = "content/thread-root/reply-one/index.md";
    expect(files.has(rootPath)).toBe(true);
    expect(files.has(replyPath)).toBe(true);

    const rootText = files.get(rootPath) as string;
    const replyText = files.get(replyPath) as string;

    const { frontMatter: rootFm } = await parseFrontMatter(rootText);
    const { frontMatter: replyFm } = await parseFrontMatter(replyText);

    // Root aliases contain the reply slug path.
    expect(rootFm.aliases).toEqual(expect.arrayContaining(["/reply-one/"]));

    // Reply has build.render=never, build.list=local, no aliases.
    expect(replyFm.build).toEqual({ render: "never", list: "local" });
    expect(replyFm.aliases).toBeUndefined();
    expect(replyFm.type).toBe("post");
    expect(replyFm.id).toBe("post-reply");
  });

  it("projects Child Featured selection and publication order onto the Root bundle", async () => {
    const root = makePost({
      id: "post-root",
      slug: "thread-root",
      threadId: "post-root",
      publishedAt: 1000,
      createdAt: 1000,
    });
    const featuredReply = makePost({
      id: "post-featured-reply",
      slug: "featured-reply",
      replyToId: root.id,
      threadId: root.id,
      featuredAt: 9000,
      publishedAt: 3000,
      createdAt: 3000,
    });
    const finalReply = makePost({
      id: "post-final-reply",
      slug: "final-reply",
      replyToId: featuredReply.id,
      threadId: root.id,
      publishedAt: 4000,
      createdAt: 4000,
    });

    const service = createExportService(
      buildServices({ posts: [root, featuredReply, finalReply] }),
      makeSiteConfig(),
    );
    const files = filesToMap(await service.generateHugoFiles());
    const rootText = files.get("content/thread-root/_index.md") as string;
    const { frontMatter } = await parseFrontMatter(rootText);

    expect(frontMatter.featured_at).toBeUndefined();
    expect(frontMatter.featured_post_ids).toEqual([featuredReply.id]);
    expect(frontMatter.featured_sort_at).toBe(
      new Date(3000 * 1000).toISOString(),
    );
  });

  it("merges historical root aliases + reply slugs onto the root", async () => {
    const root = makePost({ id: "r", slug: "new-slug", threadId: "r" });
    const reply = makePost({
      id: "rep",
      slug: "reply-a",
      replyToId: "r",
      threadId: "r",
      createdAt: 1773018000,
      publishedAt: 1773018000,
    });

    const service = createExportService(
      buildServices({
        posts: [root, reply],
        aliasMap: new Map([["r", ["/old-slug/", "/older-slug/"]]]),
      }),
      makeSiteConfig(),
    );
    const files = filesToMap(await service.generateHugoFiles());
    const rootText = files.get("content/new-slug/_index.md") as string;
    const { frontMatter } = await parseFrontMatter(rootText);

    expect(frontMatter.aliases).toEqual([
      "/old-slug/",
      "/older-slug/",
      "/reply-a/",
    ]);
    expect(frontMatter.root_aliases).toEqual(["/old-slug/", "/older-slug/"]);
  });

  it("emits home/featured/archive/collections section pages with type discriminators", async () => {
    const service = createExportService(
      buildServices({ posts: [makePost()] }),
      makeSiteConfig(),
    );
    const files = filesToMap(await service.generateHugoFiles());

    for (const [path, expectedType] of [
      ["content/_index.md", "home"],
      ["content/featured/_index.md", "featured"],
      ["content/archive/_index.md", "archive"],
      ["content/collections/_index.md", "collections"],
    ] as const) {
      const raw = files.get(path);
      expect(raw, `missing ${path}`).toBeDefined();
      const { frontMatter } = await parseFrontMatter(raw as string);
      expect(frontMatter.type).toBe(expectedType);
    }
  });

  it("emits a per-collection branch bundle with type=collection", async () => {
    const collection = makeCollection({
      id: "col-1",
      slug: "ideas",
      title: "Ideas",
      description: "Half-formed thoughts",
    });
    const service = createExportService(
      buildServices({ posts: [], collections: [collection] }),
      makeSiteConfig(),
    );
    const files = filesToMap(await service.generateHugoFiles());
    const raw = files.get("content/ideas/_index.md");
    expect(raw).toBeDefined();
    const { frontMatter } = await parseFrontMatter(raw as string);
    expect(frontMatter.type).toBe("collection");
    expect(frontMatter.slug).toBe("ideas");
    expect(frontMatter.title).toBe("Ideas");
    expect(frontMatter.summary_text).toBe("Half-formed thoughts");
  });

  it("writes hugo.toml with baseURL, theme=jant, [permalinks] post=/:slug/, and [params]", async () => {
    const service = createExportService(
      buildServices({ posts: [] }),
      makeSiteConfig({
        siteName: "My Site",
        siteUrl: "https://my.example",
      }),
    );
    const files = filesToMap(await service.generateHugoFiles());
    const toml = files.get("hugo.toml") as string;
    expect(toml).toBeDefined();
    expect(toml).toContain('baseURL = "https://my.example/"');
    expect(toml).toContain('title = "My Site"');
    expect(toml).toContain('theme = "jant"');
    expect(toml).toMatch(/\[permalinks\][\s\S]*post = "\/:slug\/"/);
    expect(toml).toContain("[params]");
    expect(toml).not.toContain("home_default_view");
  });

  it("configures hugo.toml for Atom RSS output with per-section opt-in", async () => {
    // The root feed lives at /index.xml, featured/archive/collections feeds
    // are opted in via per-section `outputs = ["html", "rss"]` front matter.
    // Sections default to ["html"] so root-post branch bundles don't each
    // emit their own /{slug}/index.xml. Taxonomy/term kinds are disabled to
    // avoid empty /tags/ and /categories/ pages.
    const service = createExportService(
      buildServices({ posts: [] }),
      makeSiteConfig({ mainRssFeed: "featured", rssFeedLimit: 25 }),
    );
    const files = filesToMap(await service.generateHugoFiles());
    const toml = files.get("hugo.toml") as string;
    expect(toml).toBeDefined();

    // `disableKinds` must be at the root — not nested under a `[table]` —
    // or TOML scoping will silently put it inside the previous table.
    expect(toml).toMatch(/^disableKinds = \[[^\]]*taxonomy[^\]]*term/m);

    expect(toml).toMatch(/\[outputs\][\s\S]*home = \[\s*"html",\s*"rss"\s*\]/);
    expect(toml).toMatch(/\[outputs\][\s\S]*section = \[\s*"html"\s*\]/);

    // Atom 2005, served as application/atom+xml at /index.xml. Text-template
    // mode (isPlainText = true) so the template isn't HTML-escaped.
    expect(toml).toMatch(
      /\[outputFormats\.RSS\][\s\S]*mediaType = "application\/atom\+xml"/,
    );
    expect(toml).toMatch(/\[outputFormats\.RSS\][\s\S]*baseName = "index"/);
    expect(toml).toMatch(/\[outputFormats\.RSS\][\s\S]*isPlainText = true/);
    expect(toml).toMatch(
      /\[mediaTypes\."application\/atom\+xml"\][\s\S]*suffixes = \[\s*"xml"\s*\]/,
    );

    // Params used by the Atom template + nav RSS link resolution.
    expect(toml).toContain('main_rss_feed = "featured"');
    expect(toml).toContain("rss_feed_limit = 25");
  });

  it("enables RSS output on featured, archive, and collection sections", async () => {
    const collection = makeCollection({ id: "col-1", slug: "ideas" });
    const service = createExportService(
      buildServices({ posts: [], collections: [collection] }),
      makeSiteConfig(),
    );
    const files = filesToMap(await service.generateHugoFiles());

    for (const path of [
      "content/featured/_index.md",
      "content/archive/_index.md",
      "content/ideas/_index.md",
    ]) {
      const raw = files.get(path) as string;
      expect(raw, `missing ${path}`).toBeDefined();
      const { frontMatter } = await parseFrontMatter(raw);
      expect(frontMatter.outputs, `outputs missing on ${path}`).toEqual([
        "html",
        "rss",
      ]);
    }
  });

  it("resolves the nav RSS link to /featured/index.xml when mainRssFeed=featured", async () => {
    const service = createExportService(
      buildServices({ posts: [] }),
      makeSiteConfig({
        mainRssFeed: "featured",
        navItems: [
          {
            type: "system",
            systemKey: "rss",
            label: "RSS",
            url: "/index.xml",
            position: 0,
            placement: "header",
          },
        ],
      }),
    );
    const files = filesToMap(await service.generateHugoFiles());
    const data = files.get("data/jant.toml") as string;
    expect(data).toBeDefined();
    expect(data).toContain('url = "/featured/index.xml"');
  });

  it("resolves the nav RSS link to /index.xml when mainRssFeed=latest", async () => {
    const service = createExportService(
      buildServices({ posts: [] }),
      makeSiteConfig({
        mainRssFeed: "latest",
        navItems: [
          {
            type: "system",
            systemKey: "rss",
            label: "RSS",
            url: "/index.xml",
            position: 0,
            placement: "header",
          },
        ],
      }),
    );
    const files = filesToMap(await service.generateHugoFiles());
    const data = files.get("data/jant.toml") as string;
    expect(data).toContain('url = "/index.xml"');
  });

  it("emits last_activity_at on root post front matter so feed <updated> tracks thread bumps", async () => {
    const post = makePost({
      id: "post-1",
      slug: "root",
      lastActivityAt: 1773100000,
      updatedAt: 1773014400,
    });
    const service = createExportService(
      buildServices({ posts: [post] }),
      makeSiteConfig(),
    );
    const files = filesToMap(await service.generateHugoFiles());
    const raw = files.get("content/root/_index.md") as string;
    expect(raw).toBeDefined();
    const { frontMatter } = await parseFrontMatter(raw);
    expect(frontMatter.last_activity_at).toBe("2026-03-09T23:46:40.000Z");
  });

  it("lowercases BCP-47 language codes in hugo.toml so Hugo accepts them", async () => {
    // Hugo rejects mixed-case language codes like `zh-Hant` with
    // "must be all lower case and no spaces" — so the exporter has to
    // normalize the site language even though Jant stores BCP-47 casing.
    const service = createExportService(
      buildServices({ posts: [] }),
      makeSiteConfig({ siteLanguage: "zh-Hant" }),
    );
    const files = filesToMap(await service.generateHugoFiles());
    const toml = files.get("hugo.toml") as string;
    expect(toml).toContain('languageCode = "zh-hant"');
    expect(toml).toContain('defaultContentLanguage = "zh-hant"');
    expect(toml).not.toContain("zh-Hant");
  });

  it("emits data/jant.toml with nav and collections directory inline", async () => {
    const collection = makeCollection({ id: "col-1", slug: "ideas" });
    const service = createExportService(
      buildServices({
        posts: [],
        collections: [collection],
        directoryItems: [
          { id: "d1", type: "divider" as const, label: "Writing" },
          {
            id: "c1",
            type: "collection" as const,
            collection: {
              ...collection,
              threadCount: 0,
              recentActivityAt: collection.updatedAt,
            },
          },
          {
            id: "l1",
            type: "link" as const,
            label: "Elsewhere",
            url: "https://example.com/elsewhere",
          },
        ],
      }),
      makeSiteConfig({
        navItems: [
          {
            type: "system",
            systemKey: "latest",
            label: "",
            url: "/latest",
            position: "a0",
            placement: "header",
          },
        ],
      }),
    );
    const files = filesToMap(await service.generateHugoFiles());
    const jantData = files.get("data/jant.toml") as string;
    expect(jantData).toBeDefined();
    expect(files.has("data/collection_directory.toml")).toBe(false);

    const { parse } = await import("smol-toml");
    const jant = parse(jantData);
    expect(jant.format).toBe("jant-site");
    expect(jant.site_name).toBe("Jant Test");
    expect(Array.isArray(jant.nav)).toBe(true);
    expect(Array.isArray(jant.directory)).toBe(true);
    expect((jant.directory as unknown[]).length).toBe(3);
  });

  it("bundles the Jant theme with layouts and CSS files", async () => {
    const service = createExportService(
      buildServices({ posts: [] }),
      makeSiteConfig(),
    );
    const files = filesToMap(await service.generateHugoFiles());

    const expectedLayouts = [
      "themes/jant/theme.toml",
      "themes/jant/layouts/_default/baseof.html",
      "themes/jant/layouts/_default/single.html",
      "themes/jant/layouts/_default/list.html",
      "themes/jant/layouts/_default/alias.html",
      "themes/jant/layouts/_default/rss.xml",
      "themes/jant/layouts/index.html",
      "themes/jant/layouts/post/list.html",
      "themes/jant/layouts/featured/list.html",
      "themes/jant/layouts/archive/list.html",
      "themes/jant/layouts/collections/list.html",
      "themes/jant/layouts/collection/single.html",
      "themes/jant/layouts/partials/head.html",
      "themes/jant/layouts/partials/header.html",
      "themes/jant/layouts/partials/footer.html",
      "themes/jant/layouts/partials/pagination.html",
      "themes/jant/layouts/partials/post-card.html",
      "themes/jant/layouts/partials/reply.html",
      "themes/jant/layouts/partials/featured-thread.html",
      "themes/jant/layouts/partials/feed-post-content.xml",
    ];
    for (const path of expectedLayouts) {
      expect(files.has(path), `missing ${path}`).toBe(true);
    }

    expect(files.has("themes/jant/static/main.css")).toBe(true);
    expect(files.has("themes/jant/static/tokens.css")).toBe(true);
    expect(files.has("themes/jant/static/theme.css")).toBe(true);
    expect(files.has("themes/jant/static/custom.css")).toBe(true);

    const collectionList = files.get(
      "themes/jant/layouts/_default/list.html",
    ) as string;
    expect(collectionList).toContain(
      'class="thread thread-full{{ if $hasReplies }} thread-has-replies{{ end }}"',
    );
  });

  it("writes a .gitignore covering Hugo build artifacts", async () => {
    const service = createExportService(
      buildServices({ posts: [] }),
      makeSiteConfig(),
    );
    const files = filesToMap(await service.generateHugoFiles());
    const gitignore = files.get(".gitignore") as string;
    expect(gitignore).toBeDefined();
    expect(gitignore).toMatch(/public\//);
    expect(gitignore).toMatch(/resources\//);
    expect(gitignore).toMatch(/\.hugo_build\.lock/);
  });

  it("generateHugoSite() returns a valid zip archive", async () => {
    const service = createExportService(
      buildServices({ posts: [makePost()] }),
      makeSiteConfig(),
    );
    const zip = await service.generateHugoSite();
    expect(zip).toBeInstanceOf(Uint8Array);
    expect(zip.byteLength).toBeGreaterThan(0);
    // ZIP magic: PK\x03\x04
    expect(zip[0]).toBe(0x50);
    expect(zip[1]).toBe(0x4b);
    const decoded = unzipSync(zip);
    expect(Object.keys(decoded)).toContain("hugo.toml");
  });

  it("writes Thread collection memberships only on root front matter", async () => {
    const collection = makeCollection({ id: "col-1", slug: "ideas" });
    const root = makePost({ id: "post-root", slug: "entry-a" });
    const reply = makePost({
      id: "post-reply",
      slug: "entry-a-reply",
      replyToId: "post-root",
      threadId: "post-root",
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
        position: 3,
        pinnedAt: 1773050000,
      },
    ]);
    const service = createExportService(
      buildServices({
        posts: [root, reply],
        collections: [collection],
        collectionEntriesByThread: entries,
      }),
      makeSiteConfig(),
    );
    const files = filesToMap(await service.generateHugoFiles());
    const { frontMatter } = await parseFrontMatter(
      files.get("content/entry-a/_index.md") as string,
    );
    expect(frontMatter.collections).toEqual([
      {
        slug: "ideas",
        title: "Ideas",
        collected_at: new Date(1773000000 * 1000).toISOString(),
        position: 3,
        pinned_at: new Date(1773050000 * 1000).toISOString(),
      },
    ]);
    const { frontMatter: replyFrontMatter } = await parseFrontMatter(
      files.get("content/entry-a/entry-a-reply/index.md") as string,
    );
    expect(replyFrontMatter.collections).toBeUndefined();
  });

  it("emits media[] front matter for each attachment on a post", async () => {
    const root = makePost({ id: "post-root", slug: "with-media" });
    const media = makeMedia({
      id: "med-1",
      filename: "photo.webp",
      width: 1024,
      height: 768,
      alt: "A red lantern",
      blurhash: "L6PZfSi_.AyE_3t7t7R**0o#DgR4",
    });
    const service = createExportService(
      buildServices({
        posts: [root],
        mediaByPost: new Map([["post-root", [media]]]),
      }),
      makeSiteConfig(),
    );
    const files = filesToMap(await service.generateHugoFiles());
    const { frontMatter } = await parseFrontMatter(
      files.get("content/with-media/_index.md") as string,
    );
    expect(Array.isArray(frontMatter.media)).toBe(true);
    const entry = frontMatter.media![0];
    expect(entry.id).toBe("med-1");
    expect(entry.kind).toBe("image");
    expect(entry.src).toBe("/media/med-1.webp");
    expect(entry.alt).toBe("A red lantern");
    expect(entry.width).toBe(1024);
    expect(entry.height).toBe(768);
    expect(entry.blurhash).toBe("L6PZfSi_.AyE_3t7t7R**0o#DgR4");
    expect(entry.provider).toBe("r2");
    expect(entry.storage_key).toBe("media/med-1.webp");
  });

  it("bundles media bytes under static/media/ for root and reply media", async () => {
    const root = makePost({
      id: "post-root",
      slug: "with-media",
      threadId: "post-root",
    });
    const reply = makePost({
      id: "post-reply",
      slug: "reply-one",
      replyToId: "post-root",
      threadId: "post-root",
      createdAt: 1773018000,
      publishedAt: 1773018000,
    });
    const rootMedia = makeMedia({
      id: "med-root",
      filename: "root.webp",
      storageKey: "media/med-root.webp",
    });
    const replyMedia = makeMedia({
      id: "med-reply",
      filename: "reply.png",
      mimeType: "image/png",
      storageKey: "media/med-reply.png",
    });
    const storedBytes = new Map<string, Uint8Array>([
      ["media/med-root.webp", new Uint8Array([1, 2, 3])],
      ["media/med-reply.png", new Uint8Array([9, 9, 9, 9])],
    ]);
    const storage = {
      get: async (key: string) => {
        const bytes = storedBytes.get(key);
        if (!bytes) return null;
        return {
          body: new Blob([new Uint8Array(bytes)]).stream(),
        };
      },
    };
    const service = createExportService(
      buildServices({
        posts: [root, reply],
        mediaByPost: new Map([
          ["post-root", [rootMedia]],
          ["post-reply", [replyMedia]],
        ]),
      }),
      makeSiteConfig(),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { storage: storage as any },
    );
    const files = filesToMap(await service.generateHugoFiles());
    expect(files.has("static/media/med-root.webp")).toBe(true);
    expect(files.has("static/media/med-reply.png")).toBe(true);
    expect(files.get("static/media/med-root.webp")).toEqual(
      new Uint8Array([1, 2, 3]),
    );
    expect(files.get("static/media/med-reply.png")).toEqual(
      new Uint8Array([9, 9, 9, 9]),
    );
    // Sanity: the old per-bundle paths are gone.
    expect(files.has("content/with-media/med-root.webp")).toBe(false);
    expect(files.has("content/with-media/reply-one/med-reply.png")).toBe(false);
  });

  it("emits poster bytes and poster field for video media with posterKey", async () => {
    const root = makePost({
      id: "post-root",
      slug: "with-video",
      threadId: "post-root",
    });
    const videoMedia = makeMedia({
      id: "med-video",
      filename: "clip.mp4",
      mimeType: "video/mp4",
      storageKey: "media/med-video.mp4",
      mediaKind: "video",
      posterKey: "media/posters/med-video.webp",
    });
    const storedBytes = new Map<string, Uint8Array>([
      ["media/med-video.mp4", new Uint8Array([10, 20, 30])],
      ["media/posters/med-video.webp", new Uint8Array([40, 50, 60, 70])],
    ]);
    const storage = {
      get: async (key: string) => {
        const bytes = storedBytes.get(key);
        if (!bytes) return null;
        return {
          body: new Blob([new Uint8Array(bytes)]).stream(),
        };
      },
    };
    const service = createExportService(
      buildServices({
        posts: [root],
        mediaByPost: new Map([["post-root", [videoMedia]]]),
      }),
      makeSiteConfig(),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { storage: storage as any },
    );
    const files = filesToMap(await service.generateHugoFiles());
    expect(files.has("static/media/med-video.mp4")).toBe(true);
    expect(files.has("static/media/med-video-poster.webp")).toBe(true);
    expect(files.get("static/media/med-video.mp4")).toEqual(
      new Uint8Array([10, 20, 30]),
    );
    expect(files.get("static/media/med-video-poster.webp")).toEqual(
      new Uint8Array([40, 50, 60, 70]),
    );

    const { frontMatter } = await parseFrontMatter(
      files.get("content/with-video/_index.md") as string,
    );
    const entry = frontMatter.media![0];
    expect(entry.kind).toBe("video");
    expect(entry.src).toBe("/media/med-video.mp4");
    expect(entry.poster).toBe("/media/med-video-poster.webp");
    expect(entry.poster_key).toBe("media/posters/med-video.webp");
  });

  it("links to provider public URL instead of inlining bytes when configured", async () => {
    const root = makePost({ id: "post-root", slug: "with-cdn" });
    const media = makeMedia({
      id: "med-cdn",
      filename: "cdn.webp",
      storageKey: "media/med-cdn.webp",
    });
    const storage = {
      // Should NOT be called — public URL is present, no inlining needed.
      get: async () => {
        throw new Error("storage.get should not be called when linking");
      },
    };
    const service = createExportService(
      buildServices({
        posts: [root],
        mediaByPost: new Map([["post-root", [media]]]),
      }),
      makeSiteConfig({ r2PublicUrl: "https://cdn.example.com" }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { storage: storage as any },
    );
    const files = filesToMap(await service.generateHugoFiles());
    expect(files.has("static/media/med-cdn.webp")).toBe(false);
    const { frontMatter } = await parseFrontMatter(
      files.get("content/with-cdn/_index.md") as string,
    );
    const entry = frontMatter.media![0];
    expect(entry.src).toBe("https://cdn.example.com/media/med-cdn.webp");
    expect(entry.storage_key).toBe("media/med-cdn.webp");
    expect(entry.provider).toBe("r2");
  });

  it("skips media byte emission when no storage driver is available", async () => {
    const root = makePost({ id: "post-root", slug: "with-media" });
    const media = makeMedia({
      id: "med-x",
      filename: "x.webp",
      storageKey: "media/med-x.webp",
    });
    const service = createExportService(
      buildServices({
        posts: [root],
        mediaByPost: new Map([["post-root", [media]]]),
      }),
      makeSiteConfig(),
      // No storage passed — front matter still lists the media but no
      // bytes are emitted.
    );
    const files = filesToMap(await service.generateHugoFiles());
    expect(files.has("static/media/med-x.webp")).toBe(false);
  });

  it("Sync mode (bundleMedia false) links media by absolute site URL without reading bytes", async () => {
    const root = makePost({ id: "post-root", slug: "with-media" });
    const media = makeMedia({
      id: "med-1",
      filename: "photo.webp",
      storageKey: "media/med-1.webp",
    });
    const storage = {
      // Must NOT be called — Sync links by URL, never reads attachment bytes.
      get: async () => {
        throw new Error("storage.get should not be called in Sync mode");
      },
    };
    const service = createExportService(
      buildServices({
        posts: [root],
        mediaByPost: new Map([["post-root", [media]]]),
      }),
      makeSiteConfig(),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { storage: storage as any, bundleMedia: false },
    );
    const files = filesToMap(await service.generateHugoFiles());
    expect(files.has("static/media/med-1.webp")).toBe(false);
    const { frontMatter } = await parseFrontMatter(
      files.get("content/with-media/_index.md") as string,
    );
    const entry = frontMatter.media![0];
    expect(entry.src).toBe("https://example.com/media/med-1.webp");
    expect(entry.storage_key).toBe("media/med-1.webp");
  });

  it("Sync mode links the video poster by absolute site URL without bundling", async () => {
    const root = makePost({ id: "post-root", slug: "with-video" });
    const videoMedia = makeMedia({
      id: "med-video",
      filename: "clip.mp4",
      mimeType: "video/mp4",
      storageKey: "media/med-video.mp4",
      mediaKind: "video",
      posterKey: "media/posters/med-video.webp",
    });
    const storage = {
      get: async () => {
        throw new Error("storage.get should not be called in Sync mode");
      },
    };
    const service = createExportService(
      buildServices({
        posts: [root],
        mediaByPost: new Map([["post-root", [videoMedia]]]),
      }),
      makeSiteConfig(),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { storage: storage as any, bundleMedia: false },
    );
    const files = filesToMap(await service.generateHugoFiles());
    expect(files.has("static/media/med-video.mp4")).toBe(false);
    expect(files.has("static/media/med-video-poster.webp")).toBe(false);
    const { frontMatter } = await parseFrontMatter(
      files.get("content/with-video/_index.md") as string,
    );
    const entry = frontMatter.media![0];
    expect(entry.src).toBe("https://example.com/media/med-video.mp4");
    expect(entry.poster).toBe(
      "https://example.com/media/posters/med-video.webp",
    );
  });

  it("Sync mode still prefers a dedicated provider public URL when configured", async () => {
    const root = makePost({ id: "post-root", slug: "with-cdn" });
    const media = makeMedia({
      id: "med-cdn",
      filename: "cdn.webp",
      storageKey: "media/med-cdn.webp",
    });
    const service = createExportService(
      buildServices({
        posts: [root],
        mediaByPost: new Map([["post-root", [media]]]),
      }),
      makeSiteConfig({ r2PublicUrl: "https://cdn.example.com" }),
      { bundleMedia: false },
    );
    const files = filesToMap(await service.generateHugoFiles());
    expect(files.has("static/media/med-cdn.webp")).toBe(false);
    const { frontMatter } = await parseFrontMatter(
      files.get("content/with-cdn/_index.md") as string,
    );
    expect(frontMatter.media![0].src).toBe(
      "https://cdn.example.com/media/med-cdn.webp",
    );
  });

  it("Sync mode falls back to bundling bytes when the site URL is unknown", async () => {
    const root = makePost({ id: "post-root", slug: "with-media" });
    const media = makeMedia({
      id: "med-1",
      filename: "photo.webp",
      storageKey: "media/med-1.webp",
    });
    const storage = {
      get: async (key: string) =>
        key === "media/med-1.webp"
          ? { body: new Blob([new Uint8Array([1, 2, 3])]).stream() }
          : null,
    };
    const service = createExportService(
      buildServices({
        posts: [root],
        mediaByPost: new Map([["post-root", [media]]]),
      }),
      makeSiteConfig({ siteUrl: "" }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { storage: storage as any, bundleMedia: false },
    );
    const files = filesToMap(await service.generateHugoFiles());
    // No resolvable URL — bundling is the only way to avoid a broken link.
    expect(files.get("static/media/med-1.webp")).toEqual(
      new Uint8Array([1, 2, 3]),
    );
    const { frontMatter } = await parseFrontMatter(
      files.get("content/with-media/_index.md") as string,
    );
    expect(frontMatter.media![0].src).toBe("/media/med-1.webp");
  });
});
