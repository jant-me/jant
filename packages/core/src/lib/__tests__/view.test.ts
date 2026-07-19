/**
 * View Model Conversion Tests
 */

import { describe, it, expect } from "vitest";
import {
  toPostView,
  toPostViews,
  toMediaView,
  toNavItemView,
  toNavItemViews,
  toSearchResultView,
  toArchiveGroups,
} from "../view.js";
import type { MediaContext } from "../view.js";
import type {
  PostWithMedia,
  Media,
  NavItem,
  SearchResult,
  Post,
} from "../../types.js";
import { renderTiptapJson } from "../tiptap-render.js";
const EMPTY_CTX: MediaContext = {};
const CTX_WITH_URLS: MediaContext = {
  r2PublicUrl: "https://cdn.example.com",
  imageTransformUrl: "https://example.com/cdn-cgi/image",
};

// TypeID-like constants for test fixtures
const UUID_1 = "019cb943-b2c0-76e3-ade2-209415e74da5";
const UUID_2 = "019cb943-b2c0-76e3-ade2-209415e74da6";
const UUID_3 = "019cb943-b2c0-76e3-ade2-209415e74da7";
const UUID_POST = "019cb943-c000-7000-8000-000000000001";
const UUID_NAV_1 = "019cb943-d000-7000-8000-000000000001";
const UUID_NAV_2 = "019cb943-d000-7000-8000-000000000002";
const UUID_NAV_3 = "019cb943-d000-7000-8000-000000000003";

function makePost(overrides: Partial<Post> = {}): Post {
  return {
    id: UUID_1,
    format: "note",
    status: "published",
    visibility: "public" as const,
    pinnedAt: null,
    featuredAt: null,
    slug: "test-post",
    title: null,
    url: null,
    body: "Hello world",
    bodyHtml: "<p>Hello world</p>",
    bodyText: null,
    quoteText: null,
    summary: null,
    rating: null,
    previewImageKey: null,
    previewKind: null,
    previewProvider: null,
    replyToId: null,
    threadId: UUID_1,
    publishedAt: 1706745600, // 2024-02-01T00:00:00Z
    createdAt: 1706745600,
    updatedAt: 1706745600,
    ...overrides,
  };
}

function makePostWithMedia(
  overrides: Partial<PostWithMedia> = {},
): PostWithMedia {
  return {
    ...makePost(overrides),
    mediaAttachments: overrides.mediaAttachments ?? [],
  };
}

function makeMedia(overrides: Partial<Media> = {}): Media {
  return {
    id: "01902a9f-1a2b-7c3d",
    siteId: "sit_test00000000000000000000000",
    postId: UUID_1,
    filename: "image.webp",
    originalName: "photo.jpg",
    mimeType: "image/webp",
    size: 12345,
    storageKey: "media/01902a9f-1a2b-7c3d.webp",
    provider: "r2",
    width: 1920,
    height: 1080,
    durationSeconds: null,
    alt: "A photo",
    position: "a0",
    blurhash: null,
    waveform: null,
    posterKey: null,
    summary: null,
    chars: null,
    mediaKind: "image",
    createdAt: 1706745600,
    updatedAt: 1706745600,
    ...overrides,
  };
}

function makeNavItem(overrides: Partial<NavItem> = {}): NavItem {
  return {
    id: UUID_NAV_1,
    type: "link",
    systemKey: undefined,
    label: "Home",
    url: "/",
    position: "a0",
    createdAt: 1706745600,
    updatedAt: 1706745600,
    ...overrides,
  };
}

// =============================================================================
// toPostView
// =============================================================================

