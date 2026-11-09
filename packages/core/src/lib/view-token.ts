/**
 * The token a page carries so the browser that opened it can confirm it was
 * seen.
 *
 * A request alone cannot tell a reader from a crawler that runs a real
 * browser: the headers are the same. What differs is what happens after the
 * HTML arrives. A reader keeps the page in front of them, scrolls, taps; a
 * crawler closes it in a second. So the page is counted only once the
 * browser says it was seen, and this token is how the page says which view
 * that was without the server keeping anything in the meantime.
 *
 * The server decides everything about the view at request time, as before
 * (which page, where the reader came from), seals it into the token with an
 * HMAC over `AUTH_SECRET`, and writes the token into the page. The browser
 * posts the token back after the page has been visible for a while or on the
 * first interaction. The endpoint verifies the signature, checks the token is
 * fresh and is this site's, and counts the view with the day and hour of
 * that moment.
 *
 * The time in the token is a ten-minute slot, not a timestamp, so every
 * response for the same page and source within a slot carries the same
 * token: the HTML stays byte-identical across readers, as it was. A token is
 * accepted for the current slot and the three before it, half an hour or so,
 * long enough to read a page slowly, short enough that a harvested token is
 * worthless the next day.
 */

import { hmacHex, timingSafeEqualText } from "./crypto.js";

/** The `<meta name>` the page carries the token under. */
export const VIEW_TOKEN_META_NAME = "jant-view";

/** Where the browser posts the token. Under `/_`, with the other reserved paths. */
export const VIEW_CONFIRM_PATH = "/_/seen";

/** Seconds in a token's time slot. */
export const VIEW_TOKEN_SLOT_SECONDS = 600;

/** Slots a token is accepted for: the current one and the ones before it. */
export const VIEW_TOKEN_SLOTS_ACCEPTED = 4;

/** Hex characters of the HMAC kept: 128 bits. */
const SIGNATURE_LENGTH = 32;

/** Longer than any token this module writes; a longer one is not ours. */
const TOKEN_MAX_LENGTH = 2048;

/** What a token says about the view. */
export interface ViewTokenClaims {
  siteId: string;
  /** The counter key of the page: an id or a path. */
  page: string;
  /** The referrer key: a host or tag, the site itself, or `""`. */
  referrer: string;
}

function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function fromBase64Url(text: string): string | null {
  try {
    const padded =
      text.replace(/-/g, "+").replace(/_/g, "/") +
      "=".repeat((4 - (text.length % 4)) % 4);
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    // Malformed UTF-8 decodes to replacement characters and fails the JSON
    // and shape checks that follow.
    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
}

/**
 * The time slot a moment falls in.
 *
 * @param timestamp - Unix timestamp in seconds
 * @returns The slot number
 * @example
 * viewTokenSlot(1_762_560_000); // 2937600
 */
export function viewTokenSlot(timestamp: number): number {
  return Math.floor(timestamp / VIEW_TOKEN_SLOT_SECONDS);
}

async function signature(secret: string, payload: string): Promise<string> {
  const hex = await hmacHex(secret, `jant-view:${payload}`);
  return hex.slice(0, SIGNATURE_LENGTH);
}

/**
 * The token for a view, to be written into the page.
 *
 * @param secret - The deployment's `AUTH_SECRET`
 * @param claims - Which page, and where the reader came from
 * @param timestamp - Unix timestamp in seconds, now
 * @returns `payload.signature`, both URL-safe
 * @example
 * ```ts
 * const token = await signViewToken(secret, { siteId, page: post.id, referrer: "" }, now());
 * ```
 */
export async function signViewToken(
  secret: string,
  claims: ViewTokenClaims,
  timestamp: number,
): Promise<string> {
  const payload = toBase64Url(
    JSON.stringify({
      s: claims.siteId,
      p: claims.page,
      r: claims.referrer,
      t: viewTokenSlot(timestamp),
    }),
  );
  return `${payload}.${await signature(secret, payload)}`;
}

/**
 * What a token posted back says, if it is ours and still fresh.
 *
 * @param secret - The deployment's `AUTH_SECRET`
 * @param token - What the browser posted
 * @param timestamp - Unix timestamp in seconds, now
 * @returns The claims, or `null` for a token that is forged, altered,
 *   malformed, from the future, or past its slots
 * @example
 * ```ts
 * const claims = await verifyViewToken(secret, await c.req.text(), now());
 * if (claims && claims.siteId === site.id) count(claims);
 * ```
 */
export async function verifyViewToken(
  secret: string,
  token: string,
  timestamp: number,
): Promise<ViewTokenClaims | null> {
  if (token.length === 0 || token.length > TOKEN_MAX_LENGTH) return null;
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const payload = token.slice(0, dot);
  const given = token.slice(dot + 1);
  if (given.length !== SIGNATURE_LENGTH) return null;
  if (!timingSafeEqualText(await signature(secret, payload), given)) {
    return null;
  }

  const json = fromBase64Url(payload);
  if (json === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const { s, p, r, t } = parsed as Record<string, unknown>;
  if (
    typeof s !== "string" ||
    typeof p !== "string" ||
    typeof r !== "string" ||
    typeof t !== "number"
  ) {
    return null;
  }
  const age = viewTokenSlot(timestamp) - t;
  if (age < 0 || age >= VIEW_TOKEN_SLOTS_ACCEPTED) return null;
  return { siteId: s, page: p, referrer: r };
}
