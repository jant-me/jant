/**
 * Post Service (v2)
 *
 * CRUD operations for posts with Thread support.
 * Posts have format (note/link/quote), status (draft/published),
 * visibility (public/latest_hidden/private), featuredAt, and pinnedAt timestamp.
 */

import {
  eq,
  and,
  or,
  type SQL,
  type SQLWrapper,
  isNull,
  desc,
  inArray,
  sql,
  isNotNull,
  asc,
  lte,
  gt,
  getTableColumns,
} from "drizzle-orm";
import {
  type Database,
  batchQueryRows,
  supportsDrizzleTransaction,
} from "../db/index.js";
import type { DatabaseDialect } from "../db/dialect.js";
import {
  sqliteSchemaBundle,
  type DatabaseSchema,
} from "../db/schema-bundle.js";
import { createEntityId } from "../lib/ids.js";
import { now } from "../lib/time.js";
import { renderTiptapJson, trimTiptapBody } from "../lib/tiptap-render.js";
import { extractSummary, extractBodyText } from "../lib/summary.js";
import { markdownToTiptapJson } from "../lib/markdown-to-tiptap.js";
import { tiptapJsonToMarkdown } from "../lib/tiptap-to-markdown.js";
import { generatePostSlug } from "../lib/slug.js";
import { getSlugValidationIssue } from "../lib/slug-format.js";
import { normalizePath, slugify } from "../lib/url.js";
import type { StorageDriver } from "../lib/storage.js";
import type { MediaService } from "./media.js";
import {
  FORMATS,
  MAX_MEDIA_ATTACHMENTS,
  STATUSES,
  VISIBILITIES,
} from "../types.js";
import type {
  CollectionSortOrder,
  Format,
  Status,
  Visibility,
  SortOrder,
  MediaKind,
  Post,
  CreatePost,
  PostAttachmentInput,
  UpdatePost,
  ThreadTimelineContext,
} from "../types.js";
import {
  ConflictError,
  ValidationError,
  NotFoundError,
} from "../lib/errors.js";
import { createPathService, type PathService } from "./path.js";
import {
  extractYouTubeVideoId,
  getYouTubeThumbnailUrls,
} from "../lib/youtube.js";
import { getPreviewStorageKey } from "../lib/upload.js";
import { generateRandomId } from "../lib/nanoid.js";

/** Dependencies for operations that coordinate with other services */
export interface PostDeleteDeps {
  media: MediaService;
  storage?: StorageDriver | null;
}

export interface PostAttachmentDeps extends PostDeleteDeps {
  storageDriver: string;
  maxFileSizeMB: number;
}

export interface PostFilters {
  format?: Format;
  status?: Status;
  visibility?: Visibility;
  pinned?: boolean;
  featured?: boolean;
  collectionId?: string;
  collectionIds?: string[];
  /** Exclude posts that are replies (have replyToId set) */
  excludeReplies?: boolean;
  /** Exclude posts hidden from Latest from results */
  excludeLatestHidden?: boolean;
  /** Exclude private posts from results */
  excludePrivate?: boolean;
  threadId?: string;
  /** Unix timestamp (inclusive) — only posts published at or after this time */
  publishedAfter?: number;
  /** Unix timestamp (exclusive) — only posts published before this time */
  publishedBefore?: number;
  /** Media kinds to filter by (OR logic: post has media of ANY selected kind). */
  mediaKinds?: MediaKind[];
  /** Filter by media presence */
  hasMedia?: boolean;
  /** Filter by title presence */
  hasTitle?: boolean;
  /** Filter by rating presence */
  hasRating?: boolean;
  /**
   * Filter thread roots by whether their thread contains published replies.
   * Only meaningful together with `excludeReplies` (replies never match).
   */
  hasReplies?: boolean;
  /** Explicit result sort order */
  sortOrder?: SortOrder;
  /** Ignore global pinned ordering when sorting subscription/feed results. */
  ignorePinnedSort?: boolean;
  limit?: number;
  cursor?: string;
  offset?: number; // offset for page-based pagination
}

/** Config for automatic summary extraction */
export interface SummaryConfig {
  maxParagraphs: number;
  maxChars: number;
}

interface ThreadRootPageOptions {
  status?: Status;
  excludePrivate?: boolean;
  excludeLatestHidden?: boolean;
  /** Restrict by the Thread root's format without excluding Child Posts. */
  rootFormat?: Format;
  /** Restrict to Threads with at least one rated published post. */
  hasRating?: true;
  limit?: number;
  offset?: number;
}

interface CollectionFeedEntryOptions extends ThreadRootPageOptions {
  /** Ignore per-collection pinned ordering when sorting collection feeds. */
  ignoreCollectionPinnedSort?: boolean;
}

interface CollectionThreadRootPageOptions extends ThreadRootPageOptions {
  sortOrder?: CollectionSortOrder;
  /** Root Post ID returned by the previous page. */
  cursor?: string;
}

interface CursorSortKey {
  direction: "asc" | "desc";
  expr: SQLWrapper;
  value: number | string;
}

export interface CollectionFeedEntry {
  post: Post;
  collectedAt: number;
}

export interface FeaturedThreadTimelinePost {
  post: Post;
  /** Zero-based position among the Thread's published Posts. */
  position: number;
}

/**
 * Bounded projection for one curated Featured Thread.
 *
 * `posts` contains only the Root, every Featured Post, and the final published
 * Post, in Thread order. Positions preserve the hidden-gap counts without
 * loading the omitted Posts or their related metadata.
 */
export interface FeaturedThreadTimelineData {
  posts: FeaturedThreadTimelinePost[];
  featuredPostIds: string[];
}

export interface PostBodyContent {
  id: string;
  type: "post";
  format: Format;
  contentFormat: "markdown";
  content: string;
  chars: number;
}

/** Minimal projection used by the sitemap renderer. */
export interface SitemapPostEntry {
  id: string;
  /** Canonical slug from `path_registry` */
  slug: string;
  /** Primary alias, if the post has one; used in preference to `slug` for URLs */
  alias: string | null;
  updatedAt: number;
  featuredAt: number | null;
}

export interface PostService {
  getById(id: string): Promise<Post | null>;
  getBodyContent(id: string): Promise<PostBodyContent | null>;
  getBySlug(slug: string): Promise<Post | null>;
  suggestSlug(input: {
    title?: string;
    slug?: string;
    excludePostId?: string;
  }): Promise<string>;
  checkSlugAvailability(slug: string, excludePostId?: string): Promise<boolean>;
  list(filters?: PostFilters): Promise<Post[]>;
  /**
   * List minimal fields needed to render sitemap entries, paginated by `id`
   * (ascending). Excludes replies, private posts, deleted posts, and drafts.
   *
   * Uses keyset pagination on the primary key so old sitemap shards are cheap
   * to serve and stable across shard boundaries: a newly created post always
   * gets a larger TypeID than any previously-committed post, so it lands in
   * the last shard and never rewrites older ones.
   *
   * @param options.afterId  Exclusive lower bound on `id`. Omit for the first
   *                         shard.
   * @param options.limit    Maximum rows to return.
   */
  listForSitemap(options: {
    afterId?: string;
    limit: number;
  }): Promise<SitemapPostEntry[]>;
  /** Count posts that qualify for the sitemap (same filters as `listForSitemap`) */
  countForSitemap(): Promise<number>;
  /**
   * Return the id at the given 0-based offset in the sitemap ordering.
   * Used to compute keyset cursors for sharded sitemap endpoints.
   *
   * Returns `null` when the offset is beyond the available rows.
   *
   * Walks the primary-key index with `ORDER BY id ASC LIMIT 1 OFFSET ?` —
   * SQLite/D1 scan only the index for this, not the row data.
   */
  getSitemapIdAt(offset: number): Promise<string | null>;
  /** Count posts matching filters (ignores cursor, offset, limit) */
  count(filters?: PostFilters): Promise<number>;
  /** Count posts matching filters up to a fixed limit (ignores cursor, offset, limit) */
  countUpTo(filters: PostFilters | undefined, limit: number): Promise<number>;
  /** Count posts grouped by published year-month (YYYY-MM) */
  countByYearMonth(
    filters?: PostFilters,
  ): Promise<{ yearMonth: string; count: number }[]>;
  create(data: CreatePost, summaryConfig?: SummaryConfig): Promise<Post>;
  createWithAttachments(
    data: CreatePost,
    attachments: PostAttachmentInput[] | undefined,
    deps: PostAttachmentDeps,
    summaryConfig?: SummaryConfig,
  ): Promise<Post>;
  /**
   * Atomically create a thread of posts. The first item is the root; each
   * subsequent item is automatically chained as a reply to the previous one.
   * On failure, all already-created posts are rolled back.
   *
   * @param items - Ordered list of (data, attachments) pairs; at least 2 required
   * @param deps - Media/storage dependencies
   * @param summaryConfig - Optional summary extraction config
   * @returns Ordered list of created posts; posts[0] is the root
   */
  createThreadWithAttachments(
    items: Array<{
      data: CreatePost;
      attachments: PostAttachmentInput[] | undefined;
    }>,
    deps: PostAttachmentDeps,
    summaryConfig?: SummaryConfig,
  ): Promise<Post[]>;
  update(
    id: string,
    data: UpdatePost,
    summaryConfig?: SummaryConfig,
  ): Promise<Post | null>;
  updateWithAttachments(
    id: string,
    data: UpdatePost,
    attachments: PostAttachmentInput[] | undefined,
    deps: PostAttachmentDeps,
    summaryConfig?: SummaryConfig,
  ): Promise<Post | null>;
  /**
   * Soft-delete a post and clean up its media (storage files + DB records).
   * Thread roots cascade to all replies.
   *
   * @param id - Post ID
   * @param deps - Media service and optional storage driver for file cleanup
   */
  delete(id: string, deps?: PostDeleteDeps): Promise<boolean>;
  /**
   * Delete a thread draft and release its slug paths so they can be reused.
   * Used when replacing a saved thread draft with a new version.
   */
  deleteThreadDraft(id: string, deps?: PostDeleteDeps): Promise<boolean>;
  getThread(rootId: string): Promise<Post[]>;
  updateThreadStatusAndVisibility(
    rootId: string,
    status: Status,
    visibility: Visibility,
  ): Promise<void>;
  /** Get reply counts for multiple posts */
  getReplyCounts(postIds: string[]): Promise<Map<string, number>>;
  /** Get preview replies for multiple thread roots */
  getThreadPreviews(
    rootIds: string[],
    previewCount?: number,
  ): Promise<Map<string, Post[]>>;
  /** Get latest-reply context for multiple thread roots (for timeline display) */
  getThreadTimelineContext(
    rootIds: string[],
  ): Promise<Map<string, ThreadTimelineContext>>;
  /** Count distinct thread roots that contain featured published posts */
  countFeaturedThreadRoots(options?: ThreadRootPageOptions): Promise<number>;
  /** List Featured Thread roots by the latest selected Post publication time. */
  listFeaturedThreadRootIds(options?: ThreadRootPageOptions): Promise<string[]>;
  /** Load only the Posts rendered by the curated Featured Thread timeline. */
  getFeaturedThreadTimelineData(
    rootIds: string[],
  ): Promise<Map<string, FeaturedThreadTimelineData>>;
  /** Count distinct thread roots that contain published posts in the given collection */
  countCollectionThreadRoots(
    collectionId: string,
    options?: ThreadRootPageOptions,
  ): Promise<number>;
  /** Count distinct thread roots that contain published posts in any of the given collections */
  countCollectionThreadRootsForCollections(
    collectionIds: string[],
    options?: ThreadRootPageOptions,
  ): Promise<number>;
  /** Count distinct matching collection Threads up to a fixed limit. */
  countCollectionThreadRootsUpToForCollections(
    collectionIds: string[],
    options: ThreadRootPageOptions | undefined,
    limit: number,
  ): Promise<number>;
  /** List collection thread root IDs ordered by collected-at or rating semantics */
  listCollectionThreadRootIds(
    collectionId: string,
    options?: CollectionThreadRootPageOptions,
  ): Promise<string[]>;
  /** List collection thread root IDs for a union of collections */
  listCollectionThreadRootIdsForCollections(
    collectionIds: string[],
    options?: CollectionThreadRootPageOptions,
  ): Promise<string[]>;
  /** List and hydrate collection Thread roots using Thread-level ordering. */
  listCollectionThreadRootsForCollections(
    collectionIds: string[],
    options?: CollectionThreadRootPageOptions,
  ): Promise<Post[]>;
  /** List collection feed entries ordered by latest added-at timestamp */
  listCollectionFeedEntries(
    collectionId: string,
    options?: CollectionFeedEntryOptions,
  ): Promise<CollectionFeedEntry[]>;
  /** List collection feed entries for a union of collections */
  listCollectionFeedEntriesForCollections(
    collectionIds: string[],
    options?: CollectionFeedEntryOptions,
  ): Promise<CollectionFeedEntry[]>;
  /** Fetch all published, non-deleted posts for each requested thread root */
  getPublishedThreads(rootIds: string[]): Promise<Map<string, Post[]>>;
  /** Get distinct years that have published posts */
  getDistinctYears(filters?: PostFilters): Promise<number[]>;
  /** For each thread ID, return the ID of the last published, non-deleted post */
  getLastPostIdsByThread(threadIds: string[]): Promise<Map<string, string>>;
  /**
   * Rebuild `post.body_text` for a batch of non-deleted posts, cursor-paginated
   * by post id. For each row, recomputes the plain-text extraction via
   * `extractBodyText(body)` and writes it back only when it differs from the
   * stored value. FTS indexes (SQLite trigger / Postgres generated column)
   * refresh automatically on the UPDATE.
   *
   * Idempotent: re-running after a no-op pass returns `updated: 0`.
   *
   * @param options.limit  Batch size (1..500, default 50)
   * @param options.cursor Exclusive lower bound on post id; pass the previous
   *                       response's `nextCursor` to continue
   * @returns processed/updated/skipped counts, the next cursor, and a `done`
   *          flag the caller uses to terminate the loop
   */
  reindexBodyText(options?: { limit?: number; cursor?: string }): Promise<{
    processed: number;
    updated: number;
    skipped: number;
    nextCursor: string | null;
    done: boolean;
  }>;
}

