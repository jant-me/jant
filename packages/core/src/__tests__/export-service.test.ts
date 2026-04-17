import { describe, expect, it } from "vitest";
import { unzipSync } from "fflate";
import { buildPostMarkdown, createExportService } from "../services/export.js";
import type { Collection, Media, Post } from "../types.js";

function decodeZipEntry(
  files: Record<string, Uint8Array>,
  path: string,
): string | null {
  const entry = files[path];
  return entry ? new TextDecoder().decode(entry) : null;
}

describe("createExportService", () => {
  it("exports collection metadata and includes archive fallback metadata", async () => {
    const rootPost: Post = {
      id: "post-1",
      format: "note",
      status: "published",
      visibility: "public",
      pinnedAt: null,
      featuredAt: null,
      slug: "desk-note",
      title: null,
      url: null,
      body: null,
      bodyHtml: null,
      bodyText:
        "Took the long way home because the light was good and the air finally felt like spring.",
      quoteText: null,
      summary:
        "Took the long way home because the light was good and the air finally felt like spring.",
      rating: null,
      previewImageKey: null,
      previewKind: null,
      previewProvider: null,
      replyToId: null,
      threadId: "post-1",
      deletedAt: null,
      publishedAt: 1773014400,
      lastActivityAt: 1773014400,
      createdAt: 1773014400,
      updatedAt: 1773014400,
    };

    const collection: Collection = {
      id: "collection-1",
      slug: "programming",
      title: "编程开发",
      description: "Posts about building and shipping software.",
      sortOrder: "newest",
      createdAt: 1773014400,
      updatedAt: 1773014400,
    };
    const directoryCollection = {
      ...collection,
      postCount: 1,
      recentActivityAt: 1773014400,
    };

    const services = {
      posts: {
        list: async () => [rootPost],
      },
      paths: {
        getPostSlugMap: async () => new Map([["post-1", "desk-note"]]),
        getPostAliases: async () => new Map([["post-1", []]]),
        getCollectionSlugMap: async () =>
          new Map([["collection-1", "programming"]]),
      },
      collections: {
        list: async () => [collection],
        listDirectoryData: async () => ({
          collections: [directoryCollection],
          items: [
            {
              id: "divider-1",
              type: "divider" as const,
              label: "Writing",
            },
            {
              id: "collection-item-1",
              type: "collection" as const,
              collection: directoryCollection,
            },
            {
              id: "link-1",
              type: "link" as const,
              label: "Elsewhere",
              url: "https://example.com/elsewhere",
            },
          ],
          directoryItems: [],
        }),
        getCollectionsByPostIds: async () =>
          new Map([["post-1", [collection]]]),
        getCollectionPinsByPostIds: async () => new Map(),
      },
      media: {
        getByPostIds: async () => new Map(),
      },
    } as unknown as Parameters<typeof createExportService>[0];

    const siteConfig: Parameters<typeof createExportService>[1] = {
      siteName: "Jant",
      siteUrl: "https://example.com",
      siteDescription: "Export test",
      siteLanguage: "zh-CN",
      showJantBrandingOnHome: true,
      homeDefaultView: "latest",

      siteFooter: "",
      showHeaderAvatar: false,
      siteAvatarUrl: "",
      themeId: "paper",
      defaultThemeId: "paper",
      fontThemeId: "system",
      defaultFontThemeId: "tufte",
      themeMode: "auto",
      noindex: false,
      navItems: [],
      pageSize: 50,
      archivePageSize: 50,
    };

    const zip = await createExportService(
      services,
      siteConfig,
    ).generateZolaSite();
    const files = unzipSync(zip);

    const configToml = decodeZipEntry(files, "config.toml");
    const collectionMetadata = decodeZipEntry(
      files,
      "content/programming/_index.md",
    );
    const postMarkdown = decodeZipEntry(files, "content/desk-note/index.md");
    const archiveTemplate = decodeZipEntry(
      files,
      "themes/jant/templates/archive.html",
    );
    const taxonomyListTemplate = decodeZipEntry(
      files,
      "themes/jant/templates/taxonomy_list.html",
    );
    const atomTemplate = decodeZipEntry(
      files,
      "themes/jant/templates/atom.xml",
    );
    const macrosTemplate = decodeZipEntry(
      files,
      "themes/jant/templates/macros.html",
    );
    const styleCss = decodeZipEntry(files, "themes/jant/static/style.css");
    const faviconFile = files["themes/jant/static/favicon.ico"];
    const appleTouchFile = files["themes/jant/static/apple-touch-icon.png"];
    const themeToml = decodeZipEntry(files, "themes/jant/theme.toml");

    expect(configToml).toContain('site_avatar_mode = "none"');
    expect(configToml).toContain('favicon_mode = "default"');
    expect(configToml).toContain('apple_touch_mode = "default"');
    expect(configToml).toContain("collections_directory_exported = true");
    expect(configToml).toContain("[[extra.jant.collections_directory]]");
    expect(configToml).toContain('type = "divider"');
    expect(configToml).toContain('label = "Writing"');
    expect(configToml).toContain('type = "collection"');
    expect(configToml).toContain('slug = "programming"');
    expect(configToml).toContain('title = "编程开发"');
    expect(configToml).toContain("entry_count = 1");
    expect(configToml).toContain('recent_activity_label = "2026-03-09"');
    expect(configToml).toContain('type = "link"');
    expect(configToml).toContain('url = "https://example.com/elsewhere"');
    expect(collectionMetadata).toContain('title = "编程开发"');
    expect(collectionMetadata).toContain(
      'description = "Posts about building and shipping software."',
    );
    expect(postMarkdown).toContain("summary_text:");
    expect(postMarkdown).not.toContain("archive_month:");
    expect(postMarkdown).not.toContain("archive_month_label:");
    expect(postMarkdown).toContain("  feed:");
    expect(postMarkdown).toContain('    - "public"');
    expect(postMarkdown).toContain('    - "archive"');
    expect(configToml).toContain('name = "feed"');
    expect(configToml).toContain("paginate_by = 50");
    expect(archiveTemplate).toContain('get_taxonomy(kind="feed")');
    expect(archiveTemplate).toContain('t.name == "archive"');
    expect(archiveTemplate).toContain("archive_pages | slice(end=page_size)");
    expect(archiveTemplate).toContain('href="/feed/archive/page/2/"');
    expect(archiveTemplate).not.toContain("latest_hidden");
    expect(taxonomyListTemplate).toContain(
      "config.extra.jant.collections_directory",
    );
    expect(taxonomyListTemplate).toContain(
      'class="collection-directory-divider"',
    );
    expect(taxonomyListTemplate).toContain(
      'class="collection-directory-divider-text"',
    );
    expect(taxonomyListTemplate).toContain(
      'class="collection-directory-item collection-directory-item-link"',
    );
    expect(taxonomyListTemplate).toContain("item.entry_count");
    expect(taxonomyListTemplate).toContain("item.recent_activity_label");
    expect(taxonomyListTemplate).toContain('href="/{{ item.slug }}"');
    expect(taxonomyListTemplate).toContain(
      "has_collection_page = entry_count != 0",
    );
    expect(taxonomyListTemplate).toContain('<ol class="collection-list">');
    expect(taxonomyListTemplate).toContain("collection-list-sequence");
    expect(taxonomyListTemplate).toContain("collection-list-title");
    expect(taxonomyListTemplate).toContain("term.pages | length");
    expect(taxonomyListTemplate).toContain("latest_page.updated");
    expect(macrosTemplate).toContain("first_collection = collections | first");
    expect(macrosTemplate).toContain(
      "hidden_collection_count = collection_count - 2",
    );
    expect(macrosTemplate).toContain("collection_count >= 2");
    expect(macrosTemplate).toContain("+{{ hidden_collection_count }}");
    expect(macrosTemplate).toContain("data-collection-popover-trigger");
    expect(macrosTemplate).toContain('class="post-collection-popover-item"');
    expect(macrosTemplate).toContain("post-body-summary");
    expect(styleCss).toContain(".collection-list-sequence::before");
    expect(styleCss).toContain(".collection-directory-sequence::before");
    expect(styleCss).toContain(".collection-directory-divider-line");
    expect(styleCss).toContain(".collection-directory-title-marker");
    expect(styleCss).toContain(
      ".post-collection-more-wrap:hover .post-collection-popover",
    );
    expect(styleCss).toContain(".post-collection-more-wrap::after");
    expect(styleCss).toContain(".site-header-top-home");
    expect(styleCss).toContain(".site-content-home");
    expect(styleCss).toContain(".post-body-summary.prose");
    expect(styleCss).toMatch(
      /\.site-content-home\s*\{[\s\S]*?padding-top: 0\.75rem;[\s\S]*?border-bottom: 0\.5px solid\s+color-mix\(in srgb, var\(--site-divider\) 84%, transparent\);/,
    );
    expect(atomTemplate).toContain('rel="self" type="application/atom+xml"');
    expect(atomTemplate).toContain('href="{{ feed_url | safe }}" />');
    expect(atomTemplate).toContain("page.extra.summary_text");
    expect(atomTemplate).toContain("<title>{{ entry_title }}</title>");
    expect(atomTemplate).not.toContain('default(value="Untitled")');
    expect(atomTemplate).toContain('<summary type="text">');
    expect(atomTemplate).toContain("&lt;p&gt;{{ entry_summary }}&lt;/p&gt;");
    expect(atomTemplate).not.toContain("page.content | safe");
    expect(atomTemplate).not.toContain('<summary type="html">{{ page.summary');
    expect(atomTemplate).not.toContain('<content type="html">{{ page.content');
    expect(faviconFile).toBeDefined();
    expect(faviconFile?.byteLength).toBeGreaterThan(0);
    expect(appleTouchFile).toBeDefined();
    expect(appleTouchFile?.byteLength).toBeGreaterThan(0);
    expect(configToml).toContain('theme = "jant"');
    expect(themeToml).toContain('name = "Jant"');
    // Legacy flat paths must not leak back in — Jant only writes under
    // themes/jant/ now; root templates/ and static/ belong to the user.
    expect(files["templates/base.html"]).toBeUndefined();
    expect(files["templates/archive.html"]).toBeUndefined();
    expect(files["templates/index.html"]).toBeUndefined();
    expect(files["static/style.css"]).toBeUndefined();
    expect(files["static/favicon.ico"]).toBeUndefined();
  });

  it("embeds markdown payloads for text attachments and renders preview markup", async () => {
    const rootPost: Post = {
      id: "post-1",
      format: "note",
      status: "published",
      visibility: "public",
      pinnedAt: null,
      featuredAt: null,
      slug: "desk-note",
      title: "Desk note",
      url: null,
      body: null,
      bodyHtml: null,
      bodyText: null,
      quoteText: null,
      summary: null,
      rating: null,
      previewImageKey: null,
      previewKind: null,
      previewProvider: null,
      replyToId: null,
      threadId: "post-1",
      deletedAt: null,
      publishedAt: 1773014400,
      lastActivityAt: 1773014400,
      createdAt: 1773014400,
      updatedAt: 1773014400,
    };

    const textAttachment: Media = {
      id: "media-1",
      postId: "post-1",
      filename: "media-1.md",
      originalName: "attached-text.md",
      mimeType: "text/markdown; charset=utf-8",
      size: 128,
      storageKey: "media/media-1.md",
      provider: "local",
      width: null,
      height: null,
      alt: null,
      position: "a0",
      blurhash: null,
      waveform: null,
      posterKey: null,
      summary: "Attached note",
      chars: 24,
      mediaKind: "text",
      createdAt: 1773014400,
      updatedAt: 1773014400,
    };

    const services = {
      posts: {
        list: async () => [rootPost],
      },
      paths: {
        getPostSlugMap: async () => new Map([["post-1", "desk-note"]]),
        getPostAliases: async () => new Map([["post-1", []]]),
        getCollectionSlugMap: async () => new Map(),
      },
      collections: {
        list: async () => [],
        getCollectionsByPostIds: async () => new Map([["post-1", []]]),
        getCollectionPinsByPostIds: async () => new Map(),
      },
      media: {
        getByPostIds: async () => new Map([["post-1", [textAttachment]]]),
      },
    } as unknown as Parameters<typeof createExportService>[0];

    const siteConfig: Parameters<typeof createExportService>[1] = {
      siteName: "Jant",
      siteUrl: "https://example.com",
      siteDescription: "Export test",
      siteLanguage: "en",
      showJantBrandingOnHome: true,
      homeDefaultView: "latest",

      siteFooter: "",
      showHeaderAvatar: false,
      siteAvatarUrl: "",
      themeId: "paper",
      defaultThemeId: "paper",
      fontThemeId: "system",
      defaultFontThemeId: "tufte",
      themeMode: "auto",
      noindex: false,
      navItems: [],
      pageSize: 50,
      archivePageSize: 50,
    };

    const zip = await createExportService(services, siteConfig, {
      storage: {} as never,
    }).generateZolaSite();
    const files = unzipSync(zip);
    const postMarkdown = decodeZipEntry(files, "content/desk-note/index.md");
    const styleCss = decodeZipEntry(files, "themes/jant/static/style.css");

    // Text attachments export as a card-shaped link to the public `.html`
    // artifact — file icon, summary, character count — not inline content.
    // Readers click through to view the pre-rendered page in a new tab.
    expect(postMarkdown).toContain('data-jant-kind="text"');
    expect(postMarkdown).toContain('"kind":"text"');
    expect(postMarkdown).toContain('"src":"');
    expect(postMarkdown).toContain('class="jant-attachment-card"');
    expect(postMarkdown).toContain('href="');
    expect(postMarkdown).toContain('target="_blank"');
    expect(postMarkdown).toContain('rel="noopener noreferrer"');
    expect(postMarkdown).toContain("media/media-1.md");
    expect(postMarkdown).toContain(
      '<span class="jant-attachment-card-summary">Attached note</span>',
    );
    expect(postMarkdown).toContain(
      '<span class="jant-attachment-card-meta">24 chars</span>',
    );
    expect(postMarkdown).toMatch(
      /<span class="jant-attachment-card-icon"><svg[^>]*>/,
    );

    // The old inline-envelope format is gone — no content embedding, no
    // server-side markdown rendering into the exported HTML.
    expect(postMarkdown).not.toContain('"contentFormat":"markdown"');
    expect(postMarkdown).not.toContain('"content":"');
    expect(postMarkdown).not.toContain("<details>");
    expect(postMarkdown).not.toContain("<summary>Attached note</summary>");

    // Styles for the old inline preview are also unnecessary; the card
    // styling lives under `.jant-attachment-card` instead.
    expect(styleCss).not.toContain(".jant-attachment-text-preview");
    expect(styleCss).toContain(".jant-attachment-card");
  });

  it("exports rendered site footer HTML and enables bottom footnotes in Zola", async () => {
    const rootPost: Post = {
      id: "post-1",
      format: "note",
      status: "published",
      visibility: "public",
      pinnedAt: null,
      featuredAt: null,
      slug: "desk-note",
      title: "Desk note",
      url: null,
      body: null,
      bodyHtml: null,
      bodyText: "Desk note",
      quoteText: null,
      summary: "Desk note",
      rating: null,
      previewImageKey: null,
      previewKind: null,
      previewProvider: null,
      replyToId: null,
      threadId: "post-1",
      deletedAt: null,
      publishedAt: 1773014400,
      lastActivityAt: 1773014400,
      createdAt: 1773014400,
      updatedAt: 1773014400,
    };

    const services = {
      posts: {
        list: async () => [rootPost],
      },
      paths: {
        getPostSlugMap: async () => new Map([["post-1", "desk-note"]]),
        getPostAliases: async () => new Map([["post-1", []]]),
        getCollectionSlugMap: async () => new Map(),
      },
      collections: {
        list: async () => [],
        getCollectionsByPostIds: async () => new Map([["post-1", []]]),
        getCollectionPinsByPostIds: async () => new Map(),
      },
      media: {
        getByPostIds: async () => new Map(),
      },
    } as unknown as Parameters<typeof createExportService>[0];

    const siteConfig: Parameters<typeof createExportService>[1] = {
      siteName: "Jant",
      siteUrl: "https://example.com",
      siteDescription: "Export test",
      siteLanguage: "en",
      showJantBrandingOnHome: true,
      homeDefaultView: "latest",

      siteFooter:
        "Read the [docs](https://example.com)[^1]\n\n[^1]: Footer note\n\n<script>alert(1)</script>",
      showHeaderAvatar: false,
      siteAvatarUrl: "",
      themeId: "paper",
      defaultThemeId: "paper",
      fontThemeId: "system",
      defaultFontThemeId: "tufte",
      themeMode: "auto",
      noindex: false,
      navItems: [],
      pageSize: 50,
      archivePageSize: 50,
    };

    const zip = await createExportService(
      services,
      siteConfig,
    ).generateZolaSite();
    const files = unzipSync(zip);
    const configToml = decodeZipEntry(files, "config.toml");

    expect(configToml).toContain("bottom_footnotes = true");
    expect(configToml).toContain(
      '<label for=\\"sn-1\\" class=\\"margin-toggle sidenote-number\\">',
    );
    expect(configToml).toContain(
      '<span class=\\"sidenote\\">Footer note</span>',
    );
    expect(configToml).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });

  it("exports custom favicon and apple-touch assets with explicit custom modes", async () => {
    const rootPost: Post = {
      id: "post-1",
      format: "note",
      status: "published",
      visibility: "public",
      pinnedAt: null,
      featuredAt: null,
      slug: "desk-note",
      title: "Desk note",
      url: null,
      body: null,
      bodyHtml: null,
      bodyText: "Desk note",
      quoteText: null,
      summary: "Desk note",
      rating: null,
      previewImageKey: null,
      previewKind: null,
      previewProvider: null,
      replyToId: null,
      threadId: "post-1",
      deletedAt: null,
      publishedAt: 1773014400,
      lastActivityAt: 1773014400,
      createdAt: 1773014400,
      updatedAt: 1773014400,
    };

    const customFaviconBytes = new Uint8Array([1, 2, 3, 4]);
    const customAppleTouchBytes = new Uint8Array([5, 6, 7, 8]);

    const services = {
      posts: {
        list: async () => [rootPost],
      },
      paths: {
        getPostSlugMap: async () => new Map([["post-1", "desk-note"]]),
        getPostAliases: async () => new Map([["post-1", []]]),
        getCollectionSlugMap: async () => new Map(),
      },
      collections: {
        list: async () => [],
        getCollectionsByPostIds: async () => new Map([["post-1", []]]),
        getCollectionPinsByPostIds: async () => new Map(),
      },
      media: {
        getByPostIds: async () => new Map(),
      },
    } as unknown as Parameters<typeof createExportService>[0];

    const siteConfig: Parameters<typeof createExportService>[1] = {
      siteName: "Jant",
      siteUrl: "https://example.com",
      siteDescription: "Export test",
      siteLanguage: "en",
      showJantBrandingOnHome: true,
      homeDefaultView: "latest",

      siteFooter: "",
      showHeaderAvatar: true,
      siteAvatarUrl: "https://example.com/media/avatar.webp",
      faviconIcoBase64: Buffer.from(customFaviconBytes).toString("base64"),
      appleTouchIconStorageKey: "site/apple-touch-icon.png",
      faviconVersion: "20260319",
      themeId: "paper",
      defaultThemeId: "paper",
      fontThemeId: "system",
      defaultFontThemeId: "tufte",
      themeMode: "auto",
      noindex: false,
      navItems: [],
      pageSize: 50,
      archivePageSize: 50,
    };

    const zip = await createExportService(services, siteConfig, {
      storage: {
        get: async (key: string) =>
          key === "site/apple-touch-icon.png"
            ? ({
                body: new Response(customAppleTouchBytes).body,
              } as never)
            : null,
      } as never,
    }).generateZolaSite();
    const files = unzipSync(zip);
    const configToml = decodeZipEntry(files, "config.toml");

    expect(configToml).toContain('site_avatar_mode = "custom"');
    expect(configToml).toContain('favicon_mode = "custom"');
    expect(configToml).toContain('apple_touch_mode = "custom"');
    expect(files["themes/jant/static/favicon.ico"]).toEqual(customFaviconBytes);
    expect(files["themes/jant/static/apple-touch-icon.png"]).toEqual(
      customAppleTouchBytes,
    );
  });

  it("falls back to the default apple-touch icon when the custom asset is unavailable", async () => {
    const rootPost: Post = {
      id: "post-1",
      format: "note",
      status: "published",
      visibility: "public",
      pinnedAt: null,
      featuredAt: null,
      slug: "desk-note",
      title: "Desk note",
      url: null,
      body: null,
      bodyHtml: null,
      bodyText: "Export should still succeed.",
      quoteText: null,
      summary: "Export should still succeed.",
      rating: null,
      previewImageKey: null,
      previewKind: null,
      previewProvider: null,
      replyToId: null,
      threadId: "post-1",
      deletedAt: null,
      publishedAt: 1773014400,
      lastActivityAt: 1773014400,
      createdAt: 1773014400,
      updatedAt: 1773014400,
    };

    const services = {
      posts: {
        list: async () => [rootPost],
      },
      paths: {
        getPostSlugMap: async () => new Map([["post-1", "desk-note"]]),
        getPostAliases: async () => new Map([["post-1", []]]),
        getCollectionSlugMap: async () => new Map(),
      },
      collections: {
        list: async () => [],
        getCollectionsByPostIds: async () => new Map([["post-1", []]]),
        getCollectionPinsByPostIds: async () => new Map(),
      },
      media: {
        getByPostIds: async () => new Map(),
      },
    } as unknown as Parameters<typeof createExportService>[0];

    const siteConfig: Parameters<typeof createExportService>[1] = {
      siteName: "Jant",
      siteUrl: "https://example.com",
      siteDescription: "Export test",
      siteLanguage: "en",
      showJantBrandingOnHome: true,
      homeDefaultView: "latest",

      siteFooter: "",
      showHeaderAvatar: false,
      siteAvatarUrl: "",
      appleTouchIconStorageKey: "site/missing-apple-touch-icon.png",
      themeId: "paper",
      defaultThemeId: "paper",
      fontThemeId: "system",
      defaultFontThemeId: "tufte",
      themeMode: "auto",
      noindex: false,
      navItems: [],
      pageSize: 50,
      archivePageSize: 50,
    };

    const zip = await createExportService(services, siteConfig, {
      storage: {
        get: async () => null,
      } as never,
    }).generateZolaSite();
    const files = unzipSync(zip);
    const configToml = decodeZipEntry(files, "config.toml");
    const appleTouchFile = files["themes/jant/static/apple-touch-icon.png"];

    expect(configToml).toContain('apple_touch_mode = "default"');
    expect(appleTouchFile).toBeDefined();
    expect(appleTouchFile?.byteLength).toBeGreaterThan(0);
  });

  it("quotes numeric-looking titles in exported front matter", async () => {
    const rootPost: Post = {
      id: "post-numeric-title",
      format: "note",
      status: "published",
      visibility: "public",
      pinnedAt: null,
      featuredAt: null,
      slug: "numbers-only",
      title: "22222",
      url: null,
      body: null,
      bodyHtml: null,
      bodyText: "Numbers as a title should stay a string.",
      quoteText: null,
      summary: "Numbers as a title should stay a string.",
      rating: null,
      previewImageKey: null,
      previewKind: null,
      previewProvider: null,
      replyToId: null,
      threadId: "post-numeric-title",
      deletedAt: null,
      publishedAt: 1773014400,
      lastActivityAt: 1773014400,
      createdAt: 1773014400,
      updatedAt: 1773014400,
    };

    const services = {
      posts: {
        list: async () => [rootPost],
      },
      paths: {
        getPostSlugMap: async () =>
          new Map([["post-numeric-title", "numbers-only"]]),
        getPostAliases: async () => new Map([["post-numeric-title", []]]),
        getCollectionSlugMap: async () => new Map(),
      },
      collections: {
        list: async () => [],
        getCollectionsByPostIds: async () =>
          new Map([["post-numeric-title", []]]),
        getCollectionPinsByPostIds: async () => new Map(),
      },
      media: {
        getByPostIds: async () => new Map(),
      },
    } as unknown as Parameters<typeof createExportService>[0];

    const siteConfig: Parameters<typeof createExportService>[1] = {
      siteName: "Jant",
      siteUrl: "https://example.com",
      siteDescription: "Export test",
      siteLanguage: "en",
      showJantBrandingOnHome: true,
      homeDefaultView: "latest",

      siteFooter: "",
      showHeaderAvatar: false,
      siteAvatarUrl: "",
      themeId: "paper",
      defaultThemeId: "paper",
      fontThemeId: "system",
      defaultFontThemeId: "tufte",
      themeMode: "auto",
      noindex: false,
      navItems: [],
      pageSize: 50,
      archivePageSize: 50,
    };

    const zip = await createExportService(
      services,
      siteConfig,
    ).generateZolaSite();
    const files = unzipSync(zip);
    const postMarkdown = decodeZipEntry(files, "content/numbers-only/index.md");

    expect(postMarkdown).toContain('title: "22222"');
  });

  it("exports quote posts with source_name and source_url instead of title", async () => {
    const rootPost: Post = {
      id: "post-quote-1",
      format: "quote",
      status: "published",
      visibility: "public",
      pinnedAt: null,
      featuredAt: null,
      slug: "from-marcus-aurelius",
      title: "Marcus Aurelius",
      url: "https://example.com/meditations",
      body: null,
      bodyHtml: null,
      bodyText: "A short note about the quote.",
      quoteText: "What stands in the way becomes the way.",
      summary: "What stands in the way becomes the way.",
      rating: null,
      previewImageKey: null,
      previewKind: null,
      previewProvider: null,
      replyToId: null,
      threadId: "post-quote-1",
      deletedAt: null,
      publishedAt: 1773014400,
      lastActivityAt: 1773014400,
      createdAt: 1773014400,
      updatedAt: 1773014400,
    };

    const services = {
      posts: {
        list: async () => [rootPost],
      },
      paths: {
        getPostSlugMap: async () =>
          new Map([["post-quote-1", "from-marcus-aurelius"]]),
        getPostAliases: async () => new Map([["post-quote-1", []]]),
        getCollectionSlugMap: async () => new Map(),
      },
      collections: {
        list: async () => [],
        getCollectionsByPostIds: async () => new Map([["post-quote-1", []]]),
        getCollectionPinsByPostIds: async () => new Map(),
      },
      media: {
        getByPostIds: async () => new Map(),
      },
    } as unknown as Parameters<typeof createExportService>[0];

    const siteConfig: Parameters<typeof createExportService>[1] = {
      siteName: "Jant",
      siteUrl: "https://example.com",
      siteDescription: "Export test",
      siteLanguage: "en",
      showJantBrandingOnHome: true,
      homeDefaultView: "latest",

      siteFooter: "",
      showHeaderAvatar: false,
      siteAvatarUrl: "",
      themeId: "paper",
      defaultThemeId: "paper",
      fontThemeId: "system",
      defaultFontThemeId: "tufte",
      themeMode: "auto",
      noindex: false,
      navItems: [],
      pageSize: 50,
      archivePageSize: 50,
    };

    const zip = await createExportService(
      services,
      siteConfig,
    ).generateZolaSite();
    const files = unzipSync(zip);
    const postMarkdown = decodeZipEntry(
      files,
      "content/from-marcus-aurelius/index.md",
    );
    const macrosTemplate = decodeZipEntry(
      files,
      "themes/jant/templates/macros.html",
    );

    expect(postMarkdown).not.toContain("\ntitle:");
    expect(postMarkdown).toContain("source_name:");
    expect(postMarkdown).toContain("source_url:");
    expect(postMarkdown).toContain("quote_text:");
    expect(postMarkdown).not.toContain("link_url:");
    expect(macrosTemplate).toContain("page.extra.source_name");
    expect(macrosTemplate).toContain("page.extra.source_url");
  });

  it("separates root aliases from reply route aliases in exported front matter", async () => {
    const rootPost: Post = {
      id: "post-1",
      format: "note",
      status: "published",
      visibility: "public",
      pinnedAt: null,
      featuredAt: null,
      slug: "thread-root",
      title: "Thread root",
      url: null,
      body: null,
      bodyHtml: null,
      bodyText: "Root body",
      quoteText: null,
      summary: "Root body",
      rating: null,
      previewImageKey: null,
      previewKind: null,
      previewProvider: null,
      replyToId: null,
      threadId: "post-1",
      deletedAt: null,
      publishedAt: 1773014400,
      lastActivityAt: 1773014400,
      createdAt: 1773014400,
      updatedAt: 1773014400,
    };

    const replyPost: Post = {
      ...rootPost,
      id: "post-2",
      slug: "thread-reply",
      title: null,
      replyToId: "post-1",
      threadId: "post-1",
      createdAt: 1773100800,
      updatedAt: 1773100800,
      publishedAt: 1773100800,
      lastActivityAt: 1773100800,
    };

    const services = {
      posts: {
        list: async () => [rootPost, replyPost],
      },
      paths: {
        getPostSlugMap: async () =>
          new Map([
            ["post-1", "thread-root"],
            ["post-2", "thread-reply"],
          ]),
        getPostAliases: async () => new Map([["post-1", ["/older-root"]]]),
        getCollectionSlugMap: async () => new Map(),
      },
      collections: {
        list: async () => [],
        getCollectionsByPostIds: async () => new Map([["post-1", []]]),
        getCollectionPinsByPostIds: async () => new Map(),
      },
      media: {
        getByPostIds: async () => new Map(),
      },
    } as unknown as Parameters<typeof createExportService>[0];

    const siteConfig: Parameters<typeof createExportService>[1] = {
      siteName: "Jant",
      siteUrl: "https://example.com",
      siteDescription: "Export test",
      siteLanguage: "en",
      showJantBrandingOnHome: true,
      homeDefaultView: "latest",

      siteFooter: "",
      showHeaderAvatar: false,
      siteAvatarUrl: "",
      themeId: "paper",
      defaultThemeId: "paper",
      fontThemeId: "system",
      defaultFontThemeId: "tufte",
      themeMode: "auto",
      noindex: false,
      navItems: [],
      pageSize: 50,
      archivePageSize: 50,
    };

    const zip = await createExportService(
      services,
      siteConfig,
    ).generateZolaSite();
    const files = unzipSync(zip);
    const postMarkdown = decodeZipEntry(files, "content/thread-root/index.md");

    expect(postMarkdown).toContain("aliases:");
    expect(postMarkdown).toContain('  - "/older-root"');
    expect(postMarkdown).toContain('  - "/thread-reply"');
    expect(postMarkdown).toContain("  jant:");
    expect(postMarkdown).toContain("    root_aliases:");
    expect(postMarkdown).toContain('      - "/older-root"');
    expect(postMarkdown).not.toContain('      - "/thread-reply"');
  });

  it("emits feed taxonomy values per visibility", () => {
    const basePost: Post = {
      id: "post-1",
      format: "note",
      status: "published",
      visibility: "public",
      pinnedAt: null,
      featuredAt: null,
      slug: "hello",
      title: null,
      url: null,
      body: null,
      bodyHtml: null,
      bodyText: "hi",
      quoteText: null,
      summary: "hi",
      rating: null,
      previewImageKey: null,
      previewKind: null,
      previewProvider: null,
      replyToId: null,
      threadId: "post-1",
      deletedAt: null,
      publishedAt: 1773014400,
      lastActivityAt: 1773014400,
      createdAt: 1773014400,
      updatedAt: 1773014400,
    };

    const siteConfig: Parameters<typeof buildPostMarkdown>[8] = {
      siteName: "Jant",
      siteUrl: "https://example.com",
      siteDescription: "",
      siteLanguage: "zh-CN",
      showJantBrandingOnHome: true,
      homeDefaultView: "latest",
      siteFooter: "",
      showHeaderAvatar: false,
      siteAvatarUrl: "",
      themeId: "paper",
      defaultThemeId: "paper",
      fontThemeId: "system",
      themeMode: "auto",
      noindex: false,
      navItems: [],
      pageSize: 50,
      archivePageSize: 50,
    };
    const callBuild = (post: Post): string =>
      buildPostMarkdown(
        post,
        [],
        [],
        { rootAliases: [], zolaAliases: [] },
        new Map([[post.id, post.slug]]),
        new Map(),
        [],
        new Map(),
        siteConfig,
      );

    const publicMd = callBuild(basePost);
    expect(publicMd).toContain("taxonomies:");
    expect(publicMd).toContain("  feed:");
    expect(publicMd).toContain('    - "public"');
    expect(publicMd).toContain('    - "archive"');
    expect(publicMd).not.toContain('    - "pinned"');
    expect(publicMd).not.toContain('    - "unlisted"');

    const pinnedMd = callBuild({ ...basePost, pinnedAt: 1773014400 });
    expect(pinnedMd).toContain("  feed:");
    expect(pinnedMd).toContain('    - "pinned"');
    expect(pinnedMd).toContain('    - "archive"');
    expect(pinnedMd).not.toContain('    - "public"');

    const latestHiddenMd = callBuild({
      ...basePost,
      visibility: "latest_hidden",
    });
    expect(latestHiddenMd).toContain("  feed:");
    expect(latestHiddenMd).toContain('    - "unlisted"');
    expect(latestHiddenMd).not.toContain('    - "public"');
    expect(latestHiddenMd).not.toContain('    - "archive"');

    const privateMd = callBuild({ ...basePost, visibility: "private" });
    expect(privateMd).not.toContain("  feed:");
    expect(privateMd).toContain("draft: true");
  });
});
