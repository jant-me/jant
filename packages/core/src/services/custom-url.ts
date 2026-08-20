/**
 * Custom URL Service
 *
 * Manages non-canonical path records (aliases + redirects) backed by the
 * shared path_registry table.
 */

import { and, desc, eq, ne, sql } from "drizzle-orm";
import type { Database } from "../db/index.js";
import {
  sqliteSchemaBundle,
  type DatabaseSchema,
} from "../db/schema-bundle.js";
import { isReservedPath } from "../lib/constants.js";
import { ConflictError, ValidationError } from "../lib/errors.js";
import { normalizePath } from "../lib/url.js";
import type { CustomUrl } from "../types.js";
import { readLanguageSettings } from "./language.js";
import { createPathService, type PathService } from "./path.js";

export interface CreateCustomUrl {
  path: string;
  /**
   * `archive` is readable but no longer creatable — {@link CustomUrlService.create}
   * refuses it. Stored ones predate smart collections and keep working.
   */
  targetType: "post" | "collection" | "redirect" | "archive";
  targetId?: string;
  toPath?: string;
  redirectType?: 301 | 302;
  archiveQuery?: string;
}

export interface CustomUrlService {
  getByPath(path: string): Promise<CustomUrl | null>;
  getByTarget(
    targetType: "post" | "collection",
    targetId: string,
  ): Promise<CustomUrl | null>;
  create(data: CreateCustomUrl): Promise<CustomUrl>;
  delete(id: string): Promise<boolean>;
  count(): Promise<number>;
  list(opts?: { limit?: number; offset?: number }): Promise<CustomUrl[]>;
  /** Check if a path is available (not used by slug/alias/redirect records). */
  isPathAvailable(path: string): Promise<boolean>;
}

export function createCustomUrlService(
  db: Database,
  siteId: string,
  paths: PathService | undefined,
  databaseSchema: DatabaseSchema = sqliteSchemaBundle,
): CustomUrlService {
  const resolvedPaths = paths ?? createPathService(db, siteId, databaseSchema);
  const { pathRegistry } = databaseSchema;

  function toCustomUrl(row: typeof pathRegistry.$inferSelect): CustomUrl {
    return {
      id: row.id,
      path: row.path,
      targetType:
        row.kind === "archive"
          ? "archive"
          : row.kind === "redirect"
            ? "redirect"
            : row.postId
              ? "post"
              : "collection",
      targetId: row.postId ?? row.collectionId,
      toPath: row.redirectToPath ? `/${row.redirectToPath}` : null,
      redirectType: row.redirectType as 301 | 302 | null,
      archiveQuery: row.archiveQuery,
      createdAt: row.createdAt,
    };
  }

  function normalizeInputPath(path: string): string {
    return normalizePath(path);
  }

  return {
    async getByPath(path) {
      const normalized = normalizeInputPath(path);
      const result = await db
        .select()
        .from(pathRegistry)
        .where(
          and(
            eq(pathRegistry.siteId, siteId),
            eq(pathRegistry.path, normalized),
            ne(pathRegistry.kind, "slug"),
          ),
        )
        .limit(1);
      return result[0] ? toCustomUrl(result[0]) : null;
    },

    async getByTarget(targetType, targetId) {
      const result = await db
        .select()
        .from(pathRegistry)
        .where(
          and(
            eq(pathRegistry.siteId, siteId),
            eq(pathRegistry.kind, "alias"),
            targetType === "post"
              ? eq(pathRegistry.postId, targetId)
              : eq(pathRegistry.collectionId, targetId),
          ),
        )
        .orderBy(desc(pathRegistry.createdAt))
        .limit(1);
      return result[0] ? toCustomUrl(result[0]) : null;
    },

    async create(data) {
      const normalized = normalizeInputPath(data.path);

      const { reservedPrefixes } = await readLanguageSettings(
        db,
        siteId,
        databaseSchema,
      );
      if (isReservedPath(normalized, reservedPrefixes)) {
        throw new ValidationError(
          `Path "${normalized}" is reserved and cannot be used`,
        );
      }

      const existing = await resolvedPaths.getByPath(normalized);
      if (existing) {
        if (existing.kind === "slug" && existing.postId) {
          throw new ConflictError(
            `Path "${normalized}" conflicts with an existing post slug`,
          );
        }
        throw new ConflictError(`Path "${normalized}" is already in use`);
      }

      if (data.targetType === "archive") {
        // Refused here, not only hidden in the settings form. Typing
        // `format=note&title=none` into a text field was the problem smart
        // collections were built to replace, and a UI that stops offering it
        // while the API still accepts it has not stopped offering it.
        //
        // Reading, listing, and deleting these paths all stay: existing ones
        // keep working indefinitely, and each carries an upgrade button.
        throw new ValidationError(
          "Archive addresses are no longer created here. Make a smart collection instead.",
        );
      }

      if (data.targetType === "redirect") {
        if (!data.toPath) {
          throw new ValidationError("Redirect target path is required");
        }
        const redirectType = data.redirectType ?? 301;
        const record = await resolvedPaths.create({
          path: normalized,
          kind: "redirect",
          redirectToPath: data.toPath ?? null,
          redirectType,
        });
        const row = await db
          .select()
          .from(pathRegistry)
          .where(
            and(
              eq(pathRegistry.siteId, siteId),
              eq(pathRegistry.id, record.id),
            ),
          )
          .limit(1);
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- freshly inserted row exists
        return toCustomUrl(row[0]!);
      }

      if (!data.targetId) {
        throw new ValidationError("Target resource is required");
      }

      const record = await resolvedPaths.create({
        path: normalized,
        kind: "alias",
        postId: data.targetType === "post" ? (data.targetId ?? null) : null,
        collectionId:
          data.targetType === "collection" ? (data.targetId ?? null) : null,
      });
      const row = await db
        .select()
        .from(pathRegistry)
        .where(
          and(eq(pathRegistry.siteId, siteId), eq(pathRegistry.id, record.id)),
        )
        .limit(1);
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- freshly inserted row exists
      return toCustomUrl(row[0]!);
    },

    async delete(id) {
      const result = await db
        .delete(pathRegistry)
        .where(
          and(
            eq(pathRegistry.siteId, siteId),
            eq(pathRegistry.id, id),
            ne(pathRegistry.kind, "slug"),
          ),
        )
        .returning();
      return result.length > 0;
    },

    async count() {
      const result = await db
        .select({ count: sql<number>`CAST(count(*) AS INTEGER)`.as("count") })
        .from(pathRegistry)
        .where(
          and(eq(pathRegistry.siteId, siteId), ne(pathRegistry.kind, "slug")),
        );
      return result[0]?.count ?? 0;
    },

    async list(opts) {
      let q = db
        .select()
        .from(pathRegistry)
        .where(
          and(eq(pathRegistry.siteId, siteId), ne(pathRegistry.kind, "slug")),
        )
        .orderBy(desc(pathRegistry.createdAt))
        .$dynamic();
      if (opts?.limit !== undefined) q = q.limit(opts.limit);
      if (opts?.offset !== undefined) q = q.offset(opts.offset);
      const rows = await q;
      return rows.map(toCustomUrl);
    },

    async isPathAvailable(path) {
      const normalized = normalizeInputPath(path);
      const { reservedPrefixes } = await readLanguageSettings(
        db,
        siteId,
        databaseSchema,
      );
      if (isReservedPath(normalized, reservedPrefixes)) return false;
      return resolvedPaths.isPathAvailable(normalized);
    },
  };
}
