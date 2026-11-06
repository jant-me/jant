/**
 * Summary Extraction from Tiptap JSON
 *
 * Extracts plain-text and HTML summaries from a Tiptap JSON document
 * for use in feeds, meta descriptions, and article previews.
 */

import type { JSONContent } from "@tiptap/core";
import {
  renderTiptapDocument,
  type TiptapRenderOptions,
} from "./tiptap-render.js";

interface TiptapNode {
  type: string;
  content?: TiptapNode[];
  text?: string;
  marks?: Array<{
    type: string;
    attrs?: Record<string, unknown>;
  }>;
  attrs?: Record<string, unknown>;
}

/**
 * Summary limits for titled, article-style posts — the excerpt is a teaser
 * and the reader continues on the post's own page.
 */
export const ARTICLE_SUMMARY_MAX_BLOCKS = 5;
export const ARTICLE_SUMMARY_MAX_CHARS = 500;
/**
 * Larger limits for untitled notes — the body itself is the content, so the
 * preview only exists to cap runaway length.
 */
export const NOTE_SUMMARY_MAX_BLOCKS = 10;
export const NOTE_SUMMARY_MAX_CHARS = 1500;
/** Don't truncate an untitled note just to hide a tail under this many chars. */
export const NOTE_SUMMARY_MIN_HIDDEN_CHARS = 200;

/**
 * Block node types that carry user-visible content for summary extraction.
 * Structural nodes (horizontalRule, moreBreak) are excluded. Images are not
 * content blocks either: they never count toward a summary's limits, and only
 * an HTML summary that asks for them keeps any (see `SummaryImageOptions`).
 */
const SUMMARY_BLOCK_TYPES = new Set([
  "paragraph",
  "heading",
  "bulletList",
  "orderedList",
  "blockquote",
  "codeBlock",
  "table",
]);

/**
 * How much room a run of text takes on the page, in Latin characters.
 *
 * A Han, kana or hangul character is a full em wide where a Latin letter is
 * about half of one, so a 500-character Chinese teaser stands twice as tall as
 * a 500-character English one. Each East Asian wide or fullwidth character
 * counts as two, which keeps the character budgets below meaning the same
 * amount of screen in either script.
 *
 * @param text - Plain text
 * @returns Its length with wide characters counted twice
 *
 * @example
 * ```ts
 * textWidth("hello"); // 5
 * textWidth("你好"); // 4
 * ```
 */
export function textWidth(text: string): number {
  let width = 0;
  for (const char of text) {
    width += WIDE_CHAR.test(char) ? 2 : 1;
  }
  return width;
}

/** Han, kana, hangul, CJK punctuation and fullwidth forms: one em wide. */
const WIDE_CHAR =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\u3000-\u303F\uFF00-\uFF60\uFFE0-\uFFE6]/u;

/**
 * Recursively extracts plain text from a Tiptap node, ignoring marks.
 */
function extractPlainText(node: TiptapNode): string {
  if (node.type === "text") return node.text ?? "";
  if (node.type === "hardBreak") return "\n";
  if (!node.content) return "";
  return node.content.map(extractPlainText).join("");
}

/**
 * Extracts a plain-text summary from a Tiptap JSON body string.
 *
 * Algorithm:
 * 1. If a `moreBreak` node is found, collect all paragraph text before it
 * 2. Otherwise, accumulate paragraph nodes until limits are reached
 * 3. Skip headings, images, code blocks, blockquotes, lists, horizontal rules
 *
 * @param bodyJson - Tiptap JSON string
 * @param maxParagraphs - Maximum number of paragraphs to include
 * @param maxChars - Maximum total character count
 * @returns Plain text summary, or null if no paragraphs found
 *
 * @example
 * ```ts
 * const summary = extractSummary(body, 5, 500);
 * ```
 */
/**
 * Content-bearing TipTap node types whose text should be indexed for search.
 * Block-level containers (bulletList, orderedList, table, etc.) are included
 * because they recurse into child nodes that carry text.
 */
const SEARCHABLE_TYPES = new Set([
  "doc",
  "paragraph",
  "heading",
  "codeBlock",
  "bulletList",
  "orderedList",
  "listItem",
  "blockquote",
  "table",
  "tableRow",
  "tableCell",
  "tableHeader",
  "footnoteDefinition",
  "text",
  "hardBreak",
]);

