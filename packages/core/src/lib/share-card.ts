/**
 * Share card assembly.
 *
 * The author's "Share as image" turns a post into a PNG in the browser; the
 * server decides what the card says. The card is its own design — a sheet
 * of paper mounted on a mat tinted from the site's theme — but it speaks
 * the site's language: its fonts and colors, each format's own marks (a
 * link's domain, a quote's quotation mark), and the summary the timeline
 * shows, cut where the author's "read more" break or the summary limits
 * cut it. Every image is read from this origin, because the browser can
 * only paint images it is allowed to read onto a canvas.
 *
 * A post in a Thread is set on the Thread's rail, as the timeline sets a
 * Thread's newest post: the Thread's first post in up to three lines, the
 * run between folded to a few dots, a line of the post after, and its place
 * in the Thread: just enough to say which Thread this is and that it is one
 * post of several, however long the Thread runs.
 */

import type { Context } from "hono";
import { renderSVG } from "uqr";
import type { Bindings, Media, Post, PostView } from "../types.js";
import type { AppVariables } from "../types/app-context.js";
import { buildMediaMap } from "./media-helpers.js";
import {
  ARTICLE_SUMMARY_MAX_BLOCKS,
  ARTICLE_SUMMARY_MAX_CHARS,
  NOTE_SUMMARY_MAX_BLOCKS,
  NOTE_SUMMARY_MAX_CHARS,
  NOTE_SUMMARY_MIN_HIDDEN_CHARS,
  extractSummaryHtml,
} from "./summary.js";
import {
  buildSiteUrl,
  extractDisplayDomain,
  sanitizeUrl,
  toPublicPath,
} from "./url.js";
import { createMediaContext, toPostView } from "./view.js";

type Env = { Bindings: Bindings; Variables: AppVariables };

/** Images at the top of a card; beyond these the last one counts the rest. */
export const SHARE_CARD_MAX_IMAGES = 4;

/**
 * Images a wordless post of the Thread shows around the shared one; beyond
 * these the last one counts the rest.
 */
export const SHARE_CARD_CONTEXT_IMAGES = 3;

/** Files listed under a card; beyond these a line counts the rest. */
export const SHARE_CARD_MAX_FILES = 3;

/**
 * Characters of a context post's text the card carries. The card shows up
 * to three lines of it; this only keeps the markup small.
 */
const CONTEXT_TEXT_CHARS = 200;

/** Quotes up to this many characters are set larger. */
const SHORT_QUOTE_CHARS = 30;
/** Quotes past this many characters are set smaller. */
const LONG_QUOTE_CHARS = 90;

/**
 * Which card a post gets. Notes split on the title: a titled note reads as
 * an article and leads with its title.
 */
export type ShareCardLayout = "note" | "article" | "link" | "quote";

export interface ShareCardImage {
  /** Same-origin URL, so the capture can read its pixels. */
  url: string;
  /** A video's poster: the card marks it as one. */
  video: boolean;
  /**
   * Pixel size, when stored. A lone image keeps its own shape on the card,
   * and the size lets the card lay it out before the image loads.
   */
  width?: number;
  height?: number;
}

/**
 * An attachment the card cannot show as a picture: a document, a sound, a
 * text, or a video without a poster. Listed by name, with its format and
 * the one number that says how much of it there is.
 */
export interface ShareCardFile {
  kind: "document" | "audio" | "video" | "text";
  /** Format in capitals — "PDF", "EPUB", "M4A", "MD". */
  format: string;
  title: string;
  /** Bytes, for a document. */
  size?: number;
  /** Seconds, for a sound or a video. */
  durationSeconds?: number;
  /** Characters, for a text. */
  chars?: number;
}

/**
 * The Thread's first post or the post after the shared one, shown quieter
 * than it: its title and words, or, for a post with no words, its images.
 */
export interface ShareCardThreadPost {
  format: Post["format"];
  /** A titled note's or a link's title, or an untitled link's domain. */
  title?: string;
  /**
   * Its words: a note's or a link's text, or a quote's words; for a post
   * with no words and no images, its first file ("PDF · Annual report").
   */
  text?: string;
  /** A quote's source: who said it, and where. */
  source?: string;
  /**
   * Its images, when it has no words: what the post is, as the timeline
   * shows it, a few of them at a size that reads.
   */
  images?: ShareCardImage[];
  /** Images beyond the ones shown. */
  moreImages?: number;
}

