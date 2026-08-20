/**
 * Drizzle Schema
 *
 * Database schema for Jant v2
 */

import {
  pgTable,
  text,
  integer,
  boolean,
  timestamp,
  primaryKey,
  foreignKey,
  index,
  unique,
  uniqueIndex,
  check,
  customType,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import {
  COLLECTION_DIRECTORY_ENTRY_TYPES,
  COLLECTION_SORT_ORDERS,
  CONTENT_DISPOSITIONS,
  FORMATS,
  GITHUB_APP_ACCOUNT_TYPES,
  NAV_ITEM_PLACEMENTS,
  NAV_ITEM_TYPES,
  PATH_KINDS,
  SITE_DOMAIN_KINDS,
  SITE_MEMBER_ROLES,
  SITE_STATUSES,
  STATUSES,
  SYSTEM_NAV_KEY_VALUES,
  UPLOAD_SESSION_STATES,
  VISIBILITIES,
} from "../../types/constants.js";

/**
 * Render a value list as the `IN (...)` body of a CHECK constraint.
 *
 * Every list it is handed comes from `types/constants.ts`. Declaring one
 * locally instead is how a CHECK once shipped missing an enum value: the
 * shared list grew, the schema's private copy did not, and the generated
 * constraint rejected rows the application treats as valid.
 */
function sqlTextEnum(values: readonly string[]) {
  return sql.raw(values.map((value) => `'${value}'`).join(", "));
}

const tsvector = customType<{ data: string }>({
  dataType() {
    return "tsvector";
  },
});

// =============================================================================
// Sites
// =============================================================================

export const sites = pgTable(
  "site",
  {
    id: text("id").primaryKey(),
    key: text("key").notNull(),
    status: text("status", {
      enum: SITE_STATUSES,
    })
      .notNull()
      .default("active"),
    provisioningIdempotencyKey: text("provisioning_idempotency_key"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("uq_site_key").on(table.key),
    uniqueIndex("uq_site_provisioning_idempotency_key")
      .on(table.provisioningIdempotencyKey)
      .where(sql`${table.provisioningIdempotencyKey} IS NOT NULL`),
    check(
      "chk_site_status",
      sql`${table.status} IN (${sqlTextEnum(SITE_STATUSES)})`,
    ),
  ],
);

export const siteDomains = pgTable(
  "site_domain",
  {
    id: text("id").primaryKey(),
    siteId: text("site_id")
      .notNull()
      .references(() => sites.id, { onDelete: "cascade" }),
    host: text("host").notNull(),
    pathPrefix: text("path_prefix"),
    kind: text("kind", {
      enum: SITE_DOMAIN_KINDS,
    })
      .notNull()
      .default("primary"),
    redirectToPrimary: boolean("redirect_to_primary").notNull().default(true),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("uq_site_domain_host").on(table.host),
    index("idx_site_domain_site_id").on(table.siteId),
    check(
      "chk_site_domain_kind",
      sql`${table.kind} IN (${sqlTextEnum(SITE_DOMAIN_KINDS)})`,
    ),
  ],
);

export const siteMembers = pgTable(
  "site_member",
  {
    siteId: text("site_id")
      .notNull()
      .references(() => sites.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    role: text("role", {
      enum: SITE_MEMBER_ROLES,
    })
      .notNull()
      .default("editor"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.siteId, table.userId] }),
    index("idx_site_member_user_id").on(table.userId),
    check(
      "chk_site_member_role",
      sql`${table.role} IN (${sqlTextEnum(SITE_MEMBER_ROLES)})`,
    ),
  ],
);

// =============================================================================
// Posts
// =============================================================================

export const posts = pgTable(
  "post",
  {
    id: text("id").primaryKey(),
    siteId: text("site_id")
      .notNull()
      .references(() => sites.id, { onDelete: "cascade" }),
    format: text("format", {
      enum: FORMATS,
    }).notNull(),
    status: text("status", {
      enum: STATUSES,
    })
      .notNull()
      .default("published"),
    visibility: text("visibility", {
      enum: VISIBILITIES,
    }).default("public"),
    pinnedAt: integer("pinned_at"),
    featuredAt: integer("featured_at"),
    title: text("title"),
    url: text("url"),
    body: text("body"),
    bodyHtml: text("body_html"),
    bodyHtmlVersion: integer("body_html_version").notNull().default(1),
    bodyText: text("body_text"),
    quoteText: text("quote_text"),
    summary: text("summary"),
    searchText: text("search_text").generatedAlwaysAs(
      sql`coalesce("title", '') || ' ' || coalesce("url", '') || ' ' || coalesce("quote_text", '') || ' ' || coalesce("body_text", '')`,
    ),
    searchDocument: tsvector("search_document").generatedAlwaysAs(
      sql`setweight(to_tsvector('simple', coalesce("title", '')), 'A') ||
          setweight(to_tsvector('simple', coalesce("url", '')), 'A') ||
          setweight(to_tsvector('simple', coalesce("quote_text", '')), 'B') ||
          setweight(to_tsvector('simple', coalesce("body_text", '')), 'C')`,
    ),
    rating: integer("rating"),
    previewImageKey: text("preview_image_key"),
    previewKind: text("preview_kind"),
    previewProvider: text("preview_provider"),
    replyToId: text("reply_to_id"),
    threadId: text("thread_id").notNull(),
    /**
     * BCP 47 content language in canonical form (`en`, `zh-Hans`).
     *
     * Uniform across a Thread: replies inherit the Root's value on creation and
     * a language change rewrites every row in the Thread. Language filters can
     * therefore be plain column predicates even on member-grained queries.
     *
     * NULL only exists before multilingual content is first enabled; enabling
     * stamps every NULL row with the primary language.
     */
    language: text("language"),
    /**
     * Shared translation-group key (TypeID, `tgr_` prefix). Rows sharing a value
     * are translations of one another — one row per language, no direction.
     *
     * Only ever set on Thread Roots (`thread_id = id`); enforced in the post
     * service so both dialects share one rule (see the SQLite schema for why a
     * table CHECK is not an option there).
     */
    translationGroupId: text("translation_group_id"),
    /**
     * The author added this reply without announcing it. Persisted so both
     * activity timestamps below stay recomputable from the rows alone.
     * Always false on Thread roots.
     */
    quietReply: boolean("quiet_reply").notNull().default(false),
    publishedAt: integer("published_at"),
    /**
     * Root only: newest published_at in the Thread, excluding quiet replies —
     * "last announced". Drives Latest and the feeds.
     */
    lastActivityAt: integer("last_activity_at"),
    /**
     * Root only: newest published_at in the Thread, quiet replies included —
     * "last changed". Drives the archive's updated sort.
     */
    threadUpdatedAt: integer("thread_updated_at"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    check(
      "chk_post_reply_to_not_self",
      sql`${table.replyToId} IS NULL OR ${table.replyToId} <> ${table.id}`,
    ),
    check(
      "chk_post_thread_shape",
      sql`(
        ${table.replyToId} IS NULL
        AND ${table.threadId} = ${table.id}
      ) OR (
        ${table.replyToId} IS NOT NULL
        AND ${table.threadId} <> ${table.id}
      )`,
    ),
    unique("uq_post_site_id_id").on(table.siteId, table.id),
    foreignKey({
      columns: [table.siteId, table.replyToId],
      foreignColumns: [table.siteId, table.id],
    }),
    foreignKey({
      columns: [table.siteId, table.threadId],
      foreignColumns: [table.siteId, table.id],
    }),
    index("idx_post_site_thread_id").on(table.siteId, table.threadId),
    index("idx_post_site_thread_created").on(
      table.siteId,
      table.threadId,
      table.createdAt,
      table.id,
    ),
    index("idx_post_site_status_published").on(
      table.siteId,
      table.status,
      table.publishedAt,
    ),
    index("idx_post_site_status_activity").on(
      table.siteId,
      table.status,
      table.lastActivityAt,
    ),
    index("idx_post_site_root_published_activity")
      .on(table.siteId, table.lastActivityAt, table.id)
      .where(sql`${table.replyToId} IS NULL AND ${table.status} = 'published'`),
    index("idx_post_site_root_thread_updated")
      .on(table.siteId, table.threadUpdatedAt, table.id)
      .where(sql`${table.replyToId} IS NULL AND ${table.status} = 'published'`),
    index("idx_post_site_root_draft_updated")
      .on(table.siteId, table.updatedAt, table.id)
      .where(sql`${table.replyToId} IS NULL AND ${table.status} = 'draft'`),
    index("idx_post_site_reply_thread_created")
      .on(table.siteId, table.threadId, table.createdAt, table.id)
      .where(
        sql`${table.replyToId} IS NOT NULL AND ${table.status} = 'published'`,
      ),
    index("idx_post_site_featured_thread_published")
      .on(table.siteId, table.threadId, table.publishedAt, table.id)
      .where(
        sql`${table.status} = 'published' AND ${table.featuredAt} IS NOT NULL`,
      ),
    // One Post per language inside a translation group. The `site_id` prefix
    // matches the indexing convention here and lets the same index serve
    // "list the members of this group" without a second index.
    uniqueIndex("uq_post_site_translation_group_language")
      .on(table.siteId, table.translationGroupId, table.language)
      .where(sql`${table.translationGroupId} IS NOT NULL`),
    index("idx_post_search_document").using("gin", table.searchDocument),
    index("idx_post_search_text_trgm").using(
      "gin",
      table.searchText.op("gin_trgm_ops"),
    ),
  ],
);

// =============================================================================
// Media
// =============================================================================

export const media = pgTable(
  "media",
  {
    id: text("id").primaryKey(),
    siteId: text("site_id")
      .notNull()
      .references(() => sites.id, { onDelete: "cascade" }),
    postId: text("post_id").references(() => posts.id, {
      onDelete: "set null",
    }),
    filename: text("filename").notNull(),
    originalName: text("original_name").notNull(),
    mimeType: text("mime_type").notNull(),
    size: integer("size").notNull(),
    storageKey: text("storage_key").notNull(),
    provider: text("provider").notNull().default("r2"),
    width: integer("width"),
    height: integer("height"),
    durationSeconds: integer("duration_seconds"),
    alt: text("alt"),
    position: text("position").notNull().default("a0"),
    blurhash: text("blurhash"),
    waveform: text("waveform"),
    posterKey: text("poster_key"),
    summary: text("summary"),
    chars: integer("chars"),
    mediaKind: text("media_kind").notNull().default("document"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    check("chk_media_size_positive", sql`${table.size} > 0`),
    check("chk_media_position_not_blank", sql`trim(${table.position}) <> ''`),
    check(
      "chk_media_dimensions_positive",
      sql`(
        ${table.width} IS NULL OR ${table.width} > 0
      ) AND (
        ${table.height} IS NULL OR ${table.height} > 0
      )`,
    ),
    check(
      "chk_media_chars_nonnegative",
      sql`${table.chars} IS NULL OR ${table.chars} >= 0`,
    ),
    index("idx_media_site_post_id_position").on(
      table.siteId,
      table.postId,
      table.position,
    ),
    uniqueIndex("uq_media_site_post_position")
      .on(table.siteId, table.postId, table.position)
      .where(sql`${table.postId} IS NOT NULL`),
    uniqueIndex("uq_media_provider_storage_key").on(
      table.provider,
      table.storageKey,
    ),
    index("idx_media_site_media_kind_post_id").on(
      table.siteId,
      table.mediaKind,
      table.postId,
    ),
  ],
);

/**
 * Recycle bin for deleted media storage objects. When media is deleted we
 * hard-remove the DB row and immediately delete the object from its original
 * (public) key — so the original URL 404s right away — but first move the bytes
 * to a `trash/` key recorded here. The cleanup sweep deletes the trash object
 * once `purge_after` elapses. `original_key` records where the object lived so
 * it can be restored within the window. Only used when the storage driver
 * supports server-side copy; otherwise deletes are immediate with no recycle.
 */
export const storagePurge = pgTable(
  "storage_purge",
  {
    id: text("id").primaryKey(),
    siteId: text("site_id")
      .notNull()
      .references(() => sites.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    storageKey: text("storage_key").notNull(),
    originalKey: text("original_key").notNull(),
    reason: text("reason"),
    purgeAfter: integer("purge_after").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("uq_storage_purge_provider_key").on(
      table.provider,
      table.storageKey,
    ),
    index("idx_storage_purge_site_provider_due").on(
      table.siteId,
      table.provider,
      table.purgeAfter,
    ),
  ],
);

export const uploadSessions = pgTable(
  "upload_session",
  {
    id: text("id").primaryKey(),
    siteId: text("site_id")
      .notNull()
      .references(() => sites.id, { onDelete: "cascade" }),
    mediaId: text("media_id").notNull(),
    originalName: text("original_name").notNull(),
    filename: text("filename").notNull(),
    provider: text("provider").notNull(),
    expectedContentType: text("expected_content_type").notNull(),
    expectedSize: integer("expected_size").notNull(),
    expectedChecksumSha256: text("expected_checksum_sha256"),
    contentDisposition: text("content_disposition", {
      enum: CONTENT_DISPOSITIONS,
    })
      .notNull()
      .default("inline"),
    tempStorageKey: text("temp_storage_key").notNull(),
    finalStorageKey: text("final_storage_key").notNull(),
    multipartUploadId: text("multipart_upload_id"),
    state: text("state", {
      enum: UPLOAD_SESSION_STATES,
    })
      .notNull()
      .default("pending"),
    expiresAt: integer("expires_at").notNull(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    check(
      "chk_upload_session_expected_size_positive",
      sql`${table.expectedSize} > 0`,
    ),
    check(
      "chk_upload_session_state",
      sql`${table.state} IN (${sqlTextEnum(UPLOAD_SESSION_STATES)})`,
    ),
    check(
      "chk_upload_session_content_disposition",
      sql`${table.contentDisposition} IN (${sqlTextEnum(CONTENT_DISPOSITIONS)})`,
    ),
    uniqueIndex("uq_upload_session_media_id").on(table.mediaId),
    uniqueIndex("uq_upload_session_temp_storage_key").on(table.tempStorageKey),
    uniqueIndex("uq_upload_session_final_storage_key").on(
      table.finalStorageKey,
    ),
    index("idx_upload_session_site_state").on(table.siteId, table.state),
    index("idx_upload_session_site_expires_at").on(
      table.siteId,
      table.expiresAt,
    ),
  ],
);

// =============================================================================
// Collections
// =============================================================================

export const collections = pgTable(
  "collection",
  {
    id: text("id").primaryKey(),
    siteId: text("site_id")
      .notNull()
      .references(() => sites.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    description: text("description"),
    sortOrder: text("sort_order", {
      enum: COLLECTION_SORT_ORDERS,
    })
      .notNull()
      .default("newest"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    check(
      "chk_collection_sort_order",
      sql`${table.sortOrder} IN (${sqlTextEnum(COLLECTION_SORT_ORDERS)})`,
    ),
    index("idx_collection_site_created_at").on(table.siteId, table.createdAt),
  ],
);

// =============================================================================
// Path Registry (slug + alias + redirect)
// =============================================================================

export const pathRegistry = pgTable(
  "path_registry",
  {
    id: text("id").primaryKey(),
    siteId: text("site_id")
      .notNull()
      .references(() => sites.id, { onDelete: "cascade" }),
    path: text("path").notNull(),
    kind: text("kind", {
      enum: ["slug", "alias", "redirect", "archive"],
    }).notNull(),
    postId: text("post_id").references(() => posts.id, {
      onDelete: "cascade",
    }),
    collectionId: text("collection_id").references(() => collections.id, {
      onDelete: "cascade",
    }),
    redirectToPath: text("redirect_to_path"),
    redirectType: integer("redirect_type"),
    archiveQuery: text("archive_query"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    check(
      "chk_path_registry_kind",
      sql`${table.kind} IN (${sqlTextEnum(PATH_KINDS)})`,
    ),
    uniqueIndex("uq_path_registry_site_path").on(table.siteId, table.path),
    uniqueIndex("uq_path_registry_site_post_slug")
      .on(table.siteId, table.postId)
      .where(sql`${table.kind} = 'slug' AND ${table.postId} IS NOT NULL`),
    uniqueIndex("uq_path_registry_site_collection_slug")
      .on(table.siteId, table.collectionId)
      .where(sql`${table.kind} = 'slug' AND ${table.collectionId} IS NOT NULL`),
    index("idx_path_registry_site_post_id").on(table.siteId, table.postId),
    index("idx_path_registry_site_collection_id").on(
      table.siteId,
      table.collectionId,
    ),
    check(
      "chk_path_registry_shape",
      sql`(
        ${table.kind} IN ('slug', 'alias')
        AND (
          (${table.postId} IS NOT NULL AND ${table.collectionId} IS NULL)
          OR (${table.postId} IS NULL AND ${table.collectionId} IS NOT NULL)
        )
        AND ${table.redirectToPath} IS NULL
        AND ${table.redirectType} IS NULL
        AND ${table.archiveQuery} IS NULL
      ) OR (
        ${table.kind} = 'redirect'
        AND ${table.postId} IS NULL
        AND ${table.collectionId} IS NULL
        AND ${table.redirectToPath} IS NOT NULL
        AND ${table.redirectType} IN (301, 302)
        AND ${table.archiveQuery} IS NULL
      ) OR (
        ${table.kind} = 'archive'
        AND ${table.postId} IS NULL
        AND ${table.collectionId} IS NULL
        AND ${table.redirectToPath} IS NULL
        AND ${table.redirectType} IS NULL
        AND ${table.archiveQuery} IS NOT NULL
      )`,
    ),
  ],
);

// =============================================================================
// Collection Directory Items (unified ordering for collections, links, and dividers)
// =============================================================================

export const collectionDirectoryItems = pgTable(
  "collection_directory_item",
  {
    id: text("id").primaryKey(),
    siteId: text("site_id")
      .notNull()
      .references(() => sites.id, { onDelete: "cascade" }),
    type: text("type", { enum: ["collection", "divider", "link"] }).notNull(),
    collectionId: text("collection_id").references(() => collections.id, {
      onDelete: "cascade",
    }),
    label: text("label"),
    url: text("url"),
    description: text("description"),
    position: text("position").notNull().default("a0"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    check(
      "chk_collection_directory_item_type",
      sql`${table.type} IN (${sqlTextEnum(COLLECTION_DIRECTORY_ENTRY_TYPES)})`,
    ),
    index("idx_collection_directory_item_site_collection_id").on(
      table.siteId,
      table.collectionId,
    ),
    uniqueIndex("uq_collection_directory_item_site_position").on(
      table.siteId,
      table.position,
    ),
    uniqueIndex("uq_collection_directory_item_site_collection_once")
      .on(table.siteId, table.collectionId)
      .where(
        sql`${table.type} = 'collection' AND ${table.collectionId} IS NOT NULL`,
      ),
    check(
      "chk_collection_directory_item_shape",
      sql`(
        ${table.type} = 'collection'
        AND ${table.collectionId} IS NOT NULL
        AND ${table.label} IS NULL
        AND ${table.url} IS NULL
      ) OR (
        ${table.type} = 'divider'
        AND ${table.collectionId} IS NULL
        AND ${table.url} IS NULL
      ) OR (
        ${table.type} = 'link'
        AND ${table.collectionId} IS NULL
        AND ${table.label} IS NOT NULL
        AND ${table.url} IS NOT NULL
      )`,
    ),
    check(
      "chk_collection_directory_item_label",
      sql`${table.type} <> 'collection' OR ${table.label} IS NULL`,
    ),
    check(
      "chk_collection_directory_item_description",
      sql`${table.type} = 'link' OR ${table.description} IS NULL`,
    ),
  ],
);

// =============================================================================
// Thread-Collection Junction Table (M:N)
// =============================================================================

export const threadCollections = pgTable(
  "thread_collection",
  {
    siteId: text("site_id")
      .notNull()
      .references(() => sites.id, { onDelete: "cascade" }),
    threadId: text("thread_id")
      .notNull()
      .references(() => posts.id, { onDelete: "cascade" }),
    collectionId: text("collection_id")
      .notNull()
      .references(() => collections.id, { onDelete: "cascade" }),
    createdAt: integer("created_at").notNull(),
    position: integer("position").notNull().default(0),
    pinnedAt: integer("pinned_at"),
  },
  (table) => [
    primaryKey({ columns: [table.siteId, table.threadId, table.collectionId] }),
    index("idx_thread_collection_site_collection_id").on(
      table.siteId,
      table.collectionId,
    ),
    index("idx_thread_collection_site_collection_created_thread").on(
      table.siteId,
      table.collectionId,
      table.createdAt,
      table.threadId,
    ),
  ],
);

// =============================================================================
// Navigation Items
// =============================================================================

export const navItems = pgTable(
  "nav_item",
  {
    id: text("id").primaryKey(),
    siteId: text("site_id")
      .notNull()
      .references(() => sites.id, { onDelete: "cascade" }),
    type: text("type", {
      enum: NAV_ITEM_TYPES,
    })
      .notNull()
      .default("link"),
    systemKey: text("system_key", {
      enum: SYSTEM_NAV_KEY_VALUES,
    }),
    collectionId: text("collection_id").references(() => collections.id, {
      onDelete: "cascade",
    }),
    postId: text("post_id").references(() => posts.id, {
      onDelete: "cascade",
    }),
    label: text("label").notNull(),
    url: text("url").notNull(),
    placement: text("placement", {
      enum: NAV_ITEM_PLACEMENTS,
    })
      .notNull()
      .default("header"),
    position: text("position").notNull().default("a0"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    check(
      "chk_nav_item_type",
      sql`${table.type} IN (${sqlTextEnum(NAV_ITEM_TYPES)})`,
    ),
    check(
      "chk_nav_item_placement",
      sql`${table.placement} IN (${sqlTextEnum(NAV_ITEM_PLACEMENTS)})`,
    ),
    check(
      "chk_nav_item_shape",
      sql`(
        ${table.type} = 'link'
        AND ${table.systemKey} IS NULL
        AND ${table.collectionId} IS NULL
        AND ${table.postId} IS NULL
      ) OR (
        ${table.type} = 'system'
        AND ${table.systemKey} IS NOT NULL
        AND ${table.collectionId} IS NULL
        AND ${table.postId} IS NULL
      ) OR (
        ${table.type} = 'collection'
        AND ${table.systemKey} IS NULL
        AND ${table.collectionId} IS NOT NULL
        AND ${table.postId} IS NULL
      ) OR (
        ${table.type} = 'page'
        AND ${table.systemKey} IS NULL
        AND ${table.collectionId} IS NULL
        AND ${table.postId} IS NOT NULL
      )`,
    ),
    uniqueIndex("uq_nav_item_site_position").on(table.siteId, table.position),
    uniqueIndex("uq_nav_item_site_system_key")
      .on(table.siteId, table.systemKey)
      .where(sql`${table.systemKey} IS NOT NULL`),
    uniqueIndex("uq_nav_item_site_collection_id")
      .on(table.siteId, table.collectionId)
      .where(sql`${table.collectionId} IS NOT NULL`),
    uniqueIndex("uq_nav_item_site_post_id")
      .on(table.siteId, table.postId)
      .where(sql`${table.postId} IS NOT NULL`),
  ],
);

// =============================================================================
// Settings (site-scoped key-value)
// =============================================================================

export const settings = pgTable(
  "site_setting",
  {
    siteId: text("site_id")
      .notNull()
      .references(() => sites.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    value: text("value").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.siteId, table.key] }),
    index("idx_site_setting_site_id").on(table.siteId),
  ],
);

// =============================================================================
// API Tokens
// =============================================================================

export const apiTokens = pgTable(
  "api_token",
  {
    id: text("id").primaryKey(),
    siteId: text("site_id")
      .notNull()
      .references(() => sites.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    prefix: text("prefix").notNull(),
    lastUsedAt: integer("last_used_at"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [index("idx_api_token_site_id").on(table.siteId)],
);

// =============================================================================
// better-auth tables
// Note: Using { mode: "timestamp" } so drizzle auto-converts Date <-> integer
// =============================================================================

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  role: text("role").default("member"),
  createdAt: timestamp("created_at", {
    withTimezone: true,
    mode: "date",
  }).notNull(),
  updatedAt: timestamp("updated_at", {
    withTimezone: true,
    mode: "date",
  }).notNull(),
});

export const session = pgTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expires_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
    token: text("token").notNull().unique(),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
    updatedAt: timestamp("updated_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id),
  },
  (table) => [index("idx_session_user_id").on(table.userId)],
);

export const account = pgTable("account", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at", {
    withTimezone: true,
    mode: "date",
  }),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at", {
    withTimezone: true,
    mode: "date",
  }),
  scope: text("scope"),
  password: text("password"),
  createdAt: timestamp("created_at", {
    withTimezone: true,
    mode: "date",
  }).notNull(),
  updatedAt: timestamp("updated_at", {
    withTimezone: true,
    mode: "date",
  }).notNull(),
});

export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at", {
    withTimezone: true,
    mode: "date",
  }).notNull(),
  createdAt: timestamp("created_at", {
    withTimezone: true,
    mode: "date",
  }),
  updatedAt: timestamp("updated_at", {
    withTimezone: true,
    mode: "date",
  }),
});