/**
 * Recursively extracts all searchable plain text from a TipTap JSON body string.
 *
 * Used for FTS indexing — includes text from paragraphs, headings, code blocks,
 * lists, blockquotes, and tables. Skips non-textual nodes (image, moreBreak,
 * horizontalRule). Block-level nodes are joined with spaces for better trigram
 * matching.
 *
 * @param bodyJson - TipTap JSON string (the `body` column)
 * @param options.includeLinkHrefs
 *   When `true`, URLs from inline link marks are appended after the link text
 *   so they get indexed for search. Default `false` keeps the output clean for
 *   plain-text consumers like `toPlainText`/`extractTitle`.
 * @returns Plain text for FTS indexing, or null if parsing fails or doc is empty
 *
 * @example
 * ```ts
 * const text = extractBodyText(body);
 * // "Hello world Some code here"
 *
 * const indexed = extractBodyText(body, { includeLinkHrefs: true });
 * // "See this page https://example.com"
 * ```
 */
export function extractBodyText(
  bodyJson: string,
  options: { includeLinkHrefs?: boolean } = {},
): string | null {
  let doc: TiptapNode;
  try {
    doc = JSON.parse(bodyJson) as TiptapNode;
  } catch {
    return null;
  }

  if (doc.type !== "doc" || !doc.content) return null;

  const includeLinkHrefs = options.includeLinkHrefs === true;

  function collectText(node: TiptapNode): string {
    if (!SEARCHABLE_TYPES.has(node.type)) return "";
    if (node.type === "text") {
      const text = node.text ?? "";
      if (!includeLinkHrefs || !node.marks || node.marks.length === 0) {
        return text;
      }
      const hrefs: string[] = [];
      for (const mark of node.marks) {
        if (mark.type !== "link") continue;
        const href = mark.attrs?.href;
        if (typeof href === "string" && href.trim()) hrefs.push(href);
      }
      return hrefs.length > 0 ? `${text} ${hrefs.join(" ")}` : text;
    }
    if (node.type === "hardBreak") return " ";
    if (!node.content) return "";
    return node.content.map(collectText).join(" ");
  }

  const parts: string[] = [];
  for (const child of doc.content) {
    const text = collectText(child).trim();
    if (text) parts.push(text);
  }

  return parts.length > 0 ? parts.join(" ") : null;
}

export function extractSummary(
  bodyJson: string,
  maxBlocks: number,
  maxChars: number,
): string | null {
  let doc: TiptapNode;
  try {
    doc = JSON.parse(bodyJson) as TiptapNode;
  } catch {
    return null;
  }

  if (doc.type !== "doc" || !doc.content) return null;

  const nodes = doc.content;

  // Check for moreBreak — collect text from all content nodes before it
  const moreBreakIdx = nodes.findIndex((n) => n.type === "moreBreak");
  if (moreBreakIdx !== -1) {
    const blocks: string[] = [];
    for (let i = 0; i < moreBreakIdx; i++) {
      const node = nodes[i];
      if (!node || !SUMMARY_BLOCK_TYPES.has(node.type)) continue;
      const text = extractPlainText(node).trim();
      if (text) blocks.push(text);
    }
    return blocks.length > 0 ? blocks.join("\n\n") : null;
  }

  // No moreBreak — accumulate content blocks up to limits
  const blocks: string[] = [];
  let totalChars = 0;

  for (const node of nodes) {
    if (!SUMMARY_BLOCK_TYPES.has(node.type)) continue;

    const text = extractPlainText(node).trim();
    if (!text) continue;

    if (
      (blocks.length >= maxBlocks || totalChars + text.length > maxChars) &&
      blocks.length > 0
    )
      break;

    blocks.push(text);
    totalChars += text.length;
  }

  return blocks.length > 0 ? blocks.join("\n\n") : null;
}

/**
 * What an HTML summary keeps beyond the block and character limits.
 */
export interface SummaryOptions {
  /**
   * Keep images in the excerpt, each in its place. Before a `moreBreak`
   * marker every image is kept, since the author chose that range. Otherwise
   * the first image ahead of the cut is kept — one that sits after the last
   * kept block but before the next dropped one counts as ahead of it — and
   * the rest are left for the full page. Images never count toward the block
   * or character limit, so keeping one never pushes text out. Default
   * `false`: the excerpt is text only.
   */
  includeImages?: boolean;
  /**
   * Stop ahead of the first heading once the summary holds a text block, so
   * the summary is the post's lead: a heading opens the body proper, and a
   * teaser that ran past one showed a section title with its first paragraph
   * and nothing of the section. Headings the post opens with are kept, so a
   * post that starts with one still has a summary. This cut is structural,
   * never softened by `minHiddenChars`. Default `false`: headings are blocks
   * like any other, which is what a note wants — its body is the content and
   * the limits only cap runaway length.
   */
  stopAtHeading?: boolean;
}