/**
 * Where the shared post sits in its Thread: the Thread's first post above
 * it, as the timeline leads a Thread, the posts between folded away, and
 * the post after it below.
 */
export interface ShareCardThread {
  /** 1-based place among the Thread's published posts. */
  position: number;
  /** Published posts in the Thread. */
  total: number;
  /** The Thread's first post, unless that is the shared post. */
  root: ShareCardThreadPost | null;
  /** Posts between `root` and the shared one, folded away. */
  hidden: number;
  /** The post just after the shared one. */
  next: ShareCardThreadPost | null;
}

export interface ShareCardView {
  layout: ShareCardLayout;
  siteName: string;
  /** Same-origin URL of the site avatar, or null when the site has none. */
  avatarUrl: string | null;
  /** Publish date as the timeline formats it. */
  date: string;
  /** Article title (titled notes only). */
  title?: string;
  /** Summary HTML from the TipTap renderer; trusted. */
  bodyHtml?: string;
  /** Whether the post continues past `bodyHtml`. */
  hasMore: boolean;
  /** Quote posts: the quoted text, how large to set it, and its source. */
  quote?: {
    text: string;
    size: "short" | "medium" | "long";
    attribution?: string;
    source?: string;
  };
  /** Link posts: the page the post points at. */
  link?: { title?: string; domain?: string };
  /**
   * Images at the top of the card: attachments (video posters included),
   * or a link's preview image when it has none.
   */
  images: ShareCardImage[];
  /** Images beyond the ones shown. */
  moreImages: number;
  /** Attachments listed under the text, in post order. */
  files: ShareCardFile[];
  /** Attachments beyond the ones listed. */
  moreFiles: number;
  /** Absolute address of the post, what the QR code encodes. */
  permalink: string;
  /**
   * The site's address under its name, as a reader would type it: host and
   * path prefix, no scheme. The post's own address is the QR code's to
   * carry; a slug is too long to type from a picture. Null when the site's
   * name already is its address.
   */
  siteAddress: string | null;
  /** QR code for `permalink`, as SVG markup from `uqr`. */
  qrSvg: string;
  /** Name for the saved PNG, without extension: the post's slug. */
  fileName: string;
  /** Content language of the post, for the card's `lang`. */
  language?: string;
  /** The Thread around the post; absent when the post stands alone. */
  thread?: ShareCardThread;
}

/** What the card builder needs to know about the site. */
export interface ShareCardSite {
  siteName: string;
  /** Storage key of the site avatar; empty when none is set. */
  siteAvatar: string;
  siteOrigin: string;
  sitePathPrefix: string;
}

/**
 * Whether a post can be shared as an image: a reader has to be able to open
 * the address its QR code points at.
 *
 * @param post - Post record
 * @returns True for published posts that are not Private
 *
 * @example
 * ```ts
 * canShareAsImage({ status: "published", visibility: "latest_hidden" }); // true
 * canShareAsImage({ status: "draft", visibility: "public" }); // false
 * ```
 */
export function canShareAsImage(
  post: Pick<Post, "status" | "visibility">,
): boolean {
  return post.status === "published" && post.visibility !== "private";
}

/**
 * Same-origin path for a storage key. `/media/*` and `/sites/*` serve the
 * site's public objects whatever CDN host the timeline links to.
 */
function storagePath(storageKey: string, sitePathPrefix: string): string {
  return toPublicPath(`/${storageKey}`, sitePathPrefix);
}

/** The stored pixel size of an image or a video, when it has one. */
function imageSize(item: Media): Pick<ShareCardImage, "width" | "height"> {
  return item.width && item.height
    ? { width: item.width, height: item.height }
    : {};
}

function cardImages(
  media: Media[],
  previewImageKey: string | null,
  sitePathPrefix: string,
): { images: ShareCardImage[]; moreImages: number } {
  const visuals: ShareCardImage[] = [];
  for (const item of media) {
    if (item.mimeType.startsWith("image/")) {
      visuals.push({
        url: storagePath(item.storageKey, sitePathPrefix),
        video: false,
        ...imageSize(item),
      });
    } else if (item.mimeType.startsWith("video/") && item.posterKey) {
      visuals.push({
        url: storagePath(item.posterKey, sitePathPrefix),
        video: true,
        ...imageSize(item),
      });
    }
  }
  if (visuals.length === 0 && previewImageKey) {
    visuals.push({
      url: storagePath(previewImageKey, sitePathPrefix),
      video: false,
    });
  }
  return {
    images: visuals.slice(0, SHARE_CARD_MAX_IMAGES),
    moreImages: Math.max(0, visuals.length - SHARE_CARD_MAX_IMAGES),
  };
}

