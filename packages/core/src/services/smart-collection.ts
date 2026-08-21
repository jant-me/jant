/**
 * Smart Collection Service
 *
 * A smart collection is a collection whose members are decided by conditions
 * rather than by tagging. To a reader it is a collection: root-level address,
 * title, description, post list, feed. To the author it is a different gesture
 * — writing conditions instead of tagging posts — and the asymmetry is
 * permanent: nothing is added by hand, pinned, or reordered.
 *
 * Two rules this service exists to hold:
 *
 * - **A smart collection is always public.** `visibility` can only be one of
 *   the public archive values, so there is no page that answers 404 to a
 *   reader, no feed guard, and no placement guard. Per-post visibility is
 *   unchanged: the same base predicate a manual collection page applies, so a
 *   signed-in author may see a larger count than an anonymous reader — exactly
 *   as on a manual collection.
 * - **A collection another object depends on is not deleted silently.**
 *   `collection_id` carries no foreign key — no ON DELETE action was the right
 *   one, and a constraint could only fail anonymously — so `assertCollectionUnused`
 *   is the whole of that rule, and it refuses by name.
 */

import { and, asc, eq, inArray } from "drizzle-orm";
import { type Database } from "../db/index.js";
import {
  sqliteSchemaBundle,
  type DatabaseSchema,
} from "../db/schema-bundle.js";
import { createEntityId } from "../lib/ids.js";
import { now } from "../lib/time.js";
import { isUniqueConstraintError } from "../db/dialect.js";
import {
  DIRECTORY_POSITION_RETRY_ATTEMPTS,
  getAppendDirectoryPosition,
} from "./collection-directory-position.js";
import {
  ConflictError,
  NotFoundError,
  ValidationError,
} from "../lib/errors.js";
import { getCollectionPagePath } from "../lib/collection-paths.js";
import { generatePostSlug } from "../lib/slug.js";
import { getSlugValidationIssue } from "../lib/slug-format.js";
import {
  PostFilterSelectionSchema,
  selectionFromRow,
  selectionToColumns,
  toPostFilters,
  type PostFilterSelection,
} from "../lib/filter-dimensions.js";
import {
  CollectionDescriptionValueSchema,
  CollectionSlugSchema,
  CollectionTitleSchema,
  parseValidated,
} from "../lib/schemas.js";
import type {
  CreateSmartCollection,
  SmartCollection,
  SmartCollectionDirectoryEntry,
  UpdateSmartCollection,
} from "../types.js";
import { toCollectionPath, type PathService } from "./path.js";
import type { PostFilters, PostService } from "./post.js";

/** Who is looking, for the per-post visibility rules a count has to respect. */
export interface SmartCollectionViewer {
  /** Signed-in authors see their private threads counted; readers do not. */
  isAuthenticated: boolean;
  /** Content language of the current view, when the site has more than one. */
  lang?: string;
}

