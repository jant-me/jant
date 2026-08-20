/**
 * Shared client-side helpers for adding Collections to site navigation.
 */

import { getJsonString, readJsonObject } from "./json.js";
import { applySiteHeaderHtml } from "./site-header-fragment.js";

const SITE_HEADER_REQUEST_HEADER = "X-Jant-Site-Header";
const INCLUDE_SITE_HEADER_RESPONSE = "include";

/**
 * Create a navigation item and refresh the rendered site header when the
 * server returns a fragment.
 *
 * @param body - Request body for `POST /api/nav-items`
 * @returns The created navigation item ID when present
 */
async function createNavItem(
  body: Record<string, unknown>,
): Promise<string | undefined> {
  const response = await fetch("/api/nav-items", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      [SITE_HEADER_REQUEST_HEADER]: INCLUDE_SITE_HEADER_RESPONSE,
    },
    body: JSON.stringify(body),
  });
  const responseBody = await readJsonObject(response);

  if (!response.ok) {
    throw new Error(
      getJsonString(responseBody, "error") ?? `HTTP ${response.status}`,
    );
  }

  applySiteHeaderHtml(getJsonString(responseBody, "headerHtml"));
  return getJsonString(responseBody, "id");
}

/**
 * Add a Collection to the end of the primary navigation and refresh the
 * rendered site header when the server returns a fragment.
 *
 * @param collectionId - TypeID of the Collection to add
 * @returns The created navigation item ID when present
 * @example
 * const navItemId = await addCollectionToNavigation("col_01abc");
 */
export async function addCollectionToNavigation(
  collectionId: string,
): Promise<string | undefined> {
  return createNavItem({
    type: "collection",
    collectionId,
    placement: "header",
  });
}

/**
 * Add a smart collection to the end of the primary navigation. Placement
 * matches {@link addCollectionToNavigation} — the two kinds are one thing to
 * the reader, so the same action puts them in the same place.
 *
 * @param smartCollectionId - TypeID of the smart collection to add
 * @returns The created navigation item ID when present
 * @example
 * const navItemId = await addSmartCollectionToNavigation("smc_01abc");
 */
export async function addSmartCollectionToNavigation(
  smartCollectionId: string,
): Promise<string | undefined> {
  return createNavItem({
    type: "smart_collection",
    smartCollectionId,
    placement: "header",
  });
}