/** Formats whose file extension is not the name a reader knows them by. */
const FORMAT_BY_MIME: Record<string, string> = {
  "application/pdf": "PDF",
  "application/epub+zip": "EPUB",
  "text/markdown": "MD",
  "text/plain": "TXT",
};

/** The file's extension in capitals, or a name for its MIME type. */
function fileFormat(item: Media): string {
  const extension = /\.([a-z0-9]{1,5})$/i.exec(item.originalName)?.[1];
  if (extension) return extension.toUpperCase();
  return (
    FORMAT_BY_MIME[item.mimeType] ??
    (item.mimeType.split("/")[1] ?? "").slice(0, 4).toUpperCase()
  );
}

function withoutExtension(name: string): string {
  return name.replace(/\.[a-z0-9]{1,5}$/i, "");
}

/**
 * Attachments a picture cannot show. Images and videos with a poster are at
 * the top of the card; everything else is listed, so a post whose point is
 * a PDF or a recording does not lose it.
 */
function cardFiles(media: Media[]): {
  files: ShareCardFile[];
  moreFiles: number;
} {
  const files: ShareCardFile[] = [];
  for (const item of media) {
    if (item.mimeType.startsWith("image/")) continue;
    const isVideo = item.mimeType.startsWith("video/");
    if (isVideo && item.posterKey) continue;
    const name = withoutExtension(item.originalName) || item.alt || "";
    if (item.mimeType.startsWith("text/")) {
      files.push({
        kind: "text",
        format: fileFormat(item),
        title: item.summary?.trim().split("\n")[0] || name,
        chars: item.chars ?? undefined,
      });
    } else if (isVideo || item.mimeType.startsWith("audio/")) {
      files.push({
        kind: isVideo ? "video" : "audio",
        format: fileFormat(item),
        title: name,
        durationSeconds: item.durationSeconds ?? undefined,
      });
    } else {
      files.push({
        kind: "document",
        format: fileFormat(item),
        title: name,
        size: item.size,
      });
    }
  }
  return {
    files: files.slice(0, SHARE_CARD_MAX_FILES),
    moreFiles: Math.max(0, files.length - SHARE_CARD_MAX_FILES),
  };
}

/**
 * A context post's text as one run of lines, cut short. Paragraphs join
 * with a space, except after CJK punctuation, which carries its own.
 */
function clipContextText(text: string | undefined): string | undefined {
  const normalized = text
    ?.replace(/\s+/g, " ")
    .replace(/([\u3000-\u303f\uff00-\uffef]) /g, "$1")
    .trim();
  if (!normalized) return undefined;
  const characters = Array.from(normalized);
  if (characters.length <= CONTEXT_TEXT_CHARS) return normalized;
  return `${characters.slice(0, CONTEXT_TEXT_CHARS).join("").trimEnd()}…`;
}

/**
 * Which posts of a Thread the card shows around the one at `index`.
 *
 * @param posts - The Thread's published posts, in Thread order
 * @param index - Position of the shared post in `posts`
 * @returns The Thread's first post, how many posts fold between it and the
 *   shared one, the post after, and the shared post's place; null when the
 *   post stands alone
 *
 * @example
 * ```ts
 * threadWindow([p1, p2, p3, p4, p5, p6, p7], 5);
 * // { root: p1, hidden: 4, next: p7, position: 6, total: 7 }
 * ```
 */
export function threadWindow<T>(
  posts: T[],
  index: number,
): {
  root: T | null;
  hidden: number;
  next: T | null;
  position: number;
  total: number;
} | null {
  if (posts.length < 2 || index < 0 || index >= posts.length) return null;
  return {
    root: index > 0 ? (posts[0] ?? null) : null,
    hidden: Math.max(0, index - 1),
    next: posts[index + 1] ?? null,
    position: index + 1,
    total: posts.length,
  };
}