describe("toPostView", () => {
  it("generates permalink from slug", () => {
    const post = makePostWithMedia({ id: UUID_POST, slug: "my-post" });
    const view = toPostView(post, EMPTY_CTX);
    expect(view.permalink).toBe("/my-post");
    expect(view.slug).toBe("my-post");
  });

  it("formats dates correctly", () => {
    const post = makePostWithMedia({ publishedAt: 1706745600 });
    const view = toPostView(post, EMPTY_CTX);
    expect(view.publishedAt).toBe("2024-02-01T00:00:00.000Z");
    expect(view.publishedAtFormatted).toBe("Feb 1, 2024");
  });

  it("generates summary and excerpt from plain-text preview content", () => {
    const shortBody = "Short text";
    const longBody = "A".repeat(200);

    const shortView = toPostView(
      makePostWithMedia({ bodyText: shortBody }),
      EMPTY_CTX,
    );
    expect(shortView.summary).toBe("Short text");
    expect(shortView.excerpt).toBe("Short text");

    const longView = toPostView(
      makePostWithMedia({ bodyText: longBody }),
      EMPTY_CTX,
    );
    expect(longView.summary).toBe(longBody);
    expect(longView.excerpt).toBe("A".repeat(160) + "...");
  });

  it("computes summaryHtml for posts with title and body", () => {
    const body = JSON.stringify({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "Short article body" }],
        },
      ],
    });
    const view = toPostView(
      makePostWithMedia({
        title: "My Article",
        body,
        bodyHtml: "<p>Short article body</p>",
      }),
      EMPTY_CTX,
    );
    expect(view.summaryHtml).toBe("<p>Short article body</p>");
    expect(view.summaryHasMore).toBe(false);
  });

  it("truncates summaryHtml for long articles", () => {
    const textA = "A".repeat(300);
    const textB = "B".repeat(300);
    const body = JSON.stringify({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: textA }],
        },
        {
          type: "paragraph",
          content: [{ type: "text", text: textB }],
        },
      ],
    });
    const p1 = `<p>${textA}</p>`;
    const p2 = `<p>${textB}</p>`;
    const view = toPostView(
      makePostWithMedia({
        title: "Long Article",
        body,
        bodyHtml: p1 + p2,
      }),
      EMPTY_CTX,
    );
    expect(view.summaryHtml).toBe(p1);
    expect(view.summaryHasMore).toBe(true);
  });

  it("injects #continue anchor at the block boundary when body has a leading <hr>", () => {
    // Regression: structural nodes like `horizontalRule` appear in bodyHtml
    // but are excluded from the summary. Slicing bodyHtml by summary.length
    // landed mid-tag (e.g. inside </h2>), producing corrupted markup like
    // `<h2>...&lt;<span id="continue"></span>/h2&gt;`.
    const textA = "A".repeat(300);
    const textB = "B".repeat(300);
    const body = JSON.stringify({
      type: "doc",
      content: [
        { type: "horizontalRule" },
        {
          type: "paragraph",
          content: [{ type: "text", text: textA }],
        },
        {
          type: "paragraph",
          content: [{ type: "text", text: textB }],
        },
      ],
    });
    const p1 = `<p>${textA}</p>`;
    const p2 = `<p>${textB}</p>`;
    const bodyHtml = `<hr>${p1}${p2}`;
    const view = toPostView(
      makePostWithMedia({ title: "Article", body, bodyHtml }),
      EMPTY_CTX,
    );
    expect(view.summaryHasMore).toBe(true);
    expect(view.bodyHtml).toBe(`<hr>${p1}<span id="continue"></span>${p2}`);
    // Must not corrupt tags by splitting them mid-character.
    expect(view.bodyHtml).not.toContain("&lt;");
    expect(view.bodyHtml).not.toContain("&gt;");
  });

  it("places the #continue anchor at the moreBreak boundary", () => {
    const body = JSON.stringify({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "Lead" }],
        },
        { type: "moreBreak" },
        {
          type: "paragraph",
          content: [{ type: "text", text: "Rest" }],
        },
      ],
    });
    const view = toPostView(
      makePostWithMedia({
        title: "Article",
        body,
        bodyHtml: "<p>Lead</p><!--more--><p>Rest</p>",
      }),
      EMPTY_CTX,
    );
    expect(view.summaryHasMore).toBe(true);
    // The anchor sits at the summary boundary. The `<!--more-->` marker is an
    // inert HTML comment, so it's fine to keep in the post-anchor body.
    expect(view.bodyHtml).toBe(
      '<p>Lead</p><span id="continue"></span><!--more--><p>Rest</p>',
    );
  });

  it("places the summary boundary after a footnote repeated in the hidden tail", () => {
    const firstText = "A".repeat(300);
    const secondText = "B".repeat(300);
    const body = JSON.stringify({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: firstText },
            { type: "footnoteReference", attrs: { label: "shared" } },
          ],
        },
        {
          type: "paragraph",
          content: [
            { type: "text", text: secondText },
            { type: "footnoteReference", attrs: { label: "shared" } },
          ],
        },
        {
          type: "footnoteDefinition",
          attrs: { label: "shared" },
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "Shared definition" }],
            },
          ],
        },
      ],
    });
    const bodyHtml = renderTiptapJson(body, { namespace: UUID_1 });
    const view = toPostView(
      makePostWithMedia({ title: "Article", body, bodyHtml }),
      EMPTY_CTX,
    );

    expect(view.summaryHasMore).toBe(true);
    const markerIndex = view.bodyHtml?.indexOf('<span id="continue"></span>');
    expect(markerIndex).toBeGreaterThan(
      view.bodyHtml?.indexOf(firstText) ?? -1,
    );
    expect(markerIndex).toBeLessThan(view.bodyHtml?.indexOf(secondText) ?? -1);
    expect(view.bodyHtml).toContain('href="#fnref-1jp3895hp1ag7-1-2"');
    expect(view.bodyHtml).not.toContain("footnote-document");
    expect(view.bodyHtml?.match(/<ol class="footnote-list">/g)).toHaveLength(1);
    expect(view.bodyHtml?.indexOf("Shared definition")).toBeGreaterThan(
      view.bodyHtml?.indexOf(secondText) ?? -1,
    );
  });

  it("does not attach summaryHtml for short untitled notes", () => {
    const body = JSON.stringify({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Just a note" }] },
      ],
    });
    const view = toPostView(
      makePostWithMedia({
        title: null,
        body,
        bodyHtml: "<p>Just a note</p>",
      }),
      EMPTY_CTX,
    );
    // Untitled notes render their body in full unless it is long enough to
    // truncate, so a short note carries no summary.
    expect(view.summaryHtml).toBeUndefined();
    expect(view.summaryHasMore).toBeUndefined();
  });

  it("marks the summary boundary on long untitled notes", () => {
    const textA = "A".repeat(1000);
    const textB = "B".repeat(1000);
    const body = JSON.stringify({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: textA }] },
        { type: "paragraph", content: [{ type: "text", text: textB }] },
      ],
    });
    const p1 = `<p>${textA}</p>`;
    const p2 = `<p>${textB}</p>`;
    const view = toPostView(
      makePostWithMedia({ title: null, body, bodyHtml: p1 + p2 }),
      EMPTY_CTX,
    );
    // Untitled notes carry no excerpt — the card renders the full body and the
    // marker tells the feed where to clamp the tail for expand-in-place.
    expect(view.summaryHtml).toBeUndefined();
    expect(view.summaryHasMore).toBe(true);
    expect(view.bodyHtml).toBe(`${p1}<span data-note-break></span>${p2}`);
  });

  it("uses the larger untitled limits before truncating", () => {
    // Seven ~100-char blocks (700 chars) fit the note limits (10 blocks /
    // 1500 chars) but would have exceeded the old article limits (5 / 500).
    const texts = Array.from({ length: 7 }, (_, i) => `${i}`.padEnd(100, "x"));
    const body = JSON.stringify({
      type: "doc",
      content: texts.map((text) => ({
        type: "paragraph",
        content: [{ type: "text", text }],
      })),
    });
    const view = toPostView(
      makePostWithMedia({
        title: null,
        body,
        bodyHtml: texts.map((t) => `<p>${t}</p>`).join(""),
      }),
      EMPTY_CTX,
    );
    expect(view.summaryHtml).toBeUndefined();
    expect(view.summaryHasMore).toBeUndefined();
  });

  it("does not truncate an untitled note to hide a tiny tail", () => {
    const body = JSON.stringify({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "A".repeat(1400) }],
        },
        {
          type: "paragraph",
          content: [{ type: "text", text: "B".repeat(150) }],
        },
      ],
    });
    const view = toPostView(
      makePostWithMedia({
        title: null,
        body,
        bodyHtml: `<p>${"A".repeat(1400)}</p><p>${"B".repeat(150)}</p>`,
      }),
      EMPTY_CTX,
    );
    expect(view.summaryHtml).toBeUndefined();
    expect(view.summaryHasMore).toBeUndefined();
  });

  it("honors moreBreak on untitled notes regardless of tail size", () => {
    const body = JSON.stringify({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Lead" }] },
        { type: "moreBreak" },
        { type: "paragraph", content: [{ type: "text", text: "tiny" }] },
      ],
    });
    const view = toPostView(
      makePostWithMedia({
        title: null,
        body,
        bodyHtml: "<p>Lead</p><!--more--><p>tiny</p>",
      }),
      EMPTY_CTX,
    );
    expect(view.summaryHtml).toBeUndefined();
    expect(view.summaryHasMore).toBe(true);
    expect(view.bodyHtml).toBe(
      "<p>Lead</p><span data-note-break></span><!--more--><p>tiny</p>",
    );
  });

  it("does not compute summaryHtml for posts without body", () => {
    const view = toPostView(
      makePostWithMedia({
        title: "Title Only",
        body: null,
        bodyHtml: null,
      }),
      EMPTY_CTX,
    );
    expect(view.summaryHtml).toBeUndefined();
    expect(view.summaryHasMore).toBeUndefined();
  });

  it("handles null body gracefully", () => {
    const view = toPostView(
      makePostWithMedia({ body: null, bodyHtml: null }),
      EMPTY_CTX,
    );
    expect(view.summary).toBeUndefined();
    expect(view.excerpt).toBeUndefined();
    expect(view.bodyHtml).toBeUndefined();
    expect(view.body).toBeUndefined();
  });

  it("converts null fields to undefined", () => {
    const view = toPostView(makePostWithMedia(), EMPTY_CTX);
    expect(view.title).toBeUndefined();
    expect(view.slug).toBe("test-post");
    expect(view.url).toBeUndefined();
    expect(view.summary).toBe("Hello world");
    expect(view.quoteText).toBeUndefined();
    expect(view.rating).toBeUndefined();
    expect(view.replyToId).toBeUndefined();
    expect(view.threadRootId).toBeUndefined();
  });

  it("preserves non-null url field", () => {
    const view = toPostView(
      makePostWithMedia({
        url: "https://example.com",
      }),
      EMPTY_CTX,
    );
    expect(view.url).toBe("https://example.com");
  });

  it("preserves non-null quoteText field", () => {
    const view = toPostView(
      makePostWithMedia({
        format: "quote",
        quoteText: "Something wise",
      }),
      EMPTY_CTX,
    );
    expect(view.summary).toBe("Something wise");
    expect(view.quoteText).toBe("Something wise");
  });

  it("maps format, status, visibility, pinned, and featured correctly", () => {
    const view = toPostView(
      makePostWithMedia({
        format: "link",
        status: "draft",
        visibility: "public",
        pinnedAt: 1706745600,
        featuredAt: 1706745600,
      }),
      EMPTY_CTX,
    );
    expect(view.format).toBe("link");
    expect(view.status).toBe("draft");
    expect(view.visibility).toBe("public");
    expect(view.pinned).toBe(true);
    expect(view.featured).toBe(true);
    expect(view.featuredAt).toBe("2024-02-01T00:00:00.000Z");
    expect(view.featuredAtFormatted).toBe("Feb 1, 2024");
    expect(view.featuredAtTime).toBe("00:00");
  });

  it("formats published and featured timestamps in the configured site timezone", () => {
    const post = makePostWithMedia({
      publishedAt: 1706747400,
      featuredAt: 1706747400,
    });
    const view = toPostView(post, { timeZone: "America/New_York" });

    expect(view.publishedAtFormatted).toBe("Jan 31, 2024");
    expect(view.publishedAtTime).toBe("19:30");
    expect(view.publishedAtRelative).toBeDefined();
    expect(view.featuredAtFormatted).toBe("Jan 31, 2024");
    expect(view.featuredAtTime).toBe("19:30");
  });

  it("maps default visibility and pinnedAt=null", () => {
    const view = toPostView(
      makePostWithMedia({
        visibility: "public",
        pinnedAt: null,
      }),
      EMPTY_CTX,
    );
    expect(view.visibility).toBe("public");
    expect(view.pinned).toBe(false);
  });

  it("preserves rating when set", () => {
    const view = toPostView(
      makePostWithMedia({
        rating: 5,
      }),
      EMPTY_CTX,
    );
    expect(view.rating).toBe(5);
  });

  it("converts media attachments to MediaView", () => {
    const view = toPostView(
      makePostWithMedia({
        mediaAttachments: [
          {
            id: "abc",
            url: "/media/abc.webp",
            previewUrl: "/media/abc-thumb.webp",
            alt: "Photo",
            blurhash: null,
            posterUrl: null,
            width: 800,
            height: 600,
            durationSeconds: null,
            position: "a0",
            mimeType: "image/webp",
            originalName: "photo.jpg",
            size: 5000,
            summary: null,
            chars: null,
          },
        ],
      }),
      EMPTY_CTX,
    );
    expect(view.media).toHaveLength(1);
    expect(view.media[0]).toEqual({
      id: "abc",
      url: "/media/abc.webp",
      thumbnailUrl: "/media/abc-thumb.webp",
      mimeType: "image/webp",
      altText: "Photo",
      width: 800,
      height: 600,
      durationSeconds: undefined,
      blurhash: undefined,
      posterUrl: undefined,
      originalName: "photo.jpg",
      size: 5000,
      summary: undefined,
      chars: undefined,
    });
  });

  it("passes blurhash from media attachments to MediaView", () => {
    const view = toPostView(
      makePostWithMedia({
        mediaAttachments: [
          {
            id: "abc",
            url: "/media/abc.webp",
            previewUrl: "/media/abc-thumb.webp",
            alt: null,
            blurhash: "LEHV6nWB2yk8pyo0adR*.7kCMdnj",
            posterUrl: null,
            width: 800,
            height: 600,
            durationSeconds: null,
            position: "a0",
            mimeType: "image/webp",
            originalName: "photo.jpg",
            size: 5000,
            summary: null,
            chars: null,
          },
        ],
      }),
      EMPTY_CTX,
    );
    expect(view.media[0]?.blurhash).toBe("LEHV6nWB2yk8pyo0adR*.7kCMdnj");
  });
});

