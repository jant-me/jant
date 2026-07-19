/**
 * Stored post body HTML projection helpers.
 *
 * TipTap JSON in `post.body` is canonical. `post.body_html` is a materialized
 * projection that may lag behind the current renderer during upgrades or after
 * importing an older snapshot.
 */

import type { JSONContent } from "@tiptap/core";
import { upgradeLegacyFootnotes } from "./footnotes.js";
import {
  renderTiptapDocument,
  type TiptapRenderResult,
} from "./tiptap-render.js";

/** Current persisted post body HTML contract. V1 is the legacy inline trio. */
export const POST_BODY_HTML_VERSION = 4;

export type PreparedPostBodyHtmlResult =
  | {
      ok: true;
      body: string;
      html: string;
      upgradedLegacyFootnotes: boolean;
    }
  | { ok: false; error: string };

export interface StoredPostBodyHtml {
  id: string;
  body: string | null;
  bodyHtml: string | null;
  bodyHtmlVersion: number | null;
}

/**
 * Render canonical post JSON with a stable page-wide footnote namespace.
 *
 * @param postId - Immutable post TypeID
 * @param body - Canonical TipTap JSON
 * @returns Current public HTML, or an empty string for invalid JSON
 * @example
 * ```ts
 * renderPostBodyHtml("pst_example", '{"type":"doc","content":[]}');
 * // ""
 * ```
 */
export function renderPostBodyHtml(postId: string, body: string): string {
  const result = tryPreparePostBodyHtml(postId, body);
  return result.ok ? result.html : "";
}

/**
 * Normalize recognized historical footnotes and render the current HTML
 * projection in one parse pass.
 *
 * @param postId - Immutable post TypeID
 * @param body - Canonical TipTap JSON
 * @returns Prepared canonical JSON and HTML, or a parse failure
 * @example
 * ```ts
 * tryPreparePostBodyHtml("pst_example", '{"type":"doc","content":[]}');
 * // { ok: true, body: "...", html: "", upgradedLegacyFootnotes: false }
 * ```
 */
export function tryPreparePostBodyHtml(
  postId: string,
  body: string,
): PreparedPostBodyHtmlResult {
  try {
    const parsed = JSON.parse(body) as JSONContent;
    if (parsed.type !== "doc") {
      return { ok: false, error: "TipTap body root must be a doc node." };
    }

    const upgraded = upgradeLegacyFootnotes(parsed);
    return {
      ok: true,
      body: upgraded.upgraded ? JSON.stringify(upgraded.doc) : body,
      html: renderTiptapDocument(upgraded.doc, { namespace: postId }),
      upgradedLegacyFootnotes: upgraded.upgraded,
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Invalid TipTap JSON.",
    };
  }
}

/**
 * Strict variant used by projection rebuilds.
 *
 * @param postId - Immutable post TypeID
 * @param body - Canonical TipTap JSON
 * @returns A result that distinguishes malformed JSON from a valid empty body
 */
export function tryRenderPostBodyHtml(
  postId: string,
  body: string,
): TiptapRenderResult {
  const result = tryPreparePostBodyHtml(postId, body);
  return result.ok
    ? { ok: true, html: result.html }
    : { ok: false, error: result.error };
}

/**
 * Resolve a stored projection to the current public HTML contract.
 *
 * Stale rows are rendered in memory so a partially completed backfill never
 * leaks mixed HTML-contract markup. Invalid historical canonical JSON falls back to the
 * stored HTML for availability; the strict rebuild reports those rows instead
 * of marking them current.
 *
 * @param input - Stored post body and projection fields
 * @returns Current rendered HTML, the legacy fallback, or null for no body
 */
export function resolvePostBodyHtml(input: StoredPostBodyHtml): string | null {
  if (input.body === null) return null;

  if (
    input.bodyHtmlVersion !== null &&
    input.bodyHtmlVersion >= POST_BODY_HTML_VERSION &&
    input.bodyHtml !== null
  ) {
    return input.bodyHtml;
  }

  const result = tryRenderPostBodyHtml(input.id, input.body);
  return result.ok ? result.html : input.bodyHtml;
}
