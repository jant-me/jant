/**
 * Default Feed Renderers
 *
 * Atom and Sitemap XML generators.
 * Theme authors can import these to extend/wrap the defaults:
 *
 * @example
 * ```typescript
 * import { defaultFeedRenderer } from "@jant/core/lib/feed";
 * ```
 */

import type {
  FeedData,
  FeedPostView,
  LanguageAlternate,
  MediaView,
  PostView,
} from "../types.js";
import { DISCOVER_NAMESPACE_URI } from "./discover.js";
import { getLinkPreviewProviderLabel } from "./link-preview.js";
import { extractDisplayDomain } from "./url.js";
import { getMediaCategory } from "./upload.js";

/**
 * Escape special XML characters.
 */
function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Escape content for safe embedding inside a CDATA section.
 *
 * CDATA sections end at the first `]]>` sequence. If the content contains
 * `]]>`, we split it by closing the current CDATA section and opening a new
 * one: `]]>` becomes `]]]]><![CDATA[>`.
 *
 * @param str - Raw string to embed in CDATA
 * @returns String safe to place inside `<![CDATA[...]]>`
 */
function escapeCdata(str: string): string {
  return str.replaceAll("]]>", "]]]]><![CDATA[>");
}

/**
 * Resolve a URL for use outside the feed document's browser context.
 *
 * Feed readers do not consistently resolve root-relative URLs found inside
 * Atom HTML content or enclosure attributes, so every non-fragment URL must
 * carry its own origin.
 */
function toAbsoluteFeedUrl(url: string, siteUrl: string): string {
  const normalizedUrl = url.trim();
  if (!normalizedUrl || normalizedUrl.startsWith("#")) return normalizedUrl;

  try {
    const baseUrl = siteUrl.endsWith("/") ? siteUrl : `${siteUrl}/`;
    return new URL(normalizedUrl, baseUrl).toString();
  } catch {
    return normalizedUrl;
  }
}

/**
 * Resolve navigational and media URL attributes inside trusted post HTML.
 *
 * Fragment-only links stay local to the rendered feed entry so footnotes and
 * other in-entry references continue to work.
 */
