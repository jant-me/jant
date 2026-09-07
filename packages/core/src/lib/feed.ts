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
import { extractTimelineSummary } from "./summary.js";
import { getLinkPreviewProviderLabel } from "./link-preview.js";
import { extractDisplayDomain } from "./url.js";
import { getMediaCategory } from "./upload.js";

/**
 * Media RSS namespace. Atom's own `<link rel="enclosure">` has no slots for
 * pixel dimensions, duration, or a description, so the richer per-attachment
 * metadata rides in this extension alongside it — enclosure stays because it
 * is the only attachment mechanism a plain Atom parser understands.
 */
const MEDIA_RSS_NAMESPACE_URI = "http://search.yahoo.com/mrss/";

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
  /**
   * Render only what a summary carries: the timeline's truncated body, the
   * quoted text, the rating. Media, link previews and the ★ permalink are the
   * post's content, and a consumer reads those from `<content>` or from the
   * Media RSS elements.
   */
  summary?: boolean;
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
    // One rendering whether or not the clip has a poster frame — the still is
    // an attribute here, not a branch. `preload="none"` is load-bearing: a
    // reader painting a timeline must not start pulling a 28 MB file.
    //
    // `thumbnailUrl` is a real still only for images; the media pipeline
    // leaves it pointing at the file itself for everything else, so a clip
    // with no poster key would otherwise poster itself with its own MP4.
    //
    // The link sits in the `<figcaption>`, outside the `<video>`, rather than
    // as its fallback child: a sanitizer that drops a disallowed element takes
    // its children with it, and out here the clip stays reachable whichever
    // way a reader's allowlist goes. That makes inlining the player a pure
    // upgrade over the old poster-thumbnail rendering — worst case it degrades
    // to exactly the link that rendering already offered.
    const posterSource = (item.posterUrl || item.thumbnailUrl)?.trim();
    const posterAttr =
      posterSource && posterSource !== item.url
        ? ` poster="${escapeXml(toAbsoluteFeedUrl(posterSource, siteUrl))}"`
        : "";
    const dims =
      item.width && item.height
        ? ` width="${item.width}" height="${item.height}"`
        : "";
    const metaSuffix = meta ? ` (${escapeXml(meta)})` : "";
    // `<video>` has no `alt`, so the description a poster image used to carry
    // moves into the caption rather than being dropped.
    const altSuffix = caption ? `: ${escapeXml(caption)}` : "";
    return (
      `<figure><video controls preload="none"${posterAttr}${dims}>` +
      `<source src="${url}" type="${escapeXml(cleanMimeType(item.mimeType))}"/>` +
      `</video><figcaption><a href="${url}">▶ Watch video</a>${metaSuffix}${altSuffix}</figcaption></figure>`
    );
  }

  if (category === "audio") {
    const linkText = buildAttachmentLinkText(item, "Audio");
    const suffix = meta ? ` (${escapeXml(meta)})` : "";
    return `<p><a href="${url}">${linkText}</a>${suffix}</p>`;
  }

  if (category === "text") {
    const previewHref = escapeXml(
      getMediaPageUrl(item, siteUrl, postPermalinkUrl),
    );
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
  const items = media
    .map((item) => renderMediaItem(item, siteUrl, postPermalinkUrl))
    .join("\n");
  // The site lays a post's attachments out as one horizontally scrolling strip
  // and marks that container `data-post-media`, which is part of the markup
  // contract themes and external scripts already read. Carrying the same
  // container into the feed lets a consumer style the strip instead of
  // reassembling it from the Media RSS elements — and in a thread it puts each
  // post's attachments next to that post's own text, which a flat list cannot.
  // A reader that ignores the attribute stacks the figures exactly as before.
  return `<div data-post-media>\n${items}\n</div>`;
}

