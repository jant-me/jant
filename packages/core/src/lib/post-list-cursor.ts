/**
 * The cursor `posts.listPage()` and `posts.listCollectionThreadRootPage()`
 * hand out as `nextCursor`.
 *
 * A cursor says where the previous page ended: the sort mode it was taken in
 * and the full sort-key tuple of that page's last row, key for key as the
 * ORDER BY reads them. Resuming is a pure keyset comparison against those
 * values, so the post the page ended on can be deleted, unpublished, or edited
 * before the next request without moving the position. The two lists name
 * their sort modes apart, so a cursor from one never resumes the other.
 *
 * Wire format: `base64url(JSON { v, s, k })` — format version, sort mode, and
 * key tuple. It is not signed. A caller who edits one can only move their own
 * position on an axis they may already read; the values are never looked up.
 * Filters stay out: a position on the sort axis is valid under any filter.
 *
 * Callers treat the string as opaque. The one other shape still accepted is
 * the bare post TypeID earlier releases returned; see
 * {@link isLegacyPostListCursor}.
 */

import { ValidationError } from "./errors.js";
import { ID_PREFIX, isTypeId } from "./ids.js";

/** Bumped when the payload shape changes; older versions are rejected. */
const POST_LIST_CURSOR_VERSION = 1;

/**
 * Longest encoded cursor accepted. The largest tuple (pinned, rating, time,
 * id) encodes to under 200 characters; the cap only keeps a hostile value from
 * reaching the decoder.
 */
const MAX_ENCODED_LENGTH = 512;

const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;

const UNREADABLE_MESSAGE =
  "This cursor can't be read. Pass back nextCursor unchanged, or leave cursor out to start from the first page.";
const VERSION_MESSAGE =
  "This cursor is from a different version of Jant. Leave cursor out to start from the first page.";
const MODE_MESSAGE =
  "This cursor is from a list in a different order. Leave cursor out to start from the first page.";

/**
 * A legacy cursor naming a Post that is gone, or that the caller can't see.
 * One message for both, so a cursor can't be used to probe for private Posts.
 */
export const MISSING_LEGACY_CURSOR_MESSAGE =
  "This cursor names a post that can't be found. Leave cursor out to start from the first page.";

/** What one position of the key tuple holds. */
export type PostListCursorKeyKind = "number" | "id";

/** One sort-key value: a Unix timestamp, a rating, a pin, or the post ID. */
export type PostListCursorValue = number | string;

/** What a cursor must match to resume the current request. */
export interface PostListCursorShape {
  /** The request's sort mode, as the service names it. */
  mode: string;
  /** One kind per ORDER BY key, in ORDER BY order. */
  kinds: readonly PostListCursorKeyKind[];
}

interface PostListCursorPayload {
  v: number;
  s: string;
  k: PostListCursorValue[];
}

function encodeBase64Url(text: string): string {
  return btoa(text).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function decodeBase64Url(encoded: string): string | null {
  const padded =
    encoded.replace(/-/g, "+").replace(/_/g, "/") +
    "===".slice((encoded.length + 3) % 4);
  try {
    return atob(padded);
  } catch {
    return null;
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function matchesKind(
  value: unknown,
  kind: PostListCursorKeyKind,
): value is PostListCursorValue {
  return kind === "number"
    ? Number.isSafeInteger(value)
    : typeof value === "string" && isTypeId(value, ID_PREFIX.post);
}

/**
 * Encode the position after a page's last row.
 *
 * @param mode - The sort mode the page was read in
 * @param values - That row's sort-key tuple, in ORDER BY order
 * @returns The opaque cursor string
 * @example
 * ```ts
 * encodePostListCursor("newest:activity:pinned", [-1, 1706000000, post.id]);
 * ```
 */
export function encodePostListCursor(
  mode: string,
  values: readonly PostListCursorValue[],
): string {
  const payload: PostListCursorPayload = {
    v: POST_LIST_CURSOR_VERSION,
    s: mode,
    k: [...values],
  };
  // Every value is ASCII — digits, a mode name, a TypeID — so `btoa` can take
  // the JSON text as it is.
  return encodeBase64Url(JSON.stringify(payload));
}

/**
 * Decode a cursor for the current request, strictly.
 *
 * Nothing here falls back to the first page: a cursor that can't be read, that
 * an unknown format version wrote, that was taken in another sort mode, or
 * whose tuple doesn't fit the mode's keys is rejected, because answering with
 * page 1 would hand the caller posts it already has.
 *
 * @param raw - The `cursor` the caller sent
 * @param shape - The current request's sort mode and key kinds
 * @returns The key tuple, in ORDER BY order
 * @throws {ValidationError} When the cursor doesn't resume this request
 * @example
 * ```ts
 * const after = decodePostListCursor(cursor, {
 *   mode: "newest:published:unpinned",
 *   kinds: ["number", "id"],
 * });
 * ```
 */
export function decodePostListCursor(
  raw: string,
  shape: PostListCursorShape,
): PostListCursorValue[] {
  if (raw.length > MAX_ENCODED_LENGTH || !BASE64URL_PATTERN.test(raw)) {
    throw new ValidationError(UNREADABLE_MESSAGE);
  }
  const text = decodeBase64Url(raw);
  if (text === null) {
    throw new ValidationError(UNREADABLE_MESSAGE);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new ValidationError(UNREADABLE_MESSAGE);
  }
  if (!isPlainObject(parsed) || !Number.isSafeInteger(parsed.v)) {
    throw new ValidationError(UNREADABLE_MESSAGE);
  }
  if (parsed.v !== POST_LIST_CURSOR_VERSION) {
    throw new ValidationError(VERSION_MESSAGE);
  }

  const { s: mode, k: values } = parsed;
  if (
    Object.keys(parsed).length !== 3 ||
    typeof mode !== "string" ||
    !Array.isArray(values)
  ) {
    throw new ValidationError(UNREADABLE_MESSAGE);
  }
  if (mode !== shape.mode) {
    throw new ValidationError(MODE_MESSAGE);
  }
  if (values.length !== shape.kinds.length) {
    throw new ValidationError(UNREADABLE_MESSAGE);
  }
  const tuple: PostListCursorValue[] = [];
  for (const [index, kind] of shape.kinds.entries()) {
    const value: unknown = values[index];
    if (!matchesKind(value, kind)) {
      throw new ValidationError(UNREADABLE_MESSAGE);
    }
    tuple.push(value);
  }
  return tuple;
}

/**
 * Whether a cursor is the bare post TypeID that releases before the opaque
 * format returned as `nextCursor`.
 *
 * Accepted indefinitely — a stored cursor, or one a client built from a post
 * ID, must keep resuming. An encoded cursor can never look like one: it opens
 * with the base64url of `{"`, never with `pst_`.
 *
 * @param raw - The `cursor` the caller sent
 * @returns Whether to resolve it as a post ID
 * @example
 * ```ts
 * isLegacyPostListCursor("pst_01jpyx3m7gw4w3h7m4bknq0v1d"); // => true
 * ```
 */
export function isLegacyPostListCursor(raw: string): boolean {
  return isTypeId(raw, ID_PREFIX.post);
}
