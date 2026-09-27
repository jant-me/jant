/**
 * Cursor Walk Helper
 *
 * Follows a paginated posts endpoint the way a client does, so route tests can
 * compare a walk against one unpaged request.
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
  const separator = path.includes("?") ? "&" : "?";
  const ids: string[] = [];
  let cursor = from;
  for (let page = 0; page < 100; page++) {
    const query: string = cursor
      ? `limit=${limit}&cursor=${encodeURIComponent(cursor)}`
      : `limit=${limit}`;
    const res = await app.request(`${path}${separator}${query}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      posts: Array<{ id: string }>;
      nextCursor: string | null;
    };
    ids.push(...body.posts.map((post) => post.id));
    if (body.nextCursor === null) return ids;
    cursor = body.nextCursor;
  }
  throw new Error(`The walk of ${path} did not end`);
}