/**
 * The Thread's first post or the post after the shared one as the card
 * shows it: its title and words, a quote's words and source, or, for a post
 * with no words, its images, or its first file by format and name.
 *
 * @param post - Post record; `previewImageKey` stands in for a link's image
 * @param view - The same post as the timeline renders it
 * @param media - The post's attachments, in order
 * @param sitePathPrefix - Path prefix for same-origin URLs
 * @returns The context post
 */
export function buildShareCardThreadPost(
  post: Pick<Post, "format" | "previewImageKey">,
  view: PostView,
  media: Media[],
  sitePathPrefix: string,
): ShareCardThreadPost {
  let title: string | undefined;
  let text: string | undefined;
  const safeUrl = view.url ? sanitizeUrl(view.url) : "";
  const domain = safeUrl
    ? (extractDisplayDomain(safeUrl) ?? undefined)
    : undefined;
  if (post.format === "quote") {
    text = clipContextText(view.quoteText);
    // Who said it and where, as the shared post's own quote card shows it.
    const source = [view.title, domain].filter(Boolean).join(" · ");
    if (text) {
      return { format: post.format, text, source: source || undefined };
    }
  } else if (post.format === "link") {
    title = view.title || domain;
    // A link with no words of its own summarizes as its address.
    text =
      view.summary && view.summary !== view.url?.trim()
        ? clipContextText(view.summary)
        : undefined;
  } else {
    title = view.title || undefined;
    text = clipContextText(view.summary);
  }
  if (title || text) return { format: post.format, title, text };
  const { images, moreImages } = cardImages(
    media,
    post.previewImageKey,
    sitePathPrefix,
  );
  if (images.length === 0) {
    const file = cardFiles(media).files[0];
    return file
      ? { format: post.format, text: `${file.format} · ${file.title}` }
      : { format: post.format };
  }
  const shown = images.slice(0, SHARE_CARD_CONTEXT_IMAGES);
  return {
    format: post.format,
    images: shown,
    moreImages: moreImages + images.length - shown.length,
  };
}

function quoteSize(text: string): "short" | "medium" | "long" {
  const length = Array.from(text).length;
  if (length <= SHORT_QUOTE_CHARS) return "short";
  if (length > LONG_QUOTE_CHARS) return "long";
  return "medium";
}

/**
 * The site's address as a reader would type it: host and path prefix,
 * percent-decoded, without a trailing slash. Null when the site's name
 * already says it, such as a site named `example.com` at
 * `www.example.com`.
 */
function toSiteAddress(site: ShareCardSite): string | null {
  const url = new URL(buildSiteUrl(site.siteOrigin, site.sitePathPrefix));
  let path = url.pathname;
  try {
    path = decodeURI(path);
  } catch {
    // Keep the encoded path when it does not decode.
  }
  const address = `${url.host}${path}`.replace(/\/$/, "");
  const bare = (text: string) =>
    text
      .trim()
      .toLowerCase()
      .replace(/^www\./, "");
  return bare(site.siteName) === bare(address) ? null : address;
}

/**
 * Builds the share card for a post: layout, text, images, and the QR code
 * for its address.
 *
 * @param post - Post record; `body` is the TipTap JSON the summary is cut from
 * @param view - The same post as the timeline renders it
 * @param media - The post's attachments, in order
 * @param site - Site name, avatar, and the origin the QR code points at
 * @returns Render-ready share card view
 *
 * @example
 * ```ts
 * const card = buildShareCardView(post, postView, media, site);
 * card.layout; // "article" for a titled note
 * ```
 */
