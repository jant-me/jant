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

/**
 * How a collection or smart collection page spells each order in `?sort=`.
 *
 * Public URL values are single lowercase words, so the stored `rating_desc`
 * is `rating` in an address. The API keeps `rating_desc` as `sortOrder`.
 */
const SORT_PARAM_BY_ORDER = {
  newest: "newest",
  oldest: "oldest",
  rating_desc: "rating",
} as const satisfies Record<CollectionSortOrder, string>;

/**
 * Older spellings a page still reads and never writes, so links to them keep
 * working: `rating_desc` is what the pages wrote before 1.0, and `updated` was
 * a smart collection's fourth order until `newest` came to mean the same.
 */
const LEGACY_SORT_PARAMS = {
  rating_desc: "rating_desc",
  updated: "newest",
} as const satisfies Record<string, CollectionSortOrder>;

/** Every `?sort=` value a collection page writes, for the reference docs. */
export const COLLECTION_SORT_PARAMS: readonly string[] =
  Object.values(SORT_PARAM_BY_ORDER);

/** Every older `?sort=` value a collection page still reads. */
export const LEGACY_COLLECTION_SORT_PARAMS: readonly string[] =
  Object.keys(LEGACY_SORT_PARAMS);

const ORDER_BY_SORT_PARAM = new Map<string, CollectionSortOrder>([
  ...Object.entries(LEGACY_SORT_PARAMS),
  ...Object.entries(SORT_PARAM_BY_ORDER).map(
    ([order, param]) => [param, order as CollectionSortOrder] as const,
  ),
]);

/**
 * The `?sort=` value for an order on a collection or smart collection page.
 *
 * @param sortOrder - The order to link to
 * @returns The value to write after `?sort=`
 *
 * @example
 * ```ts
 * collectionSortParam("rating_desc"); // "rating"
 * ```
 */
export function collectionSortParam(sortOrder: CollectionSortOrder): string {
  return SORT_PARAM_BY_ORDER[sortOrder];
}

/**
 * Read a collection or smart collection page's `?sort=`, in its current or
 * an older spelling.
 *
 * @param raw - The query value, if any
 * @returns The order it names, or undefined when it names none
 *
 * @example
 * ```ts
 * parseCollectionSortParam("rating"); // "rating_desc"
 * parseCollectionSortParam("rating_desc"); // "rating_desc"
 * ```
 */
export function parseCollectionSortParam(
  raw: string | undefined,
): CollectionSortOrder | undefined {
  return raw === undefined ? undefined : ORDER_BY_SORT_PARAM.get(raw);
}
