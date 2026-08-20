/**
 * Path Service
 *
 * Centralizes path ownership and resolution for posts, collections, aliases,
 * and redirects. Stored paths are normalized relative paths without a leading
 * slash (for example: "hello-world" or "collections/reading+tools").
 */

import { and, asc, eq, inArray, isNotNull, ne, or, sql } from "drizzle-orm";
import { type Database, batchQuery } from "../db/index.js";
import {
  sqliteSchemaBundle,
  type DatabaseSchema,
} from "../db/schema-bundle.js";
import { createEntityId } from "../lib/ids.js";
import { now } from "../lib/time.js";
import { ConflictError } from "../lib/errors.js";
import { normalizePath } from "../lib/url.js";
import type { PathKind, PathRecord, Status } from "../types.js";

export interface ResolvedPath extends PathRecord {
  targetType:
    | "post"
    | "collection"
    | "smart_collection"
    | "redirect"
    | "archive";
}

export interface CreatePathInput {
  path: string;
  kind: PathKind;
  postId?: string | null;
  collectionId?: string | null;
  smartCollectionId?: string | null;
  redirectToPath?: string | null;
  redirectType?: 301 | 302 | null;
  archiveQuery?: string | null;
}

export interface PathService {
  getByPath(path: string): Promise<PathRecord | null>;
  resolve(path: string): Promise<ResolvedPath | null>;
  /**
   * Resolve a path the way a browser would: following stored redirects until
   * something that is not a redirect answers.
   *
   * Reach for this when an address has to name an *entity* — an author pasting
   * a URL means the post at the end of it, not the hop they happened to copy.
   * The plain {@link PathService.resolve} stays the right call for serving a
   * request, which must emit the redirect rather than swallow it.
   *
   * @param path - Stored or public path, with or without a leading slash
   * @returns What the address finally points at, or null when nothing does
   * @example
   * await paths.resolveTarget("/old-name"); // { targetType: "post", postId: "pst_…" }
   */
  resolveTarget(path: string): Promise<ResolvedPath | null>;
  isPathAvailable(path: string, excludeId?: string): Promise<boolean>;
  getPostSlug(postId: string): Promise<string | null>;
  getCollectionSlug(collectionId: string): Promise<string | null>;
  getSmartCollectionSlug(smartCollectionId: string): Promise<string | null>;
  getPostSlugMap(postIds: string[]): Promise<Map<string, string>>;
  getCollectionSlugMap(collectionIds: string[]): Promise<Map<string, string>>;
  getSmartCollectionSlugMap(
    smartCollectionIds: string[],
  ): Promise<Map<string, string>>;
  create(input: CreatePathInput): Promise<PathRecord>;
  createPostSlug(postId: string, slug: string): Promise<PathRecord>;
  updatePostSlug(postId: string, slug: string): Promise<void>;
  createCollectionSlug(collectionId: string, slug: string): Promise<PathRecord>;
  updateCollectionSlug(collectionId: string, slug: string): Promise<void>;
  createSmartCollectionSlug(
    smartCollectionId: string,
    slug: string,
  ): Promise<PathRecord>;
  updateSmartCollectionSlug(
    smartCollectionId: string,
    slug: string,
  ): Promise<void>;
  deleteByPostId(postId: string): Promise<void>;
  /** Release every path a smart collection holds, slug and aliases alike. */
  deleteBySmartCollectionId(smartCollectionId: string): Promise<void>;
  getPostAliases(postIds: string[]): Promise<Map<string, string[]>>;
  listNavigableItems(): Promise<NavigableItem[]>;
  /**
   * Find registered paths that a URL segment would shadow: the segment itself
   * and anything nested under it.
   *
   * Used before a language is added, because `/{prefix}` and `/{prefix}/…` stop
   * resolving through the path registry once that prefix goes live.
   *
   * @param segment - First URL segment, without slashes
   * @param limit - Maximum records to return
   * @returns Matching path records, shortest path first
   * @example
   * await paths.findPathsUnderSegment("ja"); // [{ path: "ja", postId: "pst_…" }]
   */
  findPathsUnderSegment(segment: string, limit?: number): Promise<PathRecord[]>;
}

export interface NavigableItem {
  title: string;
  path: string;
  type: "post" | "collection" | "smart_collection";
  format?: string;
  status?: Status;
}

export function toCollectionPath(slug: string): string {
  return normalizePath(slug);
}

export function fromCollectionPath(path: string): string {
  return normalizePath(path);
}

// Re-export shared constraint detection — see db/dialect.ts
import { isUniqueConstraintError } from "../db/dialect.js";

