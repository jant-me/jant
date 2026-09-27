/**
 * Cursor Walk Helper
 *
 * Follows a paginated posts or Threads endpoint the way a client does, so route
 * tests can compare a walk against one unpaged request.
 */

import { expect } from "vitest";

interface RequestTarget {
  request(path: string): Response | Promise<Response>;
}

/**
 * Follow `nextCursor` from the first page until it is null, one request per
 * page, and fail on any non-200 page or a walk that doesn't end.
 *
 * @param app - The test app the endpoint is mounted on
 * @param path - Endpoint path with its query, without `limit` or `cursor`
 * @param limit - Page size
 * @param from - A `nextCursor` to resume from instead of the first page
 * @returns Every post ID, in the order the pages returned them
 * @example
 * ```ts
 * expect(await walkPostPages(app, "/api/public/archive", 1)).toEqual(ids);
 * ```
 */
export async function walkPostPages(
  app: RequestTarget,
  path: string,
  limit: number,
  from: string | null = null,
): Promise<string[]> {
  return walkPages(app, path, limit, "posts", from);
}

/**
 * {@link walkPostPages} for a Thread list, whose pages hold `threads`.
 *
 * @param app - The test app the endpoint is mounted on
 * @param path - Endpoint path with its query, without `limit` or `cursor`
 * @param limit - Page size
 * @returns Every Thread ID, in the order the pages returned them
 * @example
 * ```ts
 * expect(await walkThreadPages(app, "/api/public/threads", 1)).toEqual(ids);
 * ```
 */
export async function walkThreadPages(
  app: RequestTarget,
  path: string,
  limit: number,
): Promise<string[]> {
  return walkPages(app, path, limit, "threads", null);
}

async function walkPages(
  app: RequestTarget,
  path: string,
  limit: number,
  key: "posts" | "threads",
  from: string | null,
): Promise<string[]> {
  const separator = path.includes("?") ? "&" : "?";
  const ids: string[] = [];
  let cursor = from;
  for (let page = 0; page < 100; page++) {
    const query: string = cursor
      ? `limit=${limit}&cursor=${encodeURIComponent(cursor)}`
      : `limit=${limit}`;
    const res = await app.request(`${path}${separator}${query}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<
      typeof key,
      Array<{ id: string }>
    > & { nextCursor: string | null };
    ids.push(...body[key].map((item) => item.id));
    if (body.nextCursor === null) return ids;
    cursor = body.nextCursor;
  }
  throw new Error(`The walk of ${path} did not end`);
}