export interface SmartCollectionService {
  getById(id: string): Promise<SmartCollection | null>;
  getBySlug(slug: string): Promise<SmartCollection | null>;
  list(): Promise<SmartCollection[]>;
  /**
   * Every smart collection with the count and freshness this viewer would see.
   *
   * Both measures are the viewer's own: a thread only the author can see is
   * counted for the author alone, and it dates the collection for the author
   * alone. A reader is never told that something they cannot read just moved.
   */
  listDirectoryEntries(
    viewer: SmartCollectionViewer,
  ): Promise<SmartCollectionDirectoryEntry[]>;
  create(data: CreateSmartCollection): Promise<SmartCollection>;
  update(
    id: string,
    data: UpdateSmartCollection,
  ): Promise<SmartCollection | null>;
  delete(id: string): Promise<boolean>;
  /**
   * A slug this smart collection could take, derived from a title.
   *
   * Same shape posts use, because the namespace is the same one: an address is
   * free or it is not, whoever holds it.
   */
  suggestSlug(input: { title?: string; excludeId?: string }): Promise<string>;
  /** Whether an address is free, ignoring the one this smart collection holds. */
  checkSlugAvailability(slug: string, excludeId?: string): Promise<boolean>;
  /**
   * How many threads a set of conditions matches, next to the unfiltered total.
   *
   * What makes the editing dialog possible: without it an author is filling in
   * a blind form and can save something that matches nothing.
   */
  preview(
    selection: PostFilterSelection,
    viewer: SmartCollectionViewer,
  ): Promise<{ count: number; baseline: number }>;
  /**
   * The `PostFilters` this smart collection's conditions imply, for one viewer.
   *
   * The only place conditions become a query. Page, feed, and count all read
   * it, so none of them can answer with a different set than the others.
   */
  toPostFilters(
    smartCollection: SmartCollection,
    viewer: SmartCollectionViewer,
  ): PostFilters;
  /**
   * Refuse to delete a collection that a smart collection filters by.
   *
   * Called before deleting a collection. Nothing is repaired automatically:
   * clearing the condition would quietly widen a smart collection the author
   * never edited, which this project does not do.
   *
   * @param collectionId - The collection about to be deleted
   * @throws ValidationError naming the smart collections that depend on it
   */
  assertCollectionUnused(collectionId: string): Promise<void>;
}