export function buildShareCardView(
  post: Pick<Post, "id" | "format" | "body" | "previewImageKey">,
  view: PostView,
  media: Media[],
  site: ShareCardSite,
): ShareCardView {
  const layout: ShareCardLayout =
    post.format === "note" ? (view.title ? "article" : "note") : post.format;

  // The timeline's limits: an untitled note shows most of itself, anything
  // else a short teaser. An author's read-more break wins over both.
  const summary = post.body
    ? layout === "note"
      ? extractSummaryHtml(
          post.body,
          NOTE_SUMMARY_MAX_BLOCKS,
          NOTE_SUMMARY_MAX_CHARS,
          NOTE_SUMMARY_MIN_HIDDEN_CHARS,
          { namespace: post.id },
        )
      : extractSummaryHtml(
          post.body,
          ARTICLE_SUMMARY_MAX_BLOCKS,
          ARTICLE_SUMMARY_MAX_CHARS,
          0,
          { namespace: post.id },
        )
    : null;

  const permalink = new URL(view.permalink, site.siteOrigin).toString();
  const safeUrl = view.url ? sanitizeUrl(view.url) : "";
  const domain = safeUrl
    ? (extractDisplayDomain(safeUrl) ?? undefined)
    : undefined;

  return {
    layout,
    siteName: site.siteName,
    avatarUrl: site.siteAvatar
      ? storagePath(site.siteAvatar, site.sitePathPrefix)
      : null,
    date: view.publishedAtFormatted,
    title: layout === "article" ? view.title : undefined,
    bodyHtml: summary?.html || undefined,
    hasMore: summary?.hasMore ?? false,
    quote:
      layout === "quote" && view.quoteText
        ? {
            text: view.quoteText,
            size: quoteSize(view.quoteText),
            attribution: view.title || undefined,
            source: domain,
          }
        : undefined,
    link:
      layout === "link"
        ? { title: view.title || undefined, domain }
        : undefined,
    ...cardImages(media, post.previewImageKey, site.sitePathPrefix),
    ...cardFiles(media),
    permalink,
    siteAddress: toSiteAddress(site),
    qrSvg: renderSVG(permalink, { ecc: "M", border: 2 }),
    fileName: view.slug,
    language: view.language,
  };
}

/**
 * Loads a post, and the posts of its Thread the card shows around it, and
 * builds its share card.
 *
 * @param c - Hono context (services + appConfig)
 * @param postId - TypeID of the post
 * @returns The card, or null when the post is missing or cannot be shared
 */
export async function assembleShareCard(
  c: Context<Env>,
  postId: string,
): Promise<ShareCardView | null> {
  const post = await c.var.services.posts.getById(postId);
  if (!post || !canShareAsImage(post)) return null;

  // Published posts only: the card shows what a reader opening the QR code
  // finds there, never an unpublished reply.
  const threadPosts = (
    await c.var.services.posts.getThread(post.threadId)
  ).filter((threadPost) => threadPost.status === "published");
  const window = threadWindow(
    threadPosts,
    threadPosts.findIndex((threadPost) => threadPost.id === post.id),
  );
  const contextPosts = window
    ? [window.root, window.next].filter(
        (contextPost): contextPost is Post => contextPost !== null,
      )
    : [];

  const appConfig = c.var.appConfig;
  const mediaCtx = createMediaContext(appConfig);
  const [rawMediaMap, aliasesMap] = await Promise.all([
    c.var.services.media.getByPostIds([
      post.id,
      ...contextPosts.map((contextPost) => contextPost.id),
    ]),
    c.var.services.paths.getPostAliases([post.id]),
  ]);
  const mediaMap = buildMediaMap(
    rawMediaMap,
    mediaCtx.r2PublicUrl,
    mediaCtx.imageTransformUrl,
    mediaCtx.s3PublicUrl,
    mediaCtx.localPublicUrl,
    mediaCtx.sitePathPrefix,
  );
  const view = toPostView(
    { ...post, mediaAttachments: mediaMap.get(post.id) ?? [] },
    mediaCtx,
    undefined,
    true,
    aliasesMap.get(post.id)?.[0],
  );

  const card = buildShareCardView(post, view, rawMediaMap.get(post.id) ?? [], {
    siteName: appConfig.siteName,
    siteAvatar: appConfig.siteAvatar,
    // A site without SITE_ORIGIN is reached at whatever host serves it.
    siteOrigin: appConfig.siteOrigin || new URL(c.req.url).origin,
    sitePathPrefix: appConfig.sitePathPrefix,
  });
  if (!window) return card;

  const context = (contextPost: Post | null): ShareCardThreadPost | null =>
    contextPost
      ? buildShareCardThreadPost(
          contextPost,
          toPostView(
            {
              ...contextPost,
              mediaAttachments: mediaMap.get(contextPost.id) ?? [],
            },
            mediaCtx,
          ),
          rawMediaMap.get(contextPost.id) ?? [],
          appConfig.sitePathPrefix,
        )
      : null;
  return {
    ...card,
    thread: {
      position: window.position,
      total: window.total,
      root: context(window.root),
      hidden: window.hidden,
      next: context(window.next),
    },
  };
}