describe("toPostViews", () => {
  it("converts multiple posts", () => {
    const posts = [
      makePostWithMedia({ id: UUID_1 }),
      makePostWithMedia({ id: UUID_2 }),
    ];
    const views = toPostViews(posts, EMPTY_CTX);
    expect(views).toHaveLength(2);
    expect(views[0]).toHaveProperty("id", UUID_1);
    expect(views[1]).toHaveProperty("id", UUID_2);
  });
});

// =============================================================================
// toMediaView
// =============================================================================

describe("toMediaView", () => {
  it("generates local proxy URL without public URL", () => {
    const media = makeMedia();
    const view = toMediaView(media, EMPTY_CTX);
    expect(view.url).toBe("/media/01902a9f-1a2b-7c3d.webp");
    expect(view.thumbnailUrl).toBe("/media/01902a9f-1a2b-7c3d.webp");
  });

  it("generates CDN URL with public URL", () => {
    const media = makeMedia();
    const view = toMediaView(media, CTX_WITH_URLS);
    expect(view.url).toBe(
      "https://cdn.example.com/media/01902a9f-1a2b-7c3d.webp",
    );
    expect(view.thumbnailUrl).toContain("cdn-cgi/image");
  });

  it("uses S3 URL for s3 provider", () => {
    const media = makeMedia({ provider: "s3" });
    const ctx: MediaContext = {
      r2PublicUrl: "https://r2.example.com",
      s3PublicUrl: "https://s3.example.com",
    };
    const view = toMediaView(media, ctx);
    expect(view.url).toContain("s3.example.com");
  });

  it("maps alt text, dimensions, and blurhash", () => {
    const view = toMediaView(
      makeMedia({ blurhash: "LEHV6nWB2yk8pyo0adR*.7kCMdnj" }),
      EMPTY_CTX,
    );
    expect(view.altText).toBe("A photo");
    expect(view.width).toBe(1920);
    expect(view.height).toBe(1080);
    expect(view.mimeType).toBe("image/webp");
    expect(view.size).toBe(12345);
    expect(view.blurhash).toBe("LEHV6nWB2yk8pyo0adR*.7kCMdnj");
  });

  it("handles null alt, dimensions, and blurhash", () => {
    const media = makeMedia({
      alt: null,
      width: null,
      height: null,
      blurhash: null,
    });
    const view = toMediaView(media, EMPTY_CTX);
    expect(view.altText).toBeUndefined();
    expect(view.width).toBeUndefined();
    expect(view.height).toBeUndefined();
    expect(view.blurhash).toBeUndefined();
  });

  it("computes posterUrl from posterKey", () => {
    const media = makeMedia({
      posterKey: "media/abc-poster.webp",
    });
    const view = toMediaView(media, EMPTY_CTX);
    expect(view.posterUrl).toBe("/media/abc-poster.webp");
  });

  it("computes posterUrl with CDN public URL and image transform", () => {
    const media = makeMedia({
      posterKey: "media/abc-poster.webp",
    });
    const view = toMediaView(media, CTX_WITH_URLS);
    expect(view.posterUrl).toBe(
      "https://example.com/cdn-cgi/image/width=640,quality=80,format=auto,fit=scale-down/https://cdn.example.com/media/abc-poster.webp",
    );
  });

  it("returns undefined posterUrl when posterKey is null", () => {
    const media = makeMedia({ posterKey: null });
    const view = toMediaView(media, EMPTY_CTX);
    expect(view.posterUrl).toBeUndefined();
  });
});

