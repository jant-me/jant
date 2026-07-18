/**
 * Nav Item Service (v2)
 *
 * Manages navigation items (external links and system links)
 * with fractional indexing for efficient reordering.
 */

import { and, eq, asc, sql, inArray } from "drizzle-orm";
import { generateKeyBetween } from "fractional-indexing";
import type { Database } from "../db/index.js";
import {
  sqliteSchemaBundle,
  type DatabaseSchema,
} from "../db/schema-bundle.js";
import { createEntityId } from "../lib/ids.js";
import { ValidationError } from "../lib/errors.js";
import { now } from "../lib/time.js";
import {
  normalizePath,
  normalizeSitePathPrefix,
  stripSitePathPrefix,
  toSameSitePath,
} from "../lib/url.js";
import { COLLECTION_FRESHNESS_WINDOW_SECONDS } from "../types.js";
import type {
  NavItem,
  NavItemType,
  NavItemPlacement,
  CreateNavItem,
  UpdateNavItem,
  SystemNavKey,
  SuggestedNavLink,
} from "../types.js";
import { SYSTEM_NAV_KEYS } from "../types.js";

const POSITION_RETRY_ATTEMPTS = 5;
const SUGGESTED_NAV_LINK_CANDIDATES = [
  { key: "about", path: "/about", label: "About" },
  { key: "now", path: "/now", label: "Now" },
] as const;

export interface ListSuggestedLinksOptions {
  siteOrigin?: string;
  sitePathPrefix?: string;
}

// Re-export shared constraint detection — see db/dialect.ts
import { isUniqueConstraintError } from "../db/dialect.js";

export interface NavItemService {
  list(): Promise<NavItem[]>;
  getById(id: string): Promise<NavItem | null>;
  create(data: CreateNavItem): Promise<NavItem>;
  ensureSystemDefaults(
    systemKeys?: readonly SystemNavKey[],
  ): Promise<NavItem[]>;
  update(id: string, data: UpdateNavItem): Promise<NavItem | null>;
  delete(id: string): Promise<boolean>;
  move(
    id: string,
    afterId: string | null,
    beforeId: string | null,
  ): Promise<NavItem | null>;
  listSuggestedLinks(
    options?: ListSuggestedLinksOptions,
  ): Promise<SuggestedNavLink[]>;
  getCollectionFreshness(collectionIds: string[]): Promise<Map<string, number>>;
}

