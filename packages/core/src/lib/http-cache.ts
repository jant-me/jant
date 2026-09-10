/**
 * Conditional-request helpers.
 *
 * Transport-level only: deriving an entity tag for a response body, and
 * deciding whether the request already holds it. Nothing here knows what the
 * body represents.
 */

const textEncoder = new TextEncoder();

/**
 * One entity tag inside an `If-None-Match` list, weak prefix included.
 *
 * Matching quoted runs rather than splitting on commas is deliberate: RFC 9110
 * allows a comma inside an entity tag's opaque part, so a naive split can tear
 * one tag into two that match nothing.
 */
const ENTITY_TAG = /(?:W\/)?"[^"]*"/g;

/** Drop the weak prefix, which the weak comparison in RFC 9110 ignores. */
function opaqueTag(tag: string): string {
  return tag.startsWith("W/") ? tag.slice(2) : tag;
}

/**
 * Derive a strong entity tag from a response body.
 *
 * The tag is a truncated SHA-256 of the exact bytes that would be sent, so
 * two equal tags do mean two identical responses — which is what makes the
 * tag strong rather than `W/`-weak. 128 bits is far past the point where a
 * collision could plausibly pin a stale body in a cache.
 *
 * @param body - Serialized response body
 * @returns Quoted entity tag, ready for an `ETag` header
 * @example
 * ```ts
 * const etag = await strongETag(xml); // '"9f86d081884c7d65..."'
 * ```
 */
export async function strongETag(body: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    textEncoder.encode(body),
  );

  let hex = "";
  for (const byte of new Uint8Array(digest, 0, 16)) {
    hex += byte.toString(16).padStart(2, "0");
  }

  return `"${hex}"`;
}

/**
 * Whether a request's `If-None-Match` already holds `etag`.
 *
 * Comparison is the weak one RFC 9110 requires for `If-None-Match`: the weak
 * prefix is ignored on both sides, and any tag in the list can match. `*`
 * matches whenever the resource exists, which it does by the time a response
 * body has been rendered.
 *
 * @param header - Raw `If-None-Match` header value, absent when not sent
 * @param etag - Entity tag of the response about to be sent
 * @returns `true` when the response can be answered with `304`
 * @example
 * ```ts
 * matchesIfNoneMatch('W/"abc", "def"', '"def"'); // true
 * ```
 */
export function matchesIfNoneMatch(
  header: string | null | undefined,
  etag: string,
): boolean {
  if (!header) return false;
  if (header.trim() === "*") return true;

  const target = opaqueTag(etag);
  for (const candidate of header.match(ENTITY_TAG) ?? []) {
    if (opaqueTag(candidate) === target) return true;
  }

  return false;
}

/**
 * Headers a `304` carries over from the response it stands in for.
 *
 * RFC 9110 asks for the fields a cache would otherwise have to invent or
 * discard: the validator itself, the freshness the entry is stored under, and
 * the identity of what was validated.
 */
const NOT_MODIFIED_HEADERS = [
  "Cache-Control",
  "Content-Location",
  "Date",
  "ETag",
  "Expires",
  "Vary",
] as const;

/**
 * Answer a conditional request with `304` when the response is one the client
 * already holds.
 *
 * This is the only place in the app that turns a validator into a `304`, and
 * it runs at the outer edge of the request — outside the Worker response
 * cache. Both halves of that matter: a cache hit is revalidated without
 * reaching a route, and a cache miss still renders and stores the whole
 * document before the body is dropped, so the next reader gets a cache entry
 * rather than a `304` that cannot be stored.
 *
 * Anything without an entity tag passes through untouched, so a route opts in
 * simply by emitting one.
 *
 * @param request - Incoming request, read for `If-None-Match`
 * @param response - Response the app produced
 * @returns A bare `304`, or the response unchanged
 * @example
 * ```ts
 * return withConditionalResponse(request, await handle(request));
 * ```
 */
export function withConditionalResponse(
  request: Request,
  response: Response,
): Response {
  if (request.method !== "GET" && request.method !== "HEAD") return response;
  if (response.status !== 200) return response;

  // A 304 drops the body, and with it any header that only makes sense
  // attached to one. A response setting a cookie is left alone rather than
  // stripped down to a validator.
  if (response.headers.has("Set-Cookie")) return response;

  const etag = response.headers.get("ETag");
  if (!etag) return response;
  if (!matchesIfNoneMatch(request.headers.get("If-None-Match"), etag)) {
    return response;
  }

  const headers = new Headers();
  for (const name of NOT_MODIFIED_HEADERS) {
    const value = response.headers.get(name);
    if (value !== null) headers.set(name, value);
  }

  return new Response(null, { status: 304, headers });
}
