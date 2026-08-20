/**
 * Collection Service (v2)
 *
 * Manages collections. Threads belong to collections through the
 * `thread_collection` junction table (M:N).
 * Collection directory ordering is managed through the collection_directory_item
 * table with fractional indexing.
 */

import { eq, asc, sql, and, inArray, desc } from "drizzle-orm";
import { generateKeyBetween } from "fractional-indexing";
import {
  type Database,
  batchQueryRows,
  supportsDrizzleTransaction,
} from "../db/index.js";
import type { DatabaseDialect } from "../db/dialect.js";
import {
  buildRootActivityExpr,
  rootActivityColumns,
} from "../db/thread-activity.js";
import { buildReaderVisibilityConditions } from "../db/post-visibility.js";
import {
  sqliteSchemaBundle,
  type DatabaseSchema,
} from "../db/schema-bundle.js";
import { createEntityId } from "../lib/ids.js";
import { now } from "../lib/time.js";
import type {
  Collection,
  CollectionDirectoryCollection,
  CollectionDirectoryEntry,
  CollectionDirectoryEntryType,
  CollectionDirectoryItem,
  CollectionsDirectoryData,
  CreateCollection,
  CreateCollectionDirectoryEntry,
  UpdateCollection,
  UpdateCollectionDirectoryEntry,
  CollectionSortOrder,
} from "../types.js";
import {
  ConflictError,
  NotFoundError,
  ValidationError,
} from "../lib/errors.js";
import {
  createPathService,
  toCollectionPath,
  type PathService,
} from "./path.js";
import { getCollectionPagePath } from "../lib/collection-paths.js";
import {
  CreateCollectionDirectoryItemSchema,
  CollectionDirectoryLabelSchema,
  CollectionDirectoryLinkLabelSchema,
  CollectionDirectoryLinkUrlSchema,
  CollectionDescriptionValueSchema,
  CollectionSlugSchema,
  CollectionTitleSchema,
  parseValidated,
} from "../lib/schemas.js";

const POSITION_RETRY_ATTEMPTS = 5;

// Re-export shared constraint detection — see db/dialect.ts
import { isUniqueConstraintError } from "../db/dialect.js";

export interface ResolvedCollectionSelection {
  collections: Collection[];
  slugs: string[];
  slugExpression: string;
}

function parseCollectionSelectionSlugs(
  slugExpression: string,
): string[] | null {
  const parts = slugExpression.split("+");
  if (parts.length === 0) return null;

  const seen = new Set<string>();
  const slugs: string[] = [];

  for (const part of parts) {
    const slug = part.trim();
    if (!slug) return null;
    if (seen.has(slug)) continue;
    seen.add(slug);
    slugs.push(slug);
  }

  return slugs.length > 0 ? slugs : null;
}

/**
 * Who is looking at the collections directory.
 *
 * The directory lists every collection in every language view — that is site
 * skeleton, and it does not depend on the reader. Its *numbers* do: they answer
 * "how many threads will I see if I click this", so they carry the same
 * visibility and language narrowing the collection page applies.
 */
export interface CollectionDirectoryViewer {
  /** Signed-in authors see their private threads counted; readers do not. */
  isAuthenticated: boolean;
  /** Content language of the current view, when the site has more than one. */
  lang?: string;
}

