import type { CollectionSortOrder } from "../types.js";

/**
 * Returns true when the sort order depends on post ratings.
 *
 * @param sortOrder - Candidate sort order
 * @returns Whether the sort order is rating-based
 *
 * @example
 * ```ts
 * isRatingSortOrder("rating_desc");
 * ```
 */
export function isRatingSortOrder(
  sortOrder: CollectionSortOrder | null | undefined,
): boolean {
  return sortOrder === "rating_desc";
}

/**
 * Returns true when a collection has enough rated Threads to make rating sort useful.
 *
 * @param ratedThreadCount - Number of Threads with at least one rating
 * @returns Whether rating sort should be shown to readers
 *
 * @example
 * ```ts
 * supportsCollectionRatingSort(2);
 * ```
 */
export function supportsCollectionRatingSort(
  ratedThreadCount: number,
): boolean {
  return ratedThreadCount > 1;
}

/**
 * Resolves the sort order for a collection page, falling back when rating
 * sorting is requested but the collection does not have enough rated Threads.
 *
 * @param requestedSort - Sort order from the request query
 * @param defaultSort - Collection default sort order
 * @param supportsRatingSort - Whether rating sort should be available
 * @returns Effective sort order for the page
 *
 * @example
 * ```ts
 * resolveCollectionSortOrder(undefined, "oldest", false);
 * ```
 */
export function resolveCollectionSortOrder(
  requestedSort: CollectionSortOrder | undefined,
  defaultSort: CollectionSortOrder,
  supportsRatingSort: boolean,
): CollectionSortOrder {
  const candidate = requestedSort ?? defaultSort;

  if (supportsRatingSort || !isRatingSortOrder(candidate)) {
    return candidate;
  }

  return "newest";
}