// =============================================================================
// toNavItemView
// =============================================================================

describe("toNavItemView", () => {
  it("marks home link active on exact / match", () => {
    const view = toNavItemView(makeNavItem({ url: "/" }), "/");
    expect(view.isActive).toBe(true);
    expect(view.isExternal).toBe(false);
  });

  it("marks home link inactive on other paths", () => {
    const view = toNavItemView(makeNavItem({ url: "/" }), "/archive");
    expect(view.isActive).toBe(false);
  });

  it("matches prefix for non-root links", () => {
    const view = toNavItemView(makeNavItem({ url: "/archive" }), "/archive");
    expect(view.isActive).toBe(true);

    const viewSub = toNavItemView(
      makeNavItem({ url: "/archive" }),
      "/archive/2024",
    );
    expect(viewSub.isActive).toBe(true);
  });

  it("does not false-match similar prefixes", () => {
    const view = toNavItemView(makeNavItem({ url: "/arch" }), "/archive");
    expect(view.isActive).toBe(false);
  });

  it("marks external links as external and never active", () => {
    const view = toNavItemView(
      makeNavItem({ url: "https://example.com" }),
      "/",
    );
    expect(view.isExternal).toBe(true);
    expect(view.isActive).toBe(false);
  });

  it("handles http:// links", () => {
    const view = toNavItemView(makeNavItem({ url: "http://example.com" }), "/");
    expect(view.isExternal).toBe(true);
    expect(view.isActive).toBe(false);
  });

  it("treats a self-referential absolute URL as an internal link", () => {
    const view = toNavItemView(
      makeNavItem({ url: "https://example.com/about" }),
      "/about",
      false,
      "",
      undefined,
      "https://example.com",
    );
    expect(view.isExternal).toBe(false);
    expect(view.url).toBe("/about");
    expect(view.isActive).toBe(true);
  });

  it("keeps absolute URLs on other origins external", () => {
    const view = toNavItemView(
      makeNavItem({ url: "https://other.com/about" }),
      "/about",
      false,
      "",
      undefined,
      "https://example.com",
    );
    expect(view.isExternal).toBe(true);
    expect(view.url).toBe("https://other.com/about");
    expect(view.isActive).toBe(false);
  });

  it("treats a same-host URL as internal despite scheme/port differences", () => {
    // Dev serves over http://host:<port> while the nav stores the canonical
    // https URL — same site to the user, so no external-link affordances.
    const view = toNavItemView(
      makeNavItem({ url: "https://jant.example/about" }),
      "/about",
      false,
      "",
      undefined,
      "http://jant.example:8787",
    );
    expect(view.isExternal).toBe(false);
    expect(view.url).toBe("/about");
    expect(view.isActive).toBe(true);
  });

  it("normalizes a same-origin absolute URL under a site path prefix", () => {
    const view = toNavItemView(
      makeNavItem({ url: "https://example.com/blog/about" }),
      "/blog/about",
      false,
      "/blog",
      undefined,
      "https://example.com",
    );
    expect(view.isExternal).toBe(false);
    expect(view.url).toBe("/blog/about");
    expect(view.isActive).toBe(true);
  });

  it("includes type in view", () => {
    const view = toNavItemView(
      makeNavItem({ type: "system", systemKey: "rss", url: "/feed" }),
      "/",
    );
    expect(view.type).toBe("system");
    expect(view.systemKey).toBe("rss");
  });

  it("resolves the settings system item to sign in when logged out", () => {
    const view = toNavItemView(
      makeNavItem({
        type: "system",
        systemKey: "settings",
        label: "Settings",
        url: "/settings",
      }),
      "/signin",
      false,
    );

    expect(view.label).toBe("Sign in");
    expect(view.url).toBe("/signin");
    expect(view.isActive).toBe(true);
  });

  it("keeps the settings system item pointed at settings when logged in", () => {
    const view = toNavItemView(
      makeNavItem({
        type: "system",
        systemKey: "settings",
        label: "Settings",
        url: "/settings",
      }),
      "/settings",
      true,
    );

    expect(view.label).toBe("Settings");
    expect(view.url).toBe("/settings");
    expect(view.isActive).toBe(true);
  });

  it("resolves the latest built-in item to /", () => {
    const view = toNavItemView(
      makeNavItem({
        type: "system",
        systemKey: "latest",
        label: "Latest",
        url: "/latest",
      }),
      "/",
    );

    expect(view.url).toBe("/");
    expect(view.isActive).toBe(true);
  });

  it("resolves the featured built-in item to /featured", () => {
    const view = toNavItemView(
      makeNavItem({
        type: "system",
        systemKey: "featured",
        label: "Featured",
        url: "/featured",
      }),
      "/featured",
    );

    expect(view.url).toBe("/featured");
    expect(view.isActive).toBe(true);
  });

  it("corrects stale DB URL for system nav items", () => {
    const view = toNavItemView(
      makeNavItem({
        type: "system",
        systemKey: "collections",
        label: "Collections",
        url: "/c",
      }),
      "/collections",
    );

    expect(view.url).toBe("/collections");
    expect(view.isActive).toBe(true);
  });
});