export interface CollectionService {
  getById(id: string): Promise<Collection | null>;
  getBySlug(slug: string): Promise<Collection | null>;
  getBySlugs(slugs: string[]): Promise<Collection[]>;
  resolveSelection(
    slugExpression: string,
  ): Promise<ResolvedCollectionSelection | null>;
  list(): Promise<Collection[]>;
  listDirectoryData(
    viewer: CollectionDirectoryViewer,
  ): Promise<CollectionsDirectoryData>;
  /** List collections sorted by most recent Thread addition (for compose dialog) */
  listByRecentActivity(): Promise<Collection[]>;
  create(data: CreateCollection): Promise<Collection>;
  update(id: string, data: UpdateCollection): Promise<Collection | null>;
  delete(id: string): Promise<boolean>;
  /** List all collection directory items ordered by position */
  listDirectoryItems(): Promise<CollectionDirectoryEntry[]>;
  /** Create a collection directory item (collection, divider, or link) */
  createDirectoryItem(
    data: CreateCollectionDirectoryEntry,
  ): Promise<CollectionDirectoryEntry>;
  /** Delete a collection directory item by ID */
  deleteDirectoryItem(id: string): Promise<boolean>;
  /** Update a collection directory item */
  updateDirectoryItem(
    id: string,
    data: UpdateCollectionDirectoryEntry,
  ): Promise<CollectionDirectoryEntry | null>;
  /** Move a collection directory item between two neighbors */
  moveDirectoryItem(
    id: string,
    after: string | null,
    before: string | null,
  ): Promise<CollectionDirectoryEntry | null>;
  /** Get Thread count per collection */
  getThreadCounts(): Promise<Map<string, number>>;
  /**
   * Add a Thread to a collection. Optional metadata lets the caller set the
   * per-row `createdAt` / `position` / `pinnedAt` explicitly; omitted
   * fields default to `now()` / append-at-end / `null`.
   */
  addThread(
    collectionId: string,
    threadId: string,
    opts?: {
      createdAt?: number;
      position?: number;
      pinnedAt?: number | null;
    },
  ): Promise<void>;
  /**
   * Replace all collection memberships of a Thread in one transaction,
   * preserving each entry's `createdAt` / `position` / `pinnedAt`.
   * Used by the Hugo import path so round-tripping through
   * `jant site export | jant site import` is lossless.
   */
  syncThreadCollectionsWithMeta(
    threadId: string,
    entries: {
      collectionId: string;
      createdAt?: number;
      position?: number;
      pinnedAt?: number | null;
    }[],
  ): Promise<void>;
  /** Remove a Thread from a collection */
  removeThread(collectionId: string, threadId: string): Promise<void>;
  /** Pin a Thread within a collection */
  pinThread(collectionId: string, threadId: string): Promise<void>;
  /** Unpin a Thread within a collection */
  unpinThread(collectionId: string, threadId: string): Promise<void>;
  /** Get pinned Thread IDs for given collections */
  getPinnedThreadIds(collectionIds: string[]): Promise<Set<string>>;
  /** Get the Thread-level collections shared by a post and its siblings */
  getCollectionsByPostId(postId: string): Promise<Collection[]>;
  /** Batch project Thread-level collections onto multiple posts */
  getCollectionsByPostIds(
    postIds: string[],
  ): Promise<Map<string, Collection[]>>;
  /**
   * Batch get the set of collection IDs each Thread is pinned in.
   *
   * Used by the Hugo export to surface per-collection pins so the static
   * collection page can sort pinned Threads to the top, mirroring the live
   * site behavior.
   */
  getCollectionPinsByThreadIds(
    threadIds: string[],
  ): Promise<Map<string, Set<string>>>;
  /**
   * Batch fetch the full per-entry collection metadata for each Thread: the
   * `createdAt` timestamp, `position`, and per-collection `pinnedAt`.
   *
   * Used by the Hugo export to emit lossless `collections` front-matter
   * entries so round-tripping through `jant site export | jant site import`
   * preserves per-entry state.
   */
  getCollectionEntriesByThreadIds(threadIds: string[]): Promise<
    Map<
      string,
      {
        collectionId: string;
        createdAt: number;
        position: number;
        pinnedAt: number | null;
      }[]
    >
  >;
  /** Get all Thread IDs in a collection */
  getThreadIds(collectionId: string): Promise<string[]>;
  /** Sync a Thread's collection memberships (replace all with given IDs) */
  syncThreadCollections(
    threadId: string,
    collectionIds: string[],
  ): Promise<void>;
}

