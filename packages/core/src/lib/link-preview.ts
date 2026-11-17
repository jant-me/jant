/**
 * Link previews: what a Link post's URL is, read from the page it points at.
 *
 * A preview is resolved once, when the post is saved, and stored with it. It
 * has two parts. The site's icon stands in front of the domain on every Link
 * post. A video page also gets its thumbnail, drawn with a play mark and,
 * for a known provider, the provider's name.
 *
 * Whether a page is a video is read from the page itself — `og:type` of
 * `video.*`, or an `og:video` player — so any site that declares it works
 * without a rule of its own. YouTube is the one exception: its thumbnail
 * follows from the video id, so youtube.com, whose watch pages are 1.4 MB with
 * the tags 850 KB in and wall off datacenter addresses, is never fetched.
 *
 * Every fetch goes through `url-fetch.ts`, whose guard checks each redirect
 * hop. Every image is checked by its signature, not its declared type, and
 * only raster formats pass: a stored SVG would run script when opened
 * directly, and a Worker can't rasterize one.
 */

import {
  assertPublicHttpUrl,
  fetchHtmlHead,
  fetchImageBytes,
} from "./url-fetch.js";
import type { ImageOptions } from "./image.js";
import { extractYouTubeVideoId, getYouTubeThumbnailUrls } from "./youtube.js";

const LINK_PREVIEW_PROVIDER_LABELS: Record<string, string> = {
  youtube: "YouTube",
  vimeo: "Vimeo",
  bilibili: "Bilibili",
};

/**
 * The provider a host belongs to, matched on the host itself or any of its
 * subdomains. Matched on the URL a page was served from, after redirects, so
 * a short link (`b23.tv`) or a mobile host (`m.bilibili.com`) lands on its
 * provider either way.
 */
const PROVIDER_HOSTS: ReadonlyArray<readonly [string, string]> = [
  ["youtube.com", "youtube"],
  ["youtu.be", "youtube"],
  ["youtube-nocookie.com", "youtube"],
  ["bilibili.com", "bilibili"],
  ["b23.tv", "bilibili"],
  ["vimeo.com", "vimeo"],
];

/**
 * YouTube's icon, for the path that never reads a YouTube page. The 144 px
 * PNG is the one the page itself names; `/favicon.ico` (16 px) backs it up.
 */
const YOUTUBE_ICON_URLS = [
  "https://www.gstatic.com/youtube/img/branding/favicon/favicon_144x144_v2.png",
  "https://www.youtube.com/favicon.ico",
];

/** One deadline for a whole resolution: the page, its image, and its icon. */
const DEFAULT_TIMEOUT_MS = 3000;
/** The least an image fetch gets, however long the page took. */
const MIN_ASSET_TIMEOUT_MS = 1000;
/** How much of a page is read looking for its `</head>`. */
const MAX_HEAD_BYTES = 512 * 1024;
const MAX_PREVIEW_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_ICON_BYTES = 512 * 1024;
/** Icon URLs tried before giving up, so a page listing ten can't stall a save. */
const MAX_ICON_ATTEMPTS = 3;
/**
 * YouTube serves a grey 120×90 placeholder, about 1 KB, for a size a video
 * doesn't have. Anything this small is taken for one.
 */
const YOUTUBE_PLACEHOLDER_MAX_BYTES = 5000;

/** A raster image format, as recognized from a file's first bytes. */
export interface SniffedImage {
  contentType: string;
  ext: string;
}

/** An image fetched for a preview, ready to store. */
export interface LinkPreviewImage extends SniffedImage {
  bytes: Uint8Array;
}

/** What the `<head>` of a linked page says about it. */
export interface LinkPageMetadata {
  /** Whether the page declares itself a video. */
  video: boolean;
  /** Absolute URL of the page's own preview image, if it names one. */
  imageUrl: string | null;
  /** Absolute URLs of the site's icon, best first, ending with `/favicon.ico`. */
  iconUrls: string[];
}

/** A resolved preview. Either part may be missing; both may be. */
export interface ResolvedLinkPreview {
  /** A video's thumbnail; null for a page that isn't a video. */
  image: LinkPreviewImage | null;
  /** `"video"` when there is a thumbnail, else null. */
  kind: "video" | null;
  /** The known provider the thumbnail comes from, if any. */
  provider: string | null;
  /** The site's icon. */
  icon: LinkPreviewImage | null;
}

/**
 * Return the display label for a recognized Link preview provider.
 *
 * @param provider - Stored provider identifier, such as `youtube`
 * @returns A stable display label, or undefined for unknown providers
 * @example
 * ```ts
 * getLinkPreviewProviderLabel("youtube"); // "YouTube"
 * getLinkPreviewProviderLabel("unknown"); // undefined
 * ```
 */