describe("toNavItemViews", () => {
  it("converts multiple items", () => {
    const items = [
      makeNavItem({
        id: UUID_NAV_1,
        type: "system",
        systemKey: "latest",
        label: "Latest",
        url: "/latest",
      }),
      makeNavItem({ id: UUID_NAV_2, url: "/archive" }),
      makeNavItem({ id: UUID_NAV_3, url: "https://github.com" }),
    ];
    const views = toNavItemViews(items, "/archive");
    expect(views).toHaveLength(3);
    expect(views[0]?.url).toBe("/");
    expect(views[0]).toHaveProperty("isActive", false);
    expect(views[1]).toHaveProperty("isActive", true);
    expect(views[2]).toHaveProperty("isExternal", true);
  });
});

// =============================================================================
// toSearchResultView
// =============================================================================

describe("toSearchResultView", () => {
  it("wraps post in PostView", () => {
    const result: SearchResult = {
      post: makePost({ id: UUID_POST, title: "Test" }),
      rank: 1.5,
      snippet: "...matching <b>text</b>...",
    };
    const view = toSearchResultView(result, EMPTY_CTX);
    expect(view.post.id).toBe(UUID_POST);
    expect(view.post.title).toBe("Test");
    expect(view.post.permalink).toBeDefined();
    expect(view.rank).toBe(1.5);
    expect(view.snippet).toBe("...matching <b>text</b>...");
  });

  it("uses new post fields in search result view", () => {
    const result: SearchResult = {
      post: makePost({
        id: UUID_POST,
        format: "link",
        status: "published",
        visibility: "public",
        pinnedAt: null,
        featuredAt: 1706745600,
        url: "https://example.com",
        slug: "my-link",
      }),
      rank: 0.8,
    };
    const view = toSearchResultView(result, EMPTY_CTX);
    expect(view.post.format).toBe("link");
    expect(view.post.status).toBe("published");
    expect(view.post.visibility).toBe("public");
    expect(view.post.featured).toBe(true);
    expect(view.post.pinned).toBe(false);
    expect(view.post.url).toBe("https://example.com");
    expect(view.post.permalink).toBe("/my-link");
  });
});