export function createCollectionService(
  db: Database,
  siteId: string,
  paths: PathService | undefined,
  databaseSchema: DatabaseSchema = sqliteSchemaBundle,
  databaseDialect: DatabaseDialect = "sqlite",
): CollectionService {
  const resolvedPaths = paths ?? createPathService(db, siteId, databaseSchema);
  const {
    collections,
    pathRegistry,
    collectionDirectoryItems: directoryItemsTable,
    threadCollections,
    posts,
    navItems,
  } = databaseSchema;
  const usesBatchWrites = !supportsDrizzleTransaction(db, databaseDialect);

  function normalizeCreateCollectionInput(
    data: CreateCollection,
  ): CreateCollection {
    return {
      slug: parseValidated(CollectionSlugSchema, data.slug),
      title: parseValidated(CollectionTitleSchema, data.title),
      description:
        data.description === undefined
          ? undefined
          : parseValidated(CollectionDescriptionValueSchema, data.description),
      sortOrder: data.sortOrder,
    };
  }

  function normalizeUpdateCollectionInput(
    data: UpdateCollection,
  ): UpdateCollection {
    const normalized: UpdateCollection = {};

    if (data.slug !== undefined) {
      normalized.slug = parseValidated(CollectionSlugSchema, data.slug);
    }
    if (data.title !== undefined) {
      normalized.title = parseValidated(CollectionTitleSchema, data.title);
    }
    if (data.description !== undefined) {
      normalized.description =
        data.description === null
          ? null
          : parseValidated(CollectionDescriptionValueSchema, data.description);
    }
    if (data.sortOrder !== undefined) {
      normalized.sortOrder = data.sortOrder;
    }

    return normalized;
  }

  function toCollection(
    row: typeof collections.$inferSelect,
    slug: string,
  ): Collection {
    return {
      id: row.id,
      siteId: row.siteId,
      slug,
      title: row.title,
      description: row.description,
      sortOrder: row.sortOrder as CollectionSortOrder,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  function toDirectoryItem(
    row: typeof directoryItemsTable.$inferSelect,
  ): CollectionDirectoryEntry {
    return {
      id: row.id,
      siteId: row.siteId,
      type: row.type as CollectionDirectoryEntryType,
      collectionId: row.collectionId,
      label: row.label,
      url: row.url,
      description: row.description,
      position: row.position,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  function normalizeDirectoryLabel(label?: string | null): string | null {
    if (label === null) return null;
    if (label === undefined) return null;

    const trimmed = parseValidated(CollectionDirectoryLabelSchema, label);
    return trimmed ? trimmed : null;
  }

  function normalizeDirectoryLinkLabel(label: string): string {
    return parseValidated(CollectionDirectoryLinkLabelSchema, label);
  }

  function normalizeDirectoryUrl(url: string): string {
    return parseValidated(CollectionDirectoryLinkUrlSchema, url);
  }

  function normalizeDirectoryDescription(
    description?: string | null,
  ): string | null {
    if (description === null || description === undefined) return null;
    const trimmed = parseValidated(
      CollectionDescriptionValueSchema,
      description,
    );
    return trimmed || null;
  }

  function normalizeCreateDirectoryItemInput(
    data: CreateCollectionDirectoryEntry,
  ): CreateCollectionDirectoryEntry {
    if (data.type === "collection") {
      return data;
    }

    const normalized = parseValidated(
      CreateCollectionDirectoryItemSchema,
      data,
    );
    if (normalized.type === "divider") {
      return {
        type: "divider",
        label: normalizeDirectoryLabel(normalized.label),
      };
    }

    return {
      type: "link",
      label: normalizeDirectoryLinkLabel(normalized.label),
      url: normalizeDirectoryUrl(normalized.url),
      description: normalizeDirectoryDescription(normalized.description),
    };
  }

  async function getLastDirectoryPosition(): Promise<string | null> {
    const rows = await db
      .select({ position: directoryItemsTable.position })
      .from(directoryItemsTable)
      .where(eq(directoryItemsTable.siteId, siteId))
      .orderBy(sql`${directoryItemsTable.position} DESC`)
      .limit(1);
    return rows[0]?.position ?? null;
  }

  async function listOrderedDirectoryPositions(excludeId?: string) {
    const rows = await db
      .select({
        id: directoryItemsTable.id,
        position: directoryItemsTable.position,
      })
      .from(directoryItemsTable)
      .where(eq(directoryItemsTable.siteId, siteId))
      .orderBy(asc(directoryItemsTable.position));
    return excludeId ? rows.filter((row) => row.id !== excludeId) : rows;
  }

  async function getAppendDirectoryPosition(): Promise<string> {
    const lastPos = await getLastDirectoryPosition();
    return generateKeyBetween(lastPos, null);
  }

  async function pathExists(path: string): Promise<boolean> {
    const rows = await db
      .select({ id: pathRegistry.id })
      .from(pathRegistry)
      .where(and(eq(pathRegistry.siteId, siteId), eq(pathRegistry.path, path)))
      .limit(1);
    return rows.length > 0;
  }

  async function resolveThreadRootId(postId: string): Promise<string> {
    const rows = await db
      .select({ threadId: posts.threadId })
      .from(posts)
      .where(and(eq(posts.siteId, siteId), eq(posts.id, postId)))
      .limit(1);
    const threadId = rows[0]?.threadId;
    if (!threadId) throw new NotFoundError("Thread");
    return threadId;
  }

  async function getDirectoryMovePosition(
    id: string,
    afterId: string | null,
    beforeId: string | null,
  ): Promise<string> {
    const rows = await listOrderedDirectoryPositions(id);
    const afterIndex = afterId
      ? rows.findIndex((row) => row.id === afterId)
      : -1;
    if (afterIndex >= 0) {
      return generateKeyBetween(
        rows[afterIndex]?.position ?? null,
        rows[afterIndex + 1]?.position ?? null,
      );
    }

    const beforeIndex = beforeId
      ? rows.findIndex((row) => row.id === beforeId)
      : -1;
    if (beforeIndex >= 0) {
      return generateKeyBetween(
        rows[beforeIndex - 1]?.position ?? null,
        rows[beforeIndex]?.position ?? null,
      );
    }

    return generateKeyBetween(rows.at(-1)?.position ?? null, null);
  }

  async function hydrateCollection(
    row: typeof collections.$inferSelect | undefined,
  ): Promise<Collection | null> {
    if (!row) return null;
    const slug = await resolvedPaths.getCollectionSlug(row.id);
    if (!slug) return null;
    return toCollection(row, slug);
  }

  async function hydrateCollections(
    rows: (typeof collections.$inferSelect)[],
  ): Promise<Collection[]> {
    if (rows.length === 0) return [];
    const slugMap = await resolvedPaths.getCollectionSlugMap(
      rows.map((row) => row.id),
    );
    return rows
      .map((row) => {
        const slug = slugMap.get(row.id);
        return slug ? toCollection(row, slug) : null;
      })
      .filter((row): row is Collection => row !== null);
  }

  async function listDirectoryCollections(
    viewer: CollectionDirectoryViewer,
  ): Promise<CollectionDirectoryCollection[]> {
    // Joined on thread_id rather than id, so a Thread counts once no matter
    // which of its posts matched — the same shape
    // `posts.countCollectionThreadRootsForCollections` uses for the collection
    // page. The two numbers are shown one click apart and have to agree.
    const readerConditions = buildReaderVisibilityConditions(posts, siteId, {
      status: "published",
      excludePrivate: !viewer.isAuthenticated,
      lang: viewer.lang,
    });

    const threadCount =
      sql<number>`CAST(COUNT(DISTINCT ${posts.threadId}) AS INTEGER)`.as(
        "thread_count",
      );
    // Rows here are Thread *members*, so the root's activity is reached
    // through a correlated subquery; the outer MAX only collapses the group.
    // A member whose root row is missing falls back to its own timestamps.
    const recentActivityAt = sql<number | null>`MAX(
      COALESCE(
        (
          SELECT ${buildRootActivityExpr(rootActivityColumns("root"))}
          FROM post AS root
          WHERE root.site_id = ${siteId}
            AND root.id = ${posts.threadId}
        ),
        ${posts.publishedAt},
        ${posts.updatedAt}
      )
    )`.as("recent_activity_at");

    const rows = await db
      .select({
        collection: collections,
        threadCount,
        recentActivityAt,
      })
      .from(collections)
      .leftJoin(
        threadCollections,
        and(
          eq(threadCollections.siteId, siteId),
          eq(collections.id, threadCollections.collectionId),
        ),
      )
      // The reader's conditions belong in ON, not WHERE: a collection this
      // reader can see nothing in stays listed and reads `0 threads`, which is
      // what the directory promises — every collection in every view.
      .leftJoin(
        posts,
        and(
          eq(posts.siteId, threadCollections.siteId),
          eq(posts.threadId, threadCollections.threadId),
          ...readerConditions,
        ),
      )
      .where(eq(collections.siteId, siteId))
      .groupBy(collections.id)
      .orderBy(asc(collections.createdAt));

    if (rows.length === 0) return [];

    const slugMap = await resolvedPaths.getCollectionSlugMap(
      rows.map((row) => row.collection.id),
    );

    return rows
      .map((row) => {
        const slug = slugMap.get(row.collection.id);
        if (!slug) return null;

        return {
          ...toCollection(row.collection, slug),
          threadCount: row.threadCount,
          recentActivityAt: row.recentActivityAt ?? row.collection.updatedAt,
        };
      })
      .filter((row): row is CollectionDirectoryCollection => row !== null);
  }

  function buildDirectoryItems(
    directoryCollections: CollectionDirectoryCollection[],
    orderedDirectoryItems: CollectionDirectoryEntry[],
  ): CollectionDirectoryItem[] {
    const collectionMap = new Map(
      directoryCollections.map((collection) => [collection.id, collection]),
    );
    const seenCollections = new Set<string>();
    const items: CollectionDirectoryItem[] = [];

    for (const item of orderedDirectoryItems) {
      if (item.type === "divider") {
        items.push({
          id: item.id,
          type: "divider",
          label: item.label,
        });
        continue;
      }

      if (item.type === "link") {
        if (!item.label || !item.url) continue;
        items.push({
          id: item.id,
          type: "link",
          label: item.label,
          url: item.url,
          description: item.description,
        });
        continue;
      }

      const collection = item.collectionId
        ? collectionMap.get(item.collectionId)
        : undefined;
      if (!collection) continue;

      seenCollections.add(collection.id);
      items.push({
        id: item.id,
        type: "collection",
        collection,
      });
    }

    for (const collection of directoryCollections) {
      if (seenCollections.has(collection.id)) continue;
      items.push({
        id: collection.id,
        type: "collection",
        collection,
      });
    }

    return items;
  }

  return {
    async getById(id) {
      const result = await db
        .select()
        .from(collections)
        .where(and(eq(collections.siteId, siteId), eq(collections.id, id)))
        .limit(1);
      return hydrateCollection(result[0]);
    },

    async getBySlug(slug) {
      const resolved = await resolvedPaths.resolve(toCollectionPath(slug));
      if (!resolved || resolved.kind !== "slug" || !resolved.collectionId) {
        return null;
      }
      return this.getById(resolved.collectionId);
    },

    async getBySlugs(slugs) {
      if (slugs.length === 0) return [];

      const collections = await Promise.all(
        slugs.map((slug) => this.getBySlug(slug)),
      );
      return collections.filter(
        (collection): collection is Collection => collection !== null,
      );
    },

    async resolveSelection(slugExpression) {
      const slugs = parseCollectionSelectionSlugs(slugExpression);
      if (!slugs) return null;

      const collections = await this.getBySlugs(slugs);
      if (collections.length !== slugs.length) return null;

      return {
        collections,
        slugs,
        slugExpression: slugs.join("+"),
      };
    },

    async list() {
      const rows = await db
        .select()
        .from(collections)
        .where(eq(collections.siteId, siteId))
        .orderBy(asc(collections.createdAt));
      return hydrateCollections(rows);
    },

    async listDirectoryData(viewer) {
      const [directoryCollections, orderedDirectoryItems] = await Promise.all([
        listDirectoryCollections(viewer),
        this.listDirectoryItems(),
      ]);

      return {
        collections: directoryCollections,
        items: buildDirectoryItems(directoryCollections, orderedDirectoryItems),
        directoryItems: orderedDirectoryItems,
      };
    },

    async listByRecentActivity() {
      const lastAddedAt = sql<
        number | null
      >`MAX(${threadCollections.createdAt})`.as("last_added_at");
      const rows = await db
        .select({ collection: collections, lastAddedAt })
        .from(collections)
        .leftJoin(
          threadCollections,
          and(
            eq(threadCollections.siteId, siteId),
            eq(collections.id, threadCollections.collectionId),
          ),
        )
        .where(eq(collections.siteId, siteId))
        .groupBy(collections.id)
        .orderBy(
          desc(sql`COALESCE(MAX(${threadCollections.createdAt}), 0)`),
          desc(collections.createdAt),
        );
      return hydrateCollections(rows.map((row) => row.collection));
    },

    async create(data) {
      const normalizedData = normalizeCreateCollectionInput(data);
      const id = createEntityId("collection");
      const timestamp = now();
      const slugPath = toCollectionPath(normalizedData.slug);

      for (let attempt = 0; attempt < POSITION_RETRY_ATTEMPTS; attempt += 1) {
        try {
          const position = await getAppendDirectoryPosition();
          if (usesBatchWrites) {
            const writeQueries = [
              db.insert(collections).values({
                id,
                siteId,
                title: normalizedData.title,
                description: normalizedData.description ?? null,
                sortOrder: normalizedData.sortOrder ?? "newest",
                createdAt: timestamp,
                updatedAt: timestamp,
              }),
              db.insert(pathRegistry).values({
                id: createEntityId("path"),
                siteId,
                path: slugPath,
                kind: "slug",
                postId: null,
                collectionId: id,
                redirectToPath: null,
                redirectType: null,
                createdAt: timestamp,
                updatedAt: timestamp,
              }),
              db.insert(directoryItemsTable).values({
                id: createEntityId("collectionDirectoryItem"),
                siteId,
                type: "collection",
                collectionId: id,
                label: null,
                url: null,
                position,
                createdAt: timestamp,
                updatedAt: timestamp,
              }),
            ];

            await db.batch(
              writeQueries as [
                (typeof writeQueries)[number],
                ...(typeof writeQueries)[number][],
              ],
            );
          } else {
            await db.transaction(async (tx) => {
              await tx.insert(collections).values({
                id,
                siteId,
                title: normalizedData.title,
                description: normalizedData.description ?? null,
                sortOrder: normalizedData.sortOrder ?? "newest",
                createdAt: timestamp,
                updatedAt: timestamp,
              });

              await tx.insert(pathRegistry).values({
                id: createEntityId("path"),
                siteId,
                path: slugPath,
                kind: "slug",
                postId: null,
                collectionId: id,
                redirectToPath: null,
                redirectType: null,
                createdAt: timestamp,
                updatedAt: timestamp,
              });

              await tx.insert(directoryItemsTable).values({
                id: createEntityId("collectionDirectoryItem"),
                siteId,
                type: "collection",
                collectionId: id,
                label: null,
                url: null,
                position,
                createdAt: timestamp,
                updatedAt: timestamp,
              });
            });
          }

          const collection = await this.getById(id);
          if (!collection) {
            throw new ConflictError(
              `Slug "${normalizedData.slug}" could not be resolved`,
            );
          }
          return collection;
        } catch (err) {
          if (err instanceof ConflictError) {
            throw err;
          }
          if (isUniqueConstraintError(err) && (await pathExists(slugPath))) {
            throw new ConflictError(
              `Slug "${normalizedData.slug}" is already in use`,
            );
          }
          if (attempt === POSITION_RETRY_ATTEMPTS - 1) {
            throw err;
          }
        }
      }

      throw new Error("Failed to assign a unique directory item position");
    },

    async update(id, data) {
      const normalizedData = normalizeUpdateCollectionInput(data);
      const existing = await this.getById(id);
      if (!existing) return null;

      if (
        normalizedData.slug !== undefined &&
        normalizedData.slug !== existing.slug
      ) {
        try {
          await resolvedPaths.updateCollectionSlug(id, normalizedData.slug);
        } catch (err) {
          if (err instanceof ConflictError) {
            throw new ConflictError(
              `Slug "${normalizedData.slug}" is already in use`,
            );
          }
          throw err;
        }
      }

      const timestamp = now();

      // Update nav item URLs when the collection slug changes
      if (
        normalizedData.slug !== undefined &&
        normalizedData.slug !== existing.slug
      ) {
        await db
          .update(navItems)
          .set({
            url: getCollectionPagePath(normalizedData.slug),
            updatedAt: timestamp,
          })
          .where(
            and(eq(navItems.siteId, siteId), eq(navItems.collectionId, id)),
          );
      }
      const updates: Partial<typeof collections.$inferInsert> = {
        updatedAt: timestamp,
      };

      if (normalizedData.title !== undefined) {
        updates.title = normalizedData.title;
      }
      if (normalizedData.description !== undefined) {
        updates.description = normalizedData.description;
      }
      if (normalizedData.sortOrder !== undefined) {
        updates.sortOrder = normalizedData.sortOrder;
      }

      const result = await db
        .update(collections)
        .set(updates)
        .where(and(eq(collections.siteId, siteId), eq(collections.id, id)))
        .returning();

      return hydrateCollection(result[0]);
    },

    async delete(id) {
      await db
        .delete(threadCollections)
        .where(
          and(
            eq(threadCollections.siteId, siteId),
            eq(threadCollections.collectionId, id),
          ),
        );
      await db
        .delete(directoryItemsTable)
        .where(
          and(
            eq(directoryItemsTable.siteId, siteId),
            eq(directoryItemsTable.collectionId, id),
          ),
        );
      await db
        .delete(navItems)
        .where(and(eq(navItems.siteId, siteId), eq(navItems.collectionId, id)));
      const result = await db
        .delete(collections)
        .where(and(eq(collections.siteId, siteId), eq(collections.id, id)))
        .returning();
      return result.length > 0;
    },

    async listDirectoryItems() {
      const rows = await db
        .select()
        .from(directoryItemsTable)
        .where(eq(directoryItemsTable.siteId, siteId))
        .orderBy(asc(directoryItemsTable.position));
      return rows.map(toDirectoryItem);
    },

    async createDirectoryItem(data) {
      const normalizedData = normalizeCreateDirectoryItemInput(data);
      const id = createEntityId("collectionDirectoryItem");
      const timestamp = now();

      for (let attempt = 0; attempt < POSITION_RETRY_ATTEMPTS; attempt += 1) {
        try {
          const result = await db
            .insert(directoryItemsTable)
            .values({
              id,
              siteId,
              type: normalizedData.type,
              collectionId:
                normalizedData.type === "collection"
                  ? normalizedData.collectionId
                  : null,
              label:
                normalizedData.type === "divider"
                  ? (normalizedData.label ?? null)
                  : normalizedData.type === "link"
                    ? normalizedData.label
                    : null,
              url: normalizedData.type === "link" ? normalizedData.url : null,
              description:
                normalizedData.type === "link"
                  ? (normalizedData.description ?? null)
                  : null,
              position: await getAppendDirectoryPosition(),
              createdAt: timestamp,
              updatedAt: timestamp,
            })
            .returning();

          // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- DB insert with .returning() always returns inserted row
          return toDirectoryItem(result[0]!);
        } catch (err) {
          if (
            normalizedData.type === "collection" &&
            isUniqueConstraintError(err)
          ) {
            const existing = await db
              .select({ id: directoryItemsTable.id })
              .from(directoryItemsTable)
              .where(
                and(
                  eq(directoryItemsTable.siteId, siteId),
                  eq(
                    directoryItemsTable.collectionId,
                    normalizedData.collectionId,
                  ),
                ),
              )
              .limit(1);
            if (existing.length > 0) {
              throw new ConflictError(
                "Collection is already in the directory.",
              );
            }
          }
          if (
            !isUniqueConstraintError(err) ||
            attempt === POSITION_RETRY_ATTEMPTS - 1
          ) {
            throw err;
          }
        }
      }

      throw new Error("Failed to assign a unique directory item position");
    },

    async deleteDirectoryItem(id) {
      const result = await db
        .delete(directoryItemsTable)
        .where(
          and(
            eq(directoryItemsTable.siteId, siteId),
            eq(directoryItemsTable.id, id),
          ),
        )
        .returning();
      return result.length > 0;
    },

    async updateDirectoryItem(id, data) {
      const existing = await db
        .select()
        .from(directoryItemsTable)
        .where(
          and(
            eq(directoryItemsTable.siteId, siteId),
            eq(directoryItemsTable.id, id),
          ),
        )
        .limit(1);
      const item = existing[0];
      if (!item) return null;

      if (
        data.label === undefined &&
        data.url === undefined &&
        data.description === undefined
      ) {
        return toDirectoryItem(item);
      }

      let nextLabel = item.label;
      let nextUrl = item.url;
      let nextDescription = item.description;

      if (item.type === "divider" && data.label !== undefined) {
        nextLabel = normalizeDirectoryLabel(data.label);
      }

      if (item.type === "link") {
        if (data.label !== undefined) {
          if (data.label === null) {
            throw new ValidationError("Link label is required.");
          }
          nextLabel = normalizeDirectoryLinkLabel(data.label);
        }
        if (data.url !== undefined) {
          nextUrl = normalizeDirectoryUrl(data.url);
        }
        if (data.description !== undefined) {
          nextDescription = normalizeDirectoryDescription(data.description);
        }
      }

      const result = await db
        .update(directoryItemsTable)
        .set({
          label: item.type === "collection" ? null : nextLabel,
          url: item.type === "link" ? nextUrl : null,
          description: item.type === "link" ? nextDescription : null,
          updatedAt: now(),
        })
        .where(
          and(
            eq(directoryItemsTable.siteId, siteId),
            eq(directoryItemsTable.id, id),
          ),
        )
        .returning();

      return result[0] ? toDirectoryItem(result[0]) : null;
    },

    async moveDirectoryItem(id, afterId, beforeId) {
      const items = await db
        .select()
        .from(directoryItemsTable)
        .where(
          and(
            eq(directoryItemsTable.siteId, siteId),
            eq(directoryItemsTable.id, id),
          ),
        )
        .limit(1);
      if (!items[0]) return null;

      const timestamp = now();
      for (let attempt = 0; attempt < POSITION_RETRY_ATTEMPTS; attempt += 1) {
        try {
          const result = await db
            .update(directoryItemsTable)
            .set({
              position: await getDirectoryMovePosition(id, afterId, beforeId),
              updatedAt: timestamp,
            })
            .where(
              and(
                eq(directoryItemsTable.siteId, siteId),
                eq(directoryItemsTable.id, id),
              ),
            )
            .returning();

          return result[0] ? toDirectoryItem(result[0]) : null;
        } catch (err) {
          if (
            !isUniqueConstraintError(err) ||
            attempt === POSITION_RETRY_ATTEMPTS - 1
          ) {
            throw err;
          }
        }
      }

      throw new Error("Failed to assign a unique directory item position");
    },

    async getThreadCounts() {
      const rows = await db
        .select({
          collectionId: threadCollections.collectionId,
          count: sql<number>`CAST(count(*) AS INTEGER)`.as("count"),
        })
        .from(threadCollections)
        .where(eq(threadCollections.siteId, siteId))
        .groupBy(threadCollections.collectionId);

      const counts = new Map<string, number>();
      for (const row of rows) {
        counts.set(row.collectionId, row.count);
      }
      return counts;
    },

    async addThread(collectionId, postId, opts) {
      const threadId = await resolveThreadRootId(postId);
      const [maxRow] = await db
        .select({
          maxPos: sql<number>`COALESCE(MAX(${threadCollections.position}), -1)`,
        })
        .from(threadCollections)
        .where(
          and(
            eq(threadCollections.siteId, siteId),
            eq(threadCollections.threadId, threadId),
          ),
        );
      const nextPosition = (maxRow?.maxPos ?? -1) + 1;
      await db
        .insert(threadCollections)
        .values({
          siteId,
          threadId,
          collectionId,
          createdAt: opts?.createdAt ?? now(),
          position: opts?.position ?? nextPosition,
          pinnedAt: opts?.pinnedAt ?? null,
        })
        .onConflictDoNothing();
    },

    async syncThreadCollectionsWithMeta(threadId, entries) {
      const seen = new Set<string>();
      const timestamp = now();
      const insertValues: {
        siteId: string;
        threadId: string;
        collectionId: string;
        createdAt: number;
        position: number;
        pinnedAt: number | null;
      }[] = [];
      let fallbackPosition = 0;
      for (const entry of entries) {
        if (seen.has(entry.collectionId)) continue;
        seen.add(entry.collectionId);
        insertValues.push({
          siteId,
          threadId,
          collectionId: entry.collectionId,
          createdAt: entry.createdAt ?? timestamp,
          position: entry.position ?? fallbackPosition,
          pinnedAt: entry.pinnedAt ?? null,
        });
        fallbackPosition++;
      }

      const deleteQuery = db
        .delete(threadCollections)
        .where(
          and(
            eq(threadCollections.siteId, siteId),
            eq(threadCollections.threadId, threadId),
          ),
        );

      if (usesBatchWrites) {
        const writeQueries = [];
        writeQueries.push(deleteQuery);
        if (insertValues.length > 0) {
          writeQueries.push(db.insert(threadCollections).values(insertValues));
        }
        await db.batch(
          writeQueries as [
            (typeof writeQueries)[number],
            ...(typeof writeQueries)[number][],
          ],
        );
        return;
      }

      await db.transaction(async (tx) => {
        await tx
          .delete(threadCollections)
          .where(
            and(
              eq(threadCollections.siteId, siteId),
              eq(threadCollections.threadId, threadId),
            ),
          );
        if (insertValues.length > 0) {
          await tx.insert(threadCollections).values(insertValues);
        }
      });
    },

    async removeThread(collectionId, postId) {
      const threadId = await resolveThreadRootId(postId);
      await db
        .delete(threadCollections)
        .where(
          and(
            eq(threadCollections.siteId, siteId),
            eq(threadCollections.threadId, threadId),
            eq(threadCollections.collectionId, collectionId),
          ),
        );
    },

    async pinThread(collectionId, postId) {
      const threadId = await resolveThreadRootId(postId);
      await db
        .update(threadCollections)
        .set({ pinnedAt: now() })
        .where(
          and(
            eq(threadCollections.siteId, siteId),
            eq(threadCollections.threadId, threadId),
            eq(threadCollections.collectionId, collectionId),
          ),
        );
    },

    async unpinThread(collectionId, postId) {
      const threadId = await resolveThreadRootId(postId);
      await db
        .update(threadCollections)
        .set({ pinnedAt: null })
        .where(
          and(
            eq(threadCollections.siteId, siteId),
            eq(threadCollections.threadId, threadId),
            eq(threadCollections.collectionId, collectionId),
          ),
        );
    },

    async getPinnedThreadIds(collectionIds) {
      if (collectionIds.length === 0) return new Set<string>();
      const rows = await db
        .select({ threadId: threadCollections.threadId })
        .from(threadCollections)
        .where(
          and(
            eq(threadCollections.siteId, siteId),
            inArray(threadCollections.collectionId, collectionIds),
            sql`${threadCollections.pinnedAt} IS NOT NULL`,
          ),
        );
      return new Set(rows.map((row) => row.threadId));
    },

    async getCollectionsByPostId(postId) {
      const rows = await db
        .select({ collection: collections })
        .from(posts)
        .innerJoin(
          threadCollections,
          and(
            eq(threadCollections.siteId, posts.siteId),
            eq(threadCollections.threadId, posts.threadId),
          ),
        )
        .innerJoin(
          collections,
          eq(threadCollections.collectionId, collections.id),
        )
        .where(
          and(
            eq(posts.siteId, siteId),
            eq(collections.siteId, siteId),
            eq(posts.id, postId),
          ),
        )
        .orderBy(
          asc(threadCollections.position),
          asc(threadCollections.createdAt),
        );

      return hydrateCollections(rows.map((row) => row.collection));
    },

    async getCollectionsByPostIds(postIds) {
      const result = new Map<string, Collection[]>();
      if (postIds.length === 0) return result;

      const postRows = await batchQueryRows(postIds, (chunk) =>
        db
          .select({
            postId: posts.id,
            threadId: posts.threadId,
          })
          .from(posts)
          .where(and(eq(posts.siteId, siteId), inArray(posts.id, chunk))),
      );
      const threadIds = [...new Set(postRows.map((row) => row.threadId))];
      if (threadIds.length === 0) return result;
      const rows = await batchQueryRows(threadIds, (chunk) =>
        db
          .select({
            threadId: threadCollections.threadId,
            collection: collections,
          })
          .from(threadCollections)
          .innerJoin(
            collections,
            eq(threadCollections.collectionId, collections.id),
          )
          .where(
            and(
              eq(threadCollections.siteId, siteId),
              eq(collections.siteId, siteId),
              inArray(threadCollections.threadId, chunk),
            ),
          )
          .orderBy(
            asc(threadCollections.position),
            asc(threadCollections.createdAt),
          ),
      );

      const collectionRows = rows.map((row) => row.collection);
      const slugMap = await resolvedPaths.getCollectionSlugMap(
        collectionRows.map((row) => row.id),
      );

      const collectionsByThread = new Map<string, Collection[]>();
      for (const row of rows) {
        const slug = slugMap.get(row.collection.id);
        if (!slug) continue;
        const existing = collectionsByThread.get(row.threadId) ?? [];
        existing.push(toCollection(row.collection, slug));
        collectionsByThread.set(row.threadId, existing);
      }

      for (const row of postRows) {
        const threadMemberships = collectionsByThread.get(row.threadId);
        if (threadMemberships) {
          result.set(row.postId, threadMemberships);
        }
      }

      return result;
    },

    async getCollectionPinsByThreadIds(threadIds) {
      const result = new Map<string, Set<string>>();
      if (threadIds.length === 0) return result;

      const rows = await batchQueryRows(threadIds, (chunk) =>
        db
          .select({
            threadId: threadCollections.threadId,
            collectionId: threadCollections.collectionId,
          })
          .from(threadCollections)
          .where(
            and(
              eq(threadCollections.siteId, siteId),
              inArray(threadCollections.threadId, chunk),
              sql`${threadCollections.pinnedAt} IS NOT NULL`,
            ),
          ),
      );

      for (const row of rows) {
        const existing = result.get(row.threadId) ?? new Set<string>();
        existing.add(row.collectionId);
        result.set(row.threadId, existing);
      }

      return result;
    },

    async getThreadIds(collectionId) {
      const rows = await db
        .select({ threadId: threadCollections.threadId })
        .from(threadCollections)
        .where(
          and(
            eq(threadCollections.siteId, siteId),
            eq(threadCollections.collectionId, collectionId),
          ),
        );

      return rows.map((row) => row.threadId);
    },

    async getCollectionEntriesByThreadIds(threadIds) {
      const result = new Map<
        string,
        {
          collectionId: string;
          createdAt: number;
          position: number;
          pinnedAt: number | null;
        }[]
      >();
      if (threadIds.length === 0) return result;

      const rows = await batchQueryRows(threadIds, (chunk) =>
        db
          .select({
            threadId: threadCollections.threadId,
            collectionId: threadCollections.collectionId,
            createdAt: threadCollections.createdAt,
            position: threadCollections.position,
            pinnedAt: threadCollections.pinnedAt,
          })
          .from(threadCollections)
          .where(
            and(
              eq(threadCollections.siteId, siteId),
              inArray(threadCollections.threadId, chunk),
            ),
          )
          .orderBy(
            asc(threadCollections.position),
            asc(threadCollections.createdAt),
          ),
      );

      for (const row of rows) {
        const existing = result.get(row.threadId) ?? [];
        existing.push({
          collectionId: row.collectionId,
          createdAt: row.createdAt,
          position: row.position,
          pinnedAt: row.pinnedAt,
        });
        result.set(row.threadId, existing);
      }

      return result;
    },

    async syncThreadCollections(threadId, collectionIds) {
      const nextCollectionIds = [...new Set(collectionIds)];

      // Fetch existing rows to preserve createdAt for retained collections
      const existingRows = await db
        .select({
          collectionId: threadCollections.collectionId,
          createdAt: threadCollections.createdAt,
          pinnedAt: threadCollections.pinnedAt,
        })
        .from(threadCollections)
        .where(
          and(
            eq(threadCollections.siteId, siteId),
            eq(threadCollections.threadId, threadId),
          ),
        );

      if (existingRows.length === 0 && nextCollectionIds.length === 0) {
        return;
      }

      const existingEntries = new Map(
        existingRows.map((row) => [row.collectionId, row]),
      );
      const timestamp = now();
      const insertValues = nextCollectionIds.map((collectionId, index) => ({
        siteId,
        threadId,
        collectionId,
        createdAt: existingEntries.get(collectionId)?.createdAt ?? timestamp,
        position: index,
        pinnedAt: existingEntries.get(collectionId)?.pinnedAt ?? null,
      }));

      // Delete all and re-insert to preserve user-specified ordering
      const deleteQuery = db
        .delete(threadCollections)
        .where(
          and(
            eq(threadCollections.siteId, siteId),
            eq(threadCollections.threadId, threadId),
          ),
        );

      if (usesBatchWrites) {
        const writeQueries = [];
        writeQueries.push(deleteQuery);
        if (insertValues.length > 0) {
          writeQueries.push(db.insert(threadCollections).values(insertValues));
        }
        await db.batch(
          writeQueries as [
            (typeof writeQueries)[number],
            ...(typeof writeQueries)[number][],
          ],
        );
        return;
      }

      await db.transaction(async (tx) => {
        await tx
          .delete(threadCollections)
          .where(
            and(
              eq(threadCollections.siteId, siteId),
              eq(threadCollections.threadId, threadId),
            ),
          );
        if (insertValues.length > 0) {
          await tx.insert(threadCollections).values(insertValues);
        }
      });
    },
  };
}