// ---------------------------------------------------------------------------
// GitHub App Installations (junction table: installation ↔ site, many-to-many)
// ---------------------------------------------------------------------------

export const githubAppInstallation = pgTable(
  "github_app_installation",
  {
    installationId: text("installation_id").notNull(),
    siteId: text("site_id")
      .notNull()
      .references(() => sites.id, { onDelete: "cascade" }),
    accountLogin: text("account_login").notNull(),
    accountType: text("account_type", {
      enum: GITHUB_APP_ACCOUNT_TYPES,
    }).notNull(),
    accountAvatarUrl: text("account_avatar_url").notNull().default(""),
    addedAt: integer("added_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.installationId, table.siteId] }),
    index("github_app_installation_by_installation").on(table.installationId),
    index("github_app_installation_by_site").on(table.siteId),
    check(
      "chk_github_app_installation_account_type",
      sql`${table.accountType} IN (${sqlTextEnum(GITHUB_APP_ACCOUNT_TYPES)})`,
    ),
  ],
);

// ---------------------------------------------------------------------------
// Telegram bindings (connect a Telegram account to post Notes via a bot)
// ---------------------------------------------------------------------------

export const telegramPendingBindings = pgTable(
  "telegram_pending_binding",
  {
    id: text("id").primaryKey(),
    siteId: text("site_id")
      .notNull()
      .references(() => sites.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    createdAt: integer("created_at").notNull(),
    expiresAt: integer("expires_at").notNull(),
  },
  (table) => [
    uniqueIndex("uq_telegram_pending_binding_site_id").on(table.siteId),
    uniqueIndex("uq_telegram_pending_binding_code").on(table.code),
  ],
);

export const telegramBindings = pgTable(
  "telegram_binding",
  {
    id: text("id").primaryKey(),
    siteId: text("site_id")
      .notNull()
      .references(() => sites.id, { onDelete: "cascade" }),
    botId: text("bot_id").notNull(),
    telegramUserId: text("telegram_user_id").notNull(),
    telegramUsername: text("telegram_username"),
    lastUpdateId: integer("last_update_id"),
    boundAt: integer("bound_at").notNull(),
  },
  (table) => [
    uniqueIndex("uq_telegram_binding_site_id").on(table.siteId),
    uniqueIndex("uq_telegram_binding_bot_user").on(
      table.botId,
      table.telegramUserId,
    ),
  ],
);

/** Mirror of `telegram_media_group_item` in the SQLite schema. */
export const telegramMediaGroupItems = pgTable(
  "telegram_media_group_item",
  {
    id: text("id").primaryKey(),
    siteId: text("site_id")
      .notNull()
      .references(() => sites.id, { onDelete: "cascade" }),
    botId: text("bot_id").notNull(),
    telegramUserId: text("telegram_user_id").notNull(),
    mediaGroupId: text("media_group_id").notNull(),
    chatId: integer("chat_id").notNull(),
    messageId: integer("message_id").notNull(),
    updateId: integer("update_id").notNull(),
    fileId: text("file_id").notNull(),
    mediaKind: text("media_kind").notNull(),
    mimeType: text("mime_type"),
    originalName: text("original_name"),
    captionMarkdown: text("caption_markdown"),
    width: integer("width"),
    height: integer("height"),
    durationSeconds: integer("duration_seconds"),
    /** Telegram `thumbnail.file_id` for videos / previewable documents. */
    posterFileId: text("poster_file_id"),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    index("idx_telegram_media_group_item_group").on(
      table.botId,
      table.mediaGroupId,
    ),
    uniqueIndex("uq_telegram_media_group_item_message").on(
      table.botId,
      table.mediaGroupId,
      table.messageId,
    ),
  ],
);

// ---------------------------------------------------------------------------
// Rate Limit
// ---------------------------------------------------------------------------

/**
 * Per-key sliding-window rate-limit counters. Mirrors the SQLite `rate_limit`
 * table — kept in lockstep because both dialects are production targets.
 */
export const rateLimit = pgTable(
  "rate_limit",
  {
    key: text("key").notNull(),
    windowStart: integer("window_start").notNull(),
    count: integer("count").notNull().default(0),
  },
  (table) => [primaryKey({ columns: [table.key, table.windowStart] })],
);