const SLUG_RE = /^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/;

function isValidSlug(value: string): boolean {
  return SLUG_RE.test(value);
}

// Re-export shared constraint detection — see db/dialect.ts
import { isUniqueConstraintError } from "../db/dialect.js";

function hasNonEmptyText(value: string | null | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function ensureAllowedPostValue<T extends string>(
  value: string,
  allowed: readonly T[],
  message: string,
  ErrorCtor: new (message: string) => Error = ValidationError,
): T {
  if ((allowed as readonly string[]).includes(value)) {
    return value as T;
  }

  throw new ErrorCtor(message);
}

function ensurePostFormat(
  value: string,
  ErrorCtor: new (message: string) => Error = ValidationError,
): Format {
  return ensureAllowedPostValue(
    value,
    FORMATS,
    "Format must be note, link, or quote.",
    ErrorCtor,
  );
}

function ensurePostStatus(
  value: string,
  ErrorCtor: new (message: string) => Error = ValidationError,
): Status {
  return ensureAllowedPostValue(
    value,
    STATUSES,
    "Status must be draft or published.",
    ErrorCtor,
  );
}

function ensurePostVisibility(
  value: string,
  ErrorCtor: new (message: string) => Error = ValidationError,
): Visibility {
  return ensureAllowedPostValue(
    value,
    VISIBILITIES,
    "Visibility must be public, hidden from Latest, or private.",
    ErrorCtor,
  );
}

function ensurePostRating(
  value: number | null | undefined,
  ErrorCtor: new (message: string) => Error = ValidationError,
): number | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (Number.isInteger(value) && value >= 1 && value <= 5) {
    return value;
  }

  throw new ErrorCtor("Rating must be an integer between 1 and 5.");
}

function assertPostFormatShape(data: {
  format: Format;
  title?: string | null;
  body?: unknown;
  url?: string | null;
  quoteText?: string | null;
  hasAttachments?: boolean;
}): void {
  const hasTitle = hasNonEmptyText(data.title);
  const hasUrl = hasNonEmptyText(data.url);
  const hasQuoteText = hasNonEmptyText(data.quoteText);

  if (data.format === "note") {
    if (hasUrl) {
      throw new ValidationError("Notes can't include a URL.");
    }
    if (hasQuoteText) {
      throw new ValidationError("Notes can't include quoted text.");
    }
    // hasAttachments === undefined means unknown (e.g. update without
    // attachment changes) — skip the empty-content check in that case.
    if (
      !hasTitle &&
      !data.body &&
      data.hasAttachments !== undefined &&
      !data.hasAttachments
    ) {
      throw new ValidationError(
        "Notes need a title, body, or at least one attachment.",
      );
    }
    return;
  }

  if (data.format === "link") {
    if (!hasTitle) {
      throw new ValidationError("Link posts need a title.");
    }
    if (!hasUrl) {
      throw new ValidationError("Link posts need a URL.");
    }
    if (hasQuoteText) {
      throw new ValidationError("Link posts can't include quoted text.");
    }
    return;
  }

  if (!hasQuoteText) {
    throw new ValidationError("Quote posts need quoted text.");
  }
}

function isThreadReply(post: Pick<Post, "replyToId">): boolean {
  return post.replyToId !== null;
}

function assertDraftPublishedAt(
  status: Status,
  publishedAt: number | undefined,
): void {
  if (status === "draft" && publishedAt !== undefined) {
    throw new ValidationError("Drafts can't set a publish time.");
  }
}

