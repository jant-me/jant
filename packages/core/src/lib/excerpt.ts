/**
 * HTML Excerpt Utilities
 *
 * Generates paragraph-aware excerpts from HTML content for article
 * previews in timelines. Breaks only at paragraph boundaries.
 */

/**
 * Strips HTML tags from a string, returning plain text.
 *
 * @param html - HTML string to strip
 * @returns Plain text without HTML tags
 *
 * @example
 * ```typescript
 * stripHtml("<p>Hello <strong>world</strong></p>") // "Hello world"
 * ```
 */
export function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, "");
}

/**
 * Result of extracting an HTML excerpt.
 */
export interface HtmlExcerpt {
  /** HTML excerpt (complete paragraphs only) */
  excerpt: string;
  /** Whether the original content has more text beyond the excerpt */
  hasMore: boolean;
}

/**
 * Extracts a paragraph-aware HTML excerpt from body HTML.
 *
 * Uses a greedy algorithm: accumulates paragraphs until the total
 * plain-text length exceeds 500 characters, then stops. At least
 * one paragraph is always included.
 *
 * If the content contains a `<!--more-->` marker, the content before
 * the marker is used as the excerpt instead.
 *
 * @param bodyHtml - Full HTML body content
 * @returns Excerpt HTML and whether there is more content
 *
 * @example
 * ```typescript
 * // Short content — returned as-is with hasMore = false
 * getHtmlExcerpt("<p>Short post.</p>")
 * // { excerpt: "<p>Short post.</p>", hasMore: false }
 *
 * // Long content — truncated at paragraph boundary
 * getHtmlExcerpt("<p>" + "A".repeat(300) + "</p><p>" + "B".repeat(300) + "</p>")
 * // { excerpt: "<p>AAA...</p>", hasMore: true }
 *
 * // Manual break with <!--more-->
 * getHtmlExcerpt("<p>Intro</p><!--more--><p>Rest</p>")
 * // { excerpt: "<p>Intro</p>", hasMore: true }
 * ```
 */
export function getHtmlExcerpt(bodyHtml: string): HtmlExcerpt {
  // Honor manual <!--more--> marker
  if (bodyHtml.includes("<!--more-->")) {
    const excerpt = bodyHtml.split("<!--more-->")[0] ?? "";
    return { excerpt, hasMore: true };
  }

  const paragraphs = bodyHtml.match(/<p>[\s\S]*?<\/p>/g) || [];

  // No paragraphs found — return full content
  if (paragraphs.length === 0) {
    return { excerpt: bodyHtml, hasMore: false };
  }

  let excerpt = "";
  let charCount = 0;

  for (const p of paragraphs) {
    const textLen = stripHtml(p).length;
    if (charCount + textLen > 500 && excerpt) break;
    excerpt += p;
    charCount += textLen;
  }

  const hasMore = excerpt.length < bodyHtml.length;
  return { excerpt, hasMore };
}
