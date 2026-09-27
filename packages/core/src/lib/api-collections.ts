/**
 * Collection responses for the author API and the MCP collection tools.
 *
 * Every field is listed here and in docs/API.md's Collections and Smart
 * Collections tables; nothing reaches a response by being a column. The
 * owning site is left out: a response always comes from the site it was asked
 * of.
 */

import type {
  Collection,
  CollectionDirectoryCollection,
  CollectionDirectoryEntry,
  CollectionsDirectoryData,
  SmartCollection,
  SmartCollectionDirectoryEntry,
} from "../types.js";

export interface ApiCollectionResponse {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  sortOrder: Collection["sortOrder"];
  createdAt: number;
  updatedAt: number;
  /** List responses only. */
  threadCount?: number;
  /** List responses only. */
  recentActivityAt?: number;
}

export interface ApiSmartCollectionResponse {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  selection: SmartCollection["selection"];
  /** Named as a collection's is, and taking the same values. */
  sortOrder: SmartCollection["sort"];
  layout: SmartCollection["layout"];
  createdAt: number;
  updatedAt: number;
  /** List responses only. */
  threadCount?: number;
  /** List responses only. */
  recentActivityAt?: number;
}

export interface ApiDirectoryItemResponse {
  id: string;
  type: CollectionDirectoryEntry["type"];
  collectionId: string | null;
  smartCollectionId: string | null;
  label: string | null;
  url: string | null;
  description: string | null;
  position: string;
  createdAt: number;
  updatedAt: number;
}

/** What `GET /api/collections` and `jant_collections_list` answer with. */
export interface ApiCollectionListResponse {
  collections: ApiCollectionResponse[];
  smartCollections: ApiSmartCollectionResponse[];
  directoryItems: ApiDirectoryItemResponse[];
}

/**
 * One collection as the author API returns it.
 *
 * @param collection - The collection, with its directory counts when listed
 * @returns The collection response; counts only when the input carries them
 * @example
 * return c.json(toApiCollection(collection));
 */
export function toApiCollection(
  collection: Collection | CollectionDirectoryCollection,
): ApiCollectionResponse {
  return {
    id: collection.id,
    slug: collection.slug,
    title: collection.title,
    description: collection.description,
    sortOrder: collection.sortOrder,
    createdAt: collection.createdAt,
    updatedAt: collection.updatedAt,
    ...("threadCount" in collection
      ? {
          threadCount: collection.threadCount,
          recentActivityAt: collection.recentActivityAt,
        }
      : {}),
  };
}

/**
 * One smart collection as the author API returns it.
 *
 * @param smartCollection - The smart collection, with its directory counts when listed
 * @returns The smart collection response; counts only when the input carries them
 * @example
 * return c.json(toApiSmartCollection(smartCollection));
 */
export function toApiSmartCollection(
  smartCollection: SmartCollection | SmartCollectionDirectoryEntry,
): ApiSmartCollectionResponse {
  return {
    id: smartCollection.id,
    slug: smartCollection.slug,
    title: smartCollection.title,
    description: smartCollection.description,
    selection: smartCollection.selection,
    sortOrder: smartCollection.sort,
    layout: smartCollection.layout,
    createdAt: smartCollection.createdAt,
    updatedAt: smartCollection.updatedAt,
    ...("threadCount" in smartCollection
      ? {
          threadCount: smartCollection.threadCount,
          recentActivityAt: smartCollection.recentActivityAt,
        }
      : {}),
  };
}

/**
 * One collections-directory row as the author API returns it.
 *
 * @param entry - The stored directory row
 * @returns The directory item response
 * @example
 * return c.json(toApiDirectoryItem(item), 201);
 */
export function toApiDirectoryItem(
  entry: CollectionDirectoryEntry,
): ApiDirectoryItemResponse {
  return {
    id: entry.id,
    type: entry.type,
    collectionId: entry.collectionId,
    smartCollectionId: entry.smartCollectionId,
    label: entry.label,
    url: entry.url,
    description: entry.description,
    position: entry.position,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
  };
}

/**
 * The collections directory as the author API lists it: every collection and
 * smart collection with its counts, and the directory's own rows.
 *
 * @param data - The directory data the collection service assembles
 * @returns The list response
 * @example
 * return c.json(toApiCollectionList(await collections.listDirectoryData()));
 */
export function toApiCollectionList(
  data: Pick<
    CollectionsDirectoryData,
    "collections" | "smartCollections" | "directoryItems"
  >,
): ApiCollectionListResponse {
  return {
    collections: data.collections.map(toApiCollection),
    smartCollections: data.smartCollections.map(toApiSmartCollection),
    directoryItems: data.directoryItems.map(toApiDirectoryItem),
  };
}
