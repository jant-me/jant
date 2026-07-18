/**
 * Tests for the Hugo import CLI helpers.
 *
 * Covers the walker (`walkHugoContent`), site-config merger
 * (`loadSiteConfig`), media resolver (`mediaSpecFromJantMedia`), collection
 * membership decoder, and the post-payload builder. A hand-authored Hugo
 * export tree is written to a temp dir per test so we exercise real fs
 * paths the CLI uses at runtime.
 */

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { __test__ } from "../../bin/commands/import-site.js";

const {
  walkHugoContent,
  loadSiteConfig,
  mediaSpecFromJantMedia,
  resolveCollectionMemberships,
  resolveThreadCollectionMemberships,
  buildPostPayloadFromBundle,
  getRootAliasPathsForImport,
  uploadMediaList,
  normalizeTextAttachmentSpec,
  isAbsoluteImportUrl,
  shouldImportReplyQuietly,
} = __test__;

async function writeFileTree(
  rootDir: string,
  entries: Record<string, string | Uint8Array>,
): Promise<void> {
  for (const [rel, content] of Object.entries(entries)) {
    const target = join(rootDir, rel);
    await mkdir(join(target, "..").replace(/\/$/, ""), { recursive: true });
    const data =
      typeof content === "string" ? new TextEncoder().encode(content) : content;
    await writeFile(target, data);
  }
}

