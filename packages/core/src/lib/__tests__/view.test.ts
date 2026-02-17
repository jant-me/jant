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

const EMPTY_CTX: MediaContext = {};
const CTX_WITH_URLS: MediaContext = {
  r2PublicUrl: "https://cdn.example.com",
  imageTransformUrl: "https://example.com/cdn-cgi/image",
};

function makePost(overrides: Partial<Post> = {}): Post {
  return {
    id: 1,
    format: "note",
    status: "published",
    featured: 0,
    pinned: 0,
    path: null,
    title: null,
    url: null,
    body: "Hello world",
    bodyHtml: "<p>Hello world</p>",
    quoteText: null,
    rating: null,
    collectionId: null,
    replyToId: null,
    threadId: null,
    deletedAt: null,
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
    postId: 1,
    filename: "image.webp",
    originalName: "photo.jpg",
    mimeType: "image/webp",
    size: 12345,
    storageKey: "media/2025/01/01902a9f-1a2b-7c3d.webp",
    provider: "r2",
    width: 1920,
    height: 1080,
    alt: "A photo",
    position: 0,
    blurhash: null,
    createdAt: 1706745600,
    ...overrides,
  };
}

function makeNavItem(overrides: Partial<NavItem> = {}): NavItem {
  return {
    id: 1,
    type: "link",
    label: "Home",
    url: "/",
    pageId: null,
    position: 0,
    createdAt: 1706745600,
    updatedAt: 1706745600,
    ...overrides,
  };
}

// =============================================================================
// toPostView
// =============================================================================