// =============================================================================
// toArchiveGroups
// =============================================================================

describe("toArchiveGroups", () => {
  it("converts grouped map to ArchiveGroup array", () => {
    const grouped = new Map<string, Post[]>();
    grouped.set("2024-02", [
      makePost({ id: UUID_1, publishedAt: 1706745600 }),
      makePost({ id: UUID_2, publishedAt: 1706832000 }),
    ]);
    grouped.set("2024-01", [makePost({ id: UUID_3, publishedAt: 1704067200 })]);

    const groups = toArchiveGroups(grouped, EMPTY_CTX);
    expect(groups).toHaveLength(2);

    expect(groups[0]).toHaveProperty("year", "2024");
    expect(groups[0]).toHaveProperty("month", "02");
    expect(groups[0]).toHaveProperty("label", "February 2024");
    expect(groups[0]).toHaveProperty("posts");
    expect(groups[0]?.posts).toHaveLength(2);

    expect(groups[1]).toHaveProperty("year", "2024");
    expect(groups[1]).toHaveProperty("month", "01");
    expect(groups[1]).toHaveProperty("label", "January 2024");
    expect(groups[1]?.posts).toHaveLength(1);
  });

  it("converts posts to PostView within groups", () => {
    const grouped = new Map<string, Post[]>();
    grouped.set("2024-02", [makePost({ id: UUID_1 })]);

    const groups = toArchiveGroups(grouped, EMPTY_CTX);
    const post = groups[0]?.posts[0];
    expect(post).toBeDefined();
    expect(post?.permalink).toBeDefined();
    expect(post?.publishedAtFormatted).toBeDefined();
  });

  it("handles empty map", () => {
    const groups = toArchiveGroups(new Map(), EMPTY_CTX);
    expect(groups).toHaveLength(0);
  });
});