export function getLinkPreviewProviderLabel(
  provider?: string,
): string | undefined {
  const normalizedProvider = provider?.trim().toLowerCase();
  return normalizedProvider
    ? LINK_PREVIEW_PROVIDER_LABELS[normalizedProvider]
    : undefined;
}

/**
 * The transform a stored site icon is served through. The icon is drawn at
 * 16 px, so 64 covers a 3x share image; an `.ico` passes untouched, since an
 * image transform can't read one.
 *
 * @param key - The icon's storage key
 * @returns Options for `getImageUrl`, or undefined to serve the file as is
 * @example
 * ```ts
 * getLinkPreviewIconImageOptions("media/s/previews/p-icon-a.png"); // { width: 64, ... }
 * getLinkPreviewIconImageOptions("media/s/previews/p-icon-a.ico"); // undefined
 * ```
 */
export function getLinkPreviewIconImageOptions(
  key: string,
): ImageOptions | undefined {
  return key.toLowerCase().endsWith(".ico")
    ? undefined
    : { width: 64, format: "auto", fit: "scale-down" };
}

/**
 * Return the known provider a URL's host belongs to.
 *
 * @param url - The URL, ideally as served after redirects
 * @returns A provider identifier such as `bilibili`, or null
 * @example
 * ```ts
 * getLinkPreviewProvider("https://m.bilibili.com/video/BV1GJ411x7h7"); // "bilibili"
 * getLinkPreviewProvider("https://example.com/"); // null
 * ```
 */
export function getLinkPreviewProvider(url: string | URL): string | null {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase().replace(/\.+$/, "");
  } catch {
    return null;
  }
  for (const [domain, provider] of PROVIDER_HOSTS) {
    if (host === domain || host.endsWith(`.${domain}`)) return provider;
  }
  return null;
}

/**
 * Recognize a raster image from its first bytes.
 *
 * @param bytes - The file's contents
 * @returns Its MIME type and file extension, or null for anything else
 *   (SVG, HTML, an unknown format)
 * @example
 * ```ts
 * sniffRasterImage(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
 * // { contentType: "image/png", ext: "png" }
 * ```
 */
export function sniffRasterImage(bytes: Uint8Array): SniffedImage | null {
  const at = (offset: number, ...expected: number[]) =>
    expected.every((byte, index) => bytes[offset + index] === byte);
  if (at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) {
    return { contentType: "image/png", ext: "png" };
  }
  if (at(0, 0xff, 0xd8, 0xff)) return { contentType: "image/jpeg", ext: "jpg" };
  if (at(0, 0x47, 0x49, 0x46, 0x38)) {
    return { contentType: "image/gif", ext: "gif" };
  }
  if (at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) {
    return { contentType: "image/webp", ext: "webp" };
  }
  if (at(4, 0x66, 0x74, 0x79, 0x70, 0x61, 0x76, 0x69, 0x66)) {
    return { contentType: "image/avif", ext: "avif" };
  }
  if (at(0, 0x00, 0x00, 0x01, 0x00)) {
    return { contentType: "image/x-icon", ext: "ico" };
  }
  return null;
}

/**
 * Read what a page's `<head>` says about it: whether it is a video, the
 * image it offers for previews, and where the site's icon is.
 *
 * Icons the page names with `rel="icon"` come first, largest useful size
 * first; then `apple-touch-icon`, which some sites fill with the page's own
 * picture (Bilibili's is the video cover at 57 px); then the origin's
 * `/favicon.ico`. SVG icons and Safari's `mask-icon` are left out.
 *
 * @param html - The page's head, as {@link fetchHtmlHead} returns it
 * @param pageUrl - The URL the page was served from, for relative URLs
 * @returns The page's preview metadata
 * @example
 * ```ts
 * parseLinkPageHead(
 *   '<meta property="og:type" content="video.other"><meta property="og:image" content="/t.jpg">',
 *   new URL("https://example.com/v/1"),
 * );
 * // { video: true, imageUrl: "https://example.com/t.jpg",
 * //   iconUrls: ["https://example.com/favicon.ico"] }
 * ```
 */
