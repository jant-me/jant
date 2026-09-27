/**
 * Custom URL responses for the author API.
 *
 * Every field is listed here and in docs/API.md's Custom URLs table. Paths
 * carry their leading slash, as `toPath` always did and as a request's
 * `path` must.
 */

import type { CustomUrl } from "../types.js";

export interface ApiCustomUrlResponse {
  id: string;
  /** The address, with its leading slash. */
  path: string;
  targetType: CustomUrl["targetType"];
  /** The post or collection's TypeID; `null` for redirects and archives. */
  targetId: string | null;
  toPath: string | null;
  redirectType: 301 | 302 | null;
  /** `targetType: "archive"` only: the saved archive query. */
  archiveQuery: string | null;
  createdAt: number;
}

/**
 * One custom URL as the author API returns it.
 *
 * @param customUrl - The custom URL record
 * @returns The custom URL response
 * @example
 * return c.json(toApiCustomUrl(customUrl), 201);
 */
export function toApiCustomUrl(customUrl: CustomUrl): ApiCustomUrlResponse {
  return {
    id: customUrl.id,
    path: `/${customUrl.path}`,
    targetType: customUrl.targetType,
    targetId: customUrl.targetId,
    toPath: customUrl.toPath,
    redirectType: customUrl.redirectType,
    archiveQuery: customUrl.archiveQuery,
    createdAt: customUrl.createdAt,
  };
}