export function createPostService(
  db: Database,
  config: {
    slugIdLength: number;
    databaseDialect?: DatabaseDialect;
  },
  siteId: string,
  paths: PathService | undefined,
  databaseSchema: DatabaseSchema = sqliteSchemaBundle,
): PostService {
  const resolvedPaths = paths ?? createPathService(db, siteId, databaseSchema);
  const { pathRegistry, posts, threadCollections } = databaseSchema;
  const databaseDialect = config.databaseDialect ?? "sqlite";
  const usesBatchWrites = !supportsDrizzleTransaction(db, databaseDialect);

  function buildPublishedYearMonthExpr(): SQL<string> {
    return databaseDialect === "pg"
      ? sql<string>`to_char(timezone('UTC', to_timestamp(${posts.publishedAt})), 'YYYY-MM')`
      : sql<string>`strftime('%Y-%m', ${posts.publishedAt}, 'unixepoch')`;
  }

  function buildPublishedYearExpr(): SQL<string> {
    return databaseDialect === "pg"
      ? sql<string>`to_char(timezone('UTC', to_timestamp(${posts.publishedAt})), 'YYYY')`
      : sql<string>`strftime('%Y', ${posts.publishedAt}, 'unixepoch')`;
  }

  const effectiveVisibilityExpr = sql<string>`coalesce(
    ${posts.visibility},
    (SELECT root.visibility FROM post AS root WHERE root.id = ${posts.threadId} AND root.site_id = ${siteId})
  )`;

  /** Check if a slug is available (not used by posts or path_registry) */
  async function isSlugAvailable(slug: string): Promise<boolean> {
    return resolvedPaths.isPathAvailable(slug);
  }

  async function isSlugAvailableForPost(
    slug: string,
    excludePostId?: string,
  ): Promise<boolean> {
    const resolved = await resolvedPaths.resolve(slug);
    if (!resolved) return true;

    return Boolean(
      excludePostId &&
      resolved.kind === "slug" &&
      resolved.postId === excludePostId,
    );
  }

  async function pathExists(path: string): Promise<boolean> {
    const rows = await db
      .select({ id: pathRegistry.id })
      .from(pathRegistry)
      .where(
        and(
          eq(pathRegistry.siteId, siteId),
          eq(pathRegistry.path, normalizePath(path)),
        ),
      )
      .limit(1);
    return rows.length > 0;
  }

  async function recalculateThreadLastActivity(rootId: string): Promise<void> {
    const rootRows = await db
      .select({
        latestPublishedAt: sql<number | null>`MAX(${posts.publishedAt})`.as(
          "latest_published_at",
        ),
      })
      .from(posts)
      .where(and(eq(posts.siteId, siteId), eq(posts.threadId, rootId)));

    const latestPublishedAt = rootRows[0]?.latestPublishedAt ?? null;
    const root = await db
      .select({ updatedAt: posts.updatedAt })
      .from(posts)
      .where(and(eq(posts.siteId, siteId), eq(posts.id, rootId)))
      .limit(1);

    const lastActivityAt = latestPublishedAt ?? root[0]?.updatedAt ?? now();

    await db
      .update(posts)
      .set({ lastActivityAt })
      .where(and(eq(posts.siteId, siteId), eq(posts.id, rootId)));
  }

  function normalizeCollectionIds(collectionIds: readonly string[]): string[] {
    return [...new Set(collectionIds)];
  }

  /**
   * Fetch a link preview thumbnail and store it.
   * Silently returns without updating if the URL is not a recognized provider
   * or if the fetch fails.
   */
  async function resolveAndStorePreview(
    postId: string,
    format: string,
    url: string | null | undefined,
    storage: StorageDriver | null | undefined,
  ): Promise<void> {
    if (!storage || format !== "link" || !url) return;

    const videoId = extractYouTubeVideoId(url);
    if (!videoId) return;

    const thumbnailUrls = getYouTubeThumbnailUrls(videoId);
    let imageBytes: Uint8Array | null = null;
    let contentType = "image/jpeg";

    for (const thumbUrl of thumbnailUrls) {
      try {
        const response = await fetch(thumbUrl);
        if (response.ok) {
          const ct = response.headers.get("content-type");
          // YouTube returns a grey placeholder (120×90) when maxresdefault
          // is not available. Detect it by checking content-length.
          const cl = response.headers.get("content-length");
          if (cl && parseInt(cl, 10) < 5000) {
            // Too small — likely a placeholder, try next quality
            continue;
          }
          imageBytes = new Uint8Array(await response.arrayBuffer());
          if (ct) contentType = ct;
          break;
        }
      } catch {
        // Network failure — try next URL
      }
    }

    if (!imageBytes) return;

    const ext = contentType.includes("webp")
      ? "webp"
      : contentType.includes("png")
        ? "png"
        : "jpg";
    const suffix = generateRandomId(8);
    const storageKey = getPreviewStorageKey(siteId, postId, suffix, ext);

    try {
      await storage.put(storageKey, imageBytes, { contentType });
      await db
        .update(posts)
        .set({
          previewImageKey: storageKey,
          previewKind: "video",
          previewProvider: "youtube",
        })
        .where(and(eq(posts.siteId, siteId), eq(posts.id, postId)));
    } catch {
      // Storage or DB failure — preview is best-effort
    }
  }

  /**
   * Delete a preview image from storage if it exists.
   */
  async function deletePreviewImage(
    previewImageKey: string | null | undefined,
    storage: StorageDriver | null | undefined,
  ): Promise<void> {
    if (!storage || !previewImageKey) return;
    try {
      await storage.delete(previewImageKey);
    } catch {
      // Best-effort cleanup
    }
  }

  function buildCollectionMembershipCondition(
    collectionIds: readonly string[],
  ): SQL<unknown> {
    const uniqueCollectionIds = normalizeCollectionIds(collectionIds);
    const firstCollectionId = uniqueCollectionIds[0];
    if (!firstCollectionId) {
      return sql`0 = 1`;
    }

    return uniqueCollectionIds.length === 1
      ? eq(threadCollections.collectionId, firstCollectionId)
      : inArray(threadCollections.collectionId, uniqueCollectionIds);
  }

  function buildThreadCollectionSubqueryCondition(
    collectionIds: readonly string[],
  ): SQL<unknown> {
    const uniqueCollectionIds = normalizeCollectionIds(collectionIds);
    if (uniqueCollectionIds.length === 0) {
      return sql`0 = 1`;
    }

    const placeholders = uniqueCollectionIds.map(
      (collectionId) => sql`${collectionId}`,
    );
    return sql`${posts.threadId} IN (
      SELECT thread_id
      FROM thread_collection
      WHERE site_id = ${siteId}
        AND collection_id IN (${sql.join(placeholders, sql`, `)})
    )`;
  }

  /** Build WHERE conditions from filters (shared by list and count) */
  function buildFilterConditions(filters: PostFilters) {
    const conditions = [eq(posts.siteId, siteId)];

    if (filters.status) {
      conditions.push(eq(posts.status, filters.status));
    }
    if (filters.visibility !== undefined) {
      conditions.push(sql`${effectiveVisibilityExpr} = ${filters.visibility}`);
    }
    if (filters.excludeLatestHidden) {
      conditions.push(sql`${effectiveVisibilityExpr} != 'latest_hidden'`);
    }
    if (filters.excludePrivate) {
      conditions.push(sql`${effectiveVisibilityExpr} != 'private'`);
    }
    if (filters.pinned !== undefined) {
      conditions.push(
        filters.pinned
          ? sql`${posts.pinnedAt} IS NOT NULL`
          : isNull(posts.pinnedAt),
      );
    }
    if (filters.featured !== undefined) {
      conditions.push(
        filters.featured
          ? sql`${posts.featuredAt} IS NOT NULL`
          : isNull(posts.featuredAt),
      );
    }
    if (filters.format) {
      conditions.push(eq(posts.format, filters.format));
    }
    if (filters.collectionIds !== undefined) {
      conditions.push(
        buildThreadCollectionSubqueryCondition(filters.collectionIds),
      );
    } else if (filters.collectionId !== undefined) {
      conditions.push(
        buildThreadCollectionSubqueryCondition([filters.collectionId]),
      );
    }
    if (filters.threadId) {
      conditions.push(eq(posts.threadId, filters.threadId));
    }
    if (filters.excludeReplies) {
      conditions.push(isNull(posts.replyToId));
    }
    if (filters.publishedAfter !== undefined) {
      conditions.push(sql`${posts.publishedAt} >= ${filters.publishedAfter}`);
    }
    if (filters.publishedBefore !== undefined) {
      conditions.push(sql`${posts.publishedAt} < ${filters.publishedBefore}`);
    }
    if (filters.mediaKinds && filters.mediaKinds.length > 0) {
      const placeholders = filters.mediaKinds.map((k) => sql`${k}`);
      conditions.push(
        sql`${posts.id} IN (
          SELECT post_id
          FROM media
          WHERE site_id = ${siteId}
            AND media_kind IN (${sql.join(placeholders, sql`, `)})
        )`,
      );
    }
    if (filters.hasMedia !== undefined) {
      if (filters.hasMedia) {
        conditions.push(
          sql`${posts.id} IN (
            SELECT post_id FROM media WHERE site_id = ${siteId}
          )`,
        );
      } else {
        conditions.push(
          sql`${posts.id} NOT IN (
            SELECT post_id FROM media WHERE site_id = ${siteId}
          )`,
        );
      }
    }
    if (filters.hasTitle !== undefined) {
      if (filters.hasTitle) {
        conditions.push(
          sql`${posts.title} IS NOT NULL AND ${posts.title} != ''`,
        );
      } else {
        conditions.push(sql`(${posts.title} IS NULL OR ${posts.title} = '')`);
      }
    }
    if (filters.hasRating !== undefined) {
      conditions.push(
        filters.hasRating ? isNotNull(posts.rating) : isNull(posts.rating),
      );
    }
    if (filters.hasReplies !== undefined) {
      // Same notion of "reply" as getReplyCounts: published posts in the
      // thread with reply_to_id set.
      const repliesExist = sql`EXISTS (
        SELECT 1
        FROM post AS reply
        WHERE reply.site_id = ${siteId}
          AND reply.thread_id = ${posts.id}
          AND reply.reply_to_id IS NOT NULL
          AND reply.status = 'published'
      )`;
      conditions.push(
        filters.hasReplies ? repliesExist : sql`NOT ${repliesExist}`,
      );
    }

    return conditions;
  }

  async function getLastLivePostIdInThread(
    threadId: string,
  ): Promise<string | null> {
    const rows = await db
      .select({ id: posts.id })
      .from(posts)
      .where(and(eq(posts.siteId, siteId), eq(posts.threadId, threadId)))
      .orderBy(desc(posts.createdAt), desc(posts.id))
      .limit(1);

    return rows[0]?.id ?? null;
  }

  function getCursorSortTimestamp(row: typeof posts.$inferSelect): number {
    return row.status === "draft" ? row.updatedAt : (row.lastActivityAt ?? -1);
  }

  function buildLexicographicCursorCondition(
    keys: [CursorSortKey, ...CursorSortKey[]],
  ): SQL<unknown> {
    const [first, ...rest] = keys;
    const comparison =
      first.direction === "desc"
        ? sql`${first.expr} < ${first.value}`
        : sql`${first.expr} > ${first.value}`;

    if (rest.length === 0) {
      return comparison;
    }

    return sql`(
      ${comparison}
      OR (${first.expr} = ${first.value} AND ${buildLexicographicCursorCondition(
        rest as [CursorSortKey, ...CursorSortKey[]],
      )})
    )`;
  }

  async function buildListCursorCondition(
    filters: PostFilters,
  ): Promise<SQL<unknown> | null> {
    if (!filters.cursor) {
      return null;
    }

    const cursorRow = await db
      .select()
      .from(posts)
      .where(and(eq(posts.siteId, siteId), eq(posts.id, filters.cursor)))
      .limit(1);
    const cursorPost = cursorRow[0];

    if (!cursorPost) {
      return null;
    }

    const sortTimestampExpr =
      filters.status === "draft"
        ? posts.updatedAt
        : filters.status === "published"
          ? posts.lastActivityAt
          : sql<number>`CASE
              WHEN ${posts.status} = 'draft' THEN ${posts.updatedAt}
              ELSE ${posts.lastActivityAt}
            END`;
    const pinnedSortExpr = sql<number>`coalesce(${posts.pinnedAt}, -1)`;
    const featuredPublishedSortExpr = sql<number>`coalesce(
      ${posts.publishedAt}, ${posts.createdAt}, -1
    )`;
    const sortTimestampSortExpr = sql<number>`coalesce(${sortTimestampExpr}, -1)`;
    const ratingPresenceExpr = sql<number>`CASE
      WHEN ${posts.rating} IS NULL THEN 0
      ELSE 1
    END`;
    const ratingSortExpr = sql<number>`coalesce(${posts.rating}, -1)`;
    const cursorPinnedAt = cursorPost.pinnedAt ?? -1;
    const cursorFeaturedPublishedAt =
      cursorPost.publishedAt ?? cursorPost.createdAt;
    const cursorSortTimestamp = getCursorSortTimestamp(cursorPost);
    const cursorRatingPresence = cursorPost.rating === null ? 0 : 1;
    const cursorRating = cursorPost.rating ?? -1;
    const withPinnedSortKey = (
      keys: [CursorSortKey, ...CursorSortKey[]],
    ): [CursorSortKey, ...CursorSortKey[]] =>
      filters.ignorePinnedSort
        ? keys
        : [
            { direction: "desc", expr: pinnedSortExpr, value: cursorPinnedAt },
            ...keys,
          ];

    if (filters.featured || filters.sortOrder === undefined) {
      if (filters.featured) {
        return buildLexicographicCursorCondition(
          withPinnedSortKey([
            {
              direction: "desc",
              expr: featuredPublishedSortExpr,
              value: cursorFeaturedPublishedAt,
            },
            { direction: "desc", expr: posts.id, value: cursorPost.id },
          ]),
        );
      }

      return buildLexicographicCursorCondition(
        withPinnedSortKey([
          {
            direction: "desc",
            expr: sortTimestampSortExpr,
            value: cursorSortTimestamp,
          },
          { direction: "desc", expr: posts.id, value: cursorPost.id },
        ]),
      );
    }

    if (filters.sortOrder === "oldest") {
      return buildLexicographicCursorCondition(
        withPinnedSortKey([
          {
            direction: "asc",
            expr: sortTimestampSortExpr,
            value: cursorSortTimestamp,
          },
          { direction: "asc", expr: posts.id, value: cursorPost.id },
        ]),
      );
    }

    if (filters.sortOrder === "rating_desc") {
      return buildLexicographicCursorCondition(
        withPinnedSortKey([
          {
            direction: "desc",
            expr: ratingPresenceExpr,
            value: cursorRatingPresence,
          },
          { direction: "desc", expr: ratingSortExpr, value: cursorRating },
          {
            direction: "desc",
            expr: sortTimestampSortExpr,
            value: cursorSortTimestamp,
          },
          { direction: "desc", expr: posts.id, value: cursorPost.id },
        ]),
      );
    }

    return buildLexicographicCursorCondition(
      withPinnedSortKey([
        {
          direction: "desc",
          expr: ratingPresenceExpr,
          value: cursorRatingPresence,
        },
        { direction: "asc", expr: ratingSortExpr, value: cursorRating },
        {
          direction: "desc",
          expr: sortTimestampSortExpr,
          value: cursorSortTimestamp,
        },
        { direction: "desc", expr: posts.id, value: cursorPost.id },
      ]),
    );
  }

  function toPost(
    row: typeof posts.$inferSelect,
    slug: string,
    visibility: string,
  ): Post {
    return {
      id: row.id,
      siteId: row.siteId,
      format: ensurePostFormat(row.format, Error),
      status: ensurePostStatus(row.status, Error),
      visibility: ensurePostVisibility(visibility, Error),
      pinnedAt: row.pinnedAt,
      featuredAt: row.featuredAt,
      slug,
      title: row.title,
      url: row.url,
      body: row.body,
      bodyHtml: row.bodyHtml,
      bodyText: row.bodyText,
      quoteText: row.quoteText,
      summary: row.summary,
      rating: ensurePostRating(row.rating, Error),
      previewImageKey: row.previewImageKey,
      previewKind: row.previewKind,
      previewProvider: row.previewProvider,
      replyToId: row.replyToId,
      threadId: row.threadId,
      publishedAt: row.publishedAt,
      lastActivityAt: row.lastActivityAt ?? row.publishedAt ?? row.updatedAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  async function hydratePost(
    row: typeof posts.$inferSelect | undefined,
  ): Promise<Post | null> {
    if (!row) return null;
    const slug = await resolvedPaths.getPostSlug(row.id);
    if (!slug) return null;
    const rootVisibilityMap = await getThreadVisibilityMap([row.threadId]);
    const visibility = rootVisibilityMap.get(row.threadId) ?? row.visibility;
    if (!visibility) return null;
    return toPost(row, slug, visibility);
  }

  async function hydratePosts(
    rows: (typeof posts.$inferSelect)[],
  ): Promise<Post[]> {
    if (rows.length === 0) return [];
    const slugMap = await resolvedPaths.getPostSlugMap(
      rows.map((row) => row.id),
    );
    const rootVisibilityMap = await getThreadVisibilityMap(
      rows.map((row) => row.threadId),
    );
    return rows
      .map((row) => {
        const slug = slugMap.get(row.id);
        const visibility =
          rootVisibilityMap.get(row.threadId) ?? row.visibility;
        return slug && visibility ? toPost(row, slug, visibility) : null;
      })
      .filter((row): row is Post => row !== null);
  }

  async function hydratePostsById(ids: string[]): Promise<Map<string, Post>> {
    const result = new Map<string, Post>();
    const uniqueIds = [...new Set(ids)];

    if (uniqueIds.length === 0) {
      return result;
    }

    const rows = await batchQueryRows(uniqueIds, (chunk) =>
      db
        .select()
        .from(posts)
        .where(
          and(
            eq(posts.siteId, siteId),
            inArray(posts.id, chunk),
            eq(posts.status, "published"),
          ),
        ),
    );

    for (const post of await hydratePosts(rows)) {
      result.set(post.id, post);
    }

    return result;
  }

  async function getThreadVisibilityMap(
    threadIds: string[],
  ): Promise<Map<string, Visibility>> {
    const uniqueThreadIds = [...new Set(threadIds)];
    const result = new Map<string, Visibility>();
    if (uniqueThreadIds.length === 0) return result;

    const rows = await batchQueryRows(uniqueThreadIds, (chunk) =>
      db
        .select({ id: posts.id, visibility: posts.visibility })
        .from(posts)
        .where(and(eq(posts.siteId, siteId), inArray(posts.id, chunk))),
    );

    for (const row of rows) {
      if (row.visibility) {
        result.set(row.id, ensurePostVisibility(row.visibility, Error));
      }
    }

    return result;
  }

  function buildThreadRootPageConditions(options?: ThreadRootPageOptions) {
    const conditions: SQL[] = [eq(posts.siteId, siteId)];
    const status = options?.status;

    if (status) {
      conditions.push(eq(posts.status, status));
    }
    if (options?.excludePrivate) {
      conditions.push(sql`${effectiveVisibilityExpr} != 'private'`);
    }
    if (options?.excludeLatestHidden) {
      conditions.push(sql`${effectiveVisibilityExpr} != 'latest_hidden'`);
    }
    if (options?.rootFormat) {
      conditions.push(sql`EXISTS (
        SELECT 1
        FROM post AS collection_root
        WHERE collection_root.site_id = ${siteId}
          AND collection_root.id = ${posts.threadId}
          AND collection_root.format = ${options.rootFormat}
      )`);
    }
    if (options?.hasRating) {
      conditions.push(isNotNull(posts.rating));
    }

    return conditions;
  }

  function buildCollectionThreadActivityExpr(alias: string) {
    return sql<number>`MAX(
      COALESCE(
        (
          SELECT CASE
            WHEN root.updated_at > root.created_at
              AND root.updated_at > COALESCE(root.last_activity_at, -1)
            THEN root.updated_at
            ELSE COALESCE(root.last_activity_at, root.updated_at)
          END
          FROM post AS root
          WHERE root.site_id = ${siteId}
            AND root.id = ${posts.threadId}
        ),
        ${posts.publishedAt},
        ${posts.updatedAt}
      )
    )`.as(alias);
  }

  function buildCollectionThreadSortQuery(
    collectionIds: string[],
    options: CollectionThreadRootPageOptions,
  ) {
    const conditions = [
      ...buildThreadRootPageConditions(options),
      buildCollectionMembershipCondition(collectionIds),
    ];
    const sortOrder = options.sortOrder ?? "newest";
    const publishedAt =
      sortOrder === "oldest"
        ? sql<number>`MIN(${posts.publishedAt})`.as("published_at")
        : sql<number>`MAX(${posts.publishedAt})`.as("published_at");
    const threadActivityAt =
      buildCollectionThreadActivityExpr("thread_activity_at");
    const ratingPresence = sql<number>`MAX(
      CASE
        WHEN ${posts.rating} IS NULL THEN 0
        ELSE 1
      END
    )`.as("rating_presence");
    const ratingValue = sql<number>`MAX(coalesce(${posts.rating}, -1))`.as(
      "rating_value",
    );
    const collectionPinnedAt =
      sql<number>`MAX(coalesce(${threadCollections.pinnedAt}, -1))`.as(
        "collection_pinned_at",
      );

    const sortedThreads = db
      .select({
        threadId: posts.threadId,
        publishedAt,
        threadActivityAt,
        collectionPinnedAt,
        ratingPresence,
        ratingValue,
      })
      .from(posts)
      .innerJoin(
        threadCollections,
        and(
          eq(threadCollections.siteId, posts.siteId),
          eq(threadCollections.threadId, posts.threadId),
        ),
      )
      .where(and(...conditions))
      .groupBy(posts.threadId)
      .as("collection_thread_sort");

    return { sortOrder, sortedThreads };
  }

  function isMediaAttachmentInput(
    attachment: PostAttachmentInput,
  ): attachment is Extract<PostAttachmentInput, { type: "media" }> {
    return attachment.type === "media";
  }

  async function createAttachmentMediaIds(
    attachments: PostAttachmentInput[],
    deps: PostAttachmentDeps,
  ) {
    if (attachments.length > MAX_MEDIA_ATTACHMENTS) {
      throw new ValidationError(
        `Posts allow at most ${MAX_MEDIA_ATTACHMENTS} attachments`,
      );
    }

    const orderedMediaIds: string[] = [];
    const createdTextMediaIds: string[] = [];
    const referencedMediaIds = attachments
      .filter(isMediaAttachmentInput)
      .map((attachment) => attachment.mediaId);

    await deps.media.validateIds(referencedMediaIds);

    try {
      for (const attachment of attachments) {
        if (isMediaAttachmentInput(attachment)) {
          orderedMediaIds.push(attachment.mediaId);
          continue;
        }

        const created = await deps.media.createTextAttachment(attachment, {
          storage: deps.storage,
          storageDriver: deps.storageDriver,
          maxFileSizeMB: deps.maxFileSizeMB,
        });
        orderedMediaIds.push(created.id);
        createdTextMediaIds.push(created.id);
      }
    } catch (error) {
      await cleanupCreatedTextAttachments(createdTextMediaIds, deps);
      throw error;
    }

    return { orderedMediaIds, createdTextMediaIds };
  }

  async function applyAttachmentAltUpdates(
    attachments: PostAttachmentInput[],
    deps: PostAttachmentDeps,
  ) {
    const altUpdates = attachments
      .filter(isMediaAttachmentInput)
      .filter((attachment) => attachment.alt !== undefined)
      .map((attachment) =>
        deps.media.updateAlt(attachment.mediaId, attachment.alt ?? ""),
      );

    await Promise.all(altUpdates);
  }

  async function cleanupCreatedTextAttachments(
    mediaIds: string[],
    deps: PostAttachmentDeps,
  ) {
    if (mediaIds.length === 0) return;
    await deps.media.deleteByIds(mediaIds, deps.storage).catch(() => undefined);
  }

  async function getCollectionIdsForThread(
    threadId: string,
  ): Promise<string[]> {
    const rows = await db
      .select({ collectionId: threadCollections.collectionId })
      .from(threadCollections)
      .where(
        and(
          eq(threadCollections.siteId, siteId),
          eq(threadCollections.threadId, threadId),
        ),
      );

    return rows.map((row) => row.collectionId);
  }

  async function getThreadCollectionEntries(threadId: string): Promise<
    Map<
      string,
      {
        createdAt: number;
        pinnedAt: number | null;
      }
    >
  > {
    const rows = await db
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
    return new Map(
      rows.map((row) => [
        row.collectionId,
        { createdAt: row.createdAt, pinnedAt: row.pinnedAt },
      ]),
    );
  }

  function buildRollbackUpdate(
    post: Post,
    collectionIds: string[],
  ): UpdatePost {
    return {
      format: post.format,
      title: post.title,
      body: post.body ?? null,
      slug: post.slug,
      status: post.status,
      visibility: post.visibility,
      pinned: post.pinnedAt !== null,
      featured: post.featuredAt !== null,
      url: post.url,
      quoteText: post.quoteText,
      rating: post.rating,
      collectionIds,
      publishedAt: post.publishedAt ?? undefined,
    };
  }

  return {
    async getById(id) {
      const result = await db
        .select()
        .from(posts)
        .where(and(eq(posts.siteId, siteId), eq(posts.id, id)))
        .limit(1);
      return hydratePost(result[0]);
    },

    async getBodyContent(id) {
      const post = await this.getById(id);
      if (!post) return null;

      return {
        id: post.id,
        type: "post",
        format: post.format,
        contentFormat: "markdown",
        content: post.body ? tiptapJsonToMarkdown(post.body) : "",
        chars: post.bodyText?.length ?? 0,
      };
    },

    async getBySlug(slug) {
      const resolved = await resolvedPaths.resolve(slug);
      if (!resolved || resolved.kind !== "slug" || !resolved.postId) {
        return null;
      }
      return this.getById(resolved.postId);
    },

    async suggestSlug(input) {
      return generatePostSlug({
        slug: input.slug,
        title: input.title,
        idLength: config.slugIdLength,
        isAvailable: (candidate) =>
          isSlugAvailableForPost(candidate, input.excludePostId),
      });
    },

    async checkSlugAvailability(slug, excludePostId) {
      const issue = getSlugValidationIssue(slug);
      if (issue === "invalid") {
        throw new ValidationError("Slug contains invalid characters");
      }
      if (issue === "reserved") {
        throw new ValidationError("Slug is reserved");
      }

      return isSlugAvailableForPost(slug, excludePostId);
    },

    async list(filters = {}) {
      const conditions = buildFilterConditions(filters);
      const cursorCondition = await buildListCursorCondition(filters);
      if (filters.cursor && !cursorCondition) {
        return [];
      }
      const sortTimestamp =
        filters.status === "draft"
          ? posts.updatedAt
          : filters.status === "published"
            ? posts.lastActivityAt
            : sql<number>`CASE
                WHEN ${posts.status} = 'draft' THEN ${posts.updatedAt}
                ELSE ${posts.lastActivityAt}
              END`;

      if (cursorCondition) {
        conditions.push(cursorCondition);
      }

      const ratingPresence = sql<number>`CASE
          WHEN ${posts.rating} IS NULL THEN 0
          ELSE 1
        END`;

      // NULL-sort order differs between dialects: SQLite puts NULLs last for
      // DESC, Postgres puts them first. Wrap nullable sort keys in COALESCE
      // so pinned and nullable timeline values sort identically under both
      // engines. Mirrors the
      // expressions used by `buildListCursorCondition` above.
      const pinnedSortExpr = sql<number>`coalesce(${posts.pinnedAt}, -1)`;
      const featuredPublishedSortExpr = sql<number>`coalesce(
        ${posts.publishedAt}, ${posts.createdAt}, -1
      )`;
      const sortTimestampSortExpr = sql<number>`coalesce(${sortTimestamp}, -1)`;
      const pinnedOrder = filters.ignorePinnedSort
        ? []
        : [desc(pinnedSortExpr)];

      const baseQuery = db
        .select()
        .from(posts)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .limit(filters.limit ?? 100);

      let query =
        filters.featured || filters.sortOrder === undefined
          ? baseQuery.orderBy(
              ...pinnedOrder,
              filters.featured
                ? desc(featuredPublishedSortExpr)
                : desc(sortTimestampSortExpr),
              desc(posts.id),
            )
          : filters.sortOrder === "oldest"
            ? baseQuery.orderBy(
                ...pinnedOrder,
                asc(sortTimestampSortExpr),
                asc(posts.id),
              )
            : filters.sortOrder === "rating_desc"
              ? baseQuery.orderBy(
                  ...pinnedOrder,
                  desc(ratingPresence),
                  desc(posts.rating),
                  desc(sortTimestampSortExpr),
                  desc(posts.id),
                )
              : baseQuery.orderBy(
                  ...pinnedOrder,
                  desc(ratingPresence),
                  asc(posts.rating),
                  desc(sortTimestampSortExpr),
                  desc(posts.id),
                );

      if (filters.offset !== undefined) {
        query = query.offset(filters.offset) as typeof query;
      }

      const rows = await query;
      return hydratePosts(rows);
    },

    async listForSitemap({ afterId, limit }) {
      // Share the filter conditions with `list()` so visibility/reply/deleted
      // semantics stay consistent if they ever change.
      const conditions = buildFilterConditions({
        status: "published",
        excludePrivate: true,
        excludeReplies: true,
      });
      if (afterId !== undefined) {
        conditions.push(sql`${posts.id} > ${afterId}`);
      }

      const rows = await db
        .select({
          id: posts.id,
          updatedAt: posts.updatedAt,
          featuredAt: posts.featuredAt,
        })
        .from(posts)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(asc(posts.id))
        .limit(limit);

      if (rows.length === 0) return [];

      const ids = rows.map((row) => row.id);
      const [slugMap, aliasesMap] = await Promise.all([
        resolvedPaths.getPostSlugMap(ids),
        resolvedPaths.getPostAliases(ids),
      ]);

      return rows
        .map((row): SitemapPostEntry | null => {
          const slug = slugMap.get(row.id);
          if (!slug) return null;
          const alias = aliasesMap.get(row.id)?.[0] ?? null;
          return {
            id: row.id,
            slug,
            alias,
            updatedAt: row.updatedAt,
            featuredAt: row.featuredAt,
          };
        })
        .filter((entry): entry is SitemapPostEntry => entry !== null);
    },

    async countForSitemap() {
      const conditions = buildFilterConditions({
        status: "published",
        excludePrivate: true,
        excludeReplies: true,
      });
      const result = await db
        .select({ count: sql<number>`CAST(count(*) AS INTEGER)`.as("count") })
        .from(posts)
        .where(conditions.length > 0 ? and(...conditions) : undefined);
      return result[0]?.count ?? 0;
    },

    async getSitemapIdAt(offset) {
      if (offset < 0) return null;
      const conditions = buildFilterConditions({
        status: "published",
        excludePrivate: true,
        excludeReplies: true,
      });
      const rows = await db
        .select({ id: posts.id })
        .from(posts)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(asc(posts.id))
        .limit(1)
        .offset(offset);
      return rows[0]?.id ?? null;
    },

    async count(filters = {}) {
      const conditions = buildFilterConditions(filters);

      const result = await db
        .select({ count: sql<number>`CAST(count(*) AS INTEGER)`.as("count") })
        .from(posts)
        .where(conditions.length > 0 ? and(...conditions) : undefined);

      return result[0]?.count ?? 0;
    },

    async countUpTo(filters = {}, limit) {
      const normalizedLimit = Math.max(0, Math.trunc(limit));
      if (normalizedLimit === 0) {
        return 0;
      }

      const conditions = buildFilterConditions(filters);
      const rows = await db
        .select({ id: posts.id })
        .from(posts)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .limit(normalizedLimit);

      return rows.length;
    },

    async countByYearMonth(filters = {}) {
      const conditions = [
        ...buildFilterConditions(filters),
        isNotNull(posts.publishedAt),
      ];
      const publishedYearMonthExpr = buildPublishedYearMonthExpr();

      return db
        .select({
          yearMonth: publishedYearMonthExpr.as("year_month"),
          count: sql<number>`CAST(count(*) AS INTEGER)`.as("count"),
        })
        .from(posts)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .groupBy(publishedYearMonthExpr)
        .orderBy(desc(publishedYearMonthExpr));
    },

    async create(data, summaryConfig) {
      const id = createEntityId("post");
      const timestamp = now();
      const format = ensurePostFormat(data.format);
      const requestedStatus =
        data.status !== undefined ? ensurePostStatus(data.status) : undefined;
      const requestedVisibility =
        data.visibility !== undefined
          ? ensurePostVisibility(data.visibility)
          : undefined;
      const rating = ensurePostRating(data.rating);

      const rawBody = data.bodyMarkdown
        ? markdownToTiptapJson(data.bodyMarkdown)
        : (data.body ?? null);
      const body = rawBody ? trimTiptapBody(rawBody) : null;
      const title = data.title?.trim() || null;
      const quoteText = data.quoteText?.trim() || null;
      const url = data.url?.trim() || null;

      assertPostFormatShape({
        format,
        title,
        body,
        url,
        quoteText,
        hasAttachments: data.attachments
          ? data.attachments.length > 0
          : undefined,
      });

      const bodyHtml = body ? renderTiptapJson(body) : null;
      const bodyText = body
        ? extractBodyText(body, { includeLinkHrefs: true })
        : null;

      // Generate summary for titled notes with body content
      let summary: string | null = null;
      if (format === "note" && title && body && summaryConfig) {
        summary = extractSummary(
          body,
          summaryConfig.maxParagraphs,
          summaryConfig.maxChars,
        );
      }

      // Handle thread relationship
      let threadId = id;
      let status: Status = requestedStatus ?? "published";
      let visibility: Visibility | null = requestedVisibility ?? "public";

      // Collapse the two-input (`flag` + `flagAt`) pair the DTO exposes
      // into the single timestamp form the DB column stores. Explicit
      // `*At` wins over the boolean shorthand when both are set.
      const resolvedPinnedAt =
        data.pinnedAt !== undefined
          ? data.pinnedAt
          : data.pinned !== undefined
            ? data.pinned
              ? timestamp
              : null
            : null;
      const resolvedFeaturedAt =
        data.featuredAt !== undefined
          ? data.featuredAt
          : data.featured !== undefined
            ? data.featured
              ? timestamp
              : null
            : null;

      if (data.replyToId) {
        const parent = await this.getById(data.replyToId);
        if (!parent) {
          throw new NotFoundError("Parent post");
        }

        if (resolvedPinnedAt !== null) {
          throw new ConflictError(
            "Cannot pin a thread reply. Pin the root post instead.",
          );
        }

        const lastLivePostId = await getLastLivePostIdInThread(parent.threadId);
        if (lastLivePostId && lastLivePostId !== parent.id) {
          throw new ConflictError(
            "This post is no longer the end of the thread. Reply to the latest post instead.",
          );
        }

        threadId = parent.threadId;

        // Replies inherit visibility from the root at read time.
        const root =
          parent.threadId === parent.id
            ? parent
            : await this.getById(parent.threadId);
        if (root) {
          if (data.status !== "draft") {
            status = root.status;
          }
        }
        visibility = null;

        if (
          (data.collectionIds?.length ?? 0) > 0 ||
          (data.collectionEntries?.length ?? 0) > 0
        ) {
          throw new ConflictError(
            "Cannot set Collections while creating a Thread reply. Set them on the Thread root instead.",
          );
        }
      }

      assertDraftPublishedAt(status, data.publishedAt);
      const publishedAt =
        status === "published" ? (data.publishedAt ?? timestamp) : null;

      // Resolve slug from slug, path, or title
      let slug: string;
      let aliasPath: string | null = null;

      // Quote `title` stores source attribution (e.g. author name), not a real
      // title — deriving the slug from it would produce URLs like `/basho`
      // that read as "a page about Basho" and collide across every quote from
      // the same source. Fall through to random IDs instead; users who want a
      // readable slug can still set one explicitly.
      const titleForSlug =
        format === "quote" ? undefined : (title ?? undefined);

      if (data.path) {
        const normalized = normalizePath(data.path);
        if (isValidSlug(normalized)) {
          // Path is a valid slug — use it directly
          slug = await generatePostSlug({
            slug: normalized,
            idLength: config.slugIdLength,
            isAvailable: isSlugAvailable,
          });
        } else {
          // Path is not a valid slug — slugify it for the slug, keep original as alias
          const slugified = slugify(normalized);
          slug = await generatePostSlug({
            slug: slugified || undefined,
            title: titleForSlug,
            idLength: config.slugIdLength,
            isAvailable: isSlugAvailable,
          });
          // Verify the alias path is available before proceeding
          if (!(await resolvedPaths.isPathAvailable(normalized))) {
            throw new ConflictError(`Path "${normalized}" is already in use`);
          }
          aliasPath = normalized;
        }
      } else {
        slug = await generatePostSlug({
          slug: data.slug,
          title: titleForSlug,
          idLength: config.slugIdLength,
          isAvailable: isSlugAvailable,
        });
      }

      // Thread collection membership is stored against the root ID. When
      // structured `collectionEntries` are provided (Hugo import path),
      // they win over the bare `collectionIds` slug list and carry
      // `createdAt` / `position` / `pinnedAt` per row. Otherwise fall back to
      // the simple list and derive those fields from sensible defaults.
      const hasCollectionEntries =
        data.collectionEntries !== undefined &&
        data.collectionEntries.length > 0;
      const collectionInsertRows: {
        siteId: string;
        threadId: string;
        collectionId: string;
        createdAt: number;
        position: number;
        pinnedAt: number | null;
      }[] = hasCollectionEntries
        ? (() => {
            const seen = new Set<string>();
            const rows: {
              siteId: string;
              threadId: string;
              collectionId: string;
              createdAt: number;
              position: number;
              pinnedAt: number | null;
            }[] = [];
            let fallbackPosition = 0;
            for (const entry of data.collectionEntries ?? []) {
              if (seen.has(entry.collectionId)) continue;
              seen.add(entry.collectionId);
              rows.push({
                siteId,
                threadId,
                collectionId: entry.collectionId,
                createdAt: entry.createdAt ?? timestamp,
                position: entry.position ?? fallbackPosition,
                pinnedAt: entry.pinnedAt ?? null,
              });
              fallbackPosition++;
            }
            return rows;
          })()
        : [...new Set(data.collectionIds ?? [])].map((collectionId, index) => ({
            siteId,
            threadId,
            collectionId,
            createdAt: timestamp,
            position: index,
            pinnedAt: null,
          }));

      try {
        if (usesBatchWrites) {
          const writeQueries = [];

          writeQueries.push(
            db.insert(posts).values({
              id,
              siteId,
              format,
              status,
              visibility,
              pinnedAt: resolvedPinnedAt,
              featuredAt: resolvedFeaturedAt,
              title,
              url,
              body,
              bodyHtml,
              bodyText,
              quoteText,
              summary,
              rating,
              replyToId: data.replyToId ?? null,
              threadId,
              publishedAt,
              lastActivityAt: publishedAt ?? timestamp,
              createdAt: timestamp,
              updatedAt: timestamp,
            }),
          );

          writeQueries.push(
            db.insert(pathRegistry).values({
              id: createEntityId("path"),
              siteId,
              path: normalizePath(slug),
              kind: "slug",
              postId: id,
              collectionId: null,
              redirectToPath: null,
              redirectType: null,
              createdAt: timestamp,
              updatedAt: timestamp,
            }),
          );

          if (aliasPath) {
            writeQueries.push(
              db.insert(pathRegistry).values({
                id: createEntityId("path"),
                siteId,
                path: normalizePath(aliasPath),
                kind: "alias",
                postId: id,
                collectionId: null,
                redirectToPath: null,
                redirectType: null,
                createdAt: timestamp,
                updatedAt: timestamp,
              }),
            );
          }

          if (collectionInsertRows.length > 0) {
            writeQueries.push(
              data.replyToId
                ? db
                    .insert(threadCollections)
                    .values(collectionInsertRows)
                    .onConflictDoNothing()
                : db.insert(threadCollections).values(collectionInsertRows),
            );
          }

          await db.batch(
            writeQueries as [
              (typeof writeQueries)[number],
              ...(typeof writeQueries)[number][],
            ],
          );
        } else {
          await db.transaction(async (tx) => {
            await tx.insert(posts).values({
              id,
              siteId,
              format,
              status,
              visibility,
              pinnedAt: resolvedPinnedAt,
              featuredAt: resolvedFeaturedAt,
              title,
              url,
              body,
              bodyHtml,
              bodyText,
              quoteText,
              summary,
              rating,
              replyToId: data.replyToId ?? null,
              threadId,
              publishedAt,
              lastActivityAt: publishedAt ?? timestamp,
              createdAt: timestamp,
              updatedAt: timestamp,
            });

            await tx.insert(pathRegistry).values({
              id: createEntityId("path"),
              siteId,
              path: normalizePath(slug),
              kind: "slug",
              postId: id,
              collectionId: null,
              redirectToPath: null,
              redirectType: null,
              createdAt: timestamp,
              updatedAt: timestamp,
            });

            if (aliasPath) {
              await tx.insert(pathRegistry).values({
                id: createEntityId("path"),
                siteId,
                path: normalizePath(aliasPath),
                kind: "alias",
                postId: id,
                collectionId: null,
                redirectToPath: null,
                redirectType: null,
                createdAt: timestamp,
                updatedAt: timestamp,
              });
            }

            if (collectionInsertRows.length > 0) {
              const insertQuery = tx
                .insert(threadCollections)
                .values(collectionInsertRows);
              if (data.replyToId) {
                await insertQuery.onConflictDoNothing();
              } else {
                await insertQuery;
              }
            }
          });
        }
      } catch (err) {
        if (err instanceof ConflictError) {
          throw new ConflictError(`Slug "${slug}" is already in use`);
        }
        if (isUniqueConstraintError(err) && (await pathExists(slug))) {
          throw new ConflictError(`Slug "${slug}" is already in use`);
        }
        throw err;
      }

      const post = await this.getById(id);
      if (!post) {
        throw new ConflictError(`Slug "${slug}" could not be resolved`);
      }

      // Bump thread root's lastActivityAt when creating a published reply
      if (data.replyToId && status === "published" && !data.quietReply) {
        await recalculateThreadLastActivity(threadId);
      }

      return post;
    },

    async createWithAttachments(data, attachments, deps, summaryConfig) {
      const attachmentInputs = attachments ?? [];
      const { orderedMediaIds, createdTextMediaIds } =
        await createAttachmentMediaIds(attachmentInputs, deps);

      try {
        const post = await this.create(
          { ...data, attachments: attachmentInputs },
          summaryConfig,
        );

        try {
          if (orderedMediaIds.length > 0) {
            await deps.media.attachToPost(post.id, orderedMediaIds);
          }
          await applyAttachmentAltUpdates(attachmentInputs, deps);

          // Best-effort: fetch and store link preview thumbnail
          await resolveAndStorePreview(
            post.id,
            post.format,
            post.url,
            deps.storage,
          );

          return post;
        } catch (error) {
          await deps.media.attachToPost(post.id, []).catch(() => undefined);
          await this.delete(post.id, {
            media: deps.media,
            storage: deps.storage,
          }).catch(() => undefined);
          await cleanupCreatedTextAttachments(createdTextMediaIds, deps);
          throw error;
        }
      } catch (error) {
        await cleanupCreatedTextAttachments(createdTextMediaIds, deps);
        throw error;
      }
    },

    async createThreadWithAttachments(items, deps, summaryConfig) {
      if (items.length < 2) {
        throw new ValidationError("A thread requires at least 2 posts.");
      }

      const created: Post[] = [];

      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (!item) continue;
        const { data, attachments } = item;
        const prevPost = created[i - 1];
        const postData: CreatePost = {
          ...data,
          // Chain each post as a reply to the previous one (server-side chaining)
          replyToId: i === 0 ? data.replyToId : prevPost?.id,
        };

        try {
          const post = await this.createWithAttachments(
            postData,
            attachments,
            deps,
            summaryConfig,
          );
          created.push(post);
        } catch (error) {
          // Rollback: delete all already-created posts in reverse order
          for (const p of [...created].reverse()) {
            await this.delete(p.id, {
              media: deps.media,
              storage: deps.storage,
            }).catch(() => undefined);
          }
          throw error;
        }
      }

      return created;
    },

    async update(id, data, summaryConfig) {
      const existing = await this.getById(id);
      if (!existing) return null;

      const timestamp = now();
      const nextFormat =
        data.format !== undefined
          ? ensurePostFormat(data.format)
          : existing.format;
      const nextUrl =
        data.url !== undefined ? data.url?.trim() || null : existing.url;
      const nextQuoteText =
        data.quoteText !== undefined
          ? data.quoteText?.trim() || null
          : existing.quoteText;
      const nextStatus =
        data.status !== undefined
          ? ensurePostStatus(data.status)
          : existing.status;
      const nextVisibility =
        data.visibility !== undefined
          ? ensurePostVisibility(data.visibility)
          : undefined;
      const nextRating =
        data.rating !== undefined ? ensurePostRating(data.rating) : undefined;

      const nextTitle =
        data.title !== undefined ? data.title?.trim() || null : existing.title;

      assertPostFormatShape({
        format: nextFormat,
        title: nextTitle,
        body:
          data.body !== undefined || data.bodyMarkdown !== undefined
            ? data.bodyMarkdown
              ? markdownToTiptapJson(data.bodyMarkdown)
              : (data.body ?? null)
            : existing.body,
        url: nextUrl,
        quoteText: nextQuoteText,
        // During update we can't cheaply resolve final attachment state;
        // existing posts already passed creation validation, so we only
        // guard against clearing all text fields here.
        hasAttachments: data.attachments
          ? data.attachments.length > 0
          : undefined,
      });
      assertDraftPublishedAt(nextStatus, data.publishedAt);

      const updates: Partial<typeof posts.$inferInsert> = {
        updatedAt: timestamp,
      };

      // Handle slug change
      const slugChanged =
        data.slug !== undefined && data.slug !== existing.slug;
      if (slugChanged && data.slug) {
        try {
          await resolvedPaths.updatePostSlug(id, data.slug);
        } catch (err) {
          if (err instanceof ConflictError) {
            throw new ConflictError(`Slug "${data.slug}" is already in use`);
          }
          throw err;
        }
      }

      if (data.format !== undefined) updates.format = nextFormat;
      if (data.title !== undefined) updates.title = nextTitle;
      if (data.url !== undefined) updates.url = nextUrl;
      if (data.quoteText !== undefined) updates.quoteText = nextQuoteText;
      if (data.rating !== undefined) updates.rating = nextRating;
      // Prefer explicit timestamp when provided; fall back to boolean shorthand.
      if (data.pinnedAt !== undefined) {
        updates.pinnedAt = data.pinnedAt;
      } else if (data.pinned !== undefined) {
        updates.pinnedAt = data.pinned ? timestamp : null;
      }
      if (data.featuredAt !== undefined) {
        updates.featuredAt = data.featuredAt;
      } else if (data.featured !== undefined) {
        updates.featuredAt = data.featured ? timestamp : null;
      }

      if (data.body !== undefined || data.bodyMarkdown !== undefined) {
        const rawBody = data.bodyMarkdown
          ? markdownToTiptapJson(data.bodyMarkdown)
          : (data.body ?? null);
        const normalizedBody = rawBody ? trimTiptapBody(rawBody) : null;
        updates.body = normalizedBody;
        updates.bodyHtml = normalizedBody
          ? renderTiptapJson(normalizedBody)
          : null;
        updates.bodyText = normalizedBody
          ? extractBodyText(normalizedBody, { includeLinkHrefs: true })
          : null;
      }

      // Recompute summary when body, title, or format change
      if (summaryConfig) {
        const format = nextFormat;
        const title = nextTitle;
        const body =
          data.bodyMarkdown !== undefined
            ? data.bodyMarkdown
              ? markdownToTiptapJson(data.bodyMarkdown)
              : null
            : data.body !== undefined
              ? data.body
              : existing.body;
        if (format === "note" && title && body) {
          updates.summary = extractSummary(
            body,
            summaryConfig.maxParagraphs,
            summaryConfig.maxChars,
          );
        } else {
          updates.summary = null;
        }
      }

      // Thread replies inherit visibility/pinned from root — reject direct changes
      if (isThreadReply(existing)) {
        if (data.visibility !== undefined) {
          throw new ConflictError(
            "Cannot change visibility of a thread reply. Update the root post instead.",
          );
        }
        if (
          (data.pinnedAt !== undefined && data.pinnedAt !== null) ||
          data.pinned === true
        ) {
          throw new ConflictError(
            "Cannot pin a thread reply. Pin the root post instead.",
          );
        }
      }

      // Handle status/visibility change - cascade to thread if this is root
      const statusChanged =
        data.status !== undefined && data.status !== existing.status;
      const visibilityChanged =
        nextVisibility !== undefined && nextVisibility !== existing.visibility;
      const publishedAtChanged = data.publishedAt !== undefined;
      const nextPublishedAt =
        nextStatus === "draft"
          ? null
          : publishedAtChanged
            ? (data.publishedAt ?? timestamp)
            : existing.status === "draft"
              ? timestamp
              : (existing.publishedAt ?? timestamp);

      if (statusChanged) updates.status = nextStatus;
      if (visibilityChanged && !isThreadReply(existing)) {
        updates.visibility = nextVisibility;
      }
      if (statusChanged || publishedAtChanged || existing.status === "draft") {
        updates.publishedAt = nextPublishedAt;
        updates.lastActivityAt = nextPublishedAt ?? timestamp;
      }

      // Build all write queries for atomic execution via D1 batch
      const needsCascade = statusChanged && !isThreadReply(existing);
      const needsReplyVisibilityCleanup =
        !isThreadReply(existing) && (statusChanged || visibilityChanged);
      const needsCollectionSync =
        data.collectionIds !== undefined ||
        data.collectionEntries !== undefined;
      const needsThreadActivityRecalc =
        statusChanged || publishedAtChanged || existing.status === "draft";
      const hasExtraWrites =
        needsCascade || needsReplyVisibilityCleanup || needsCollectionSync;

      if (!hasExtraWrites) {
        // Simple case: only the post update
        const result = await db
          .update(posts)
          .set(updates)
          .where(and(eq(posts.siteId, siteId), eq(posts.id, id)))
          .returning();
        if (needsThreadActivityRecalc) {
          await recalculateThreadLastActivity(existing.threadId);
          return this.getById(id);
        }
        return hydratePost(result[0]);
      }

      // Complex case: cascade + update + Thread collection sync atomically.
      // Retained entries keep their collected/pinned timestamps when a normal
      // collectionIds update only changes selection or ordering.
      const existingThreadCollections = needsCollectionSync
        ? await getThreadCollectionEntries(existing.threadId)
        : new Map<string, { createdAt: number; pinnedAt: number | null }>();
      const collectionTimestamp = now();
      const nextThreadCollectionRows = (() => {
        if (!needsCollectionSync) return [];

        if (data.collectionEntries !== undefined) {
          const seen = new Set<string>();
          return data.collectionEntries.flatMap((entry, index) => {
            if (seen.has(entry.collectionId)) return [];
            seen.add(entry.collectionId);
            const existingEntry = existingThreadCollections.get(
              entry.collectionId,
            );
            return [
              {
                siteId,
                threadId: existing.threadId,
                collectionId: entry.collectionId,
                createdAt:
                  entry.createdAt ??
                  existingEntry?.createdAt ??
                  collectionTimestamp,
                position: entry.position ?? index,
                pinnedAt:
                  entry.pinnedAt !== undefined
                    ? entry.pinnedAt
                    : (existingEntry?.pinnedAt ?? null),
              },
            ];
          });
        }

        return [...new Set(data.collectionIds ?? [])].map(
          (collectionId, index) => {
            const existingEntry = existingThreadCollections.get(collectionId);
            return {
              siteId,
              threadId: existing.threadId,
              collectionId,
              createdAt: existingEntry?.createdAt ?? collectionTimestamp,
              position: index,
              pinnedAt: existingEntry?.pinnedAt ?? null,
            };
          },
        );
      })();
      let updateResult: (typeof posts.$inferSelect)[] | undefined;

      if (usesBatchWrites) {
        const writeQueries = [];

        if (needsCascade) {
          writeQueries.push(
            db
              .update(posts)
              .set({
                status: nextStatus,
                publishedAt:
                  nextStatus === "published" ? nextPublishedAt : null,
                lastActivityAt:
                  nextStatus === "published"
                    ? (nextPublishedAt ?? timestamp)
                    : timestamp,
                updatedAt: timestamp,
              })
              .where(
                and(
                  eq(posts.siteId, siteId),
                  eq(posts.threadId, id),
                  isNotNull(posts.replyToId),
                ),
              ),
          );
        }

        if (needsReplyVisibilityCleanup) {
          writeQueries.push(
            db
              .update(posts)
              .set({ visibility: null, updatedAt: timestamp })
              .where(
                and(
                  eq(posts.siteId, siteId),
                  eq(posts.threadId, id),
                  isNotNull(posts.replyToId),
                ),
              ),
          );
        }

        const updateIdx = writeQueries.length;
        writeQueries.push(
          db
            .update(posts)
            .set(updates)
            .where(and(eq(posts.siteId, siteId), eq(posts.id, id)))
            .returning(),
        );

        if (needsCollectionSync) {
          // Delete all and re-insert the one shared Thread membership set.
          writeQueries.push(
            db
              .delete(threadCollections)
              .where(
                and(
                  eq(threadCollections.siteId, siteId),
                  eq(threadCollections.threadId, existing.threadId),
                ),
              ),
          );

          if (nextThreadCollectionRows.length > 0) {
            writeQueries.push(
              db.insert(threadCollections).values(nextThreadCollectionRows),
            );
          }
        }

        const results = await db.batch(
          writeQueries as [
            (typeof writeQueries)[number],
            ...(typeof writeQueries)[number][],
          ],
        );
        updateResult = results[updateIdx] as
          | (typeof posts.$inferSelect)[]
          | undefined;
      } else {
        await db.transaction(async (tx) => {
          if (needsCascade) {
            await tx
              .update(posts)
              .set({
                status: nextStatus,
                publishedAt:
                  nextStatus === "published" ? nextPublishedAt : null,
                lastActivityAt:
                  nextStatus === "published"
                    ? (nextPublishedAt ?? timestamp)
                    : timestamp,
                updatedAt: timestamp,
              })
              .where(
                and(
                  eq(posts.siteId, siteId),
                  eq(posts.threadId, id),
                  isNotNull(posts.replyToId),
                ),
              );
          }

          if (needsReplyVisibilityCleanup) {
            await tx
              .update(posts)
              .set({ visibility: null, updatedAt: timestamp })
              .where(
                and(
                  eq(posts.siteId, siteId),
                  eq(posts.threadId, id),
                  isNotNull(posts.replyToId),
                ),
              );
          }

          updateResult = await tx
            .update(posts)
            .set(updates)
            .where(and(eq(posts.siteId, siteId), eq(posts.id, id)))
            .returning();

          if (needsCollectionSync) {
            // Delete all and re-insert the one shared Thread membership set.
            await tx
              .delete(threadCollections)
              .where(
                and(
                  eq(threadCollections.siteId, siteId),
                  eq(threadCollections.threadId, existing.threadId),
                ),
              );

            if (nextThreadCollectionRows.length > 0) {
              await tx
                .insert(threadCollections)
                .values(nextThreadCollectionRows);
            }
          }
        });
      }

      if (needsThreadActivityRecalc) {
        await recalculateThreadLastActivity(existing.threadId);
        return this.getById(id);
      }
      return hydratePost(updateResult?.[0]);
    },

    async updateWithAttachments(id, data, attachments, deps, summaryConfig) {
      if (attachments === undefined) {
        const existing = await this.getById(id);
        const post = await this.update(id, data, summaryConfig);
        if (post && existing) {
          const urlChanged =
            data.url !== undefined && data.url !== existing.url;
          const formatChanged =
            data.format !== undefined && data.format !== existing.format;
          if (urlChanged || formatChanged) {
            await deletePreviewImage(existing.previewImageKey, deps.storage);
            await db
              .update(posts)
              .set({
                previewImageKey: null,
                previewKind: null,
                previewProvider: null,
              })
              .where(and(eq(posts.siteId, siteId), eq(posts.id, post.id)));
            await resolveAndStorePreview(
              post.id,
              post.format,
              post.url,
              deps.storage,
            );
          }
        }
        return post;
      }

      const existingPost = await this.getById(id);
      if (!existingPost) return null;

      const existingCollectionIds = await getCollectionIdsForThread(
        existingPost.threadId,
      );
      const rollbackData = buildRollbackUpdate(
        existingPost,
        existingCollectionIds,
      );
      const existingAttachments = await deps.media.getByPostId(id);
      const previousMediaIds = existingAttachments.map(
        (attachment) => attachment.id,
      );
      const previousAltMap = new Map(
        existingAttachments.map((attachment) => [
          attachment.id,
          attachment.alt ?? "",
        ]),
      );
      const { orderedMediaIds, createdTextMediaIds } =
        await createAttachmentMediaIds(attachments, deps);
      const post = await this.update(id, data, summaryConfig);

      if (!post) {
        await cleanupCreatedTextAttachments(createdTextMediaIds, deps);
        return null;
      }

      let replacedAttachments = false;

      try {
        await deps.media.attachToPost(post.id, orderedMediaIds);
        replacedAttachments = true;
        await applyAttachmentAltUpdates(attachments, deps);

        const nextAttachmentIds = new Set(orderedMediaIds);
        const removedAttachmentIds = existingAttachments
          .filter((attachment) => !nextAttachmentIds.has(attachment.id))
          .map((attachment) => attachment.id);
        await deps.media
          .deleteByIds(removedAttachmentIds, deps.storage)
          .catch(() => undefined);

        // Best-effort: update link preview when URL changes
        const urlChanged =
          data.url !== undefined && data.url !== existingPost.url;
        const formatChanged =
          data.format !== undefined && data.format !== existingPost.format;
        if (urlChanged || formatChanged) {
          // Clean up old preview image
          await deletePreviewImage(existingPost.previewImageKey, deps.storage);

          // Clear preview fields first (may be re-set by resolveAndStorePreview)
          await db
            .update(posts)
            .set({
              previewImageKey: null,
              previewKind: null,
              previewProvider: null,
            })
            .where(and(eq(posts.siteId, siteId), eq(posts.id, post.id)));

          // Fetch new preview if applicable
          await resolveAndStorePreview(
            post.id,
            post.format,
            post.url,
            deps.storage,
          );
        }

        return post;
      } catch (error) {
        if (replacedAttachments) {
          await deps.media
            .attachToPost(post.id, previousMediaIds)
            .catch(() => undefined);
          await Promise.all(
            existingAttachments.map((attachment) =>
              deps.media.updateAlt(
                attachment.id,
                previousAltMap.get(attachment.id) ?? "",
              ),
            ),
          ).catch(() => undefined);
        }
        await this.update(id, rollbackData, summaryConfig).catch(
          () => undefined,
        );
        await cleanupCreatedTextAttachments(createdTextMediaIds, deps);
        throw error;
      }
    },

    async delete(id, deps) {
      const existing = await this.getById(id);
      if (!existing) return false;

      const isRoot = !isThreadReply(existing);
      const affectedPosts: Post[] = isRoot
        ? await this.getThread(id)
        : [existing];

      // Clean up media and preview images
      if (deps?.media) {
        const mediaMap = await deps.media.getByPostIds(
          affectedPosts.map((p) => p.id),
        );
        const allMedia = [...mediaMap.values()].flat();
        if (allMedia.length > 0) {
          await deps.media.deleteByIds(
            allMedia.map((m) => m.id),
            deps.storage,
          );
        }

        for (const p of affectedPosts) {
          await deletePreviewImage(p.previewImageKey, deps.storage);
        }
      }

      if (isRoot) {
        // Delete the entire thread atomically. SQLite/D1's self-referential
        // FK on thread_id triggers a violation when the root is removed (its
        // own thread_id points to itself), so wrap the cascade in a
        // transaction with PRAGMA defer_foreign_keys to push the FK check to
        // commit time, by which point every referencing row is gone too.
        if (databaseDialect === "pg") {
          await db.transaction(async (tx) => {
            await tx
              .delete(posts)
              .where(and(eq(posts.siteId, siteId), eq(posts.threadId, id)));
          });
        } else {
          await db.batch([
            db.run(sql`PRAGMA defer_foreign_keys = ON`),
            db
              .delete(posts)
              .where(and(eq(posts.siteId, siteId), eq(posts.threadId, id))),
          ]);
        }
      } else {
        // Re-parent any direct children of this reply onto its own parent so
        // the thread chain stays connected after the reply is removed.
        await db
          .update(posts)
          .set({ replyToId: existing.replyToId })
          .where(and(eq(posts.siteId, siteId), eq(posts.replyToId, id)));
        await db
          .delete(posts)
          .where(and(eq(posts.siteId, siteId), eq(posts.id, id)));
        await recalculateThreadLastActivity(existing.threadId);
      }

      return true;
    },

    async deleteThreadDraft(id, deps) {
      return this.delete(id, deps);
    },

    async getThread(rootId) {
      const rows = await db
        .select()
        .from(posts)
        .where(and(eq(posts.siteId, siteId), eq(posts.threadId, rootId)))
        .orderBy(posts.createdAt, posts.id);

      return hydratePosts(rows);
    },

    async updateThreadStatusAndVisibility(rootId, status, visibility) {
      const nextStatus = ensurePostStatus(status);
      const nextVisibility = ensurePostVisibility(visibility);
      const timestamp = now();
      if (usesBatchWrites) {
        await db.batch([
          db
            .update(posts)
            .set({
              status: nextStatus,
              visibility: nextVisibility,
              publishedAt: nextStatus === "published" ? timestamp : null,
              lastActivityAt: timestamp,
              updatedAt: timestamp,
            })
            .where(and(eq(posts.siteId, siteId), eq(posts.id, rootId))),
          db
            .update(posts)
            .set({
              status: nextStatus,
              visibility: null,
              publishedAt: nextStatus === "published" ? timestamp : null,
              lastActivityAt: timestamp,
              updatedAt: timestamp,
            })
            .where(
              and(
                eq(posts.siteId, siteId),
                eq(posts.threadId, rootId),
                isNotNull(posts.replyToId),
              ),
            ),
        ]);
      } else {
        await db.transaction(async (tx) => {
          await tx
            .update(posts)
            .set({
              status: nextStatus,
              visibility: nextVisibility,
              publishedAt: nextStatus === "published" ? timestamp : null,
              lastActivityAt: timestamp,
              updatedAt: timestamp,
            })
            .where(and(eq(posts.siteId, siteId), eq(posts.id, rootId)));

          await tx
            .update(posts)
            .set({
              status: nextStatus,
              visibility: null,
              publishedAt: nextStatus === "published" ? timestamp : null,
              lastActivityAt: timestamp,
              updatedAt: timestamp,
            })
            .where(
              and(
                eq(posts.siteId, siteId),
                eq(posts.threadId, rootId),
                isNotNull(posts.replyToId),
              ),
            );
        });
      }
      await recalculateThreadLastActivity(rootId);
    },

    async getReplyCounts(postIds) {
      if (postIds.length === 0) return new Map();

      const rows = await db
        .select({
          threadId: posts.threadId,
          count: sql<number>`CAST(count(*) AS INTEGER)`.as("count"),
        })
        .from(posts)
        .where(
          and(
            eq(posts.siteId, siteId),
            inArray(posts.threadId, postIds),
            eq(posts.status, "published"),
            isNotNull(posts.replyToId),
          ),
        )
        .groupBy(posts.threadId);

      const counts = new Map<string, number>();
      for (const row of rows) {
        counts.set(row.threadId, row.count);
      }
      return counts;
    },

    async getThreadPreviews(rootIds, previewCount = 3) {
      if (rootIds.length === 0) return new Map();

      const rankedReplies = db
        .select({
          id: posts.id,
          threadId: posts.threadId,
          createdAt: posts.createdAt,
          previewRank: sql<number>`CAST(ROW_NUMBER() OVER (
            PARTITION BY ${posts.threadId}
            ORDER BY ${posts.createdAt}, ${posts.id}
          ) AS INTEGER)`.as("preview_rank"),
        })
        .from(posts)
        .where(
          and(
            eq(posts.siteId, siteId),
            inArray(posts.threadId, rootIds),
            eq(posts.status, "published"),
            isNotNull(posts.replyToId),
          ),
        )
        .as("ranked_replies");

      const rankedRows = await db
        .select({
          id: rankedReplies.id,
          threadId: rankedReplies.threadId,
          createdAt: rankedReplies.createdAt,
        })
        .from(rankedReplies)
        .where(lte(rankedReplies.previewRank, previewCount))
        .orderBy(
          rankedReplies.threadId,
          rankedReplies.createdAt,
          rankedReplies.id,
        );

      const hydratedPosts = await hydratePostsById(
        rankedRows.map((row) => row.id),
      );
      const result = new Map<string, Post[]>();
      for (const row of rankedRows) {
        const post = hydratedPosts.get(row.id);
        if (!post) continue;

        const list = result.get(row.threadId);
        if (list) {
          list.push(post);
          continue;
        }

        result.set(row.threadId, [post]);
      }
      return result;
    },

    async getThreadTimelineContext(rootIds) {
      if (rootIds.length === 0) return new Map();

      const rankedReplies = db
        .select({
          id: posts.id,
          threadId: posts.threadId,
          firstReplyRank: sql<number>`CAST(ROW_NUMBER() OVER (
            PARTITION BY ${posts.threadId}
            ORDER BY ${posts.createdAt}, ${posts.id}
          ) AS INTEGER)`.as("first_reply_rank"),
          latestReplyRank: sql<number>`CAST(ROW_NUMBER() OVER (
            PARTITION BY ${posts.threadId}
            ORDER BY ${posts.createdAt} DESC, ${posts.id} DESC
          ) AS INTEGER)`.as("latest_reply_rank"),
          totalReplyCount: sql<number>`CAST(COUNT(*) OVER (
            PARTITION BY ${posts.threadId}
          ) AS INTEGER)`.as("total_reply_count"),
        })
        .from(posts)
        .where(
          and(
            eq(posts.siteId, siteId),
            inArray(posts.threadId, rootIds),
            eq(posts.status, "published"),
            isNotNull(posts.replyToId),
          ),
        )
        .as("ranked_replies");

      const contextRows = await db
        .select({
          threadId: rankedReplies.threadId,
          id: rankedReplies.id,
          firstReplyRank: rankedReplies.firstReplyRank,
          latestReplyRank: rankedReplies.latestReplyRank,
          totalReplyCount: rankedReplies.totalReplyCount,
        })
        .from(rankedReplies)
        .where(
          or(
            lte(rankedReplies.firstReplyRank, 2),
            lte(rankedReplies.latestReplyRank, 3),
          ),
        );

      const hydratedPosts = await hydratePostsById(
        contextRows.map((row) => row.id),
      );

      const contextByThreadId = new Map<
        string,
        {
          leadingReplyIds: Map<number, string>;
          trailingReplyIds: Map<number, string>;
          latestReplyId: string | null;
          totalReplyCount: number;
        }
      >();
      for (const row of contextRows) {
        const existing = contextByThreadId.get(row.threadId) ?? {
          leadingReplyIds: new Map<number, string>(),
          trailingReplyIds: new Map<number, string>(),
          latestReplyId: null,
          totalReplyCount: row.totalReplyCount,
        };

        if (row.firstReplyRank <= 2) {
          existing.leadingReplyIds.set(row.firstReplyRank, row.id);
        }
        if (row.latestReplyRank === 2 || row.latestReplyRank === 3) {
          existing.trailingReplyIds.set(row.latestReplyRank, row.id);
        }
        if (row.latestReplyRank === 1) {
          existing.latestReplyId = row.id;
        }

        contextByThreadId.set(row.threadId, existing);
      }

      const result = new Map<string, ThreadTimelineContext>();
      for (const [threadId, context] of contextByThreadId) {
        if (!context.latestReplyId) continue;

        const latestReply = hydratedPosts.get(context.latestReplyId);
        if (!latestReply) continue;

        const hydrateReplyIds = (ids: Array<string | undefined>) =>
          ids
            .map((id) => (id ? hydratedPosts.get(id) : undefined))
            .filter((post): post is Post => post !== undefined);

        result.set(threadId, {
          leadingReplies: hydrateReplyIds([
            context.leadingReplyIds.get(1),
            context.leadingReplyIds.get(2),
          ]),
          trailingReplies: hydrateReplyIds([
            context.trailingReplyIds.get(3),
            context.trailingReplyIds.get(2),
          ]),
          latestReply,
          totalReplyCount: context.totalReplyCount,
        });
      }

      return result;
    },

    async countFeaturedThreadRoots(options = {}) {
      const conditions = [
        ...buildThreadRootPageConditions(options),
        isNotNull(posts.featuredAt),
      ];

      const rows = await db
        .select({
          count:
            sql<number>`CAST(count(distinct ${posts.threadId}) AS INTEGER)`.as(
              "count",
            ),
        })
        .from(posts)
        .where(and(...conditions));

      return rows[0]?.count ?? 0;
    },

    async listFeaturedThreadRootIds(options = {}) {
      const conditions = [
        ...buildThreadRootPageConditions(options),
        isNotNull(posts.featuredAt),
      ];
      const latestFeaturedPublishedAt =
        sql<number>`MAX(${posts.publishedAt})`.as(
          "latest_featured_published_at",
        );

      let query = db
        .select({
          threadId: posts.threadId,
          latestFeaturedPublishedAt,
        })
        .from(posts)
        .where(and(...conditions))
        .groupBy(posts.threadId)
        .orderBy(desc(latestFeaturedPublishedAt), desc(posts.threadId));

      if (options.limit !== undefined) {
        query = query.limit(options.limit) as typeof query;
      }
      if (options.offset !== undefined) {
        query = query.offset(options.offset) as typeof query;
      }

      const rows = await query;
      return rows.map((row) => row.threadId);
    },

    async getFeaturedThreadTimelineData(rootIds) {
      const result = new Map<string, FeaturedThreadTimelineData>();
      if (rootIds.length === 0) return result;

      const uniqueRootIds = [...new Set(rootIds)];
      const threadPosition = sql<number>`CAST(
        row_number() OVER (
          PARTITION BY ${posts.threadId}
          ORDER BY ${posts.createdAt}, ${posts.id}
        ) - 1 AS INTEGER
      )`.as("thread_position");
      const threadPostCount = sql<number>`CAST(
        count(*) OVER (PARTITION BY ${posts.threadId}) AS INTEGER
      )`.as("thread_post_count");

      const rankedPosts = db
        .select({
          ...getTableColumns(posts),
          threadPosition,
          threadPostCount,
        })
        .from(posts)
        .where(
          and(
            eq(posts.siteId, siteId),
            inArray(posts.threadId, uniqueRootIds),
            eq(posts.status, "published"),
          ),
        )
        .as("ranked_featured_thread_post");

      const rows = await db
        .select()
        .from(rankedPosts)
        .where(
          or(
            eq(rankedPosts.id, rankedPosts.threadId),
            isNotNull(rankedPosts.featuredAt),
            sql`${rankedPosts.threadPosition} = ${rankedPosts.threadPostCount} - 1`,
          ),
        )
        .orderBy(rankedPosts.threadId, sql`${rankedPosts.threadPosition}`);

      const hydratedPosts = await hydratePosts(
        rows.map(
          ({ threadPosition: _position, threadPostCount: _count, ...row }) =>
            row,
        ),
      );
      const hydratedById = new Map(
        hydratedPosts.map((post) => [post.id, post]),
      );

      for (const row of rows) {
        const post = hydratedById.get(row.id);
        if (!post) continue;

        const thread = result.get(row.threadId) ?? {
          posts: [],
          featuredPostIds: [],
        };
        thread.posts.push({ post, position: row.threadPosition });
        if (row.featuredAt !== null) {
          thread.featuredPostIds.push(row.id);
        }
        result.set(row.threadId, thread);
      }

      return result;
    },

    async countCollectionThreadRoots(collectionId, options = {}) {
      return this.countCollectionThreadRootsForCollections(
        [collectionId],
        options,
      );
    },

    async countCollectionThreadRootsForCollections(
      collectionIds,
      options = {},
    ) {
      const conditions = [
        ...buildThreadRootPageConditions(options),
        buildCollectionMembershipCondition(collectionIds),
      ];

      const rows = await db
        .select({
          count:
            sql<number>`CAST(count(distinct ${posts.threadId}) AS INTEGER)`.as(
              "count",
            ),
        })
        .from(posts)
        .innerJoin(
          threadCollections,
          and(
            eq(threadCollections.siteId, posts.siteId),
            eq(threadCollections.threadId, posts.threadId),
          ),
        )
        .where(and(...conditions));

      return rows[0]?.count ?? 0;
    },

    async countCollectionThreadRootsUpToForCollections(
      collectionIds,
      options = {},
      limit,
    ) {
      const normalizedLimit = Math.max(0, Math.trunc(limit));
      if (normalizedLimit === 0) return 0;

      const conditions = [
        ...buildThreadRootPageConditions(options),
        buildCollectionMembershipCondition(collectionIds),
      ];
      const rows = await db
        .select({ threadId: posts.threadId })
        .from(posts)
        .innerJoin(
          threadCollections,
          and(
            eq(threadCollections.siteId, posts.siteId),
            eq(threadCollections.threadId, posts.threadId),
          ),
        )
        .where(and(...conditions))
        .groupBy(posts.threadId)
        .limit(normalizedLimit);

      return rows.length;
    },

    async listCollectionThreadRootIds(collectionId, options = {}) {
      return this.listCollectionThreadRootIdsForCollections(
        [collectionId],
        options,
      );
    },

    async listCollectionThreadRootIdsForCollections(
      collectionIds,
      options = {},
    ) {
      const { sortOrder, sortedThreads } = buildCollectionThreadSortQuery(
        collectionIds,
        options,
      );
      let cursorCondition: SQL<unknown> | undefined;

      if (options.cursor) {
        const cursorRows = await db
          .select()
          .from(sortedThreads)
          .where(eq(sortedThreads.threadId, options.cursor))
          .limit(1);
        const cursorRow = cursorRows[0];
        if (!cursorRow) return [];

        const pinnedKey: CursorSortKey = {
          direction: "desc",
          expr: sortedThreads.collectionPinnedAt,
          value: cursorRow.collectionPinnedAt,
        };

        cursorCondition =
          sortOrder === "oldest"
            ? buildLexicographicCursorCondition([
                pinnedKey,
                {
                  direction: "asc",
                  expr: sortedThreads.publishedAt,
                  value: cursorRow.publishedAt,
                },
                {
                  direction: "asc",
                  expr: sortedThreads.threadId,
                  value: cursorRow.threadId,
                },
              ])
            : sortOrder === "rating_desc"
              ? buildLexicographicCursorCondition([
                  pinnedKey,
                  {
                    direction: "desc",
                    expr: sortedThreads.ratingPresence,
                    value: cursorRow.ratingPresence,
                  },
                  {
                    direction: "desc",
                    expr: sortedThreads.ratingValue,
                    value: cursorRow.ratingValue,
                  },
                  {
                    direction: "desc",
                    expr: sortedThreads.threadActivityAt,
                    value: cursorRow.threadActivityAt,
                  },
                  {
                    direction: "desc",
                    expr: sortedThreads.threadId,
                    value: cursorRow.threadId,
                  },
                ])
              : buildLexicographicCursorCondition([
                  pinnedKey,
                  {
                    direction: "desc",
                    expr: sortedThreads.threadActivityAt,
                    value: cursorRow.threadActivityAt,
                  },
                  {
                    direction: "desc",
                    expr: sortedThreads.threadId,
                    value: cursorRow.threadId,
                  },
                ]);
      }

      const baseQuery = db.select().from(sortedThreads).where(cursorCondition);

      let query =
        sortOrder === "oldest"
          ? baseQuery.orderBy(
              desc(sortedThreads.collectionPinnedAt),
              asc(sortedThreads.publishedAt),
              asc(sortedThreads.threadId),
            )
          : sortOrder === "rating_desc"
            ? baseQuery.orderBy(
                desc(sortedThreads.collectionPinnedAt),
                desc(sortedThreads.ratingPresence),
                desc(sortedThreads.ratingValue),
                desc(sortedThreads.threadActivityAt),
                desc(sortedThreads.threadId),
              )
            : baseQuery.orderBy(
                desc(sortedThreads.collectionPinnedAt),
                desc(sortedThreads.threadActivityAt),
                desc(sortedThreads.threadId),
              );

      if (options.limit !== undefined) {
        query = query.limit(options.limit) as typeof query;
      }
      if (options.offset !== undefined) {
        query = query.offset(options.offset) as typeof query;
      }

      const rows = await query;
      return rows.map((row) => row.threadId);
    },

    async listCollectionThreadRootsForCollections(collectionIds, options = {}) {
      const rootIds = await this.listCollectionThreadRootIdsForCollections(
        collectionIds,
        options,
      );
      const rootsById = await hydratePostsById(rootIds);
      return rootIds.flatMap((rootId) => {
        const root = rootsById.get(rootId);
        return root ? [root] : [];
      });
    },

    async listCollectionFeedEntries(collectionId, options = {}) {
      return this.listCollectionFeedEntriesForCollections(
        [collectionId],
        options,
      );
    },

    async listCollectionFeedEntriesForCollections(collectionIds, options = {}) {
      const conditions = [
        ...buildThreadRootPageConditions(options),
        buildCollectionMembershipCondition(collectionIds),
      ];
      const threadActivityAt =
        buildCollectionThreadActivityExpr("thread_activity_at");
      const collectedAt = sql<number>`MAX(${threadCollections.createdAt})`.as(
        "collected_at",
      );
      const collectionPinnedAt =
        sql<number>`MAX(coalesce(${threadCollections.pinnedAt}, -1))`.as(
          "collection_pinned_at",
        );
      const pinnedOrder = options.ignoreCollectionPinnedSort
        ? []
        : [desc(collectionPinnedAt)];

      let query = db
        .select({
          threadId: posts.threadId,
          threadActivityAt,
          collectedAt,
          collectionPinnedAt,
        })
        .from(posts)
        .innerJoin(
          threadCollections,
          and(
            eq(threadCollections.siteId, posts.siteId),
            eq(threadCollections.threadId, posts.threadId),
          ),
        )
        .where(and(...conditions))
        .groupBy(posts.threadId)
        .orderBy(...pinnedOrder, desc(threadActivityAt), desc(posts.threadId));

      if (options.limit !== undefined) {
        query = query.limit(options.limit) as typeof query;
      }
      if (options.offset !== undefined) {
        query = query.offset(options.offset) as typeof query;
      }

      const rows = await query;
      const postsById = await hydratePostsById(rows.map((row) => row.threadId));

      return rows.flatMap((row) => {
        const post = postsById.get(row.threadId);
        return post ? [{ post, collectedAt: row.collectedAt }] : [];
      });
    },

    async getPublishedThreads(rootIds) {
      const result = new Map<string, Post[]>();
      if (rootIds.length === 0) return result;

      const unique = [...new Set(rootIds)];
      const rows = await db
        .select()
        .from(posts)
        .where(
          and(
            eq(posts.siteId, siteId),
            inArray(posts.threadId, unique),
            eq(posts.status, "published"),
          ),
        )
        .orderBy(posts.threadId, posts.createdAt, posts.id);

      for (const post of await hydratePosts(rows)) {
        const thread = result.get(post.threadId);
        if (thread) {
          thread.push(post);
        } else {
          result.set(post.threadId, [post]);
        }
      }

      return result;
    },

    async getLastPostIdsByThread(threadIds) {
      const result = new Map<string, string>();
      if (threadIds.length === 0) return result;

      const unique = [...new Set(threadIds)];
      const rows = await db
        .select({
          threadId: posts.threadId,
          id: posts.id,
        })
        .from(posts)
        .where(
          and(
            eq(posts.siteId, siteId),
            inArray(posts.threadId, unique),
            eq(posts.status, "published"),
          ),
        )
        .orderBy(posts.threadId, desc(posts.createdAt), desc(posts.id));

      for (const row of rows) {
        if (!result.has(row.threadId)) {
          result.set(row.threadId, row.id);
        }
      }
      return result;
    },

    async getDistinctYears(filters = {}) {
      const conditions = [
        ...buildFilterConditions(filters),
        isNotNull(posts.publishedAt),
      ];
      const publishedYearExpr = buildPublishedYearExpr();

      const rows = await db
        .select({
          year: publishedYearExpr.as("year"),
        })
        .from(posts)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .groupBy(publishedYearExpr)
        .orderBy(desc(publishedYearExpr));

      return rows.map((r) => parseInt(r.year, 10));
    },

    async reindexBodyText(options = {}) {
      const requested = options.limit ?? 50;
      const limit = Math.min(Math.max(Math.trunc(requested), 1), 500);
      const cursor = options.cursor;

      const whereConditions = [eq(posts.siteId, siteId)];
      if (cursor) whereConditions.push(gt(posts.id, cursor));

      // Fetch one extra row to detect end-of-data without a separate COUNT.
      const rows = await db
        .select({
          id: posts.id,
          body: posts.body,
          bodyText: posts.bodyText,
        })
        .from(posts)
        .where(and(...whereConditions))
        .orderBy(asc(posts.id))
        .limit(limit + 1);

      const hasMore = rows.length > limit;
      const batch = hasMore ? rows.slice(0, limit) : rows;

      let updated = 0;
      let skipped = 0;

      for (const row of batch) {
        const nextBodyText = row.body
          ? extractBodyText(row.body, { includeLinkHrefs: true })
          : null;
        if (nextBodyText === row.bodyText) {
          skipped++;
          continue;
        }
        await db
          .update(posts)
          .set({ bodyText: nextBodyText })
          .where(and(eq(posts.siteId, siteId), eq(posts.id, row.id)));
        updated++;
      }

      const lastRow = batch.at(-1);
      const lastId = lastRow ? lastRow.id : null;

      return {
        processed: batch.length,
        updated,
        skipped,
        nextCursor: hasMore ? lastId : null,
        done: !hasMore,
      };
    },
  };
}