export function createPathService(
  db: Database,
  siteId: string,
  databaseSchema: DatabaseSchema = sqliteSchemaBundle,
): PathService {
  const { pathRegistry, posts, collections, smartCollections } = databaseSchema;

  function toPathRecord(row: typeof pathRegistry.$inferSelect): PathRecord {
    return {
      id: row.id,
      siteId: row.siteId,
      path: row.path,
      kind: row.kind as PathKind,
      postId: row.postId,
      collectionId: row.collectionId,
      smartCollectionId: row.smartCollectionId,
      redirectToPath: row.redirectToPath,
      redirectType: row.redirectType as 301 | 302 | null,
      archiveQuery: row.archiveQuery,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  function normalizeStoredPath(path: string): string {
    return normalizePath(path);
  }

  async function insertPath(input: CreatePathInput): Promise<PathRecord> {
    const timestamp = now();
    const normalizedPath = normalizeStoredPath(input.path);

    try {
      const result = await db
        .insert(pathRegistry)
        .values({
          id: createEntityId("path"),
          siteId,
          path: normalizedPath,
          kind: input.kind,
          postId: input.postId ?? null,
          collectionId: input.collectionId ?? null,
          smartCollectionId: input.smartCollectionId ?? null,
          redirectToPath: input.redirectToPath
            ? normalizeStoredPath(input.redirectToPath)
            : null,
          redirectType: input.redirectType ?? null,
          archiveQuery: input.archiveQuery ?? null,
          createdAt: timestamp,
          updatedAt: timestamp,
        })
        .returning();

      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- DB insert with .returning() always returns inserted row
      return toPathRecord(result[0]!);
    } catch (err) {
      if (isUniqueConstraintError(err)) {
        throw new ConflictError(`Path "${normalizedPath}" is already in use`);
      }
      throw err;
    }
  }

  return {
    async getByPath(path) {
      const normalized = normalizeStoredPath(path);
      const result = await db
        .select()
        .from(pathRegistry)
        .where(
          and(
            eq(pathRegistry.siteId, siteId),
            eq(pathRegistry.path, normalized),
          ),
        )
        .limit(1);
      return result[0] ? toPathRecord(result[0]) : null;
    },

    async resolve(path) {
      const record = await this.getByPath(path);
      if (!record) return null;

      const targetType =
        record.kind === "archive"
          ? "archive"
          : record.kind === "redirect"
            ? "redirect"
            : record.postId
              ? "post"
              : record.smartCollectionId
                ? "smart_collection"
                : "collection";

      return { ...record, targetType };
    },

    async resolveTarget(path) {
      let current = await this.resolve(path);
      const seen = new Set<string>();

      while (
        current?.targetType === "redirect" &&
        current.redirectToPath &&
        !seen.has(current.path)
      ) {
        seen.add(current.path);
        current = await this.resolve(current.redirectToPath);
      }

      // A redirect chain that loops, or ends on another redirect with nothing
      // to point at, names no entity.
      return current?.targetType === "redirect" ? null : current;
    },

    async isPathAvailable(path, excludeId) {
      const normalized = normalizeStoredPath(path);
      const conditions = [
        eq(pathRegistry.siteId, siteId),
        eq(pathRegistry.path, normalized),
      ];
      if (excludeId) conditions.push(ne(pathRegistry.id, excludeId));

      const result = await db
        .select({ id: pathRegistry.id })
        .from(pathRegistry)
        .where(and(...conditions))
        .limit(1);

      return result.length === 0;
    },

    async getPostSlug(postId) {
      const result = await db
        .select({ path: pathRegistry.path })
        .from(pathRegistry)
        .where(
          and(
            eq(pathRegistry.siteId, siteId),
            eq(pathRegistry.postId, postId),
            eq(pathRegistry.kind, "slug"),
          ),
        )
        .limit(1);
      return result[0]?.path ?? null;
    },

    async getCollectionSlug(collectionId) {
      const result = await db
        .select({ path: pathRegistry.path })
        .from(pathRegistry)
        .where(
          and(
            eq(pathRegistry.siteId, siteId),
            eq(pathRegistry.collectionId, collectionId),
            eq(pathRegistry.kind, "slug"),
          ),
        )
        .limit(1);
      return result[0] ? fromCollectionPath(result[0].path) : null;
    },

    async getSmartCollectionSlug(smartCollectionId) {
      const result = await db
        .select({ path: pathRegistry.path })
        .from(pathRegistry)
        .where(
          and(
            eq(pathRegistry.siteId, siteId),
            eq(pathRegistry.smartCollectionId, smartCollectionId),
            eq(pathRegistry.kind, "slug"),
          ),
        )
        .limit(1);
      return result[0] ? fromCollectionPath(result[0].path) : null;
    },

    async getPostSlugMap(postIds) {
      if (postIds.length === 0) return new Map<string, string>();

      return batchQuery(postIds, async (chunk) => {
        const result = new Map<string, string>();
        const rows = await db
          .select({
            postId: pathRegistry.postId,
            path: pathRegistry.path,
          })
          .from(pathRegistry)
          .where(
            and(
              eq(pathRegistry.siteId, siteId),
              inArray(pathRegistry.postId, chunk),
              eq(pathRegistry.kind, "slug"),
              isNotNull(pathRegistry.postId),
            ),
          );

        for (const row of rows) {
          if (row.postId) result.set(row.postId, row.path);
        }
        return result;
      });
    },

    async getCollectionSlugMap(collectionIds) {
      if (collectionIds.length === 0) return new Map<string, string>();

      return batchQuery(collectionIds, async (chunk) => {
        const result = new Map<string, string>();
        const rows = await db
          .select({
            collectionId: pathRegistry.collectionId,
            path: pathRegistry.path,
          })
          .from(pathRegistry)
          .where(
            and(
              eq(pathRegistry.siteId, siteId),
              inArray(pathRegistry.collectionId, chunk),
              eq(pathRegistry.kind, "slug"),
              isNotNull(pathRegistry.collectionId),
            ),
          );

        for (const row of rows) {
          if (row.collectionId) {
            result.set(row.collectionId, fromCollectionPath(row.path));
          }
        }
        return result;
      });
    },

    async getSmartCollectionSlugMap(smartCollectionIds) {
      if (smartCollectionIds.length === 0) return new Map<string, string>();

      return batchQuery(smartCollectionIds, async (chunk) => {
        const result = new Map<string, string>();
        const rows = await db
          .select({
            smartCollectionId: pathRegistry.smartCollectionId,
            path: pathRegistry.path,
          })
          .from(pathRegistry)
          .where(
            and(
              eq(pathRegistry.siteId, siteId),
              inArray(pathRegistry.smartCollectionId, chunk),
              eq(pathRegistry.kind, "slug"),
              isNotNull(pathRegistry.smartCollectionId),
            ),
          );

        for (const row of rows) {
          if (row.smartCollectionId) {
            result.set(row.smartCollectionId, fromCollectionPath(row.path));
          }
        }
        return result;
      });
    },

    async create(input) {
      return insertPath(input);
    },

    async createPostSlug(postId, slug) {
      return insertPath({ path: slug, kind: "slug", postId });
    },

    async updatePostSlug(postId, slug) {
      const timestamp = now();
      const normalized = normalizeStoredPath(slug);

      try {
        await db
          .update(pathRegistry)
          .set({
            path: normalized,
            updatedAt: timestamp,
          })
          .where(
            and(
              eq(pathRegistry.siteId, siteId),
              eq(pathRegistry.postId, postId),
              eq(pathRegistry.kind, "slug"),
            ),
          );
      } catch (err) {
        if (isUniqueConstraintError(err)) {
          throw new ConflictError(`Path "${normalized}" is already in use`);
        }
        throw err;
      }
    },

    async createCollectionSlug(collectionId, slug) {
      return insertPath({
        path: toCollectionPath(slug),
        kind: "slug",
        collectionId,
      });
    },

    async updateCollectionSlug(collectionId, slug) {
      const timestamp = now();
      const normalized = toCollectionPath(slug);

      try {
        await db
          .update(pathRegistry)
          .set({
            path: normalized,
            updatedAt: timestamp,
          })
          .where(
            and(
              eq(pathRegistry.siteId, siteId),
              eq(pathRegistry.collectionId, collectionId),
              eq(pathRegistry.kind, "slug"),
            ),
          );
      } catch (err) {
        if (isUniqueConstraintError(err)) {
          throw new ConflictError(`Path "${normalized}" is already in use`);
        }
        throw err;
      }
    },

    async createSmartCollectionSlug(smartCollectionId, slug) {
      return insertPath({
        path: toCollectionPath(slug),
        kind: "slug",
        smartCollectionId,
      });
    },

    async updateSmartCollectionSlug(smartCollectionId, slug) {
      const timestamp = now();
      const normalized = toCollectionPath(slug);

      try {
        await db
          .update(pathRegistry)
          .set({
            path: normalized,
            updatedAt: timestamp,
          })
          .where(
            and(
              eq(pathRegistry.siteId, siteId),
              eq(pathRegistry.smartCollectionId, smartCollectionId),
              eq(pathRegistry.kind, "slug"),
            ),
          );
      } catch (err) {
        if (isUniqueConstraintError(err)) {
          throw new ConflictError(`Path "${normalized}" is already in use`);
        }
        throw err;
      }
    },

    async deleteBySmartCollectionId(smartCollectionId) {
      await db
        .delete(pathRegistry)
        .where(
          and(
            eq(pathRegistry.siteId, siteId),
            eq(pathRegistry.smartCollectionId, smartCollectionId),
          ),
        );
    },

    async deleteByPostId(postId) {
      await db
        .delete(pathRegistry)
        .where(
          and(eq(pathRegistry.siteId, siteId), eq(pathRegistry.postId, postId)),
        );
    },

    async getPostAliases(postIds) {
      if (postIds.length === 0) return new Map<string, string[]>();

      return batchQuery(postIds, async (chunk) => {
        const result = new Map<string, string[]>();
        const rows = await db
          .select({
            postId: pathRegistry.postId,
            path: pathRegistry.path,
          })
          .from(pathRegistry)
          .where(
            and(
              eq(pathRegistry.siteId, siteId),
              inArray(pathRegistry.postId, chunk),
              inArray(pathRegistry.kind, ["alias", "redirect"]),
              isNotNull(pathRegistry.postId),
            ),
          );

        for (const row of rows) {
          if (!row.postId) continue;
          const existing = result.get(row.postId) ?? [];
          existing.push(`/${row.path}`);
          result.set(row.postId, existing);
        }
        return result;
      });
    },

    async listNavigableItems(): Promise<NavigableItem[]> {
      const postRows = await db
        .select({
          title: posts.title,
          format: posts.format,
          status: posts.status,
          path: pathRegistry.path,
        })
        .from(pathRegistry)
        .innerJoin(
          posts,
          and(eq(posts.id, pathRegistry.postId), eq(posts.siteId, siteId)),
        )
        .where(
          and(
            eq(pathRegistry.siteId, siteId),
            eq(pathRegistry.kind, "slug"),
            isNotNull(pathRegistry.postId),
            isNotNull(posts.title),
            eq(posts.format, "note"),
          ),
        );

      const collectionRows = await db
        .select({
          title: collections.title,
          path: pathRegistry.path,
        })
        .from(pathRegistry)
        .innerJoin(
          collections,
          and(
            eq(collections.id, pathRegistry.collectionId),
            eq(collections.siteId, siteId),
          ),
        )
        .where(
          and(
            eq(pathRegistry.siteId, siteId),
            eq(pathRegistry.kind, "slug"),
            isNotNull(pathRegistry.collectionId),
          ),
        );

      // A smart collection is a page with an address, so it is reachable from
      // anywhere addresses are listed. Its own row rather than a collection's:
      // a collection also answers at `/collections/{slug}`, through a redirect,
      // and a smart collection does not.
      const smartCollectionRows = await db
        .select({
          title: smartCollections.title,
          path: pathRegistry.path,
        })
        .from(pathRegistry)
        .innerJoin(
          smartCollections,
          and(
            eq(smartCollections.id, pathRegistry.smartCollectionId),
            eq(smartCollections.siteId, siteId),
          ),
        )
        .where(
          and(
            eq(pathRegistry.siteId, siteId),
            eq(pathRegistry.kind, "slug"),
            isNotNull(pathRegistry.smartCollectionId),
          ),
        );

      const items: NavigableItem[] = [];

      for (const row of postRows) {
        if (!row.title) continue;
        items.push({
          title: row.title,
          path: row.path,
          type: "post",
          format: row.format,
          status: row.status,
        });
      }

      for (const row of collectionRows) {
        items.push({
          title: row.title,
          path: fromCollectionPath(row.path),
          type: "collection",
        });
      }

      for (const row of smartCollectionRows) {
        items.push({
          title: row.title,
          path: fromCollectionPath(row.path),
          type: "smart_collection",
        });
      }

      return items;
    },

    async findPathsUnderSegment(segment, limit = 10) {
      const normalized = normalizeStoredPath(segment);
      if (!normalized) return [];

      // Stored alias paths are free-form, so a segment containing `%` or `_`
      // would widen the prefix match. The explicit ESCAPE clause is understood
      // by both SQLite and Postgres; drizzle's bare `like()` is not, because
      // the two dialects disagree on the default escape character.
      const childPattern = `${normalized.replace(/[\\%_]/g, "\\$&")}/%`;
      const rows = await db
        .select()
        .from(pathRegistry)
        .where(
          and(
            eq(pathRegistry.siteId, siteId),
            or(
              eq(pathRegistry.path, normalized),
              sql`${pathRegistry.path} LIKE ${childPattern} ESCAPE '\\'`,
            ),
          ),
        )
        .orderBy(asc(pathRegistry.path))
        .limit(limit);

      return rows.map(toPathRecord);
    },
  };
}
