/**
 * Custom URL Service
 *
 * Manages non-canonical path records (aliases + redirects) backed by the
 * shared path_registry table.
 */

import { and, asc, desc, eq, lt, ne, or, sql } from "drizzle-orm";
import type { Database } from "../db/index.js";
import {
  sqliteSchemaBundle,
  type DatabaseSchema,
} from "../db/schema-bundle.js";
import { isReservedPath } from "../lib/constants.js";
import { ID_PREFIX } from "../lib/ids.js";
import {
  ConflictError,
  NotFoundError,
  ValidationError,
} from "../lib/errors.js";
import {
  decodePostListCursor,
  encodePostListCursor,
} from "../lib/post-list-cursor.js";
import { normalizePath, redirectTargetHref } from "../lib/url.js";
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
  /** The post or collection: its TypeID, or its slug. */
  targetId?: string;
  toPath?: string;
  redirectType?: 301 | 302;
  archiveQuery?: string;
}

export interface CustomUrlService {
  getByPath(path: string): Promise<CustomUrl | null>;
  /**
   * The custom URL a post or collection is known by: its oldest alias, the
   * one feeds, the sitemap, and the export name it by. Later aliases are
   * other ways in.
   */
  getByTarget(
    targetType: "post" | "collection",
    targetId: string,
  ): Promise<CustomUrl | null>;
  create(data: CreateCustomUrl): Promise<CustomUrl>;
  delete(id: string): Promise<boolean>;
  count(): Promise<number>;
  list(opts?: { limit?: number; offset?: number }): Promise<CustomUrl[]>;
  /**
   * One page of custom URLs, newest first, and the cursor that continues it.
   *
   * @param opts - Page size, and `nextCursor` from the previous page
   * @returns The page and its `nextCursor`, null on the last page
   * @throws {ValidationError} When the cursor doesn't continue this list
   */
  listPage(opts: {
    limit: number;
    cursor?: string;
  }): Promise<{ customUrls: CustomUrl[]; nextCursor: string | null }>;
  /** Check if a path is available (not used by slug/alias/redirect records). */
  isPathAvailable(path: string): Promise<boolean>;
}

/** The one order custom URLs are listed in: newest first, then by ID. */
const CUSTOM_URL_CURSOR_MODE = "custom-urls:newest";

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
      toPath: row.redirectToPath
        ? redirectTargetHref(row.redirectToPath)
        : null,
      redirectType: row.redirectType as 301 | 302 | null,
      archiveQuery: row.archiveQuery,
      createdAt: row.createdAt,
    };
  }

  function normalizeInputPath(path: string): string {
    return normalizePath(path);
  }

  /**
   * The post or collection a custom URL points at, named by TypeID or by
   * slug. Both are read from its slug record, so an ID that names nothing is
   * refused here rather than by a foreign key.
   */
  async function resolveTarget(
    targetType: "post" | "collection",
    idOrSlug: string,
  ): Promise<string> {
    const idColumn =
      targetType === "post" ? pathRegistry.postId : pathRegistry.collectionId;
    const rows = await db
      .select({
        postId: pathRegistry.postId,
        collectionId: pathRegistry.collectionId,
      })
      .from(pathRegistry)
      .where(
        and(
          eq(pathRegistry.siteId, siteId),
          eq(pathRegistry.kind, "slug"),
          or(
            eq(idColumn, idOrSlug),
            eq(pathRegistry.path, normalizeInputPath(idOrSlug)),
          ),
        ),
      )
      .limit(1);
    const id = targetType === "post" ? rows[0]?.postId : rows[0]?.collectionId;
    if (!id) {
      throw new NotFoundError(
        `${targetType === "post" ? "Post" : "Collection"} "${idOrSlug}"`,
      );
    }
    return id;
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
        .orderBy(asc(pathRegistry.createdAt), asc(pathRegistry.id))
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
      const targetId = await resolveTarget(data.targetType, data.targetId);

      const record = await resolvedPaths.create({
        path: normalized,
        kind: "alias",
        postId: data.targetType === "post" ? targetId : null,
        collectionId: data.targetType === "collection" ? targetId : null,
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
        .orderBy(desc(pathRegistry.createdAt), desc(pathRegistry.id))
        .$dynamic();
      if (opts?.limit !== undefined) q = q.limit(opts.limit);
      if (opts?.offset !== undefined) q = q.offset(opts.offset);
      const rows = await q;
      return rows.map(toCustomUrl);
    },

    async listPage({ limit, cursor }) {
      const after = cursor
        ? decodePostListCursor(cursor, {
            mode: CUSTOM_URL_CURSOR_MODE,
            kinds: ["number", "id"],
            idPrefix: ID_PREFIX.path,
          })
        : null;
      const rows = await db
        .select()
        .from(pathRegistry)
        .where(
          and(
            eq(pathRegistry.siteId, siteId),
            ne(pathRegistry.kind, "slug"),
            after
              ? or(
                  lt(pathRegistry.createdAt, after[0] as number),
                  and(
                    eq(pathRegistry.createdAt, after[0] as number),
                    lt(pathRegistry.id, after[1] as string),
                  ),
                )
              : undefined,
          ),
        )
        .orderBy(desc(pathRegistry.createdAt), desc(pathRegistry.id))
        .limit(limit + 1);
      const page = rows.slice(0, limit);
      const last = page.at(-1);
      return {
        customUrls: page.map(toCustomUrl),
        nextCursor:
          rows.length > limit && last
            ? encodePostListCursor(CUSTOM_URL_CURSOR_MODE, [
                last.createdAt,
                last.id,
              ])
            : null,
      };
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