export function createSmartCollectionService(
  db: Database,
  siteId: string,
  resolvedPaths: PathService,
  posts: PostService,
  databaseSchema: DatabaseSchema = sqliteSchemaBundle,
  slugIdLength = 5,
): SmartCollectionService {
  const {
    smartCollections,
    navItems,
    collectionDirectoryItems: directoryItemsTable,
  } = databaseSchema;

  type SmartCollectionRow = typeof smartCollections.$inferSelect;

  function toSmartCollection(
    row: SmartCollectionRow,
    slug: string,
  ): SmartCollection {
    return {
      id: row.id,
      siteId: row.siteId,
      slug,
      title: row.title,
      description: row.description,
      selection: selectionFromRow(row as unknown as Record<string, unknown>),
      sort: row.sort,
      layout: row.layout ?? null,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  async function hydrate(
    row: SmartCollectionRow | undefined,
  ): Promise<SmartCollection | null> {
    if (!row) return null;
    const slug = await resolvedPaths.getSmartCollectionSlug(row.id);
    return slug ? toSmartCollection(row, slug) : null;
  }

  async function hydrateMany(
    rows: SmartCollectionRow[],
  ): Promise<SmartCollection[]> {
    if (rows.length === 0) return [];
    const slugMap = await resolvedPaths.getSmartCollectionSlugMap(
      rows.map((row) => row.id),
    );
    return rows
      .map((row) => {
        const slug = slugMap.get(row.id);
        return slug ? toSmartCollection(row, slug) : null;
      })
      .filter((row): row is SmartCollection => row !== null);
  }

  /**
   * Append this smart collection's row to the collections directory.
   *
   * The directory is one ordered list shared with manual collections, dividers,
   * and links; the row is what gives a smart collection a position in it. The
   * position rule itself lives in `collection-directory-position`, so both
   * writers append the same way.
   *
   * @param id - The smart collection to place
   * @param timestamp - Creation time, shared with the smart collection row
   */
  async function placeInDirectory(
    id: string,
    timestamp: number,
  ): Promise<void> {
    for (
      let attempt = 0;
      attempt < DIRECTORY_POSITION_RETRY_ATTEMPTS;
      attempt += 1
    ) {
      try {
        await db.insert(directoryItemsTable).values({
          id: createEntityId("collectionDirectoryItem"),
          siteId,
          type: "smart_collection",
          collectionId: null,
          smartCollectionId: id,
          label: null,
          url: null,
          position: await getAppendDirectoryPosition(
            db,
            directoryItemsTable,
            siteId,
          ),
          createdAt: timestamp,
          updatedAt: timestamp,
        });
        return;
      } catch (err) {
        if (
          !isUniqueConstraintError(err) ||
          attempt === DIRECTORY_POSITION_RETRY_ATTEMPTS - 1
        ) {
          throw err;
        }
      }
    }
  }

  /** Validate and normalize the fields a create or update may set. */
  function normalizeInput(
    data: CreateSmartCollection | UpdateSmartCollection,
  ): {
    slug?: string;
    title?: string;
    description?: string | null;
    selection?: PostFilterSelection;
    sort?: SmartCollection["sort"];
    layout?: SmartCollection["layout"];
  } {
    return {
      ...(data.slug !== undefined
        ? { slug: parseValidated(CollectionSlugSchema, data.slug) }
        : {}),
      ...(data.title !== undefined
        ? { title: parseValidated(CollectionTitleSchema, data.title) }
        : {}),
      ...(data.description !== undefined
        ? {
            description:
              data.description === null || data.description === ""
                ? null
                : parseValidated(
                    CollectionDescriptionValueSchema,
                    data.description,
                  ),
          }
        : {}),
      ...(data.selection !== undefined
        ? {
            selection: parseValidated(
              PostFilterSelectionSchema,
              data.selection,
            ),
          }
        : {}),
      ...(data.sort !== undefined ? { sort: data.sort } : {}),
      ...(data.layout !== undefined ? { layout: data.layout } : {}),
    };
  }

  /** Is this address free, ignoring the one this smart collection already holds? */
  async function isSlugFree(
    slug: string,
    excludeId?: string,
  ): Promise<boolean> {
    const resolved = await resolvedPaths.resolve(toCollectionPath(slug));
    if (!resolved) return true;
    return Boolean(
      excludeId &&
      resolved.kind === "slug" &&
      resolved.smartCollectionId === excludeId,
    );
  }

  /**
   * Every collection the selection names must exist.
   *
   * The registry validates the *shape* of a collection id; only the database
   * can say whether one is real. A condition pointing at nothing would render
   * as a smart collection that silently matches no post.
   */
  async function assertSelectionResolvable(
    selection: PostFilterSelection,
  ): Promise<void> {
    const ids = selection.collection ?? [];
    if (ids.length === 0) return;

    const { collections } = databaseSchema;
    const rows = await db
      .select({ id: collections.id })
      .from(collections)
      .where(
        and(eq(collections.siteId, siteId), inArray(collections.id, [...ids])),
      );
    if (rows.length !== ids.length) {
      throw new NotFoundError("Collection");
    }
  }

  function buildPostFilters(
    smartCollection: SmartCollection,
    viewer: SmartCollectionViewer,
  ): PostFilters {
    const sortsByActivity = smartCollection.sort === "updated";
    return {
      lang: viewer.lang,
      status: "published",
      excludeReplies: true,
      // The floor, always. A smart collection is public, but the posts inside
      // it are only as visible as they are anywhere else.
      excludePrivate: !viewer.isAuthenticated,
      excludeLatestHidden: false,
      // Membership never depends on presentation, so the year condition is
      // pinned to the publication axis whatever the chosen order is.
      ...toPostFilters(smartCollection.selection, { yearAxis: "published" }),
      ...(sortsByActivity
        ? { sortBy: "thread_updated" as const }
        : { sortBy: "published" as const }),
      ...(smartCollection.sort === "oldest"
        ? { sortOrder: "oldest" as const }
        : smartCollection.sort === "rating_desc"
          ? { sortOrder: "rating_desc" as const }
          : smartCollection.sort === "newest"
            ? { sortOrder: "newest" as const }
            : {}),
      ignorePinnedSort: true,
    };
  }

  return {
    async getById(id) {
      const rows = await db
        .select()
        .from(smartCollections)
        .where(
          and(eq(smartCollections.siteId, siteId), eq(smartCollections.id, id)),
        )
        .limit(1);
      return hydrate(rows[0]);
    },

    async getBySlug(slug) {
      const resolved = await resolvedPaths.resolve(toCollectionPath(slug));
      if (
        !resolved ||
        resolved.kind !== "slug" ||
        !resolved.smartCollectionId
      ) {
        return null;
      }
      return this.getById(resolved.smartCollectionId);
    },

    async list() {
      const rows = await db
        .select()
        .from(smartCollections)
        .where(eq(smartCollections.siteId, siteId))
        .orderBy(asc(smartCollections.createdAt));
      return hydrateMany(rows);
    },

    async listDirectoryEntries(viewer) {
      const entries = await this.list();
      if (entries.length === 0) return [];

      // One pass for every smart collection on the page, not one query each.
      // Same predicate builder the pages use, so the number in the directory
      // and the number on the page it links to agree.
      const measured = await posts.aggregateMany(
        entries.map((entry) => toPostFilters(entry.selection, {})),
        {
          status: "published",
          excludeReplies: true,
          excludePrivate: !viewer.isAuthenticated,
          excludeLatestHidden: false,
          lang: viewer.lang,
        },
      );

      return entries.map((entry, index) => ({
        ...entry,
        threadCount: measured[index]?.count ?? 0,
        // Nothing matched — no thread to date it by — so the collection dates
        // itself, exactly as an empty manual collection does.
        recentActivityAt: measured[index]?.recentActivityAt ?? entry.updatedAt,
      }));
    },

    async create(data) {
      const normalized = normalizeInput(data);
      if (!normalized.slug || !normalized.title) {
        throw new ValidationError(
          "A smart collection needs a title and an address.",
        );
      }
      const selection = normalized.selection ?? {};
      await assertSelectionResolvable(selection);

      const id = createEntityId("smartCollection");
      const timestamp = now();

      // The row goes in before its path, because the path row's foreign key
      // points at it. The address is what can still fail — it shares one
      // namespace with posts and collections — so a clash rolls the row back
      // rather than leaving a smart collection nothing can reach.
      await db.insert(smartCollections).values({
        id,
        siteId,
        title: normalized.title,
        description: normalized.description ?? null,
        ...selectionToColumns(selection),
        sort: normalized.sort ?? "newest",
        layout: normalized.layout ?? null,
        createdAt: timestamp,
        updatedAt: timestamp,
      } as typeof smartCollections.$inferInsert);

      try {
        // A smart collection takes its place in the directory the way a manual
        // one does — appended, with a row of its own. The directory would list
        // it either way, but only a row can hold a position, so without this it
        // sits below every manual collection and cannot be dragged out of there.
        await placeInDirectory(id, timestamp);
        await resolvedPaths.createSmartCollectionSlug(id, normalized.slug);
      } catch (err) {
        await db
          .delete(directoryItemsTable)
          .where(
            and(
              eq(directoryItemsTable.siteId, siteId),
              eq(directoryItemsTable.smartCollectionId, id),
            ),
          );
        await db
          .delete(smartCollections)
          .where(
            and(
              eq(smartCollections.siteId, siteId),
              eq(smartCollections.id, id),
            ),
          );
        if (err instanceof ConflictError) {
          throw new ConflictError(
            `Slug "${normalized.slug}" is already in use`,
          );
        }
        throw err;
      }

      const created = await this.getById(id);
      if (!created) throw new NotFoundError("Smart collection");
      return created;
    },

    async update(id, data) {
      const existing = await this.getById(id);
      if (!existing) return null;

      const normalized = normalizeInput(data);
      if (normalized.selection) {
        await assertSelectionResolvable(normalized.selection);
      }

      const timestamp = now();
      const slugChanged =
        normalized.slug !== undefined && normalized.slug !== existing.slug;

      if (slugChanged && normalized.slug) {
        try {
          await resolvedPaths.updateSmartCollectionSlug(id, normalized.slug);
        } catch (err) {
          if (err instanceof ConflictError) {
            throw new ConflictError(
              `Slug "${normalized.slug}" is already in use`,
            );
          }
          throw err;
        }

        // A nav item's URL is stored, unlike its label, so moving the address
        // has to move the link with it — the same rewrite a renamed collection
        // performs.
        await db
          .update(navItems)
          .set({
            url: getCollectionPagePath(normalized.slug),
            updatedAt: timestamp,
          })
          .where(
            and(
              eq(navItems.siteId, siteId),
              eq(navItems.smartCollectionId, id),
            ),
          );
      }

      const updates: Record<string, unknown> = { updatedAt: timestamp };
      if (normalized.title !== undefined) updates.title = normalized.title;
      if (normalized.description !== undefined) {
        updates.description = normalized.description;
      }
      if (normalized.sort !== undefined) updates.sort = normalized.sort;
      if (normalized.layout !== undefined) updates.layout = normalized.layout;
      if (normalized.selection !== undefined) {
        // Every dimension is written, including the ones with no value —
        // removing a condition has to clear its column, not leave it behind.
        Object.assign(updates, selectionToColumns(normalized.selection));
      }

      await db
        .update(smartCollections)
        .set(updates as Partial<typeof smartCollections.$inferInsert>)
        .where(
          and(eq(smartCollections.siteId, siteId), eq(smartCollections.id, id)),
        );

      return this.getById(id);
    },

    async delete(id) {
      await db
        .delete(directoryItemsTable)
        .where(
          and(
            eq(directoryItemsTable.siteId, siteId),
            eq(directoryItemsTable.smartCollectionId, id),
          ),
        );
      await db
        .delete(navItems)
        .where(
          and(eq(navItems.siteId, siteId), eq(navItems.smartCollectionId, id)),
        );
      const result = await db
        .delete(smartCollections)
        .where(
          and(eq(smartCollections.siteId, siteId), eq(smartCollections.id, id)),
        )
        .returning();
      return result.length > 0;
    },

    async suggestSlug(input) {
      return generatePostSlug({
        title: input.title,
        idLength: slugIdLength,
        isAvailable: (candidate) => isSlugFree(candidate, input.excludeId),
      });
    },

    async checkSlugAvailability(slug, excludeId) {
      const issue = getSlugValidationIssue(slug);
      if (issue === "invalid") {
        throw new ValidationError("Slug contains invalid characters");
      }
      if (issue === "reserved") {
        throw new ValidationError("Slug is reserved");
      }
      return isSlugFree(slug, excludeId);
    },

    async preview(selection, viewer) {
      const parsed = parseValidated(PostFilterSelectionSchema, selection);
      await assertSelectionResolvable(parsed);

      const base: PostFilters = {
        status: "published",
        excludeReplies: true,
        excludePrivate: !viewer.isAuthenticated,
        excludeLatestHidden: false,
        lang: viewer.lang,
      };
      // Both numbers in one round trip, and both through the same predicate
      // builder the saved page will use — a preview that counted differently
      // than the page would be worse than no preview.
      const [matched, all] = await posts.aggregateMany(
        [toPostFilters(parsed, {}), {}],
        base,
      );
      return { count: matched?.count ?? 0, baseline: all?.count ?? 0 };
    },

    toPostFilters(smartCollection, viewer) {
      return buildPostFilters(smartCollection, viewer);
    },

    async assertCollectionUnused(collectionId) {
      const rows = await db
        .select({ title: smartCollections.title })
        .from(smartCollections)
        .where(
          and(
            eq(smartCollections.siteId, siteId),
            eq(smartCollections.collectionId, collectionId),
          ),
        )
        .orderBy(asc(smartCollections.createdAt));

      if (rows.length === 0) return;

      // Named, not counted: "used by 2 smart collections" leaves the author
      // hunting for which ones.
      const names = rows.map((row) => row.title).join(", ");
      throw new ValidationError(
        rows.length === 1
          ? `This collection is used by the smart collection ${names}. Change or delete that first.`
          : `This collection is used by these smart collections: ${names}. Change or delete them first.`,
      );
    },
  };
}