/**
 * The truncated body the site's timeline renders for this post, at the same
 * boundary the page uses.
 *
 * Derived here rather than read off `PostView.summaryHtml`, which exists only
 * for titled posts: an untitled note expands in place on the page, so the card
 * renders the full body with a break marker and never needs a second HTML
 * string. `NoteCard` reads `summaryHtml ?? bodyHtml`, so populating it for
 * notes to serve the feed would silently switch the site off expand-in-place.
 * `PostView.body` carries the source document, so the feed derives its own.
 *
 * @param post - Post view data, carrying the TipTap document in `body`
 * @returns Truncated HTML and whether content continues, or null when the post
 *   has no TipTap document to truncate
 * @example
 * getTimelineSummary(post) // { html: "<p>Intro</p>", hasMore: true }
 */
function getTimelineSummary(
  post: PostView,
): { html: string; hasMore: boolean } | null {
  return extractTimelineSummary(post.body, !!post.title, {
    namespace: post.id,
  });
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

  let quoteRendered = false;
  if (post.format === "quote" && post.quoteText) {
    const sourceName = post.title || "";
    const sourceUrl = post.url || "";
    const attribution = sourceName || sourceUrl;
    const cite = sourceUrl ? ` cite="${escapeXml(sourceUrl)}"` : "";
    const quoteHtml = renderPlainTextHtml(post.quoteText);
    const source = attribution
      ? sourceUrl
        ? `<a href="${escapeXml(sourceUrl)}">${escapeXml(sourceName || extractDisplayDomain(sourceUrl) || sourceUrl)}</a>`
        : escapeXml(attribution)
      : "";
    if (quoteHtml) {
      // `<figure>`/`<figcaption>` is how the site card groups the quote with
      // its source (`h-cite`), and how this renderer already pairs media with
      // a caption. A loose `<p>— source</p>` sibling said neither.
      const caption = source ? `<figcaption>— ${source}</figcaption>` : "";
      parts.push(
        `<figure><blockquote${cite}>${quoteHtml}</blockquote>${caption}</figure>`,
      );
      quoteRendered = true;
    } else if (source) {
      parts.push(`<p>— ${source}</p>`);
    }
  }

  // The preview image is media: `<media:thumbnail>` carries it for a consumer
  // laying out its own card, so the summary has no reason to repeat the markup.
  if (!options.summary) {
    const linkPreviewHtml = renderLinkPreviewForFeed(post, siteUrl);
    if (linkPreviewHtml) {
      parts.push(linkPreviewHtml);
    }
  }

  // In summary mode the body is the timeline's truncated rendering; a post
  // without a TipTap document (legacy plain-text rows) has nothing to truncate
  // and keeps its full body.
  const bodyHtml = options.summary
    ? (getTimelineSummary(post)?.html ?? post.bodyHtml)
    : post.bodyHtml;

  if (bodyHtml) {
    // The site draws a hairline between a quote and the author's commentary
    // (`.feed-quote-commentary::before` in ui.css). Feed readers strip CSS, so
    // that separator only survives as an element.
    if (quoteRendered) parts.push("<hr/>");
    parts.push(absolutizeFeedHtmlUrls(stripUnsafeFeedHtml(bodyHtml), siteUrl));
  }

  // Media belongs to `<content>` and to `<media:content>`, not here. A feed
  // cannot express the timeline's justified row anyway — the consumer computes
  // it from the dimensions on `<media:content>` — so a consumer that lays out
  // its own card wants this field to be the text and nothing else.
  if (!options.summary) {
    const mediaHtml = renderMediaForFeed(post.media, siteUrl, permalinkUrl);
    if (mediaHtml) {
      parts.push(mediaHtml);
    }
  }

  if (post.rating && post.rating > 0) {
    parts.push(renderRatingHtml(post.rating));
  }

  // An entry's content cannot be empty, so a post with nothing but a title or
  // a URL falls back to its plain-text projection. A summary can be empty —
  // that is what "there is no shorter rendering" looks like — and must be: a
  // post carrying only attachments has no text to summarise, and the fallback
  // would put a bare `Post #<id>` where a teaser belongs.
  if (parts.length === 0 && !options.summary) {
    parts.push(`<p>${escapeXml(getFeedSummaryText(post))}</p>`);
  }

  // For link posts, append a ★ permalink back to the blog post (Daring Fireball
  // style). A feed convention, not something the site's card shows, so it stays
  // out of the summary.
  if (post.format === "link" && permalinkUrl && !options.summary) {
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

/**
 * Build the HTML for a feed entry's `<summary>` — the entry's text, as the
 * timeline shows it: truncated at the same boundary, quoted text and rating
 * included, a thread folded to its root, a gap link and its newest reply.
 *
 * Text only. Media is in `<content>` and, structured, in the Media RSS
 * elements — and it has to be read from there anyway, because a feed cannot
 * express the timeline's justified row and a consumer has to compute it from
 * the dimensions. So the field a consumer reaches for to draw its own card
 * carries the words, and nothing it would have to strip back out.
 *
 * Comes back empty for a post with no text at all — a photo with no caption —
 * and the caller drops the element there. That is the only reason it is ever
 * missing, which makes `summary ?? ""` the whole of a consumer's rule; Atom
 * only mandates a summary for `src`/base64 content (RFC 4287 §4.1.2).
 *
 * @param post - Root post view data
 * @param siteUrl - Site base URL for absolute permalinks
 * @param permalinkUrl - Absolute permalink URL for the root post
 * @returns The entry's text as the timeline renders it, or "" when it has none
 * @example
 * buildFeedSummary(post, "https://example.com", "https://example.com/hello")
 * // "<p>Intro</p>\n<hr/>\n<p><small><a …>2 more posts</a></small></p>…"
 */
function buildFeedSummary(
  post: FeedPostView,
  siteUrl: string,
  permalinkUrl?: string,
): string {
  const replies = post.threadReplies ?? [];
  const latestReply = replies.at(-1);
  // The timeline keeps the root as context and the newest reply as the hero,
  // collapsing everything between into a count. One reply is the hero, so
  // nothing is hidden.
  const hiddenCount = Math.max(0, replies.length - 1);

  const parts: string[] = [];
  const rootMarkup = buildSinglePostContent(post, siteUrl, permalinkUrl, {
    summary: true,
  });
  if (rootMarkup) parts.push(rootMarkup);

  const firstHidden = replies[0];
  if (hiddenCount > 0 && firstHidden) {
    // The site's gap marker is a link to the first post it hides
    // (`ThreadPreview`'s `gapHref`), not just a count — in a feed there is no
    // toggle to expand context, so the link is the only way through.
    const gapHref = escapeXml(
      toAbsoluteFeedUrl(firstHidden.permalink, siteUrl),
    );
    const label =
      hiddenCount === 1 ? "1 more post" : `${hiddenCount} more posts`;
    if (parts.length > 0) parts.push("<hr/>");
    parts.push(`<p><small><a href="${gapHref}">${label}</a></small></p>`);
  }

  if (latestReply) {
    const replyPermalink = new URL(latestReply.permalink, siteUrl).toString();
    const replyMarkup = buildSinglePostContent(
      latestReply,
      siteUrl,
      replyPermalink,
      { inline: true, summary: true },
    );
    if (replyMarkup) {
      if (parts.length > 0) parts.push("<hr/>");
      parts.push(
        `<p><small><time datetime="${escapeXml(latestReply.publishedAt)}">${escapeXml(latestReply.publishedAtFormatted)}</time></small></p>`,
      );
      parts.push(replyMarkup);
    }
  }

  return parts.join("\n");
}

/**
 * Whether the summary's text is shorter than the post's own.
 *
 * `<summary>` is sent whenever an entry has text, so its presence says nothing
 * about truncation — but a consumer drawing the timeline needs to know whether
 * to offer the "Read more" the site offers. Covers the newest reply too, since
 * that is the post a thread's summary shows in full.
 *
 * @param post - Root post view data
 * @returns true when some text in the summary was cut
 * @example
 * isEntryTruncated(longArticle); // true
 */
function isEntryTruncated(post: FeedPostView): boolean {
  if (getTimelineSummary(post)?.hasMore === true) return true;
  const latestReply = post.threadReplies?.at(-1);
  return latestReply
    ? getTimelineSummary(latestReply)?.hasMore === true
    : false;
}

/**
 * Media RSS `medium` for an attachment. The vocabulary is fixed
 * (image/audio/video/document/executable), so everything that is not a
 * playable or visual file is a document.
 */
function getMediaRssMedium(mimeType: string): string {
  const category = getMediaCategory(mimeType);
  if (category === "image") return "image";
  if (category === "video") return "video";
  if (category === "audio") return "audio";
  return "document";
}

/**
 * Render one attachment as `<media:content>`, carrying the dimensions,
 * duration, size, and description that Atom's `<link rel="enclosure">` has
 * nowhere to put.
 *
 * @param item - Attachment view data
 * @param siteUrl - Site base URL, for absolutizing stored paths
 * @returns A `<media:content>` element, newline-prefixed for entry indentation
 * @example
 * renderMediaRssContent(photo, "https://example.com")
 * // '\n    <media:content url="…" type="image/jpeg" medium="image" …/>'
 */
function renderMediaRssContent(
  { item, postPermalinkUrl }: EntryMedia,
  siteUrl: string,
): string {
  const fileUrl = toAbsoluteFeedUrl(item.url, siteUrl);
  const attrs = [
    `url="${escapeXml(fileUrl)}"`,
    `type="${escapeXml(item.mimeType)}"`,
    `medium="${getMediaRssMedium(item.mimeType)}"`,
  ];

  if (item.size != null && item.size > 0) attrs.push(`fileSize="${item.size}"`);
  if (item.width != null && item.width > 0) attrs.push(`width="${item.width}"`);
  if (item.height != null && item.height > 0) {
    attrs.push(`height="${item.height}"`);
  }
  if (item.durationSeconds != null && item.durationSeconds > 0) {
    attrs.push(`duration="${Math.round(item.durationSeconds)}"`);
  }

  // Where to send someone who clicks the attachment, after the Media RSS
  // attributes so the foreign one stays out of their way. Only carried when it
  // is not the file itself — today that means text attachments — so a consumer
  // reads `jant:page ?? url` and needs no rule per attachment kind.
  const pageUrl = getMediaPageUrl(item, siteUrl, postPermalinkUrl);
  if (pageUrl !== fileUrl) {
    attrs.push(`jant:page="${escapeXml(pageUrl)}"`);
  }

  const children: string[] = [];
  const title = item.originalName?.trim();
  if (title) {
    children.push(
      `<media:title type="plain">${escapeXml(title)}</media:title>`,
    );
  }
  // Alt text describes a picture; a text attachment has none but carries an
  // excerpt, which is what the site prints on its card. One slot, because to a
  // consumer both answer "what is this file".
  const description = item.altText?.trim() || item.summary?.trim();
  if (description) {
    children.push(
      `<media:description type="plain">${escapeXml(description)}</media:description>`,
    );
  }
  const thumbnail = (item.posterUrl || item.thumbnailUrl)?.trim();
  if (thumbnail && thumbnail !== item.url) {
    children.push(
      `<media:thumbnail url="${escapeXml(toAbsoluteFeedUrl(thumbnail, siteUrl))}"/>`,
    );
  }

  return children.length > 0
    ? `\n    <media:content ${attrs.join(" ")}>${children.join("")}</media:content>`
    : `\n    <media:content ${attrs.join(" ")}/>`;
}

/**
 * One attachment plus the post it hangs off, since an entry's media is drawn
 * from a whole thread and a text attachment's page lives under its own post.
 */
interface EntryMedia {
  item: MediaView;
  /** Absolute permalink of the post carrying this attachment. */
  postPermalinkUrl: string;
}

function getEntryMedia(post: FeedPostView, siteUrl: string): EntryMedia[] {
  const collect = (from: PostView): EntryMedia[] => {
    const postPermalinkUrl = new URL(from.permalink, siteUrl).toString();
    return from.media.map((item) => ({ item, postPermalinkUrl }));
  };

  const media = collect(post);
  for (const reply of post.threadReplies ?? []) {
    media.push(...collect(reply));
  }
  return media;
}

/**
 * The URL a browser can usefully open for an attachment.
 *
 * For a picture, a clip or a PDF that is the file itself. A text attachment's
 * file is markdown or plain text, which a browser downloads or dumps unstyled,
 * so it points at the page that renders it instead. Consumers laying out their
 * own card follow this rather than `url`, which stays the file for fetching
 * and for the enclosure.
 *
 * @param item - Attachment view data
 * @param siteUrl - Site base URL, for absolutizing a stored path
 * @param postPermalinkUrl - Absolute permalink of the post carrying it
 * @returns An absolute URL worth opening in a browser
 * @example
 * getMediaPageUrl(note, "https://example.com", "https://example.com/hn2v7")
 * // "https://example.com/hn2v7/text/med_01m13xhg"
 */
function getMediaPageUrl(
  item: MediaView,
  siteUrl: string,
  postPermalinkUrl?: string,
): string {
  if (getMediaCategory(item.mimeType) === "text" && postPermalinkUrl) {
    return `${postPermalinkUrl}/text/${item.id}`;
  }
  return toAbsoluteFeedUrl(item.url, siteUrl);
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
      const publishedAt = post.feedPublishedAt ?? post.publishedAt;
      const updatedAt = post.feedUpdatedAt ?? post.updatedAt;

      // For link posts, add a <link rel="related"> back to the blog permalink
      const relatedLink = alternateUrl
        ? `\n    <link href="${escapedPermalink}" rel="related"/>`
        : "";

      // One <link rel="enclosure"> per attachment the content cannot already
      // show, so podcast/offline readers can fetch it. Atom omits length when
      // size is unknown; mimeType is always known from the upload pipeline.
      //
      // Images are excluded: the content already renders them full size inside
      // a link to the original, so an enclosure adds nothing a plain Atom
      // parser could not already see — it only asks readers with an attachment
      // shelf to list the picture a second time under the post. Every podcast
      // feed works this way, enclosing the audio it cannot inline while
      // leaving its inline show-note images alone.
      const entryMedia = getEntryMedia(post, siteUrl);
      const enclosureLinks = entryMedia
        .map(({ item }) => item)
        .filter((m) => getMediaCategory(m.mimeType) !== "image")
        .map((m) => {
          const lengthAttr =
            m.size != null && m.size > 0 ? ` length="${m.size}"` : "";
          const titleAttr = m.originalName
            ? ` title="${escapeXml(m.originalName)}"`
            : "";
          return `\n    <link rel="enclosure" type="${escapeXml(m.mimeType)}" href="${escapeXml(toAbsoluteFeedUrl(m.url, siteUrl))}"${lengthAttr}${titleAttr}/>`;
        })
        .join("");

      // The same attachments again, with the metadata Atom's `<link>` cannot
      // carry — pixel dimensions, duration, alt text, poster. Enclosure stays
      // above because it is what a plain Atom parser reads; this is the layer
      // a reader that knows Media RSS can lay out without fetching the file.
      const mediaContentElements = entryMedia
        .map((m) => renderMediaRssContent(m, siteUrl))
        .join("");

      // The entry's representative image, for readers that lay out cards or a
      // grid. A link post's preview is a thumbnail of someone else's page, not
      // a file the author published, so it gets no `rel="enclosure"` — that
      // would tell podcast and download clients to fetch it as content. Left
      // out, a reader has to scrape the first `<img>` out of the content HTML.
      // Dimensions are unknown: the URL is a scale-down transform of a stored
      // key, and Media RSS makes width/height optional.
      const previewImageUrl = post.previewImageUrl?.trim();
      const thumbnailElement = previewImageUrl
        ? `\n    <media:thumbnail url="${escapeXml(toAbsoluteFeedUrl(previewImageUrl, siteUrl))}"/>`
        : "";

      // What kind of post this is, in Jant's own namespace. Atom has no field
      // for it, and `<category>` is the wrong place: a reader would show
      // "quote" as a tag the author never wrote. A namespaced element is
      // invisible to readers that do not know it.
      //
      // A link post is already tellable from the `rel="related"` above, but a
      // quote and an untitled note are identical from the feed alone — both
      // carry an empty `<title>` and a body — so anything reading feeds had to
      // fetch the post's page to tell them apart. It rides on every entry
      // rather than only the ambiguous ones, because a consumer should be able
      // to read one field instead of inferring three cases.
      //
      // Core's own three formats, not a consumer's rendering distinctions: a
      // titled note is still a note here, and whether that is drawn as an
      // article is the reader's call, made from this and `<title>`.
      const formatElement = `\n    <jant:format>${escapeXml(post.format)}</jant:format>`;

      // The site's own tags for this post, which Atom has a field for — unlike
      // `<jant:format>` above, a collection is a label the author chose, so
      // showing it as one is right. Replies inherit their root's, and the site
      // prints them on the root alone, so they ride on the entry once.
      // `jant:page` because a single collection lives in the root URL
      // namespace and a site path prefix makes it unguessable from the term.
      const categoryElements = post.collections
        .map(
          (collection) =>
            `\n    <category term="${escapeXml(collection.slug)}" label="${escapeXml(collection.title)}" jant:page="${escapeXml(toAbsoluteFeedUrl(collection.url, siteUrl))}"/>`,
        )
        .join("");

      // Whether the summary's text was cut. `<summary>` is present whenever
      // there is text, so only this says whether the site would offer a
      // "Read more" — a consumer drawing its own timeline cannot tell without
      // fetching and comparing the content.
      const truncatedElement = isEntryTruncated(post)
        ? "\n    <jant:truncated/>"
        : "";

      // `<summary>` is the entry's text, `<content>` the post's full page. It
      // is present whenever there is text — a bare note repeats itself here,
      // which costs the words and nothing else, and buys a field that means one
      // thing on its own rather than one defined by what content happens to
      // hold. Missing therefore says exactly one thing: this post has no text.
      const contentMarkup = buildFeedContent(post, siteUrl, permalinkUrl);
      const summaryMarkup = buildFeedSummary(post, siteUrl, permalinkUrl);
      const summaryElement = summaryMarkup
        ? `\n    <summary type="html"><![CDATA[${escapeCdata(summaryMarkup)}]]></summary>`
        : "";

      return `
  <entry>
    <title>${escapeXml(title)}</title>
    <link href="${alternateLink}" rel="alternate"/>${relatedLink}${enclosureLinks}
    <id>${escapedPermalink}</id>
    <published>${publishedAt}</published>
    <updated>${updatedAt}</updated>${formatElement}${truncatedElement}${categoryElements}${thumbnailElement}${mediaContentElements}${summaryElement}
    <content type="html"><![CDATA[${escapeCdata(contentMarkup)}]]></content>
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
  // same way the sitemap declares xhtml only for alternates. Two things live
  // in it now: the Discover declaration below, and every entry's format — so
  // only a feed with neither, which means an empty feed on a site that has
  // never answered Discover, leaves it out.
  const jantNs =
    discover || posts.length > 0
      ? ` xmlns:jant="${escapeXml(DISCOVER_NAMESPACE_URI)}"`
      : "";

  // Media RSS rides along only when an entry actually carries an attachment or
  // a representative image, on the same rule as the jant namespace above.
  const mediaNs = posts.some(
    (post) =>
      getEntryMedia(post, siteUrl).length > 0 ||
      Boolean(post.previewImageUrl?.trim()),
  )
    ? ` xmlns:media="${escapeXml(MEDIA_RSS_NAMESPACE_URI)}"`
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
<feed xmlns="http://www.w3.org/2005/Atom"${jantNs}${mediaNs}${langAttr}>
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
