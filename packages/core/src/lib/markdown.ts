/**
 * Markdown Rendering
 *
 * Uses marked with minimal configuration
 */

import { marked } from "marked";

// Configure marked for security and simplicity
marked.setOptions({
  gfm: true,
  breaks: true,
});

/**
 * Renders Markdown content to HTML using the marked library.
 *
 * Configured with GitHub Flavored Markdown (GFM) support and line breaks enabled.
 * Uses synchronous parsing for simplicity and consistency in server-side rendering.
 *
 * @param markdown - The Markdown string to convert to HTML
 * @returns The rendered HTML string
 *
 * @example
 * ```ts
 * const html = render("# Hello\n\nThis is **bold** text.");
 * // Returns: "<h1>Hello</h1>\n<p>This is <strong>bold</strong> text.</p>"
 * ```
 */
export function render(markdown: string): string {
  return marked.parse(markdown, { async: false }) as string;
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
  return markdown
    .replace(/#{1,6}\s+/g, "") // Remove headers
    .replace(/\*\*(.+?)\*\*/g, "$1") // Bold
    .replace(/\*(.+?)\*/g, "$1") // Italic
    .replace(/\[(.+?)\]\(.+?\)/g, "$1") // Links
    .replace(/!\[.*?\]\(.+?\)/g, "") // Images
    .replace(/`{1,3}[^`]*`{1,3}/g, "") // Code
    .replace(/>\s+/g, "") // Blockquotes
    .replace(/[-*+]\s+/g, "") // Lists
    .replace(/\n+/g, " ") // Newlines
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