/**
 * Extracts an HTML summary from a Tiptap JSON body by taking the first
 * N content-bearing block nodes and rendering them as HTML.
 *
 * Unlike the plain-text `extractSummary`, this preserves the original
 * structure (lists, blockquotes, headings, etc.) for rich previews.
 *
 * Character limits count East Asian wide characters as two
 * ({@link textWidth}), so a Chinese teaser takes the room an English one
 * does. With `stopAtHeading`, the summary is the post's lead and ends ahead
 * of its first heading; see {@link SummaryOptions}.
 *
 * @param bodyJson - Tiptap JSON string
 * @param maxBlocks - Maximum number of top-level blocks to include
 * @param maxChars - Maximum total plain-text width, in Latin characters
 * @param minHiddenChars - Tolerance for limit-based truncation: when > 0 and a
 *   block/char limit would hide a tail shorter than this many plain-text
 *   characters, the truncation is cancelled — all remaining content blocks are
 *   included and `hasMore` is `false`. Avoids a "read more" that reveals only a
 *   sliver of text. Explicit `moreBreak` markers reflect author intent and are
 *   never subject to this tolerance.
 * @param renderOptions - Renderer options such as the post footnote namespace
 * @param options - Whether the excerpt keeps images and whether it stops at
 *   a heading; see {@link SummaryOptions}
 * @returns HTML summary, whether content was truncated, and the index in
 *   `doc.content` where the content after the summary boundary begins, or null.
 *   `breakAtIndex` lets callers align the summary with the full-body rendering
 *   when splitting at the "read more" boundary (e.g. to insert an anchor).
 *   With images kept, `hasMore` is also true when an image was left out.
 *
 * @example
 * ```ts
 * const result = extractSummaryHtml(body, 5, 500);
 * // { html: "<ul><li><p>Item</p></li></ul>", hasMore: true, breakAtIndex: 1 }
 *
 * extractSummaryHtml(body, 5, 500, 0, {}, { includeImages: true });
 * // { html: "<figure><img src=\"…\"></figure><p>Intro</p>", hasMore: true, breakAtIndex: 2 }
 * ```
 */
