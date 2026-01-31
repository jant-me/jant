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
 * Render Markdown to HTML
 */
export function render(markdown: string): string {
  return marked.parse(markdown, { async: false }) as string;
}

/**
 * Extract plain text from Markdown (for excerpts)
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
 * Extract first line or first N characters for title fallback
 */
export function extractTitle(markdown: string, maxLength = 120): string {
  const plain = toPlainText(markdown);
  const firstLine = plain.split(/[.!?]/)[0] ?? plain;

  if (firstLine.length <= maxLength) {
    return firstLine;
  }

  return plain.slice(0, maxLength).trim() + "...";
}
