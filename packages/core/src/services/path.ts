/**
 * Path Service
 *
 * Centralizes path ownership and resolution for posts, collections, aliases,
 * and redirects. Stored paths are normalized relative paths without a leading
 * slash (for example: "hello-world" or "collections/reading+tools").
 */

import { and, eq, inArray, isNotNull, ne } from "drizzle-orm";
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
  targetType: "post" | "collection" | "redirect" | "archive";
}

export interface CreatePathInput {
  path: string;
  kind: PathKind;
  postId?: string | null;
  collectionId?: string | null;
  redirectToPath?: string | null;
  redirectType?: 301 | 302 | null;
  archiveQuery?: string | null;
}

export interface PathService {
  getByPath(path: string): Promise<PathRecord | null>;
  resolve(path: string): Promise<ResolvedPath | null>;
  isPathAvailable(path: string, excludeId?: string): Promise<boolean>;
  getPostSlug(postId: string): Promise<string | null>;
  getCollectionSlug(collectionId: string): Promise<string | null>;
  getPostSlugMap(postIds: string[]): Promise<Map<string, string>>;
  getCollectionSlugMap(collectionIds: string[]): Promise<Map<string, string>>;
  create(input: CreatePathInput): Promise<PathRecord>;
  createPostSlug(postId: string, slug: string): Promise<PathRecord>;
  updatePostSlug(postId: string, slug: string): Promise<void>;
  createCollectionSlug(collectionId: string, slug: string): Promise<PathRecord>;
  updateCollectionSlug(collectionId: string, slug: string): Promise<void>;
  deleteByPostId(postId: string): Promise<void>;
  getPostAliases(postIds: string[]): Promise<Map<string, string[]>>;
  listNavigableItems(): Promise<NavigableItem[]>;
}

export interface NavigableItem {
  title: string;
  path: string;
  type: "post" | "collection";
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
  const { pathRegistry, posts, collections } = databaseSchema;

  function toPathRecord(row: typeof pathRegistry.$inferSelect): PathRecord {
    return {
      id: row.id,
      siteId: row.siteId,
      path: row.path,
      kind: row.kind as PathKind,
      postId: row.postId,
      collectionId: row.collectionId,
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
              : "collection";

      return { ...record, targetType };
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

      return items;
    },
  };
}