export function createNavItemService(
  db: Database,
  siteId: string,
  databaseSchema: DatabaseSchema = sqliteSchemaBundle,
): NavItemService {
  const { navItems, threadCollections, posts, pathRegistry, collections } =
    databaseSchema;

  const defaultSystemOrder = [
    "latest",
    "featured",
    "collections",
    "archive",
    "rss",
    "settings",
  ] as const satisfies readonly SystemNavKey[];

  function toNavItem(row: typeof navItems.$inferSelect): NavItem {
    return {
      id: row.id,
      siteId: row.siteId,
      type: row.type as NavItemType,
      systemKey: (row.systemKey as SystemNavKey | null) ?? undefined,
      collectionId: row.collectionId ?? undefined,
      label: row.label,
      url: row.url,
      placement: (row.placement ?? "header") as NavItemPlacement,
      position: row.position,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  function normalizeCreateData(data: CreateNavItem) {
    if (data.type === "system") {
      const config = SYSTEM_NAV_KEYS[data.systemKey];
      if (!config) {
        throw new ValidationError("Invalid system nav key");
      }

      return {
        type: data.type,
        systemKey: data.systemKey,
        collectionId: null,
        label: "",
        url: config.url,
        placement: data.placement ?? config.defaultPlacement,
        position: data.position,
      };
    }

    if (data.type === "collection") {
      return {
        type: data.type,
        systemKey: null,
        collectionId: data.collectionId,
        label: data.label,
        url: data.url,
        placement: data.placement ?? "header",
        position: data.position,
      };
    }

    return {
      type: data.type,
      systemKey: null,
      collectionId: null,
      label: data.label,
      url: data.url,
      placement: data.placement ?? "header",
      position: data.position,
    };
  }

  function withLeadingSlash(path: string): string {
    const normalized = normalizePath(path);
    return normalized ? `/${normalized}` : "/";
  }

  function getComparableInternalPath(
    url: string,
    options: ListSuggestedLinksOptions = {},
  ): string | null {
    const value = url.trim();
    const sitePathPrefix = normalizeSitePathPrefix(
      options.sitePathPrefix ?? "",
    );
    const sameSitePath = toSameSitePath(value, options.siteOrigin ?? "");
    if (sameSitePath !== null) {
      try {
        const pathname = new URL(sameSitePath, "https://jant.invalid").pathname;
        const internalPath = stripSitePathPrefix(pathname, sitePathPrefix);
        return internalPath ? withLeadingSlash(internalPath) : null;
      } catch {
        return null;
      }
    }

    if (
      value.startsWith("http://") ||
      value.startsWith("https://") ||
      value.startsWith("//") ||
      value.startsWith("mailto:") ||
      value.startsWith("tel:") ||
      value.startsWith("#")
    ) {
      return null;
    }

    try {
      const pathname = new URL(value, "https://jant.invalid").pathname;
      const internalPath = stripSitePathPrefix(pathname, sitePathPrefix);
      return internalPath ? withLeadingSlash(internalPath) : null;
    } catch {
      return null;
    }
  }

  function normalizeSuggestedLabel(
    label: string | null | undefined,
    fallback: string,
  ): string {
    const trimmed = label?.trim();
    return trimmed && trimmed.length > 0 ? trimmed : fallback;
  }

  async function getLastPosition(): Promise<string | null> {
    const rows = await db
      .select({ position: navItems.position })
      .from(navItems)
      .where(eq(navItems.siteId, siteId))
      .orderBy(sql`${navItems.position} DESC`)
      .limit(1);
    return rows[0]?.position ?? null;
  }

  async function listOrderedPositions(excludeId?: string) {
    const rows = await db
      .select({ id: navItems.id, position: navItems.position })
      .from(navItems)
      .where(eq(navItems.siteId, siteId))
      .orderBy(asc(navItems.position));
    return excludeId ? rows.filter((row) => row.id !== excludeId) : rows;
  }

  async function getAppendPosition(): Promise<string> {
    const lastPos = await getLastPosition();
    return generateKeyBetween(lastPos, null);
  }

  async function getMovePosition(
    id: string,
    afterId: string | null,
    beforeId: string | null,
  ): Promise<string> {
    const rows = await listOrderedPositions(id);
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

  return {
    async list() {
      const rows = await db
        .select()
        .from(navItems)
        .where(eq(navItems.siteId, siteId))
        .orderBy(asc(navItems.position));
      return rows.map(toNavItem);
    },

    async getById(id) {
      const result = await db
        .select()
        .from(navItems)
        .where(and(eq(navItems.siteId, siteId), eq(navItems.id, id)))
        .limit(1);
      return result[0] ? toNavItem(result[0]) : null;
    },

    async create(data) {
      const id = createEntityId("navItem");
      const timestamp = now();
      const normalized = normalizeCreateData(data);

      if (normalized.systemKey) {
        const existingSystemItem = await db
          .select({ id: navItems.id })
          .from(navItems)
          .where(
            and(
              eq(navItems.siteId, siteId),
              eq(navItems.systemKey, normalized.systemKey),
            ),
          )
          .limit(1);

        if (existingSystemItem[0]) {
          throw new ValidationError("Built-in navigation item already exists");
        }
      }

      if (normalized.collectionId) {
        const existingCollectionItem = await db
          .select({ id: navItems.id })
          .from(navItems)
          .where(
            and(
              eq(navItems.siteId, siteId),
              eq(navItems.collectionId, normalized.collectionId),
            ),
          )
          .limit(1);

        if (existingCollectionItem[0]) {
          throw new ValidationError("Collection already added to navigation");
        }
      }

      if (normalized.position !== undefined) {
        const result = await db
          .insert(navItems)
          .values({
            id,
            siteId,
            type: normalized.type,
            systemKey: normalized.systemKey,
            collectionId: normalized.collectionId,
            label: normalized.label,
            url: normalized.url,
            placement: normalized.placement,
            position: normalized.position,
            createdAt: timestamp,
            updatedAt: timestamp,
          })
          .returning();

        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- DB insert with .returning() always returns inserted row
        return toNavItem(result[0]!);
      }

      for (let attempt = 0; attempt < POSITION_RETRY_ATTEMPTS; attempt += 1) {
        try {
          const result = await db
            .insert(navItems)
            .values({
              id,
              siteId,
              type: normalized.type,
              systemKey: normalized.systemKey,
              collectionId: normalized.collectionId,
              label: normalized.label,
              url: normalized.url,
              placement: normalized.placement,
              position: await getAppendPosition(),
              createdAt: timestamp,
              updatedAt: timestamp,
            })
            .returning();

          // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- DB insert with .returning() always returns inserted row
          return toNavItem(result[0]!);
        } catch (err) {
          if (
            !isUniqueConstraintError(err) ||
            attempt === POSITION_RETRY_ATTEMPTS - 1
          ) {
            throw err;
          }
        }
      }

      throw new Error("Failed to assign a unique nav item position");
    },

    async ensureSystemDefaults(systemKeys = defaultSystemOrder) {
      const existingRows = await db
        .select({ systemKey: navItems.systemKey })
        .from(navItems)
        .where(
          and(
            eq(navItems.siteId, siteId),
            sql`${navItems.systemKey} IS NOT NULL`,
          ),
        );
      const existing = new Set(
        existingRows.flatMap((row) =>
          row.systemKey ? [row.systemKey as SystemNavKey] : [],
        ),
      );

      const created: NavItem[] = [];
      for (const systemKey of systemKeys) {
        if (existing.has(systemKey)) continue;
        try {
          created.push(
            await this.create({
              type: "system",
              systemKey,
            }),
          );
        } catch (error) {
          if (
            !(error instanceof ValidationError) ||
            error.message !== "Built-in navigation item already exists"
          ) {
            throw error;
          }
        }
        existing.add(systemKey);
      }

      return created;
    },

    async update(id, data) {
      const existing = await db
        .select()
        .from(navItems)
        .where(and(eq(navItems.siteId, siteId), eq(navItems.id, id)))
        .limit(1);
      if (!existing[0]) return null;

      if (existing[0].type === "system" || existing[0].type === "collection") {
        if (data.url !== undefined) {
          throw new ValidationError(
            existing[0].type === "system"
              ? "Built-in navigation URLs are managed automatically"
              : "Collection navigation URLs are managed automatically",
          );
        }
      }

      // Non-system items require a non-empty label
      if (
        data.label !== undefined &&
        !data.label &&
        existing[0].type !== "system"
      ) {
        throw new ValidationError("Label is required");
      }

      const timestamp = now();
      const result = await db
        .update(navItems)
        .set({
          ...(data.label !== undefined && { label: data.label }),
          ...(data.url !== undefined && { url: data.url }),
          ...(data.placement !== undefined && { placement: data.placement }),
          ...(data.position !== undefined && { position: data.position }),
          updatedAt: timestamp,
        })
        .where(and(eq(navItems.siteId, siteId), eq(navItems.id, id)))
        .returning();

      return result[0] ? toNavItem(result[0]) : null;
    },

    async delete(id) {
      const result = await db
        .delete(navItems)
        .where(and(eq(navItems.siteId, siteId), eq(navItems.id, id)))
        .returning();
      return result.length > 0;
    },

    async move(id, afterId, beforeId) {
      // Look up the item
      const items = await db
        .select()
        .from(navItems)
        .where(and(eq(navItems.siteId, siteId), eq(navItems.id, id)))
        .limit(1);
      if (!items[0]) return null;

      const timestamp = now();
      for (let attempt = 0; attempt < POSITION_RETRY_ATTEMPTS; attempt += 1) {
        try {
          const result = await db
            .update(navItems)
            .set({
              position: await getMovePosition(id, afterId, beforeId),
              updatedAt: timestamp,
            })
            .where(and(eq(navItems.siteId, siteId), eq(navItems.id, id)))
            .returning();

          return result[0] ? toNavItem(result[0]) : null;
        } catch (err) {
          if (
            !isUniqueConstraintError(err) ||
            attempt === POSITION_RETRY_ATTEMPTS - 1
          ) {
            throw err;
          }
        }
      }

      throw new Error("Failed to assign a unique nav item position");
    },

    async listSuggestedLinks(options: ListSuggestedLinksOptions = {}) {
      const existingRows = await db
        .select({
          url: navItems.url,
          collectionId: navItems.collectionId,
        })
        .from(navItems)
        .where(eq(navItems.siteId, siteId));
      const existingPaths = new Set(
        existingRows.flatMap((item) => {
          const path = getComparableInternalPath(item.url, options);
          return path ? [path] : [];
        }),
      );
      const existingCollectionIds = new Set(
        existingRows.flatMap((item) =>
          item.collectionId ? [item.collectionId] : [],
        ),
      );

      const suggestions: SuggestedNavLink[] = [];

      for (const candidate of SUGGESTED_NAV_LINK_CANDIDATES) {
        const path = withLeadingSlash(candidate.path);
        if (existingPaths.has(path)) continue;

        const pathRows = await db
          .select()
          .from(pathRegistry)
          .where(
            and(
              eq(pathRegistry.siteId, siteId),
              eq(pathRegistry.path, normalizePath(candidate.path)),
            ),
          )
          .limit(1);
        const record = pathRows[0];
        if (!record || record.kind === "redirect") continue;

        if (record.postId) {
          const postRows = await db
            .select({
              title: posts.title,
              status: posts.status,
              visibility: posts.visibility,
            })
            .from(posts)
            .where(and(eq(posts.siteId, siteId), eq(posts.id, record.postId)))
            .limit(1);
          const post = postRows[0];
          if (
            !post ||
            post.status !== "published" ||
            post.visibility === "private"
          ) {
            continue;
          }

          suggestions.push({
            key: candidate.key,
            label: normalizeSuggestedLabel(post.title, candidate.label),
            url: path,
            targetType: "page",
            navItemType: "link",
          });
          continue;
        }

        if (record.collectionId) {
          if (existingCollectionIds.has(record.collectionId)) continue;

          const collectionRows = await db
            .select({
              title: collections.title,
            })
            .from(collections)
            .where(
              and(
                eq(collections.siteId, siteId),
                eq(collections.id, record.collectionId),
              ),
            )
            .limit(1);
          const collection = collectionRows[0];
          if (!collection) continue;

          suggestions.push({
            key: candidate.key,
            label: normalizeSuggestedLabel(collection.title, candidate.label),
            url: path,
            targetType: "collection",
            navItemType: record.kind === "slug" ? "collection" : "link",
            ...(record.kind === "slug" && {
              collectionId: record.collectionId,
            }),
          });
          continue;
        }

        if (record.kind === "archive") {
          suggestions.push({
            key: candidate.key,
            label: candidate.label,
            url: path,
            targetType: "archive",
            navItemType: "link",
          });
        }
      }

      return suggestions;
    },

    async getCollectionFreshness(collectionIds) {
      if (collectionIds.length === 0) return new Map<string, number>();

      const threshold = now() - COLLECTION_FRESHNESS_WINDOW_SECONDS;
      const threadActivityAt = sql<number>`CASE
        WHEN ${posts.updatedAt} > ${posts.createdAt}
          AND ${posts.updatedAt} > COALESCE(${posts.lastActivityAt}, -1)
        THEN ${posts.updatedAt}
        ELSE COALESCE(${posts.lastActivityAt}, ${posts.updatedAt})
      END`;

      // Find collections with recent Thread activity and its latest timestamp.
      // `lastActivityAt` is maintained on the root when a non-quiet reply is
      // published. A later `updatedAt` keeps actual root edits visible without
      // treating a freshly imported historical root as newly active.
      const rows = await db
        .select({
          collectionId: threadCollections.collectionId,
          latestAt:
            sql<number>`MAX(CASE WHEN ${threadCollections.createdAt} > ${threadActivityAt} THEN ${threadCollections.createdAt} ELSE ${threadActivityAt} END)`.as(
              "latest_at",
            ),
        })
        .from(threadCollections)
        .innerJoin(
          posts,
          and(
            eq(posts.id, threadCollections.threadId),
            eq(posts.siteId, threadCollections.siteId),
          ),
        )
        .where(
          and(
            eq(threadCollections.siteId, siteId),
            inArray(threadCollections.collectionId, collectionIds),
            sql`(
              ${threadCollections.createdAt} > ${threshold}
              OR (${threadActivityAt} > ${threshold}
                AND ${posts.status} = 'published')
            )`,
          ),
        )
        .groupBy(threadCollections.collectionId);

      return new Map(rows.map((r) => [r.collectionId, r.latestAt]));
    },
  };
}