function absolutizeFeedHtmlUrls(html: string, siteUrl: string): string {
  return html.replaceAll(
    /(\s)(href|poster|src)=(["'])([^"']*)\3/gi,
    (
      match,
      whitespace: string,
      attribute: string,
      quote: string,
      url: string,
    ) => {
      const absoluteUrl = toAbsoluteFeedUrl(url, siteUrl);
      return absoluteUrl
        ? `${whitespace}${attribute}=${quote}${absoluteUrl}${quote}`
        : match;
    },
  );
}

/**
 * Strip embedded content that is unsafe or unsupported in feed readers.
 *
 * - `<figure class="tiptap-embed-figure">` is replaced by its fallback link
 *   (rendered by `renderEmbedFigure`), so subscribers still get a clickable
 *   "Watch on YouTube →" line. Atom/RSS readers reject `<iframe>` outright.
 * - `<div class="tiptap-html-block">` (raw HTML escape hatch) is dropped
 *   wholesale — author-pasted HTML is for the live site only.
 * - Stray `<iframe>`, `<script>`, and `<style>` are removed defensively.
 */
function stripUnsafeFeedHtml(html: string): string {
  return html
    .replaceAll(
      /<figure\b[^>]*class="[^"]*\btiptap-embed-figure\b[^"]*"[^>]*>([\s\S]*?)<\/figure>/gi,
      (_match, inner: string) => {
        const fallback = inner.match(
          /<a\b[^>]*class="[^"]*\btiptap-embed-fallback\b[^"]*"[^>]*>[\s\S]*?<\/a>/i,
        );
        return fallback ? `<p>${fallback[0]}</p>` : "";
      },
    )
    .replaceAll(
      /<div\b[^>]*class="[^"]*\btiptap-html-block\b[^"]*"[^>]*>[\s\S]*?<\/div>/gi,
      "",
    )
    .replaceAll(/<iframe\b[^>]*>[\s\S]*?<\/iframe>/gi, "")
    .replaceAll(/<iframe\b[^>]*\/?>/gi, "")
    .replaceAll(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, "");
}

function getFeedSummaryText(post: PostView): string {
  if (post.format === "quote") {
    return (
      post.summary ||
      post.excerpt ||
      post.quoteText ||
      post.title ||
      post.url ||
      `Post #${post.id}`
    );
  }

  return (
    post.summary || post.excerpt || post.title || post.url || `Post #${post.id}`
  );
}

function getAtomTitle(post: PostView): string {
  if (post.format === "quote") return "";
  return post.title || "";
}

interface SinglePostContentOptions {
  /**
   * Inline posts do not have their own Atom entry title/link, so their visible
   * feed HTML must carry title and link metadata that top-level entries expose
   * through Atom fields.
   */
  inline?: boolean;
}

function renderLinkedText(text: string, href?: string): string {
  const label = escapeXml(text);
  return href ? `<a href="${escapeXml(href)}">${label}</a>` : label;
}

function renderInlinePostHeader(
  post: PostView,
  permalinkUrl?: string,
): string[] {
  if (post.format === "quote") return [];

  const parts: string[] = [];

  if (post.format === "link") {
    const linkUrl = post.url || "";
    const domain = linkUrl ? extractDisplayDomain(linkUrl) || linkUrl : "";
    if (domain) {
      parts.push(`<p>${renderLinkedText(domain, linkUrl)}</p>`);
    }
    if (post.title) {
      parts.push(
        `<h2>${renderLinkedText(post.title, linkUrl || permalinkUrl)}</h2>`,
      );
    }
    return parts;
  }

  if (post.title) {
    parts.push(`<h2>${renderLinkedText(post.title, permalinkUrl)}</h2>`);
  }

  return parts;
}

/**
 * Render author-authored plain text as feed-safe HTML, preserving its breaks.
 *
 * The site keeps quote line breaks with `white-space: pre-line`, but feed
 * readers strip CSS, so the breaks have to be structural: a blank line starts
 * a new `<p>`, a single newline becomes a `<br/>`.
 *
 * @param text - Raw plain text as the author typed it
 * @returns One or more `<p>` blocks, or an empty string for blank input
 * @example
 * renderPlainTextHtml("one\ntwo\n\nthree")
 * // => "<p>one<br/>two</p>\n<p>three</p>"
 */
function renderPlainTextHtml(text: string): string {
  return text
    .replaceAll("\r\n", "\n")
    .replaceAll("\r", "\n")
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter((block) => block.length > 0)
    .map((block) => `<p>${escapeXml(block).replaceAll("\n", "<br/>")}</p>`)
    .join("\n");
}

/**
 * Render a star rating as HTML for feed content.
 */
function renderRatingHtml(rating: number): string {
  const filled = "★".repeat(rating);
  const empty = "☆".repeat(5 - rating);
  return `<p>${filled}${empty} ${rating}/5</p>`;
}

/**
 * Render a Link post preview as feed-safe HTML.
 *
 * Feed readers commonly strip CSS overlays and embedded players, so video
 * previews use a linked thumbnail plus a visible provider-aware action.
 * Non-video Link previews keep the linked thumbnail without a video label.
 */
function renderLinkPreviewForFeed(post: PostView, siteUrl: string): string {
  if (post.format !== "link") return "";

  const imageUrl = post.previewImageUrl?.trim();
  const linkUrl = post.url?.trim();
  if (!imageUrl || !linkUrl) return "";

  const isVideo = post.previewKind?.trim().toLowerCase() === "video";
  const providerLabel = getLinkPreviewProviderLabel(post.previewProvider);
  const fallbackAlt = isVideo
    ? providerLabel
      ? `${providerLabel} video`
      : "Video preview"
    : "Link preview";
  const altText = post.title?.trim() || fallbackAlt;
  const caption = isVideo
    ? `<figcaption><a href="${escapeXml(linkUrl)}">▶ ${providerLabel ? `Watch on ${providerLabel}` : "Watch video"}</a></figcaption>`
    : "";

  return `<figure><a href="${escapeXml(linkUrl)}"><img src="${escapeXml(toAbsoluteFeedUrl(imageUrl, siteUrl))}" alt="${escapeXml(altText)}"/></a>${caption}</figure>`;
}

function formatFeedBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatFeedDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function getMediaMeta(item: MediaView): string {
  const parts: string[] = [];
  if (item.durationSeconds != null && item.durationSeconds > 0) {
    parts.push(formatFeedDuration(item.durationSeconds));
  }
  if (item.size != null && item.size > 0) {
    parts.push(formatFeedBytes(item.size));
  }
  return parts.join(" · ");
}

/**
 * Strip MIME type parameters like `; charset=utf-8` so the visible label
 * stays compact (e.g. `text/html` instead of `text/html; charset=utf-8`).
 */
function cleanMimeType(mimeType: string): string {
  const semi = mimeType.indexOf(";");
  return (semi >= 0 ? mimeType.slice(0, semi) : mimeType).trim();
}

/**
 * Build the visible link text for non-visual attachments — paperclip +
 * MIME-type tag + filename. Marks the line clearly as an attachment so it
 * doesn't get mistaken for body text.
 */
function buildAttachmentLinkText(
  item: MediaView,
  fallbackName: string,
): string {
  const name = item.originalName?.trim() || fallbackName;
  const mime = cleanMimeType(item.mimeType);
  return `📎 [${escapeXml(mime)}] ${escapeXml(name)}`;
}

/**
 * Render a single media attachment as HTML for embedding in feed content.
 *
 * - Images embed as `<figure><a><img/></a><figcaption/></figure>` with alt
 *   used as caption when present.
 * - Videos render as a poster thumbnail linked to the file with a caption
 *   describing the action — feed reader support for `<video>` is uneven, so
 *   we never inline the player.
 * - Audio, text, and document attachments render as plain links with size
 *   and duration metadata when known. Text attachments link to the rendered
 *   preview page when a post permalink is available.
 */
function renderMediaItem(
  item: MediaView,
  siteUrl: string,
  postPermalinkUrl?: string,
): string {
  const category = getMediaCategory(item.mimeType);
  const url = escapeXml(toAbsoluteFeedUrl(item.url, siteUrl));
  const name = item.originalName ?? "";
  const altText = item.altText ?? "";
  const caption = item.altText?.trim() || "";
  const meta = getMediaMeta(item);

  if (category === "image") {
    const dims =
      item.width && item.height
        ? ` width="${item.width}" height="${item.height}"`
        : "";
    const figcaption = caption
      ? `<figcaption>${escapeXml(caption)}</figcaption>`
      : "";
    return `<figure><a href="${url}"><img src="${url}" alt="${escapeXml(altText)}"${dims}/></a>${figcaption}</figure>`;
  }

  if (category === "video") {
    const poster = toAbsoluteFeedUrl(
      item.posterUrl || item.thumbnailUrl,
      siteUrl,
    );
    const dims =
      item.width && item.height
        ? ` width="${item.width}" height="${item.height}"`
        : "";
    // Prefix the caption with a ▶ glyph as a video cue. A CSS overlay would
    // be stripped by most feed-reader sanitizers, so a plain-text play
    // character is the only marker that renders reliably everywhere. Link
    // only the "Watch video" action label (so it's clickable like the
    // thumbnail and reads cleanly to screen readers); metadata stays outside
    // the link in parens, matching the audio/text/document attachment style.
    const metaSuffix = meta ? ` (${escapeXml(meta)})` : "";
    return `<figure><a href="${url}"><img src="${escapeXml(poster)}" alt="${escapeXml(altText || name)}"${dims}/></a><figcaption><a href="${url}">▶ Watch video</a>${metaSuffix}</figcaption></figure>`;
  }

  if (category === "audio") {
    const linkText = buildAttachmentLinkText(item, "Audio");
    const suffix = meta ? ` (${escapeXml(meta)})` : "";
    return `<p><a href="${url}">${linkText}</a>${suffix}</p>`;
  }

  if (category === "text") {
    const previewHref = postPermalinkUrl
      ? escapeXml(`${postPermalinkUrl}/text/${item.id}`)
      : url;
    const linkText = buildAttachmentLinkText(item, "Attached text");
    // Prefer character count over byte size — more meaningful for text.
    const textMeta =
      typeof item.chars === "number" && item.chars > 0
        ? `${item.chars} chars`
        : meta;
    const metaSuffix = textMeta ? ` (${escapeXml(textMeta)})` : "";
    const summary = item.summary?.trim() ?? "";
    const summarySuffix = summary ? `: ${escapeXml(summary)}` : "";
    return `<p><a href="${previewHref}">${linkText}</a>${metaSuffix}${summarySuffix}</p>`;
  }

  // document, archive, office, font, 3d, code → plain link
  const linkText = buildAttachmentLinkText(item, "Attachment");
  const suffix = meta ? ` (${escapeXml(meta)})` : "";
  return `<p><a href="${url}">${linkText}</a>${suffix}</p>`;
}

/**
 * Render all media attachments for a post as HTML for embedding in feed
 * content. Returns an empty string when the post has no media.
 */
function renderMediaForFeed(
  media: MediaView[],
  siteUrl: string,
  postPermalinkUrl?: string,
): string {
  if (media.length === 0) return "";
  return media
    .map((item) => renderMediaItem(item, siteUrl, postPermalinkUrl))
    .join("\n");
}

/**
 * Build the HTML content for a single post (root or reply).
 *
 * @param post - Post view data
 * @param permalinkUrl - Absolute permalink URL back to the blog post
 * @param options - Rendering options for top-level versus inline posts
 */
function buildSinglePostContent(
  post: PostView,
  siteUrl: string,
  permalinkUrl?: string,
  options: SinglePostContentOptions = {},
): string {
  const parts: string[] = [];

  if (options.inline) {
    parts.push(...renderInlinePostHeader(post, permalinkUrl));
  }

  if (post.format === "quote" && post.quoteText) {
    const sourceName = post.title || "";
    const sourceUrl = post.url || "";
    const attribution = sourceName || sourceUrl;
    const cite = sourceUrl ? ` cite="${escapeXml(sourceUrl)}"` : "";
    const quoteHtml = renderPlainTextHtml(post.quoteText);
    if (quoteHtml) {
      parts.push(`<blockquote${cite}>${quoteHtml}</blockquote>`);
    }
    if (attribution) {
      const source = sourceUrl
        ? `<a href="${escapeXml(sourceUrl)}">${escapeXml(sourceName || extractDisplayDomain(sourceUrl) || sourceUrl)}</a>`
        : escapeXml(attribution);
      parts.push(`<p>— ${source}</p>`);
    }
  }

  const linkPreviewHtml = renderLinkPreviewForFeed(post, siteUrl);
  if (linkPreviewHtml) {
    parts.push(linkPreviewHtml);
  }

  if (post.bodyHtml) {
    parts.push(
      absolutizeFeedHtmlUrls(stripUnsafeFeedHtml(post.bodyHtml), siteUrl),
    );
  }

  const mediaHtml = renderMediaForFeed(post.media, siteUrl, permalinkUrl);
  if (mediaHtml) {
    parts.push(mediaHtml);
  }

  if (post.rating && post.rating > 0) {
    parts.push(renderRatingHtml(post.rating));
  }

  if (parts.length === 0) {
    parts.push(`<p>${escapeXml(getFeedSummaryText(post))}</p>`);
  }

  // For link posts, append a ★ permalink back to the blog post (Daring Fireball style)
  if (post.format === "link" && permalinkUrl) {
    parts.push(
      `<p><a href="${escapeXml(permalinkUrl)}" title="Permalink">&nbsp;★&nbsp;</a></p>`,
    );
  }

  return parts.join("\n");
}

/**
 * Build the full HTML content for a feed entry, including thread replies.
 *
 * @param post - Root post view data
 * @param siteUrl - Site base URL for building absolute permalinks
 * @param permalinkUrl - Absolute permalink URL for the root post
 */
function buildFeedContent(
  post: FeedPostView,
  siteUrl: string,
  permalinkUrl?: string,
): string {
  const rootContent = buildSinglePostContent(post, siteUrl, permalinkUrl);
  const replies = post.threadReplies;

  if (!replies || replies.length === 0) {
    return rootContent;
  }

  const parts = [rootContent];

  for (const reply of replies) {
    const replyPermalink = new URL(reply.permalink, siteUrl).toString();
    parts.push("<hr/>");
    parts.push(
      `<p><small><time datetime="${escapeXml(reply.publishedAt)}">${escapeXml(reply.publishedAtFormatted)}</time></small></p>`,
    );
    parts.push(
      buildSinglePostContent(reply, siteUrl, replyPermalink, { inline: true }),
    );
  }

  return parts.join("\n");
}

function getEntryMedia(post: FeedPostView): MediaView[] {
  const media = [...post.media];
  for (const reply of post.threadReplies ?? []) {
    media.push(...reply.media);
  }
  return media;
}

/**
 * Default Atom feed renderer.
 *
 * @param data - Feed data with FeedPostView[] (pre-computed URLs)
 * @returns Atom XML string
 */
export function defaultFeedRenderer(data: FeedData): string {
  const {
    siteName,
    siteDescription,
    siteUrl,
    siteLanguage,
    title,
    selfUrl,
    posts,
    siteIconUrl,
    discover,
    discoverFeedUrl,
    languageAlternates,
  } = data;
  const feedTitle = title ?? siteName;

  const entries = posts
    .map((post) => {
      const permalinkUrl = new URL(post.permalink, siteUrl).toString();
      const escapedPermalink = escapeXml(permalinkUrl);
      // Link-format posts point <link rel="alternate"> to the original URL
      const alternateUrl = post.format === "link" ? post.url : null;
      const alternateLink = alternateUrl
        ? escapeXml(alternateUrl)
        : escapedPermalink;
      const title = getAtomTitle(post);
      const summary = getFeedSummaryText(post);
      const publishedAt = post.feedPublishedAt ?? post.publishedAt;
      const updatedAt = post.feedUpdatedAt ?? post.updatedAt;

      // For link posts, add a <link rel="related"> back to the blog permalink
      const relatedLink = alternateUrl
        ? `\n    <link href="${escapedPermalink}" rel="related"/>`
        : "";

      // One <link rel="enclosure"> per attachment so podcast/offline readers
      // can fetch them. Atom omits length when size is unknown; mimeType is
      // always known from the upload pipeline.
      const enclosureLinks = getEntryMedia(post)
        .map((m) => {
          const lengthAttr =
            m.size != null && m.size > 0 ? ` length="${m.size}"` : "";
          const titleAttr = m.originalName
            ? ` title="${escapeXml(m.originalName)}"`
            : "";
          return `\n    <link rel="enclosure" type="${escapeXml(m.mimeType)}" href="${escapeXml(toAbsoluteFeedUrl(m.url, siteUrl))}"${lengthAttr}${titleAttr}/>`;
        })
        .join("");

      return `
  <entry>
    <title>${escapeXml(title)}</title>
    <link href="${alternateLink}" rel="alternate"/>${relatedLink}${enclosureLinks}
    <id>${escapedPermalink}</id>
    <published>${publishedAt}</published>
    <updated>${updatedAt}</updated>
    <summary type="text">${escapeXml(summary)}</summary>
    <content type="html"><![CDATA[${escapeCdata(buildFeedContent(post, siteUrl, permalinkUrl))}]]></content>
  </entry>`;
    })
    .join("");

  // The feed's own <updated> is the newest entry timestamp, not the current
  // time — stamping "now" on every render tells every reader the feed changed
  // on every poll, which is both untrue and useless for change detection.
  // ISO 8601 from toISOString() is UTC and zero-padded, so lexical max is
  // chronological max. Empty feeds fall back to now, since Atom requires it.
  const feedUpdated =
    posts
      .map((post) => post.feedUpdatedAt ?? post.updatedAt)
      .reduce<string | null>(
        (latest, value) => (latest === null || value > latest ? value : latest),
        null,
      ) ?? new Date().toISOString();

  // A feed states its own language: at the root that is the site's, and in a
  // language view it is that view's, so a reader subscribing to /en/feed gets
  // a feed their reader can label and their screen reader can pronounce.
  const langAttr = siteLanguage ? ` xml:lang="${escapeXml(siteLanguage)}"` : "";

  // The jant namespace is only declared when something in it is emitted, the
  // same way the sitemap declares xhtml only for alternates.
  const jantNs = discover
    ? ` xmlns:jant="${escapeXml(DISCOVER_NAMESPACE_URI)}"`
    : "";

  // Sibling-language feeds. `type` is carried because Atom forbids two
  // `rel="alternate"` links sharing a type/hreflang pair, and the site's own
  // HTML alternate above has neither.
  const alternateFeedLinks = (languageAlternates ?? [])
    .map(
      (alternate) =>
        `\n  <link href="${escapeXml(alternate.href)}" rel="alternate" type="application/atom+xml" hreflang="${escapeXml(alternate.hreflang)}"/>`,
    )
    .join("");

  // The Discover declaration. It rides in every feed the site emits, so a
  // crawler holding any one of them learns the site's answer and which feed
  // to poll for it. `feed` is omitted when the site is not listed — there is
  // nothing to point at.
  const discoverFeedAttr = discoverFeedUrl
    ? ` feed="${escapeXml(discoverFeedUrl)}"`
    : "";
  const discoverElement = discover
    ? `\n  <jant:discover${discoverFeedAttr}>${escapeXml(discover)}</jant:discover>`
    : "";

  // The feed's title is composed — "<site> - Latest posts" — because a reader's
  // sidebar sorts by it and one site's feeds should stay together there. That
  // leaves nothing carrying the site's own name, which is what a directory
  // needs to label a blog. `atom:author` is where a single-author blog's name
  // belongs anyway, and every feed reader already knows what to do with it.
  const authorBlock = siteName
    ? `\n  <author><name>${escapeXml(siteName)}</name></author>`
    : "";

  // `atom:icon` is the site's avatar. A reader puts it in its sidebar, and a
  // directory listing this blog has nowhere else to read one from — the feed
  // is the only machine-readable surface it is guaranteed to have fetched.
  // Atom requires an IRI, so a stored path is resolved against the site URL.
  const iconBlock = siteIconUrl
    ? `\n  <icon>${escapeXml(toAbsoluteFeedUrl(siteIconUrl, siteUrl))}</icon>`
    : "";

  return `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom"${jantNs}${langAttr}>
  <title>${escapeXml(feedTitle)}</title>
  <subtitle>${escapeXml(siteDescription)}</subtitle>${authorBlock}${iconBlock}
  <link href="${escapeXml(siteUrl)}" rel="alternate"/>
  <link href="${escapeXml(selfUrl)}" rel="self"/>${alternateFeedLinks}
  <id>${escapeXml(selfUrl)}</id>
  <updated>${feedUpdated}</updated>${discoverElement}
  ${entries}
</feed>`;
}

/**
 * Maximum URLs per sitemap shard. The sitemap.xml spec allows up to 50,000
 * per file; 500 keeps individual shards cheap to generate on D1 and makes old
 * (already-filled) shards small enough to cache aggressively at the edge.
 */
export const SITEMAP_SHARD_SIZE = 500;

/** One `<url>` entry inside a sitemap `<urlset>`. */
export interface SitemapUrlEntry {
  loc: string;
  /** ISO date (YYYY-MM-DD) or full ISO datetime */
  lastmod?: string;
  changefreq?:
    "always" | "hourly" | "daily" | "weekly" | "monthly" | "yearly" | "never";
  /** "0.0" – "1.0" */
  priority?: string;
  /**
   * Other-language versions of this URL. Sitemap `hreflang` groups must be
   * reciprocal and self-inclusive, so this lists every member of the group,
   * this URL included.
   */
  alternates?: LanguageAlternate[];
}

/** One `<sitemap>` entry inside a `<sitemapindex>`. */
export interface SitemapIndexEntry {
  loc: string;
  lastmod?: string;
}

/**
 * Render a sitemap `<urlset>` XML document from a list of URL entries.
 *
 * Used by the sharded sitemap endpoints in `routes/feed/sitemap.ts`.
 */
export function renderSitemapUrlSet(entries: SitemapUrlEntry[]): string {
  const urls = entries
    .map((entry) => {
      const parts = [`    <loc>${escapeXml(entry.loc)}</loc>`];
      if (entry.lastmod) {
        parts.push(`    <lastmod>${escapeXml(entry.lastmod)}</lastmod>`);
      }
      if (entry.changefreq) {
        parts.push(
          `    <changefreq>${escapeXml(entry.changefreq)}</changefreq>`,
        );
      }
      if (entry.priority) {
        parts.push(`    <priority>${escapeXml(entry.priority)}</priority>`);
      }
      for (const alternate of entry.alternates ?? []) {
        parts.push(
          `    <xhtml:link rel="alternate" hreflang="${escapeXml(alternate.hreflang)}" href="${escapeXml(alternate.href)}"/>`,
        );
      }
      return `  <url>\n${parts.join("\n")}\n  </url>`;
    })
    .join("\n");

  // The xhtml namespace is only meaningful for `<xhtml:link>` alternates, so
  // it is declared only when some URL carries them.
  const xhtmlNs = entries.some((entry) => entry.alternates?.length)
    ? ' xmlns:xhtml="http://www.w3.org/1999/xhtml"'
    : "";

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"${xhtmlNs}>
${urls}
</urlset>`;
}

/**
 * Render a `<sitemapindex>` XML document listing shard sitemap URLs.
 */
export function renderSitemapIndex(entries: SitemapIndexEntry[]): string {
  const items = entries
    .map((entry) => {
      const parts = [`    <loc>${escapeXml(entry.loc)}</loc>`];
      if (entry.lastmod) {
        parts.push(`    <lastmod>${escapeXml(entry.lastmod)}</lastmod>`);
      }
      return `  <sitemap>\n${parts.join("\n")}\n  </sitemap>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${items}
</sitemapindex>`;
}
