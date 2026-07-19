/**
 * Stored post body HTML projection helpers.
 *
 * TipTap JSON in `post.body` is canonical. `post.body_html` is a materialized
 * projection that may lag behind the current renderer during upgrades or after
 * importing an older snapshot.
 */

import {
  renderTiptapJson,
  tryRenderTiptapJson,
  type TiptapRenderResult,
} from "./tiptap-render.js";

/** Current persisted post body HTML contract. V1 is the legacy inline trio. */
export const POST_BODY_HTML_VERSION = 3;

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
  return renderTiptapJson(body, { namespace: postId });
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
  return tryRenderTiptapJson(body, { namespace: postId });
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
