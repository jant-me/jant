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
 * Block node types that carry user-visible content for summary extraction.
 * Structural nodes (horizontalRule, moreBreak, image) are excluded.
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
 * Extracts an HTML summary from a Tiptap JSON body by taking the first
 * N content-bearing block nodes and rendering them as HTML.
 *
 * Unlike the plain-text `extractSummary`, this preserves the original
 * structure (lists, blockquotes, headings, etc.) for rich previews.
 *
 * @param bodyJson - Tiptap JSON string
 * @param maxBlocks - Maximum number of top-level blocks to include
 * @param maxChars - Maximum total plain-text character count
 * @param minHiddenChars - Tolerance for limit-based truncation: when > 0 and a
 *   block/char limit would hide a tail shorter than this many plain-text
 *   characters, the truncation is cancelled — all remaining content blocks are
 *   included and `hasMore` is `false`. Avoids a "read more" that reveals only a
 *   sliver of text. Explicit `moreBreak` markers reflect author intent and are
 *   never subject to this tolerance.
 * @param renderOptions - Renderer options such as the post footnote namespace
 * @returns HTML summary, whether content was truncated, and the index in
 *   `doc.content` where the content after the summary boundary begins, or null.
 *   `breakAtIndex` lets callers align the summary with the full-body rendering
 *   when splitting at the "read more" boundary (e.g. to insert an anchor).
 *
 * @example
 * ```ts
 * const result = extractSummaryHtml(body, 5, 500);
 * // { html: "<ul><li><p>Item</p></li></ul>", hasMore: true, breakAtIndex: 1 }
 * ```
 */
export function extractSummaryHtml(
  bodyJson: string,
  maxBlocks: number = 5,
  maxChars: number = 500,
  minHiddenChars: number = 0,
  renderOptions: TiptapRenderOptions = {},
): { html: string; hasMore: boolean; breakAtIndex: number } | null {
  let doc: TiptapNode;
  try {
    doc = JSON.parse(bodyJson) as TiptapNode;
  } catch {
    return null;
  }

  if (doc.type !== "doc" || !doc.content) return null;

  const nodes = doc.content;
  const totalContentNodes = nodes.filter((n) =>
    SUMMARY_BLOCK_TYPES.has(n.type),
  ).length;

  // Check for moreBreak — take all content nodes before it
  const moreBreakIdx = nodes.findIndex((n) => n.type === "moreBreak");
  if (moreBreakIdx !== -1) {
    const selected = nodes
      .slice(0, moreBreakIdx)
      .filter((n) => SUMMARY_BLOCK_TYPES.has(n.type));
    if (selected.length === 0) return null;
    const subDoc: JSONContent = {
      type: "doc",
      content: [
        ...selected,
        ...nodes.filter((node) => node.type === "footnoteDefinition"),
      ] as JSONContent[],
    };
    return {
      html: renderTiptapDocument(subDoc, renderOptions),
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
    totalContentChars += text.length;
  }

  const selected: TiptapNode[] = [];
  let totalChars = 0;
  let lastSelectedIdx = -1;

  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    if (!node || !SUMMARY_BLOCK_TYPES.has(node.type)) continue;

    const text = contentText.get(i) ?? "";
    if (
      (selected.length >= maxBlocks || totalChars + text.length > maxChars) &&
      selected.length > 0
    )
      break;

    selected.push(node);
    totalChars += text.length;
    lastSelectedIdx = i;
  }

  if (selected.length === 0) return null;

  let hasMore = selected.length < totalContentNodes;

  // Tolerance: don't truncate just to hide a tiny tail. When a block/char limit
  // triggered the cut and the hidden content is shorter than `minHiddenChars`,
  // include the remaining content blocks instead. `moreBreak` is handled above
  // and never reaches this path.
  if (
    hasMore &&
    minHiddenChars > 0 &&
    totalContentChars - totalChars < minHiddenChars
  ) {
    for (let i = lastSelectedIdx + 1; i < nodes.length; i++) {
      const node = nodes[i];
      if (!node || !SUMMARY_BLOCK_TYPES.has(node.type)) continue;
      selected.push(node);
      lastSelectedIdx = i;
    }
    hasMore = false;
  }

  const subDoc: JSONContent = {
    type: "doc",
    content: [
      ...selected,
      ...nodes.filter((node) => node.type === "footnoteDefinition"),
    ] as JSONContent[],
  };
  return {
    html: renderTiptapDocument(subDoc, renderOptions),
    hasMore,
    breakAtIndex: lastSelectedIdx + 1,
  };
}