describe("Hugo import CLI helpers", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "jant-import-cmd-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("walkHugoContent classifies root posts, replies, and collection bundles", async () => {
    await writeFileTree(tempDir, {
      "content/_index.md": "---\ntype: home\n---\n",
      "content/ideas/_index.md":
        "---\ntitle: Ideas\nslug: ideas\ntype: collection\n---\n",
      "content/hello/_index.md":
        "---\nid: pst_root\ntitle: Hello\ndate: 2026-04-01T00:00:00Z\nslug: hello\ntype: post\nformat: note\nstatus: published\nvisibility: public\n---\nHello body\n",
      "content/hello/reply-a/index.md":
        "---\nid: pst_replya\ntitle: Reply A\ndate: 2026-04-01T01:00:00Z\nslug: reply-a\ntype: post\nbuild:\n  render: never\n  list: local\nformat: note\nstatus: published\nvisibility: public\n---\nReply A body\n",
      "content/hello/reply-b/index.md":
        "---\nid: pst_replyb\ntitle: Reply B\ndate: 2026-04-01T00:30:00Z\nslug: reply-b\ntype: post\nbuild:\n  render: never\n  list: local\nformat: note\nstatus: published\nvisibility: public\n---\nReply B body\n",
    });

    const { rootBundles, collectionBundles } = await walkHugoContent(tempDir);
    expect(rootBundles).toHaveLength(1);
    expect(collectionBundles).toHaveLength(1);
    expect(collectionBundles[0].slug).toBe("ideas");

    const root = rootBundles[0];
    expect(root.slug).toBe("hello");
    expect(root.children).toHaveLength(2);
    // Replies are sorted by date ascending: B (00:30) before A (01:00).
    expect(root.children.map((c: { slug: string }) => c.slug)).toEqual([
      "reply-b",
      "reply-a",
    ]);
  });

  it("loadSiteConfig merges hugo.toml + data/jant.toml (with inline directory)", async () => {
    await writeFileTree(tempDir, {
      "hugo.toml": [
        'baseURL = "https://example.com/"',
        'title = "Example Site"',
        'languageCode = "en"',
        'theme = "jant"',
        "[params]",
        '  description = "A description"',
        '  theme_id = "paper"',
        '  home_default_view = "featured"',
        "",
      ].join("\n"),
      "data/jant.toml": [
        'format = "jant-site"',
        "version = 1",
        'site_name = "Example Site"',
        'site_description = "A description"',
        'site_language = "en"',
        "show_jant_branding_on_home = true",
        "show_header_avatar = false",
        "noindex = false",
        'site_avatar_mode = "none"',
        'favicon_mode = "default"',
        'apple_touch_mode = "default"',
        'theme_id = "paper"',
        'default_theme_id = "paper"',
        'font_theme_id = "system"',
        'theme_mode = "auto"',
        "page_size = 10",
        "archive_page_size = 50",
        "",
        "[[nav]]",
        'type = "system"',
        'label = "Latest"',
        'url = "/"',
        'system_key = "latest"',
        'placement = "header"',
        "",
        "[[directory]]",
        'type = "divider"',
        'label = "Writing"',
        "",
        "[[directory]]",
        'type = "collection"',
        'slug = "ideas"',
        'title = "Ideas"',
        "",
      ].join("\n"),
    });

    const siteConfig = await loadSiteConfig(tempDir);
    expect(siteConfig).not.toBeNull();
    expect(siteConfig.title).toBe("Example Site");
    expect(siteConfig.base_url).toBe("https://example.com/");
    expect(siteConfig.extra.jant.theme_id).toBe("paper");
    expect(siteConfig.extra.jant).not.toHaveProperty("home_default_view");
    expect(siteConfig.extra.jant.nav_exported).toBe(true);
    expect(siteConfig.extra.jant.nav).toHaveLength(1);
    expect(siteConfig.extra.jant.collections_directory_exported).toBe(true);
    expect(siteConfig.extra.jant.collections_directory).toHaveLength(2);
  });

  it("mediaSpecFromJantMedia resolves site-relative src under static/", async () => {
    await mkdir(join(tempDir, "static", "media"), { recursive: true });
    await writeFile(join(tempDir, "static/media/med-1.webp"), "PHOTO");

    const spec = await mediaSpecFromJantMedia(
      {
        id: "med-1",
        src: "/media/med-1.webp",
        kind: "image",
        alt: "Alt text",
        width: 800,
        height: 600,
        blurhash: "LEHV6nWB2yk8pyo0adR*.7kCMdnj",
        original_name: "photo.webp",
        mime_type: "image/webp",
      },
      tempDir,
    );
    expect(spec).toMatchObject({
      kind: "image",
      src: "/media/med-1.webp",
      srcFilePath: join(tempDir, "static/media/med-1.webp"),
      originalName: "photo.webp",
      mimeType: "image/webp",
      alt: "Alt text",
      width: 800,
      height: 600,
      blurhash: "LEHV6nWB2yk8pyo0adR*.7kCMdnj",
    });
  });

  it("mediaSpecFromJantMedia passes through absolute URLs without a disk lookup", async () => {
    const spec = await mediaSpecFromJantMedia(
      {
        id: "med-cdn",
        src: "https://cdn.example.com/media/med-cdn.webp",
        kind: "image",
      },
      tempDir,
    );
    expect(spec).toMatchObject({
      kind: "image",
      src: "https://cdn.example.com/media/med-cdn.webp",
      srcFilePath: null,
    });
  });

  it("mediaSpecFromJantMedia returns null when a relative src has no file on disk", async () => {
    const spec = await mediaSpecFromJantMedia(
      { id: "med-missing", src: "/media/nope.webp", kind: "image" },
      tempDir,
    );
    expect(spec).toBeNull();
  });

  it("uploadMediaList keys urlMap by the original body URL so rewrites actually match", async () => {
    await mkdir(join(tempDir, "static", "media"), { recursive: true });
    await writeFile(
      join(tempDir, "static/media/inline.png"),
      new Uint8Array([0]),
    );

    const target = {
      uploadMedia: async () => ({
        id: "med_new",
        url: "https://target.example/media/med_new.png",
      }),
    };

    const result = await uploadMediaList(
      [{ src: "/media/inline.png" }],
      target,
      { base_url: "https://origin.example/" },
      tempDir,
    );

    expect(result.uploaded).toBe(1);
    // The key must be the raw path that `findImageUrls` extracted from the
    // markdown AST (`/media/inline.png`) — otherwise `rewriteMediaReferences`
    // would never match and the post body would retain the old URL.
    expect(result.urlMap.get("/media/inline.png")).toBe(
      "https://target.example/media/med_new.png",
    );
  });

  it("isAbsoluteImportUrl distinguishes absolute URLs from relative paths for --skip-remote-media", () => {
    // Relative paths — always treated as the source site's own files.
    expect(isAbsoluteImportUrl("/media/foo.png")).toBe(false);
    expect(isAbsoluteImportUrl("./foo.png")).toBe(false);
    expect(isAbsoluteImportUrl("../foo.png")).toBe(false);
    expect(isAbsoluteImportUrl("foo.png")).toBe(false);
    // Absolute / scheme'd / protocol-relative URLs — treated as remote.
    expect(isAbsoluteImportUrl("https://example.com/foo.png")).toBe(true);
    expect(isAbsoluteImportUrl("http://example.com/foo.png")).toBe(true);
    expect(isAbsoluteImportUrl("HTTPS://Example.com/Foo.png")).toBe(true);
    expect(isAbsoluteImportUrl("//cdn.example.com/foo.png")).toBe(true);
    expect(isAbsoluteImportUrl("data:image/png;base64,AAA")).toBe(true);
    // Non-strings.
    expect(isAbsoluteImportUrl(undefined)).toBe(false);
    expect(isAbsoluteImportUrl(null)).toBe(false);
  });

  it("normalizeTextAttachmentSpec handles a kind:text entry from front matter media[]", async () => {
    await mkdir(join(tempDir, "static", "media", "files"), { recursive: true });
    await writeFile(
      join(tempDir, "static/media/files/note.md"),
      "# Note\n\nhello world",
    );

    const spec = await normalizeTextAttachmentSpec(
      {
        kind: "text",
        src: "/media/files/note.md",
        summary: "hello world",
        original_name: "note.md",
      },
      { base_url: "https://example.com/" },
      tempDir,
    );

    expect(spec).toEqual({
      type: "text",
      contentFormat: "markdown",
      content: "# Note\n\nhello world",
      summary: "hello world",
    });
  });

  it("resolveCollectionMemberships drops unknown slugs and converts timestamps to seconds", () => {
    const slugToId = new Map([["ideas", "col_known"]]);
    const fm = {
      collections: [
        {
          slug: "ideas",
          collected_at: "2026-03-06T08:00:00Z",
          position: 2,
          pinned_at: "2026-03-06T21:53:20Z",
        },
        { slug: "unknown", collected_at: "2026-03-06T08:00:00Z" },
      ],
    };
    const { entries, ids } = resolveCollectionMemberships(fm, slugToId);
    expect(ids).toEqual(["col_known"]);
    expect(entries).toEqual([
      {
        collectionId: "col_known",
        createdAt: Math.floor(
          new Date("2026-03-06T08:00:00Z").getTime() / 1000,
        ),
        position: 2,
        pinnedAt: Math.floor(new Date("2026-03-06T21:53:20Z").getTime() / 1000),
      },
    ]);
  });

  it("unions legacy per-post Collection metadata across a Thread", () => {
    const slugToId = new Map([
      ["ideas", "col_ideas"],
      ["walks", "col_walks"],
    ]);
    const rootBundle = {
      frontMatter: {
        collections: [
          {
            slug: "ideas",
            collected_at: "2026-03-01T00:00:00Z",
            position: 5,
            pinned_at: "2026-03-05T00:00:00Z",
          },
        ],
      },
      children: [
        {
          frontMatter: {
            collections: [
              {
                slug: "ideas",
                collected_at: "2026-03-03T00:00:00Z",
                position: 2,
                pinned_at: "2026-03-04T00:00:00Z",
              },
              {
                slug: "walks",
                collected_at: "2026-03-02T00:00:00Z",
                position: 7,
              },
            ],
          },
        },
      ],
    };

    expect(resolveThreadCollectionMemberships(rootBundle, slugToId)).toEqual({
      entries: [
        {
          collectionId: "col_ideas",
          createdAt: Date.parse("2026-03-03T00:00:00Z") / 1000,
          position: 2,
          pinnedAt: Date.parse("2026-03-05T00:00:00Z") / 1000,
        },
        {
          collectionId: "col_walks",
          createdAt: Date.parse("2026-03-02T00:00:00Z") / 1000,
          position: 7,
        },
      ],
      ids: ["col_ideas", "col_walks"],
    });
  });

  it("buildPostPayloadFromBundle translates front matter into createPost input", () => {
    const bundle = {
      slug: "hello",
      frontMatter: {
        id: "pst_root",
        title: "Hello",
        date: "2026-04-01T00:00:00Z",
        slug: "hello",
        type: "post",
        format: "note",
        status: "published",
        visibility: "public",
        featured_at: "2026-04-02T00:00:00Z",
        pinned_at: "2026-04-03T00:00:00Z",
        rating: 4,
      },
      body: "Body text",
    };
    const data = buildPostPayloadFromBundle(bundle, {
      bodyMarkdown: "Body text",
      attachments: [],
      memberships: { entries: [], ids: [] },
      replyToId: null,
    });
    expect(data).toMatchObject({
      format: "note",
      title: "Hello",
      slug: "hello",
      status: "published",
      bodyMarkdown: "Body text",
      publishedAt: Math.floor(
        new Date("2026-04-01T00:00:00Z").getTime() / 1000,
      ),
      featuredAt: Math.floor(new Date("2026-04-02T00:00:00Z").getTime() / 1000),
      pinnedAt: Math.floor(new Date("2026-04-03T00:00:00Z").getTime() / 1000),
      rating: 4,
    });
  });

  it("buildPostPayloadFromBundle emits quote-format fields with sourceName/url mapping", () => {
    const bundle = {
      slug: "from-basho",
      frontMatter: {
        id: "pst_q",
        slug: "from-basho",
        type: "post",
        format: "quote",
        status: "published",
        visibility: "public",
        source_name: "Basho",
        source_url: "https://example.com/basho",
        quote_text: "An old silent pond…",
        date: "2026-04-01T00:00:00Z",
      },
      body: "",
    };
    const data = buildPostPayloadFromBundle(bundle, {
      bodyMarkdown: "",
      attachments: [],
      memberships: { entries: [], ids: [] },
      replyToId: "pst_root",
    });
    expect(data).toMatchObject({
      format: "quote",
      title: "Basho",
      quoteText: "An old silent pond…",
      url: "https://example.com/basho",
      replyToId: "pst_root",
    });
  });

  it("buildPostPayloadFromBundle can mark imported replies as quiet", () => {
    const bundle = {
      slug: "reply-a",
      frontMatter: {
        id: "pst_reply",
        title: "Reply A",
        date: "2026-04-01T01:00:00Z",
        slug: "reply-a",
        type: "post",
        format: "note",
        status: "published",
        visibility: "public",
      },
      body: "Reply body",
    };
    const data = buildPostPayloadFromBundle(bundle, {
      bodyMarkdown: "Reply body",
      attachments: [],
      memberships: { entries: [], ids: [] },
      replyToId: "pst_root",
      quietReply: true,
    });

    expect(data).toMatchObject({
      replyToId: "pst_root",
      quietReply: true,
    });
  });

  it("buildPostPayloadFromBundle preserves every canonical visibility value", () => {
    const base = {
      slug: "hello",
      frontMatter: {
        id: "pst_x",
        title: "Hello",
        date: "2026-04-01T00:00:00Z",
        slug: "hello",
        type: "post",
        format: "note",
        status: "published",
      },
      body: "Body",
    };
    const payloadOptions = {
      bodyMarkdown: "Body",
      attachments: [],
      memberships: { entries: [], ids: [] },
      replyToId: null,
    };

    for (const visibility of ["public", "latest_hidden", "private"] as const) {
      const bundle = {
        ...base,
        frontMatter: { ...base.frontMatter, visibility },
      };
      const data = buildPostPayloadFromBundle(bundle, payloadOptions);
      expect(data.visibility).toBe(visibility);
    }

    // Unknown values fall through to undefined (service applies default).
    const fallback = buildPostPayloadFromBundle(
      { ...base, frontMatter: { ...base.frontMatter, visibility: "bogus" } },
      payloadOptions,
    );
    expect(fallback.visibility).toBeUndefined();
  });

  it("shouldImportReplyQuietly preserves exported thread activity cutoffs", () => {
    const rootFrontMatter = {
      date: "2026-04-01T00:00:00Z",
      last_activity_at: "2026-04-01T01:00:00Z",
    };

    expect(
      shouldImportReplyQuietly(rootFrontMatter, {
        date: "2026-04-01T00:30:00Z",
        status: "published",
      }),
    ).toBe(false);
    expect(
      shouldImportReplyQuietly(rootFrontMatter, {
        date: "2026-04-01T01:00:00Z",
        status: "published",
      }),
    ).toBe(false);
    expect(
      shouldImportReplyQuietly(rootFrontMatter, {
        date: "2026-04-01T02:00:00Z",
        status: "published",
      }),
    ).toBe(true);
  });

  it("shouldImportReplyQuietly falls back to root date for all-quiet threads", () => {
    const rootFrontMatter = {
      date: "2026-04-01T00:00:00Z",
    };

    expect(
      shouldImportReplyQuietly(rootFrontMatter, {
        date: "2026-04-01T01:00:00Z",
        status: "published",
      }),
    ).toBe(true);
    expect(
      shouldImportReplyQuietly(rootFrontMatter, {
        date: "2026-04-01T01:00:00Z",
        status: "draft",
      }),
    ).toBe(false);
  });

  it("getRootAliasPathsForImport prefers root_aliases and strips reply slugs", () => {
    // Reply slug paths are normalized (no trailing slash) to match the
    // return format of normalizeImportAliasPath.
    const replySlugPaths = new Set(["/reply-a"]);
    const paths = getRootAliasPathsForImport(
      ["/old-slug/", "/reply-a/", "/hello/"],
      ["/historic-slug/"],
      "hello",
      replySlugPaths,
    );
    expect(paths).toEqual(["/historic-slug"]);
  });

  it("getRootAliasPathsForImport falls back to aliases minus reply slugs when root_aliases is empty", () => {
    const replySlugPaths = new Set(["/reply-a"]);
    const paths = getRootAliasPathsForImport(
      ["/old-slug/", "/reply-a/", "/hello/"],
      [],
      "hello",
      replySlugPaths,
    );
    expect(paths).toEqual(["/old-slug"]);
  });
});
