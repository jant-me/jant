/**
 * Shared fixture builders for Hugo export + roundtrip tests.
 *
 * Kept outside the `__tests__/*.test.ts` glob so importing these helpers
 * from one test file doesn't re-trigger the describe blocks of another.
 */

import type { SiteConfig } from "../../services/export.js";
import type { Collection, Media, Post } from "../../types.js";

export function makePost(over: Partial<Post> = {}): Post {
  const base: Post = {
    id: "post-root",
    siteId: "site-test",
    format: "note",
    status: "published",
    visibility: "public",
    pinnedAt: null,
    featuredAt: null,
    slug: "root-slug",
    title: "Root title",
    url: null,
    body: null,
    bodyHtml: null,
    bodyText: "Root body text.",
    quoteText: null,
    summary: "Root body text.",
    rating: null,
    previewImageKey: null,
    previewKind: null,
    previewProvider: null,
    replyToId: null,
    threadId: "post-root",
    publishedAt: 1773014400,
    lastActivityAt: 1773014400,
    createdAt: 1773014400,
    updatedAt: 1773014400,
  };
  return { ...base, ...over };
}

export function makeCollection(over: Partial<Collection> = {}): Collection {
  const base: Collection = {
    id: "col-1",
    siteId: "site-test",
    slug: "ideas",
    title: "Ideas",
    description: null,
    sortOrder: "newest",
    createdAt: 1770000000,
    updatedAt: 1773014400,
  };
  return { ...base, ...over };
}

export function makeMedia(over: Partial<Media> = {}): Media {
  const base: Media = {
    id: "med-1",
    siteId: "site-test",
    postId: null,
    filename: "photo.webp",
    originalName: "photo.webp",
    mimeType: "image/webp",
    size: 1234,
    storageKey: "media/med-1.webp",
    provider: "r2",
    width: 800,
    height: 600,
    durationSeconds: null,
    alt: "A photo",
    position: "a0",
    blurhash: "LEHV6nWB2yk8pyo0adR*.7kCMdnj",
    waveform: null,
    posterKey: null,
    summary: null,
    chars: null,
    mediaKind: "image",
    createdAt: 1773014400,
    updatedAt: 1773014400,
  };
  return { ...base, ...over };
}

export function makeSiteConfig(over: Partial<SiteConfig> = {}): SiteConfig {
  const base: SiteConfig = {
    siteName: "Jant Test",
    siteUrl: "https://example.com",
    siteDescription: "Export fixture",
    siteLanguage: "en",
    multilingualEnabled: false,
    additionalLanguages: [],
    showJantBrandingOnHome: true,
    publicApiEnabled: true,
    rssFeedsEnabled: true,
    mainRssFeed: "latest",
    archiveDefaultLayout: "list",
    siteFooter: "",
    showHeaderAvatar: false,
    siteAvatarUrl: "",
    themeId: "paper",
    defaultThemeId: "paper",
    fontThemeId: "system",
    themeMode: "auto",
    noindex: false,
    navItems: [],
    pageSize: 10,
    archivePageSize: 50,
    rssFeedLimit: 50,
  };
  return { ...base, ...over };
}
