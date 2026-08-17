/**
 * Nav Item Service (v2)
 *
 * Manages navigation items (external links and system links)
 * with fractional indexing for efficient reordering.
 */

import { and, eq, asc, desc, isNull, sql, inArray } from "drizzle-orm";
import { generateKeyBetween } from "fractional-indexing";
import type { Database } from "../db/index.js";
import {
  sqliteSchemaBundle,
  type DatabaseSchema,
} from "../db/schema-bundle.js";
import { createEntityId } from "../lib/ids.js";
import { getCollectionPagePath } from "../lib/collection-paths.js";
import { NotFoundError, ValidationError } from "../lib/errors.js";
import { now } from "../lib/time.js";
import { normalizePath, toInternalPath } from "../lib/url.js";
import {
  COLLECTION_FRESHNESS_WINDOW_SECONDS,
  DEFAULT_NAVIGATION_PROFILE,
} from "../types.js";
import type {
  NavItem,
  NavItemType,
  NavItemPlacement,
  CreateNavItem,
  UpdateNavItem,
  SystemNavKey,
  SuggestedNavLink,
  NavigationPageCandidate,
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
import { createPathService, type PathService } from "./path.js";

export interface ListNavItemsOptions {
  /**
   * Content language whose view is being rendered, when it is not the site's
   * primary one. Page items then resolve to the version of their target
   * written in that language, so a reader browsing `/en` reaches the English
   * About page. Items whose target has no version in that language are left
   * pointing at the original — an asymmetric site is the normal case, and a
   * link to the one About that exists beats no link at all.
   */
  language?: string | null;
}

/**
 * What an address the author pasted can become in navigation.
 *
 * An address that names something on this site should become an item that
 * *follows* it — a page item tracks its post's title and slug, where a link
 * item freezes both — so resolution is what turns a pasted URL into the right
 * kind of item instead of a string that rots.
 */
export type NavTargetResolution =
  /** A post navigation can point at, with the name it will show. */
  | { status: "page"; page: NavigationPageCandidate }
  | { status: "collection"; collection: NavTargetCollection }
  /** A page on this site that navigation can only hold as a link. */
  | { status: "link_only" }
  /** Nothing to show in a menu until it has a title. */
  | { status: "untitled" }
  | { status: "unpublished" }
  /** Published but private: a menu entry nobody could open. */
  | { status: "private" }
  | { status: "not_found" };

export interface NavTargetCollection {
  id: string;
  title: string;
  slug: string;
}

export interface NavItemService {
  list(options?: ListNavItemsOptions): Promise<NavItem[]>;
  listPageCandidates(options?: {
    query?: string;
    limit?: number;
  }): Promise<NavigationPageCandidate[]>;
  /**
   * Resolve an address the author pasted into the navigation item it could
   * become.
   *
   * The picker searches titles, which is no help when the author is holding
   * the URL rather than the name. Every "no" is specific, because the page is
   * one they can see in another tab: a draft, a private post, an untitled one.
   *
   * @param path - Internal path, as produced by `toInternalPath()`
   * @returns The target to add, or why it cannot be added
   * @example
   * await navItems.resolveNavTarget("/about"); // { status: "page", page: … }
   */
  resolveNavTarget(path: string): Promise<NavTargetResolution>;
  getById(id: string): Promise<NavItem | null>;
  create(data: CreateNavItem): Promise<NavItem>;
  /**
   * Add missing items from the current default profile without changing
   * existing navigation state. Call only during provisioning or incomplete
   * onboarding recovery.
   */
  materializeDefaultNavigation(): Promise<NavItem[]>;
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
  paths?: PathService,
): NavItemService {
  const { navItems, threadCollections, posts, pathRegistry, collections } =
    databaseSchema;
  const resolvedPaths = paths ?? createPathService(db, siteId, databaseSchema);

  function toNavItem(
    row: typeof navItems.$inferSelect,
    targetTitle?: string | null,
  ): NavItem {
    const title = targetTitle?.trim();
    return {
      id: row.id,
      siteId: row.siteId,
      type: row.type as NavItemType,
      systemKey: (row.systemKey as SystemNavKey | null) ?? undefined,
      collectionId: row.collectionId ?? undefined,
      postId: row.postId ?? undefined,
      label: row.label,
      url: row.url,
      ...(title ? { targetTitle: title } : {}),
      placement: (row.placement ?? "header") as NavItemPlacement,
      position: row.position,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  /**
   * Read nav rows together with the current title of whatever each one points
   * at.
   *
   * The title is joined rather than stored so renaming a page or a collection
   * moves its nav entry with it. Two left joins on primary keys, on a table
   * that holds a handful of rows — the alternative, a denormalized copy, costs
   * a sync branch in every write path that can rename a target, including the
   * ones that bypass the service entirely (import, GitHub sync, backfills).
   */
  function selectNavItemsWithTargets() {
    return db
      .select({
        nav: navItems,
        postTitle: posts.title,
        postTranslationGroupId: posts.translationGroupId,
        collectionTitle: collections.title,
      })
      .from(navItems)
      .leftJoin(
        posts,
        and(eq(posts.siteId, siteId), eq(posts.id, navItems.postId)),
      )
      .leftJoin(
        collections,
        and(
          eq(collections.siteId, siteId),
          eq(collections.id, navItems.collectionId),
        ),
      );
  }

  type NavItemWithTargetRow = Awaited<
    ReturnType<ReturnType<typeof selectNavItemsWithTargets>["where"]>
  >[number];

  function targetTitleOf(row: NavItemWithTargetRow): string | null {
    if (row.nav.type === "page") return row.postTitle;
    if (row.nav.type === "collection") return row.collectionTitle;
    return null;
  }

  /**
   * Re-point page items at the version of their target written in `language`.
   *
   * A translated post is a different post at its own address, so following a
   * nav entry into another language means swapping the destination, not
   * prefixing the URL. Both the address and the title move together: a link
   * that lands on Chinese content should be labelled in Chinese, whichever
   * view the reader came from.
   *
   * Runs only in non-primary language views — the primary view's targets are
   * already the ones stored — and only when a page item's target actually
   * belongs to a translation group.
   */
  async function resolvePageTranslations(
    rows: NavItemWithTargetRow[],
    language: string,
  ): Promise<Map<string, { url: string; title: string }>> {
    const groupIds = [
      ...new Set(
        rows.flatMap((row) =>
          row.nav.type === "page" && row.postTranslationGroupId
            ? [row.postTranslationGroupId]
            : [],
        ),
      ),
    ];
    if (groupIds.length === 0) return new Map();

    // Same bar the item had to clear to be added: a nav link must never lead
    // to a draft, a private post, or an untitled one.
    const siblings = await db
      .select({
        groupId: posts.translationGroupId,
        title: posts.title,
        path: pathRegistry.path,
      })
      .from(posts)
      .innerJoin(
        pathRegistry,
        and(
          eq(pathRegistry.siteId, siteId),
          eq(pathRegistry.postId, posts.id),
          eq(pathRegistry.kind, "slug"),
        ),
      )
      .where(
        and(
          eq(posts.siteId, siteId),
          inArray(posts.translationGroupId, groupIds),
          eq(posts.language, language),
          eq(posts.status, "published"),
          sql`${posts.visibility} != 'private'`,
          isNull(posts.replyToId),
          sql`trim(${posts.title}) != ''`,
        ),
      );

    return new Map(
      siblings.flatMap((sibling) =>
        sibling.groupId && sibling.title
          ? [
              [
                sibling.groupId,
                { url: withLeadingSlash(sibling.path), title: sibling.title },
              ] as const,
            ]
          : [],
      ),
    );
  }

  async function normalizeCreateData(data: CreateNavItem) {
    if (data.type === "system") {
      const config = SYSTEM_NAV_KEYS[data.systemKey];
      if (!config) {
        throw new ValidationError("Invalid system nav key");
      }

      return {
        type: data.type,
        systemKey: data.systemKey,
        collectionId: null,
        postId: null,
        label: "",
        url: config.url,
        targetTitle: null,
        placement: data.placement ?? config.defaultPlacement,
        position: data.position,
      };
    }

    if (data.type === "collection") {
      // The slug lives in `path_registry`, the same place the page branch
      // below reads it from — collections have no slug column of their own.
      const rows = await db
        .select({ title: collections.title, slug: pathRegistry.path })
        .from(collections)
        .innerJoin(
          pathRegistry,
          and(
            eq(pathRegistry.siteId, siteId),
            eq(pathRegistry.collectionId, collections.id),
            eq(pathRegistry.kind, "slug"),
          ),
        )
        .where(
          and(
            eq(collections.siteId, siteId),
            eq(collections.id, data.collectionId),
          ),
        )
        .limit(1);
      const collection = rows[0];
      if (!collection) {
        throw new NotFoundError("Collection");
      }

      return {
        type: data.type,
        systemKey: null,
        collectionId: data.collectionId,
        postId: null,
        // Stored empty unless the author typed something: the item then shows
        // the collection's current title, and follows it when renamed.
        label: (data.label?.trim() ?? "").slice(0, 100),
        url: getCollectionPagePath(collection.slug),
        targetTitle: collection.title,
        placement: data.placement ?? "header",
        position: data.position,
      };
    }

    if (data.type === "page") {
      const rows = await db
        .select({
          title: posts.title,
          slug: pathRegistry.path,
        })
        .from(posts)
        .innerJoin(
          pathRegistry,
          and(
            eq(pathRegistry.siteId, siteId),
            eq(pathRegistry.postId, posts.id),
            eq(pathRegistry.kind, "slug"),
          ),
        )
        .where(
          and(
            eq(posts.siteId, siteId),
            eq(posts.id, data.postId),
            eq(posts.format, "note"),
            eq(posts.status, "published"),
            sql`${posts.visibility} != 'private'`,
            isNull(posts.replyToId),
            sql`trim(${posts.title}) != ''`,
          ),
        )
        .limit(1);
      const page = rows[0];
      if (!page?.title) {
        throw new ValidationError(
          "Page must be a published, non-private titled note",
        );
      }

      return {
        type: data.type,
        systemKey: null,
        collectionId: null,
        postId: data.postId,
        // Stored empty unless the author typed something: the item then shows
        // the page's current title, and follows it when renamed.
        label: (data.label?.trim() ?? "").slice(0, 100),
        url: withLeadingSlash(page.slug),
        targetTitle: page.title,
        placement: data.placement ?? "header",
        position: data.position,
      };
    }

    return {
      type: data.type,
      systemKey: null,
      collectionId: null,
      postId: null,
      label: data.label,
      url: data.url,
      targetTitle: null,
      placement: data.placement ?? "header",
      position: data.position,
    };
  }

  /** Read one nav item with its target's current title. */
  async function readNavItem(id: string): Promise<NavItem | null> {
    const result = await selectNavItemsWithTargets()
      .where(and(eq(navItems.siteId, siteId), eq(navItems.id, id)))
      .limit(1);
    const row = result[0];
    return row ? toNavItem(row.nav, targetTitleOf(row)) : null;
  }

  function withLeadingSlash(path: string): string {
    const normalized = normalizePath(path);
    return normalized ? `/${normalized}` : "/";
  }

  function getComparableInternalPath(
    url: string,
    options: ListSuggestedLinksOptions = {},
  ): string | null {
    const internalPath = toInternalPath(url, {
      siteOrigins: options.siteOrigin ? [options.siteOrigin] : [],
      sitePathPrefix: options.sitePathPrefix ?? "",
    });
    return internalPath ? withLeadingSlash(internalPath) : null;
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
    async list(options = {}) {
      const rows = await selectNavItemsWithTargets()
        .where(eq(navItems.siteId, siteId))
        .orderBy(asc(navItems.position));

      const translations = options.language
        ? await resolvePageTranslations(rows, options.language)
        : null;

      return rows.map((row) => {
        const translated =
          translations && row.nav.type === "page" && row.postTranslationGroupId
            ? translations.get(row.postTranslationGroupId)
            : undefined;
        if (!translated) return toNavItem(row.nav, targetTitleOf(row));
        // `postId` keeps naming the item's configured target: it is what the
        // settings UI edits and what "already in navigation" checks against.
        // Only where the reader lands, and what it is called, follow the view.
        return toNavItem({ ...row.nav, url: translated.url }, translated.title);
      });
    },

    async listPageCandidates(options = {}) {
      const query = options.query?.trim() ?? "";
      const limit = Math.min(Math.max(Math.trunc(options.limit ?? 20), 1), 50);
      const escapedQuery = query.replace(/[\\%_]/g, "\\$&");
      const conditions = [
        eq(posts.siteId, siteId),
        eq(posts.format, "note"),
        eq(posts.status, "published"),
        sql`${posts.visibility} != 'private'`,
        isNull(posts.replyToId),
        sql`trim(${posts.title}) != ''`,
        isNull(navItems.id),
      ];
      if (query) {
        conditions.push(
          sql`lower(${posts.title}) LIKE lower(${`%${escapedQuery}%`}) ESCAPE '\\'`,
        );
      }

      const rows = await db
        .select({
          id: posts.id,
          title: posts.title,
          slug: pathRegistry.path,
          updatedAt: posts.updatedAt,
        })
        .from(posts)
        .innerJoin(
          pathRegistry,
          and(
            eq(pathRegistry.siteId, siteId),
            eq(pathRegistry.postId, posts.id),
            eq(pathRegistry.kind, "slug"),
          ),
        )
        .leftJoin(
          navItems,
          and(eq(navItems.siteId, siteId), eq(navItems.postId, posts.id)),
        )
        .where(and(...conditions))
        .orderBy(desc(posts.updatedAt), desc(posts.id))
        .limit(limit);

      return rows.flatMap((row) =>
        row.title
          ? [
              {
                id: row.id,
                title: row.title,
                slug: row.slug,
                updatedAt: row.updatedAt,
              },
            ]
          : [],
      );
    },

    async resolveNavTarget(path) {
      const target = await resolvedPaths.resolveTarget(path);
      if (!target) return { status: "not_found" };

      if (target.targetType === "collection" && target.collectionId) {
        const rows = await db
          .select({ id: collections.id, title: collections.title })
          .from(collections)
          .where(
            and(
              eq(collections.siteId, siteId),
              eq(collections.id, target.collectionId),
            ),
          )
          .limit(1);
        const row = rows[0];
        if (!row) return { status: "not_found" };

        const slug = await resolvedPaths.getCollectionSlug(row.id);
        return {
          status: "collection",
          collection: { id: row.id, title: row.title, slug: slug ?? "" },
        };
      }

      if (target.targetType !== "post" || !target.postId) {
        // A real address — an archive URL, say — that no navigation item can
        // track. It can still be held as a plain link.
        return { status: "link_only" };
      }

      const rows = await db
        .select({
          id: posts.id,
          title: posts.title,
          status: posts.status,
          visibility: posts.visibility,
          updatedAt: posts.updatedAt,
        })
        .from(posts)
        .where(and(eq(posts.siteId, siteId), eq(posts.id, target.postId)))
        .limit(1);
      const row = rows[0];
      if (!row) return { status: "not_found" };

      if (row.status !== "published") return { status: "unpublished" };
      if (row.visibility === "private") return { status: "private" };
      const title = row.title?.trim() ?? "";
      if (!title) return { status: "untitled" };

      // The canonical slug rather than the address that was pasted: an alias
      // resolves here too, and the item should show where the page lives.
      const slug = await resolvedPaths.getPostSlug(row.id);
      if (!slug) return { status: "not_found" };

      return {
        status: "page",
        page: { id: row.id, title, slug, updatedAt: row.updatedAt },
      };
    },

    async getById(id) {
      return readNavItem(id);
    },

    async create(data) {
      const id = createEntityId("navItem");
      const timestamp = now();
      const normalized = await normalizeCreateData(data);

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

      if (normalized.postId) {
        const existingPageItem = await db
          .select({ id: navItems.id })
          .from(navItems)
          .where(
            and(
              eq(navItems.siteId, siteId),
              eq(navItems.postId, normalized.postId),
            ),
          )
          .limit(1);

        if (existingPageItem[0]) {
          throw new ValidationError("Page already added to navigation");
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
            postId: normalized.postId,
            label: normalized.label,
            url: normalized.url,
            placement: normalized.placement,
            position: normalized.position,
            createdAt: timestamp,
            updatedAt: timestamp,
          })
          .returning();

        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- DB insert with .returning() always returns inserted row
        return toNavItem(result[0]!, normalized.targetTitle);
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
              postId: normalized.postId,
              label: normalized.label,
              url: normalized.url,
              placement: normalized.placement,
              position: await getAppendPosition(),
              createdAt: timestamp,
              updatedAt: timestamp,
            })
            .returning();

          // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- DB insert with .returning() always returns inserted row
          return toNavItem(result[0]!, normalized.targetTitle);
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

    async materializeDefaultNavigation() {
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
      for (const systemKey of DEFAULT_NAVIGATION_PROFILE.systemKeys) {
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

      if (
        existing[0].type === "system" ||
        existing[0].type === "collection" ||
        existing[0].type === "page"
      ) {
        if (data.url !== undefined) {
          throw new ValidationError(
            existing[0].type === "system"
              ? "Built-in navigation URLs are managed automatically"
              : existing[0].type === "collection"
                ? "Collection navigation URLs are managed automatically"
                : "Page navigation URLs are managed automatically",
          );
        }
      }

      // Clearing the label is how an item goes back to following what it
      // points at, so only free-form links — which have no target to follow —
      // still require one.
      if (
        data.label !== undefined &&
        !data.label.trim() &&
        existing[0].type === "link"
      ) {
        throw new ValidationError("Label is required");
      }

      const timestamp = now();
      const result = await db
        .update(navItems)
        .set({
          ...(data.label !== undefined && { label: data.label.trim() }),
          ...(data.url !== undefined && { url: data.url }),
          ...(data.placement !== undefined && { placement: data.placement }),
          ...(data.position !== undefined && { position: data.position }),
          updatedAt: timestamp,
        })
        .where(and(eq(navItems.siteId, siteId), eq(navItems.id, id)))
        .returning();

      return result[0] ? readNavItem(id) : null;
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

          return result[0] ? readNavItem(id) : null;
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
              id: posts.id,
              format: posts.format,
              title: posts.title,
              status: posts.status,
              visibility: posts.visibility,
              replyToId: posts.replyToId,
            })
            .from(posts)
            .where(and(eq(posts.siteId, siteId), eq(posts.id, record.postId)))
            .limit(1);
          const post = postRows[0];
          if (
            !post ||
            post.format !== "note" ||
            post.status !== "published" ||
            post.visibility === "private" ||
            post.replyToId !== null ||
            !post.title?.trim()
          ) {
            continue;
          }

          suggestions.push({
            key: candidate.key,
            label: normalizeSuggestedLabel(post.title, candidate.label),
            url: path,
            targetType: "page",
            navItemType: "page",
            postId: post.id,
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