export function extractSummaryHtml(
  bodyJson: string,
  maxBlocks: number = 5,
  maxChars: number = 500,
  minHiddenChars: number = 0,
  renderOptions: TiptapRenderOptions = {},
  options: SummaryOptions = {},
): { html: string; hasMore: boolean; breakAtIndex: number } | null {
  let doc: TiptapNode;
  try {
    doc = JSON.parse(bodyJson) as TiptapNode;
  } catch {
    return null;
  }

  if (doc.type !== "doc" || !doc.content) return null;

  const nodes = doc.content;
  const includeImages = options.includeImages === true;
  const stopAtHeading = options.stopAtHeading === true;
  const render = (indices: number[]): string => {
    const subDoc: JSONContent = {
      type: "doc",
      content: [
        ...indices
          .sort((a, b) => a - b)
          .map((i) => nodes[i])
          .filter((node): node is TiptapNode => node !== undefined),
        ...nodes.filter((node) => node.type === "footnoteDefinition"),
      ] as JSONContent[],
    };
    return renderTiptapDocument(subDoc, renderOptions);
  };

  // Check for moreBreak — take all content nodes before it
  const moreBreakIdx = nodes.findIndex((n) => n.type === "moreBreak");
  if (moreBreakIdx !== -1) {
    const selected: number[] = [];
    for (let i = 0; i < moreBreakIdx; i++) {
      const type = nodes[i]?.type ?? "";
      if (
        SUMMARY_BLOCK_TYPES.has(type) ||
        (includeImages && type === "image")
      ) {
        selected.push(i);
      }
    }
    if (selected.length === 0) return null;
    return {
      html: render(selected),
      hasMore: true,
      // Anchor goes in place of the moreBreak marker, so the marker itself
      // is NOT part of the pre-anchor body. It remains in the post-anchor
      // body as an inert HTML comment.
      breakAtIndex: moreBreakIdx,
    };
  }

  // No moreBreak — accumulate blocks up to limits.
  // Pre-extract plain text per content node so the tolerance check below can
  // measure the hidden tail without a second extraction pass.
  const contentText = new Map<number, string>();
  let totalContentChars = 0;
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    if (!node || !SUMMARY_BLOCK_TYPES.has(node.type)) continue;
    const text = extractPlainText(node).trim();
    contentText.set(i, text);
    totalContentChars += textWidth(text);
  }

  const selected: number[] = [];
  let totalChars = 0;
  let lastSelectedIdx = -1;
  let hasTextBlock = false;
  let cutAtHeading = false;
  // Index of the first content block left out, or the end of the document
  // when every block made it in.
  let cutIdx = nodes.length;

  for (const [i, text] of contentText) {
    const isHeading = nodes[i]?.type === "heading";
    const width = textWidth(text);
    if (selected.length > 0) {
      if (stopAtHeading && isHeading && hasTextBlock) {
        cutIdx = i;
        cutAtHeading = true;
        break;
      }
      if (selected.length >= maxBlocks || totalChars + width > maxChars) {
        cutIdx = i;
        break;
      }
    }

    selected.push(i);
    totalChars += width;
    lastSelectedIdx = i;
    if (!isHeading) hasTextBlock = true;
  }

  let hasMore = selected.length < contentText.size;

  // Tolerance: don't truncate just to hide a tiny tail. When a block/char limit
  // triggered the cut and the hidden content is shorter than `minHiddenChars`,
  // include the remaining content blocks instead. `moreBreak` is handled above
  // and never reaches this path; a heading cut is structural and stands.
  if (
    hasMore &&
    !cutAtHeading &&
    minHiddenChars > 0 &&
    totalContentChars - totalChars < minHiddenChars
  ) {
    for (const i of contentText.keys()) {
      if (i <= lastSelectedIdx) continue;
      selected.push(i);
      lastSelectedIdx = i;
    }
    cutIdx = nodes.length;
    hasMore = false;
  }

  let breakAtIndex = lastSelectedIdx + 1;
  if (includeImages) {
    const imageIdx = nodes.findIndex(
      (node, i) => i < cutIdx && node.type === "image",
    );
    if (imageIdx !== -1) {
      selected.push(imageIdx);
      breakAtIndex = Math.max(breakAtIndex, imageIdx + 1);
    }
    if (nodes.some((node, i) => node.type === "image" && i !== imageIdx)) {
      hasMore = true;
    }
  }

  if (selected.length === 0) return null;

  return { html: render(selected), hasMore, breakAtIndex };
}

/**
 * Extract the summary the site's timeline shows for a post, at the boundary
 * the timeline uses.
 *
 * Wraps {@link extractSummaryHtml} with the limits that decide where a card
 * stops: a titled post is an article whose excerpt is its lead, cut ahead of
 * the first heading, an untitled one is a note whose body is the content and
 * only needs a cap. Callers that need that boundary — the feed renderer, the
 * theme exporter — share this rather than repeating five numbers each.
 *
 * @param bodyJson - TipTap JSON body, or null/undefined for a post without one
 * @param hasTitle - Whether the post has a title, which makes it an article
 * @param renderOptions - Renderer options, notably the footnote namespace
 * @returns The truncated HTML and whether content continues, or null when
 *   there is no TipTap document to truncate
 * @example
 * extractTimelineSummary(post.body, !!post.title, { namespace: post.id });
 * // { html: "<p>Intro</p>", hasMore: true }
 */
export function extractTimelineSummary(
  bodyJson: string | null | undefined,
  hasTitle: boolean,
  renderOptions: TiptapRenderOptions = {},
): { html: string; hasMore: boolean } | null {
  if (!bodyJson) return null;
  const result = extractSummaryHtml(
    bodyJson,
    hasTitle ? ARTICLE_SUMMARY_MAX_BLOCKS : NOTE_SUMMARY_MAX_BLOCKS,
    hasTitle ? ARTICLE_SUMMARY_MAX_CHARS : NOTE_SUMMARY_MAX_CHARS,
    hasTitle ? 0 : NOTE_SUMMARY_MIN_HIDDEN_CHARS,
    renderOptions,
    { stopAtHeading: hasTitle },
  );
  return result ? { html: result.html, hasMore: result.hasMore } : null;
}
