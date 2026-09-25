/**
 * Tiptap JSON → Markdown Converter
 *
 * Converts Tiptap JSON documents to Markdown using the official
 * Tiptap MarkdownManager and Jant's shared markdown schema.
 */

import type { JSONContent } from "@tiptap/core";
import { serializeMarkdownDocument } from "./markdown-manager.js";

/**
 * Converts a Tiptap JSON document to a Markdown string.
 *
 * Throws rather than returning an empty string: a caller writing the result
 * somewhere (an export, a text attachment) would otherwise replace the
 * content with nothing and say nothing.
 *
 * @param json - Tiptap JSON document string
 * @returns Markdown string
 * @throws {SyntaxError} When `json` is not JSON
 * @throws {Error} When the root node is not a `doc`
 *
 * @example
 * ```ts
 * const md = tiptapJsonToMarkdown('{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Hello"}]}]}');
 * // "Hello"
 * ```
 */
export function tiptapJsonToMarkdown(json: string): string {
  const doc = JSON.parse(json) as JSONContent;
  if (doc.type !== "doc") {
    throw new Error(
      `A TipTap body's root must be a doc node, not ${JSON.stringify(doc.type)}.`,
    );
  }
  return serializeMarkdownDocument(doc).trimEnd();
}