describe("toPostView", () => {
  it("generates permalink from post id when no path", () => {
    const post = makePostWithMedia({ id: 123, path: null });
    const view = toPostView(post, EMPTY_CTX);
    expect(view.permalink).toMatch(/^\/p\/.+$/);
    expect(view.permalink.length).toBeGreaterThan(3);
  });

  it("generates permalink from path when path is set", () => {
    const post = makePostWithMedia({ id: 123, path: "my-post" });
    const view = toPostView(post, EMPTY_CTX);
    expect(view.permalink).toBe("/my-post");
  });

  it("generates permalink from multi-level path", () => {
    const post = makePostWithMedia({ id: 123, path: "2024/01/my-post" });
    const view = toPostView(post, EMPTY_CTX);
    expect(view.permalink).toBe("/2024/01/my-post");
  });

  it("formats dates correctly", () => {
    const post = makePostWithMedia({ publishedAt: 1706745600 });
    const view = toPostView(post, EMPTY_CTX);
    expect(view.publishedAt).toBe("2024-02-01T00:00:00.000Z");
    expect(view.publishedAtFormatted).toBe("Feb 1, 2024");
  });

  it("generates excerpt from body", () => {
    const shortBody = "Short text";
    const longBody = "A".repeat(200);

    const shortView = toPostView(
      makePostWithMedia({ body: shortBody }),
      EMPTY_CTX,
    );
    expect(shortView.excerpt).toBe("Short text");

    const longView = toPostView(
      makePostWithMedia({ body: longBody }),
      EMPTY_CTX,
    );
    expect(longView.excerpt).toBe("A".repeat(160) + "...");
  });

  it("computes summaryHtml for posts with title and bodyHtml", () => {
    const view = toPostView(
      makePostWithMedia({
        title: "My Article",
        body: "Short article body",
        bodyHtml: "<p>Short article body</p>",
      }),
      EMPTY_CTX,
    );
    expect(view.summaryHtml).toBe("<p>Short article body</p>");
    expect(view.summaryHasMore).toBe(false);
  });

  it("truncates summaryHtml for long articles", () => {
    const p1 = `<p>${"A".repeat(300)}</p>`;
    const p2 = `<p>${"B".repeat(300)}</p>`;
    const view = toPostView(
      makePostWithMedia({
        title: "Long Article",
        body: "A".repeat(300) + "B".repeat(300),
        bodyHtml: p1 + p2,
      }),
      EMPTY_CTX,
    );
    expect(view.summaryHtml).toBe(p1);
    expect(view.summaryHasMore).toBe(true);
  });

  it("does not compute summaryHtml for posts without title", () => {
    const view = toPostView(
      makePostWithMedia({
        title: null,
        bodyHtml: "<p>Just a note</p>",
      }),
      EMPTY_CTX,
    );
    expect(view.summaryHtml).toBeUndefined();
    expect(view.summaryHasMore).toBeUndefined();
  });

  it("does not compute summaryHtml for posts without bodyHtml", () => {
    const view = toPostView(
      makePostWithMedia({
        title: "Title Only",
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
    expect(view.excerpt).toBeUndefined();
    expect(view.bodyHtml).toBeUndefined();
    expect(view.body).toBeUndefined();
  });

  it("converts null fields to undefined", () => {
    const view = toPostView(makePostWithMedia(), EMPTY_CTX);
    expect(view.title).toBeUndefined();
    expect(view.path).toBeUndefined();
    expect(view.url).toBeUndefined();
    expect(view.quoteText).toBeUndefined();
    expect(view.rating).toBeUndefined();
    expect(view.collectionId).toBeUndefined();
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
    expect(view.quoteText).toBe("Something wise");
  });

  it("maps format, status, featured, and pinned correctly", () => {
    const view = toPostView(
      makePostWithMedia({
        format: "link",
        status: "draft",
        featured: 1,
        pinned: 1,
      }),
      EMPTY_CTX,
    );
    expect(view.format).toBe("link");
    expect(view.status).toBe("draft");
    expect(view.featured).toBe(true);
    expect(view.pinned).toBe(true);
  });

  it("converts featured=0 and pinned=0 to false", () => {
    const view = toPostView(
      makePostWithMedia({
        featured: 0,
        pinned: 0,
      }),
      EMPTY_CTX,
    );
    expect(view.featured).toBe(false);
    expect(view.pinned).toBe(false);
  });

  it("preserves rating and collectionId when set", () => {
    const view = toPostView(
      makePostWithMedia({
        rating: 5,
        collectionId: 42,
      }),
      EMPTY_CTX,
    );
    expect(view.rating).toBe(5);
    expect(view.collectionId).toBe(42);
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
            width: 800,
            height: 600,
            position: 0,
            mimeType: "image/webp",
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
    });
  });
});

describe("toPostViews", () => {
  it("converts multiple posts", () => {
    const posts = [makePostWithMedia({ id: 1 }), makePostWithMedia({ id: 2 })];
    const views = toPostViews(posts, EMPTY_CTX);
    expect(views).toHaveLength(2);
    expect(views[0]).toHaveProperty("id", 1);
    expect(views[1]).toHaveProperty("id", 2);
  });
});

// =============================================================================
// toMediaView
// =============================================================================

describe("toMediaView", () => {
  it("generates local proxy URL without public URL", () => {
    const media = makeMedia();
    const view = toMediaView(media, EMPTY_CTX);
    expect(view.url).toBe("/media/2025/01/01902a9f-1a2b-7c3d.webp");
    expect(view.thumbnailUrl).toBe("/media/2025/01/01902a9f-1a2b-7c3d.webp");
  });

  it("generates CDN URL with public URL", () => {
    const media = makeMedia();
    const view = toMediaView(media, CTX_WITH_URLS);
    expect(view.url).toBe(
      "https://cdn.example.com/media/2025/01/01902a9f-1a2b-7c3d.webp",
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

  it("maps alt text and dimensions", () => {
    const view = toMediaView(makeMedia(), EMPTY_CTX);
    expect(view.altText).toBe("A photo");
    expect(view.width).toBe(1920);
    expect(view.height).toBe(1080);
    expect(view.mimeType).toBe("image/webp");
    expect(view.size).toBe(12345);
  });

  it("handles null alt and dimensions", () => {
    const media = makeMedia({ alt: null, width: null, height: null });
    const view = toMediaView(media, EMPTY_CTX);
    expect(view.altText).toBeUndefined();
    expect(view.width).toBeUndefined();
    expect(view.height).toBeUndefined();
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

  it("includes type and pageId in view", () => {
    const view = toNavItemView(makeNavItem({ type: "page", pageId: 5 }), "/");
    expect(view.type).toBe("page");
    expect(view.pageId).toBe(5);
  });

  it("converts null pageId to undefined", () => {
    const view = toNavItemView(makeNavItem({ pageId: null }), "/");
    expect(view.pageId).toBeUndefined();
  });
});

describe("toNavItemViews", () => {
  it("converts multiple items", () => {
    const items = [
      makeNavItem({ id: 1, url: "/" }),
      makeNavItem({ id: 2, url: "/archive" }),
      makeNavItem({ id: 3, url: "https://github.com" }),
    ];
    const views = toNavItemViews(items, "/archive");
    expect(views).toHaveLength(3);
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
      post: makePost({ id: 42, title: "Test" }),
      rank: 1.5,
      snippet: "...matching <b>text</b>...",
    };
    const view = toSearchResultView(result, EMPTY_CTX);
    expect(view.post.id).toBe(42);
    expect(view.post.title).toBe("Test");
    expect(view.post.permalink).toBeDefined();
    expect(view.rank).toBe(1.5);
    expect(view.snippet).toBe("...matching <b>text</b>...");
  });

  it("uses new post fields in search result view", () => {
    const result: SearchResult = {
      post: makePost({
        id: 10,
        format: "link",
        status: "published",
        featured: 1,
        pinned: 0,
        url: "https://example.com",
        path: "my-link",
      }),
      rank: 0.8,
    };
    const view = toSearchResultView(result, EMPTY_CTX);
    expect(view.post.format).toBe("link");
    expect(view.post.status).toBe("published");
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
      makePost({ id: 1, publishedAt: 1706745600 }),
      makePost({ id: 2, publishedAt: 1706832000 }),
    ]);
    grouped.set("2024-01", [makePost({ id: 3, publishedAt: 1704067200 })]);

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
    grouped.set("2024-02", [makePost({ id: 1 })]);

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