export function parseLinkPageHead(
  html: string,
  pageUrl: URL,
): LinkPageMetadata {
  const meta = new Map<string, string>();
  const icons: { url: string; score: number }[] = [];
  const touchIcons: { url: string; score: number }[] = [];
  let base = pageUrl;

  for (const { name, attributes } of scanHeadTags(html)) {
    if (name === "base") {
      const href = attributes.get("href");
      const resolved = href ? resolveHttpUrl(href, pageUrl) : null;
      if (resolved) base = new URL(resolved);
      continue;
    }

    if (name === "meta") {
      const key = (attributes.get("property") ?? attributes.get("name"))
        ?.trim()
        .toLowerCase();
      const content = attributes.get("content")?.trim();
      if (key && content && !meta.has(key)) meta.set(key, content);
      continue;
    }

    const rel = (attributes.get("rel") ?? "").toLowerCase().split(/\s+/);
    const href = attributes.get("href")?.trim();
    if (!href) continue;
    const type = attributes.get("type")?.toLowerCase() ?? "";
    if (type.includes("svg") || /\.svgz?(?:[?#]|$)/i.test(href)) continue;
    const isTouchIcon = rel.some((token) =>
      token.startsWith("apple-touch-icon"),
    );
    if (!isTouchIcon && !rel.includes("icon")) continue;
    // Resolved later, against a `<base>` that may come after this tag.
    const entry = {
      url: href,
      score: scoreIcon(attributes.get("sizes"), type, href),
    };
    (isTouchIcon ? touchIcons : icons).push(entry);
  }

  const ogType = meta.get("og:type")?.toLowerCase() ?? "";
  const video =
    ogType === "video" ||
    ogType.startsWith("video.") ||
    ["og:video", "og:video:url", "og:video:secure_url"].some((key) =>
      meta.has(key),
    );

  const imageUrl =
    [
      "og:image",
      "og:image:url",
      "og:image:secure_url",
      "twitter:image",
      "twitter:image:src",
    ]
      .map((key) => meta.get(key))
      .map((value) => (value ? resolveHttpUrl(value, base) : null))
      .find((value): value is string => value !== null) ?? null;

  const byScore = (a: { score: number }, b: { score: number }) =>
    b.score - a.score;
  const iconUrls = [...icons.sort(byScore), ...touchIcons.sort(byScore)]
    .map(({ url }) => resolveHttpUrl(url, base))
    .filter((url): url is string => url !== null);
  iconUrls.push(new URL("/favicon.ico", pageUrl).toString());

  return { video, imageUrl, iconUrls: [...new Set(iconUrls)] };
}

/**
 * Resolve a Link post's URL to its preview: fetch the page's head (or, for
 * YouTube, nothing), then its thumbnail and the site's icon side by side, all
 * within one deadline. Never throws: whatever can't be fetched is left null.
 *
 * @param rawUrl - The Link post's URL
 * @param options - `timeoutMs`, the deadline for the whole resolution
 * @returns The preview's parts
 * @example
 * ```ts
 * const preview = await resolveLinkPreview("https://www.bilibili.com/video/BV1GJ411x7h7");
 * // { kind: "video", provider: "bilibili", image: {...}, icon: {...} }
 * ```
 */
export async function resolveLinkPreview(
  rawUrl: string,
  options: { timeoutMs?: number } = {},
): Promise<ResolvedLinkPreview> {
  const deadline = Date.now() + (options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const assetTimeout = () =>
    Math.max(MIN_ASSET_TIMEOUT_MS, deadline - Date.now());
  const none: ResolvedLinkPreview = {
    image: null,
    kind: null,
    provider: null,
    icon: null,
  };

  const youTubeId = extractYouTubeVideoId(rawUrl);
  if (youTubeId) {
    const [image, icon] = await Promise.all([
      fetchFirstImage(getYouTubeThumbnailUrls(youTubeId), {
        maxBytes: MAX_PREVIEW_IMAGE_BYTES,
        timeoutMs: assetTimeout,
        accept: isPreviewImage,
        minBytes: YOUTUBE_PLACEHOLDER_MAX_BYTES,
      }),
      fetchFirstImage(YOUTUBE_ICON_URLS, {
        maxBytes: MAX_ICON_BYTES,
        timeoutMs: assetTimeout,
        accept: () => true,
      }),
    ]);
    return image
      ? { image, kind: "video", provider: "youtube", icon }
      : { ...none, icon };
  }

  let pageUrl: URL;
  try {
    pageUrl = assertPublicHttpUrl(rawUrl, "page");
  } catch {
    return none;
  }

  const page = await fetchHtmlHead(pageUrl, {
    maxBytes: MAX_HEAD_BYTES,
    timeoutMs: Math.max(0, deadline - Date.now()),
  }).catch(() => null);
  // A page that can't be read may still serve its icon.
  const metadata = page
    ? parseLinkPageHead(page.html, page.url)
    : {
        video: false,
        imageUrl: null,
        iconUrls: [new URL("/favicon.ico", pageUrl).toString()],
      };

  const [image, icon] = await Promise.all([
    metadata.video && metadata.imageUrl
      ? fetchFirstImage([metadata.imageUrl], {
          maxBytes: MAX_PREVIEW_IMAGE_BYTES,
          timeoutMs: assetTimeout,
          accept: isPreviewImage,
        })
      : null,
    fetchFirstImage(metadata.iconUrls.slice(0, MAX_ICON_ATTEMPTS), {
      maxBytes: MAX_ICON_BYTES,
      timeoutMs: assetTimeout,
      accept: () => true,
    }),
  ]);

  return image
    ? {
        image,
        kind: "video",
        provider: getLinkPreviewProvider(page?.url ?? pageUrl),
        icon,
      }
    : { ...none, icon };
}

/** A thumbnail is drawn large, so an icon format won't do. */
function isPreviewImage(image: SniffedImage): boolean {
  return image.ext !== "ico";
}

/** Fetch each URL in turn until one is a raster image `accept` takes. */
async function fetchFirstImage(
  urls: readonly string[],
  options: {
    maxBytes: number;
    timeoutMs: () => number;
    accept: (image: SniffedImage) => boolean;
    /** Smaller files are skipped as placeholders. */
    minBytes?: number;
  },
): Promise<LinkPreviewImage | null> {
  for (const url of urls) {
    try {
      const { bytes } = await fetchImageBytes(assertPublicHttpUrl(url), {
        maxBytes: options.maxBytes,
        timeoutMs: options.timeoutMs(),
      });
      if (options.minBytes !== undefined && bytes.byteLength < options.minBytes)
        continue;
      const sniffed = sniffRasterImage(bytes);
      if (sniffed && options.accept(sniffed)) return { ...sniffed, bytes };
    } catch {
      // Unreachable, too large, or refused by the guard — try the next one.
    }
  }
  return null;
}

/**
 * Rank an icon by how well it draws at 16–32 px: a declared size from 32 to
 * 256 is best, larger first; then a size above 256, then no size given (a
 * raster file before an `.ico`), then anything under 32.
 */
function scoreIcon(
  sizes: string | undefined,
  type: string,
  href: string,
): number {
  const declared = (sizes ?? "")
    .toLowerCase()
    .split(/\s+/)
    .map((size) => /^(\d+)x(\d+)$/.exec(size))
    .filter((match): match is RegExpExecArray => match !== null)
    .map((match) => Math.max(Number(match[1]), Number(match[2])));
  const size = declared.length > 0 ? Math.max(...declared) : null;
  if (size !== null && size >= 32 && size <= 256) return 1000 + size;
  if (size !== null && size > 256) return 900;
  if (size === null) {
    const isIco = type.includes("icon") || /\.ico(?:[?#]|$)/i.test(href);
    return isIco ? 500 : 600;
  }
  return size;
}

/** An absolute http(s) URL for `value` against `base`, or null. */
function resolveHttpUrl(value: string, base: URL): string | null {
  try {
    const url = new URL(value, base);
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

/** Elements whose contents are not markup, and comments, which are skipped. */
const SKIPPED_CONTENT =
  /<!--[\s\S]*?-->|<(script|style|noscript|template|textarea|title)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;

/** A `<meta>`, `<link>`, or `<base>` tag; a quoted `>` doesn't end it. */
const HEAD_TAG = /<(meta|link|base)\b((?:[^>"']|"[^"]*"|'[^']*')*)>/gi;

const ATTRIBUTE =
  /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

/**
 * The `<meta>`, `<link>`, and `<base>` tags of a head, with their attributes
 * (names lowercased, values entity-decoded). A scanner, not a parser: the
 * head is read for a few tags, and a full parse of half a megabyte would
 * spend a Worker's CPU budget.
 */
function* scanHeadTags(
  html: string,
): Generator<{ name: string; attributes: Map<string, string> }> {
  const markup = html.replace(SKIPPED_CONTENT, "");
  for (const tag of markup.matchAll(HEAD_TAG)) {
    const attributes = new Map<string, string>();
    for (const attribute of (tag[2] ?? "").matchAll(ATTRIBUTE)) {
      const name = attribute[1]?.toLowerCase();
      if (!name || attributes.has(name)) continue;
      const value = attribute[2] ?? attribute[3] ?? attribute[4] ?? "";
      attributes.set(name, decodeHtmlEntities(value));
    }
    yield { name: (tag[1] ?? "").toLowerCase(), attributes };
  }
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

function decodeHtmlEntities(value: string): string {
  return value.replace(
    /&(?:#(\d+)|#x([0-9a-f]+)|([a-z]+));/gi,
    (match, decimal: string, hex: string, name: string) => {
      const code = decimal
        ? Number(decimal)
        : hex
          ? Number.parseInt(hex, 16)
          : null;
      if (code !== null) {
        return code > 0 && code <= 0x10ffff
          ? String.fromCodePoint(code)
          : match;
      }
      return NAMED_ENTITIES[name.toLowerCase()] ?? match;
    },
  );
}
