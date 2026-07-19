/**
 * Markdown Rendering
 *
 * Uses the shared MarkdownManager + TipTap HTML renderer so Markdown parsing,
 * serialization, HTML rendering, and plain-text extraction all follow the
 * same document schema.
 */

import { parseMarkdownDocument } from "./markdown-manager.js";
import { extractBodyText } from "./summary.js";
import {
  renderTiptapDocument,
  type TiptapRenderOptions,
} from "./tiptap-render.js";

/**
 * Renders Markdown content to HTML using Jant's shared Markdown pipeline.
 *
 * @param markdown - The Markdown string to convert to HTML
 * @param options - Rendering options, including a stable footnote namespace
 * @returns The rendered HTML string
 *
 * @example
 * ```ts
 * const html = render("# Hello\n\nThis is **bold** text.");
 * // "<h1>Hello</h1><p>This is <strong>bold</strong> text.</p>"
 * ```
 */
export function render(
  markdown: string,
  options: TiptapRenderOptions = {},
): string {
  if (!markdown.trim()) return "";
  return renderTiptapDocument(parseMarkdownDocument(markdown), options);
}

/**
 * Converts Markdown to plain text by stripping all formatting syntax.
 *
 * Removes Markdown syntax including headers, bold, italic, links, images, code blocks,
 * blockquotes, lists, and converts newlines to spaces. Useful for generating text excerpts,
 * meta descriptions, or search indexes.
 *
 * @param markdown - The Markdown string to convert to plain text
 * @returns The plain text string with all Markdown syntax removed
 *
 * @example
 * ```ts
 * const plain = toPlainText("## Hello\n\nThis is **bold** and [a link](url).");
 * // Returns: "Hello This is bold and a link."
 * ```
 */
export function toPlainText(markdown: string): string {
  if (!markdown.trim()) return "";

  const doc = parseMarkdownDocument(markdown);
  return (extractBodyText(JSON.stringify(doc)) ?? "")
    .replace(/\s+/g, " ")
    .replace(/\s+([.,!?;:])/g, "$1")
    .trim();
}

/**
 * Extracts a title from Markdown content by taking the first sentence or line.
 *
 * Converts Markdown to plain text first, then takes the first sentence (split by `.!?`)
 * or truncates to the specified maximum length. Useful for generating automatic titles
 * from post content when no explicit title is provided.
 *
 * @param markdown - The Markdown string to extract a title from
 * @param maxLength - Maximum length of the extracted title (default: 120)
 * @returns The extracted title string, with "..." appended if truncated
 *
 * @example
 * ```ts
 * const title = extractTitle("This is the first sentence. And another one.", 50);
 * // Returns: "This is the first sentence"
 *
 * const title = extractTitle("A very long sentence that exceeds the maximum length...", 30);
 * // Returns: "A very long sentence that ex..."
 * ```
 */
export function extractTitle(markdown: string, maxLength = 120): string {
  const plain = toPlainText(markdown);
  const firstLine = plain.split(/[.!?]/)[0] ?? plain;

  if (firstLine.length <= maxLength) {
    return firstLine;
  }

  return plain.slice(0, maxLength).trim() + "...";
}
