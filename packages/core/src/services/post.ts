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
  notInArray,
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
import {
  buildRootActivityExpr,
  rootActivityColumns,
} from "../db/thread-activity.js";
import { buildReaderVisibilityConditions } from "../db/post-visibility.js";
import { createEntityId } from "../lib/ids.js";
import { now } from "../lib/time.js";
import { trimTiptapBody } from "../lib/tiptap-render.js";
import {
  POST_BODY_HTML_VERSION,
  renderPostBodyHtml,
  resolvePostBodyHtml,
  tryPreparePostBodyHtml,
} from "../lib/post-body-html.js";
import { extractSummary, extractBodyText } from "../lib/summary.js";
import { markdownToTiptapJson } from "../lib/markdown-to-tiptap.js";
import { tiptapJsonToMarkdown } from "../lib/tiptap-to-markdown.js";
import { generatePostSlug } from "../lib/slug.js";
import { getSlugValidationIssue } from "../lib/slug-format.js";
import { isReservedPath } from "../lib/constants.js";
import { normalizePath } from "../lib/url.js";
import { slugify } from "../lib/slugify.js";
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
import {
  isValidContentLanguage,
  normalizeContentLanguage,
  toLanguagePrefix,
} from "../i18n/locales.js";
import { readLanguageSettings } from "./language.js";
import { getOrBuildEntry } from "../i18n/supported-locales.js";
import { suggestPostLanguage } from "../lib/lang-detect.js";
import { createPathService, type PathService } from "./path.js";
import {
  extractYouTubeVideoId,
  getYouTubeThumbnailUrls,
} from "../lib/youtube.js";
import { getPreviewStorageKey } from "../lib/upload.js";
import { generateRandomId } from "../lib/nanoid.js";
import { resolveSummaryConfig } from "../lib/resolve-config.js";
import type { Bindings } from "../types/bindings.js";
import type { SettingsService } from "./settings.js";

/** Dependencies for operations that coordinate with other services */
export interface PostDeleteDeps {
  media: MediaService;
  storage?: StorageDriver | null;
}

export interface RebuildBodyHtmlOptions {
  /** Batch size (1..100, default 50). */
  limit?: number;
  /** Exclusive post ID cursor. */
  cursor?: string;
  /** Compute and report changes without writing them. */
  dryRun?: boolean;
  /** Summary settings used only when a canonical legacy body is upgraded. */
  summaryConfig?: SummaryConfig;
}

export interface RebuildBodyHtmlResult {
  processed: number;
  wouldRebuild: number;
  rebuilt: number;
  wouldUpgradeFootnotes: number;
  upgradedFootnotes: number;
  skipped: number;
  conflicted: number;
  failed: number;
  failures: Array<{ postId: string; error: string }>;
  nextCursor: string | null;
  done: boolean;
  targetVersion: number;
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
  /**
   * Unix timestamp (inclusive) — range filter on whichever column `sortBy`
   * selects. Kept separate from `publishedAfter` so a caller can pin a
   * publication window (the RSS delay) and still filter on the sort axis.
   */
  axisAfter?: number;
  /** Unix timestamp (exclusive) — upper bound on the `sortBy` column */
  axisBefore?: number;
  /** Media kinds to filter by (OR logic: post has media of ANY selected kind). */
  mediaKinds?: MediaKind[];
  /**
   * Restrict to one BCP 47 content language (canonical form, matched exactly).
   *
   * A plain column predicate is correct at every grain because `post.language`
   * is uniform across a Thread — replies inherit the Root's value and a
   * language change rewrites the whole Thread. It rides along as a residual
   * predicate on the existing hot-path partial indexes rather than getting its
   * own index; see the multilingual design notes for the upgrade path.
   */
  lang?: string;
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
  /**
   * Time axis for chronological queries (defaults to announced activity).
   *
   * - `activity` — `lastActivityAt`: last announced post. Quiet replies do not
   *   move it. Latest and the feeds use this.
   * - `thread_updated` — `threadUpdatedAt`: last post of any kind, quiet
   *   included. The archive's updated sort uses this.
   * - `published` — when the Thread root itself was published.
   *
   * Selects the column used for sorting **and** for the year/month bucketing
   * done by `countByYearMonth` and `getDistinctYears`, so a caller that groups
   * its results cannot end up with buckets that disagree with the order.
   */
  sortBy?: "activity" | "thread_updated" | "published";
  /** Ignore global pinned ordering when results must remain chronological. */
  ignorePinnedSort?: boolean;
  limit?: number;
  cursor?: string;
  offset?: number; // offset for page-based pagination
}

/** What one filter measured over a set of Posts. See `aggregateMany`. */
export interface PostFilterAggregate {
  count: number;
  /** Newest activity among the matched rows; `null` when nothing matched. */
  recentActivityAt: number | null;
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
  /** See `PostFilters.lang`. */
  lang?: string;
  /** Exclude Posts published at or after this Unix timestamp. */
  publishedBefore?: number;
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
  /** Content language, when the post has one. */
  language: string | null;
  /** Translation group, used to emit sitemap `hreflang` alternates. */
  translationGroupId: string | null;
}

/**
 * What an address the author pasted turned out to be, for the one question the
 * translation picker asks: can this Thread be linked to that one?
 *
 * Every "no" carries which one it is, because the author is looking at a page
 * they know exists and needs to be told what is wrong with it, not that the
 * search found nothing.
 */
export type TranslationCandidateResolution =
  /** Linkable: the Thread root the address names. */
  | { status: "ok"; post: Post }
  /** No page at that address — a typo, or something since deleted. */
  | { status: "not_found" }
  /** A real page, but a collection or an archive rather than a Post. */
  | { status: "not_a_post" }
  /** The Thread the author is already linking from. */
  | { status: "same_thread" }
  | { status: "unpublished" }
  /** Nothing to translate between until it has a language. */
  | { status: "no_language" }
  /** Written in the same language as this Thread. */
  | { status: "same_language" }
  /** A Thread already linked here speaks for that language. */
  | { status: "language_taken"; language: string }
  /** Both sides carry a group; linking would silently merge them. */
  | { status: "group_conflict" }
  /** Its group already holds this Thread's language. */
  | { status: "group_language_taken"; language: string };

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
  /**
   * Measure several filters at once, in a single round trip.
   *
   * One table scan with one `SUM(CASE …)` and one `MAX(CASE …)` per filter,
   * rather than one query per filter. On Workers the round trip is the cost
   * that matters, and a page that lists twenty smart collections would
   * otherwise pay twenty of them — `Promise.all` only turns "slow in sequence"
   * into "expensive in parallel".
   *
   * Every predicate is built by the same `buildFilterConditions` a single
   * `count` uses, so the numbers here and the numbers on the pages they link to
   * cannot drift.
   *
   * `recentActivityAt` is the newest activity among the matched rows, on the
   * one definition {@link buildRootActivityExpr} holds for everything that
   * orders or dates a Thread. It reads the matched row's own columns, so it
   * describes a Thread only when `base` excludes replies — which is what every
   * caller does, because a reply is not a member of anything.
   *
   * @param filters - One filter per measurement, in order
   * @param base - Applied to every measurement: the site, the reader's
   *   visibility floor, and anything else common to all of them
   * @returns Count and newest activity, positionally matching `filters`;
   *   `recentActivityAt` is `null` where nothing matched
   * @example
   * await posts.aggregateMany([{ format: "note" }, { format: "quote" }], base);
   * // [{ count: 12, recentActivityAt: 1706100000 }, { count: 5, … }]
   */
  aggregateMany(
    filters: readonly PostFilters[],
    base: PostFilters,
  ): Promise<PostFilterAggregate[]>;
  /** Count posts grouped by year-month (YYYY-MM) on the `sortBy` time axis */
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
   * When the first item quietly extends an existing thread, the quiet behavior
   * applies to every new reply in the batch.
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
  /**
   * 1-based position of a Post in the reply chain running from its Thread root
   * down to it: a root is 1, a reply to it is 2, a reply to that is 3.
   *
   * Threads are stored as a tree (`replyToId`) flattened under one `threadId`,
   * so this is the Post's depth, not how many Posts the Thread holds — two
   * replies to the same parent are both at the same position.
   *
   * @param postId - TypeID of the Post to locate
   * @returns The 1-based position, or 0 when no such Post exists
   * @example
   * // Root -> reply -> reply, asked about the last one
   * await posts.getThreadPosition(lastId); // => 3
   */
  getThreadPosition(postId: string): Promise<number>;
  updateThreadStatusAndVisibility(
    rootId: string,
    status: Status,
    visibility: Visibility,
  ): Promise<void>;
  /**
   * Set the content language of a whole Thread (root and every reply).
   *
   * Thread-wide by design: `post.language` is uniform inside a Thread, which is
   * what lets every language filter stay a plain column predicate. Rejects a
   * language another Post in the same translation group already holds.
   *
   * @param postId - Any Post in the Thread; the Thread is resolved from it
   * @param language - Canonical BCP 47 tag
   * @throws {NotFoundError} When no such Post exists on this site
   * @throws {ConflictError} When the translation group already has that language
   * @example
   * await posts.setThreadLanguage(post.id, "zh-Hans");
   */
  setThreadLanguage(postId: string, language: string): Promise<void>;
  /**
   * Stamp every Post that has no language yet with `language`.
   *
   * Runs once when an author turns multilingual content on, and is idempotent
   * so re-enabling later only touches Posts written while it was off. Scoped to
   * this site — hosted deployments share one database.
   *
   * @param language - Canonical BCP 47 tag of the site's primary language
   * @returns Number of Posts stamped
   * @example
   * await posts.materializeMissingLanguage("zh-Hans"); // => 347
   */
  materializeMissingLanguage(language: string): Promise<number>;
  /** Count Posts on this site that still have no language. */
  countMissingLanguage(): Promise<number>;
  /** Count Posts on this site written in `language`, drafts included. */
  countByLanguage(language: string): Promise<number>;
  /**
   * Every language stamped on this site's Posts, with how many carry it.
   * Drafts included; the pre-multilingual NULL rows are not.
   */
  listLanguagesInUse(): Promise<Array<{ language: string; count: number }>>;
  /**
   * List the Thread roots that are translations of the given Post, excluding
   * the Post itself. Empty when it belongs to no translation group.
   */
  listTranslations(postId: string): Promise<Post[]>;
  /**
   * List translations for many Thread roots in one round trip, keyed by the
   * root ID that was asked about. Roots with no group are omitted.
   */
  getTranslationsMap(postIds: string[]): Promise<Map<string, Post[]>>;
  /**
   * Find published Thread roots this Post could be linked to as a translation.
   *
   * Filtered server-side rather than in the menu, because "can these two be
   * linked" is a rule the service owns: a candidate has to be a Thread root in
   * a language this Post's translation group does not already hold, and the two
   * groups must not both exist — `linkTranslation` refuses to merge them.
   * Offering a post that will be rejected teaches the author nothing.
   *
   * The match is a plain substring scan over title and body text. It is a
   * deliberate, authenticated action over one author's own posts, so the cost
   * is bounded and the shared search index (which cannot express these filters)
   * is not worth involving.
   *
   * @param postId - Any Post in the Thread looking for a translation
   * @param options - Search text and how many candidates to return
   * @returns Matching Thread roots, newest first
   * @example
   * await posts.listTranslationCandidates(id, { query: "recipe" });
   */
  listTranslationCandidates(
    postId: string,
    options: { query: string; limit?: number },
  ): Promise<Post[]>;
  /**
   * Resolve an address the author pasted into the Thread it names, and say
   * whether this Post could be linked to it as a translation.
   *
   * The same rules as {@link PostService.listTranslationCandidates}, asked
   * about one known Thread instead of searched for — so the answer can be a
   * reason rather than an empty list. An address that lands on a reply names
   * its Thread, because translations link whole Threads.
   *
   * @param postId - Any Post in the Thread looking for a translation
   * @param path - Internal path, as produced by `toInternalPath()`
   * @returns The Thread root to link, or why it cannot be
   * @example
   * await posts.resolveTranslationCandidate(id, "/hello-world");
   * // { status: "unpublished" }
   */
  resolveTranslationCandidate(
    postId: string,
    path: string,
  ): Promise<TranslationCandidateResolution>;
  /**
   * Link two already-published Thread roots as translations of each other.
   *
   * Joins the side without a group into the other's group, minting one when
   * neither has any. Merging two existing groups is refused — that would
   * silently restructure both sides.
   *
   * @throws {ConflictError} When the languages clash or both sides have groups
   */
  linkTranslation(postId: string, otherPostId: string): Promise<void>;
  /**
   * Remove a Thread root from its translation group. When that leaves a single
   * Post behind, its group is cleared too so no one-member groups survive.
   */
  unlinkTranslation(postId: string): Promise<void>;
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
  /** Fetch published Posts for each requested Thread root. */
  getPublishedThreads(
    rootIds: string[],
    options?: Pick<PostFilters, "publishedBefore">,
  ): Promise<Map<string, Post[]>>;
  /** Get distinct years with posts, bucketed on the `sortBy` time axis */
  getDistinctYears(filters?: PostFilters): Promise<number[]>;
  /**
   * For each Thread ID, resolve the Post that currently ends the chain.
   *
   * Two callers need two different answers. Readers ask what the audience can
   * see, so drafts must not count — the Reply affordance belongs on the last
   * published Post. The reply guard asks what the chain physically ends with,
   * and there an unpublished draft still owns the slot: attaching a second
   * reply to the same parent would fork a structure that is meant to be linear.
   *
   * @param threadIds - Thread root IDs to resolve (duplicates are fine)
   * @param options - `includeDrafts` counts unpublished members as the tail
   * @returns Map of Thread root ID to its tail Post ID; threads with no
   *   matching member are absent from the map
   * @example
   * ```ts
   * const tails = await posts.getThreadTailIds([root.id], { includeDrafts: true });
   * const tailId = tails.get(root.id);
   * ```
   */
  getThreadTailIds(
    threadIds: string[],
    options?: { includeDrafts?: boolean },
  ): Promise<Map<string, string>>;
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
  /**
   * Upgrade recognized legacy footnotes and rebuild stored post body HTML for
   * this site.
   *
   * Updates use compare-and-swap guards so concurrent edits win. Editorial
   * timestamps are never touched. The operation is cursor-paginated,
   * idempotent, and supports a read-only dry run.
   */
  rebuildBodyHtml(
    options?: RebuildBodyHtmlOptions,
  ): Promise<RebuildBodyHtmlResult>;
}

/**
 * Rebuild body HTML using the site's current runtime summary settings.
 *
 * Internal maintenance routes do not run behind the normal app-config
 * middleware, so this service-level orchestration preserves the same
 * DB → environment → built-in resolution used by regular requests.
 *
 * @param services - Site-scoped post and settings services.
 * @param env - Runtime environment bindings.
 * @param options - Rebuild options supplied by the maintenance caller.
 * @returns Rebuild progress and outcome counts.
 */
export async function rebuildPostBodyHtmlWithRuntimeSettings(
  services: Pick<
    { posts: PostService; settings: SettingsService },
    "posts" | "settings"
  >,
  env: Bindings,
  options: Omit<RebuildBodyHtmlOptions, "summaryConfig"> = {},
): Promise<RebuildBodyHtmlResult> {
  const allSettings = await services.settings.getAll();
  return services.posts.rebuildBodyHtml({
    ...options,
    summaryConfig: resolveSummaryConfig(env, allSettings),
  });
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

/**
 * Normalize a caller-supplied content language to what the column stores.
 *
 * Empty, missing, and unparseable values all become `null` — the single-language
 * state — so the column never holds a half-set value. Whether the tag is one
 * the site actually offers is a settings-layer question, checked where the site
 * language configuration is in scope.
 *
 * @param value - Raw BCP 47 tag from a request or import
 * @returns Canonical tag (`zh-Hans`), or `null` when there is nothing to store
 * @example
 * normalizePostLanguage("ZH-hans"); // "zh-Hans"
 * normalizePostLanguage("  ");      // null
 */
export function normalizePostLanguage(
  value: string | null | undefined,
): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!isValidContentLanguage(trimmed)) {
    throw new ValidationError(
      "Enter a valid BCP 47 language tag (e.g. en, zh-Hans, ja).",
    );
  }
  return normalizeContentLanguage(trimmed);
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
  const { navItems, pathRegistry, posts, sites, threadCollections } =
    databaseSchema;
  const databaseDialect = config.databaseDialect ?? "sqlite";
  const usesBatchWrites = !supportsDrizzleTransaction(db, databaseDialect);

  /**
   * Column that carries the time axis selected by `PostFilters.sortBy`.
   * Sorting, year/month bucketing, and date-range filters all read it through
   * here so they can never drift onto different columns.
   */
  function timeAxisColumn(filters: Pick<PostFilters, "sortBy">) {
    if (filters.sortBy === "activity") return posts.lastActivityAt;
    if (filters.sortBy === "thread_updated") return posts.threadUpdatedAt;
    return posts.publishedAt;
  }

  function buildYearMonthExpr(column: SQLWrapper): SQL<string> {
    return databaseDialect === "pg"
      ? sql<string>`to_char(timezone('UTC', to_timestamp(${column})), 'YYYY-MM')`
      : sql<string>`strftime('%Y-%m', ${column}, 'unixepoch')`;
  }

  function buildYearExpr(column: SQLWrapper): SQL<string> {
    return databaseDialect === "pg"
      ? sql<string>`to_char(timezone('UTC', to_timestamp(${column})), 'YYYY')`
      : sql<string>`strftime('%Y', ${column}, 'unixepoch')`;
  }

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

  /**
   * Recompute both Thread activity timestamps on the root from the Thread's
   * rows.
   *
   * - `lastActivityAt` — newest published post excluding quiet replies. This
   *   is "last announced" and drives Latest and the feeds.
   * - `threadUpdatedAt` — newest published post including quiet replies. This
   *   is "last changed" and drives the archive's updated sort.
   *
   * Both are derived, never accumulated, so a quiet reply stays quiet no
   * matter what later edits or deletions trigger a recalculation.
   *
   * @param rootId - Thread root post ID
   */
  async function recalculateThreadActivity(rootId: string): Promise<void> {
    const rootRows = await db
      .select({
        announcedAt: sql<number | null>`MAX(
          CASE
            WHEN ${posts.quietReply} THEN NULL
            ELSE ${posts.publishedAt}
          END
        )`.as("announced_at"),
        updatedAt: sql<number | null>`MAX(${posts.publishedAt})`.as(
          "thread_updated_at",
        ),
      })
      .from(posts)
      .where(
        and(
          eq(posts.siteId, siteId),
          eq(posts.threadId, rootId),
          eq(posts.status, "published"),
        ),
      );

    const announcedAt = rootRows[0]?.announcedAt ?? null;
    const threadUpdatedAt = rootRows[0]?.updatedAt ?? null;
    const root = await db
      .select({ updatedAt: posts.updatedAt })
      .from(posts)
      .where(and(eq(posts.siteId, siteId), eq(posts.id, rootId)))
      .limit(1);

    const fallback = root[0]?.updatedAt ?? now();

    await db
      .update(posts)
      .set({
        lastActivityAt: announcedAt ?? fallback,
        threadUpdatedAt: threadUpdatedAt ?? fallback,
      })
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

  /**
   * Load a Post and assert it can carry a translation group.
   *
   * Groups live on Thread roots only, and both sides must belong to this site.
   * These two rules replace the table CHECK the SQLite schema cannot add, so
   * every write path that touches `translation_group_id` goes through here.
   */
  async function requireTranslatableRoot(
    postId: string,
  ): Promise<typeof posts.$inferSelect> {
    const rows = await db
      .select()
      .from(posts)
      .where(and(eq(posts.siteId, siteId), eq(posts.id, postId)))
      .limit(1);
    const row = rows[0];
    if (!row) {
      throw new NotFoundError("Post");
    }
    if (row.threadId !== row.id) {
      throw new ValidationError(
        "Translations link whole threads. Use the thread's first post.",
      );
    }
    return row;
  }

  /** Reject a language another Post in the same translation group already holds. */
  async function assertTranslationLanguageFree(
    groupId: string,
    language: string,
    excludePostId?: string,
  ): Promise<void> {
    const rows = await db
      .select({ id: posts.id, title: posts.title })
      .from(posts)
      .where(
        and(
          eq(posts.siteId, siteId),
          eq(posts.translationGroupId, groupId),
          eq(posts.language, language),
        ),
      )
      .limit(2);
    const clash = rows.find((row) => row.id !== excludePostId);
    if (clash) {
      // The language's own name, not its tag: this message is shown to the
      // author, and "简体中文" is what they picked in the menu — "zh-Hans" is
      // an implementation detail they never chose.
      const languageName = getOrBuildEntry(language).native;
      throw new ConflictError(
        clash.title
          ? `"${clash.title}" is already the ${languageName} version in this translation group. Unlink it first, or pick another language.`
          : `Another post is already the ${languageName} version in this translation group. Unlink it first, or pick another language.`,
      );
    }
  }

  /** Build WHERE conditions from filters (shared by list and count) */
  function buildFilterConditions(filters: PostFilters) {
    const conditions = [
      eq(posts.siteId, siteId),
      ...buildReaderVisibilityConditions(posts, siteId, filters),
    ];

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
    if (filters.axisAfter !== undefined || filters.axisBefore !== undefined) {
      const axis = timeAxisColumn(filters);
      if (filters.axisAfter !== undefined) {
        conditions.push(sql`${axis} >= ${filters.axisAfter}`);
      }
      if (filters.axisBefore !== undefined) {
        conditions.push(sql`${axis} < ${filters.axisBefore}`);
      }
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
      const mediaExists = sql`EXISTS (
        SELECT 1
        FROM media
        WHERE site_id = ${siteId}
          AND post_id = ${posts.id}
      )`;
      conditions.push(filters.hasMedia ? mediaExists : sql`NOT ${mediaExists}`);
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

  function getCursorSortTimestamp(
    row: typeof posts.$inferSelect,
    filters: PostFilters,
  ): number {
    if (filters.sortBy === "published") {
      return row.publishedAt ?? row.createdAt;
    }
    if (filters.sortBy === "thread_updated") {
      return row.threadUpdatedAt ?? -1;
    }
    return row.status === "draft" ? row.updatedAt : (row.lastActivityAt ?? -1);
  }

  /**
   * Chronological sort key for `list()`.
   *
   * Shared by the ORDER BY and the keyset cursor comparison — they must read
   * the same expression or pagination silently skips or repeats rows.
   */
  function buildSortTimestampExpr(filters: PostFilters): SQLWrapper {
    if (filters.sortBy === "published") {
      return sql<number>`coalesce(${posts.publishedAt}, ${posts.createdAt})`;
    }
    if (filters.sortBy === "thread_updated") {
      return posts.threadUpdatedAt;
    }
    if (filters.status === "draft") return posts.updatedAt;
    if (filters.status === "published") return posts.lastActivityAt;
    return sql<number>`CASE
      WHEN ${posts.status} = 'draft' THEN ${posts.updatedAt}
      ELSE ${posts.lastActivityAt}
    END`;
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

    const sortTimestampExpr = buildSortTimestampExpr(filters);
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
    const cursorSortTimestamp = getCursorSortTimestamp(cursorPost, filters);
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

    // One case per sort order, mirroring `list()` key for key.
    switch (filters.sortOrder ?? "newest") {
      case "oldest":
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
      case "rating_desc":
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
      case "newest":
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
      bodyHtml: resolvePostBodyHtml({
        id: row.id,
        body: row.body,
        bodyHtml: row.bodyHtml,
        bodyHtmlVersion: row.bodyHtmlVersion,
      }),
      bodyText: row.bodyText,
      quoteText: row.quoteText,
      summary: row.summary,
      rating: ensurePostRating(row.rating, Error),
      previewImageKey: row.previewImageKey,
      previewKind: row.previewKind,
      previewProvider: row.previewProvider,
      replyToId: row.replyToId,
      threadId: row.threadId,
      language: row.language,
      translationGroupId: row.translationGroupId,
      quietReply: row.quietReply,
      publishedAt: row.publishedAt,
      lastActivityAt: row.lastActivityAt ?? row.publishedAt ?? row.updatedAt,
      threadUpdatedAt:
        row.threadUpdatedAt ??
        row.lastActivityAt ??
        row.publishedAt ??
        row.updatedAt,
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
    const conditions: SQL[] = [
      eq(posts.siteId, siteId),
      ...buildReaderVisibilityConditions(posts, siteId, options ?? {}),
    ];
    if (options?.publishedBefore !== undefined) {
      conditions.push(
        sql`${posts.publishedAt} < ${options.publishedBefore}`,
        sql`EXISTS (
          SELECT 1
          FROM post AS publication_root
          WHERE publication_root.site_id = ${siteId}
            AND publication_root.id = ${posts.threadId}
            AND publication_root.published_at < ${options.publishedBefore}
        )`,
      );
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

  /**
   * Thread activity timestamp used to order collection threads.
   *
   * Rows here are Thread *members* grouped by thread_id, so the definition is
   * reached through a subquery to the root. The outer MAX only collapses the
   * group — the subquery returns one value per thread. The outer COALESCE
   * covers a member whose root row is missing.
   */
  function buildCollectionThreadActivityExpr(alias: string) {
    return sql<number>`MAX(
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
      const sortTimestamp = buildSortTimestampExpr(filters);

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

      // A case per sort order, and no shared fallthrough. This was an if/else
      // chain whose last branch was written for one order and silently caught
      // another, so `newest` ordered by rating instead of by time wherever it
      // was passed explicitly — a smart collection page, most visibly.
      const buildOrderBy = (): SQL<unknown>[] => {
        if (filters.featured) {
          return [
            ...pinnedOrder,
            desc(featuredPublishedSortExpr),
            desc(posts.id),
          ];
        }
        switch (filters.sortOrder ?? "newest") {
          case "oldest":
            return [...pinnedOrder, asc(sortTimestampSortExpr), asc(posts.id)];
          case "rating_desc":
            return [
              ...pinnedOrder,
              desc(ratingPresence),
              desc(posts.rating),
              desc(sortTimestampSortExpr),
              desc(posts.id),
            ];
          case "newest":
            return [
              ...pinnedOrder,
              desc(sortTimestampSortExpr),
              desc(posts.id),
            ];
        }
      };

      let query = baseQuery.orderBy(...buildOrderBy());

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

      // `lastmod` describes the page, and a Thread root's page renders its
      // replies too — so an added or edited reply changes it even though the
      // root row is untouched. Unlike ordering, edits do count here: the page
      // really did change. Mirrors `articleModifiedTime` in lib/post-display.
      //
      // The outer columns are written out rather than interpolated: Drizzle
      // only qualifies projection columns when the query has a join, so
      // `${posts.id}` would render as a bare "id" here and bind to the
      // subquery's own alias instead of correlating to the outer row.
      const threadModifiedAt = sql<number>`COALESCE(
        (
          SELECT MAX(member.updated_at)
          FROM post AS member
          WHERE member.site_id = ${siteId}
            AND member.thread_id = "post"."id"
            AND member.status = 'published'
        ),
        "post"."updated_at"
      )`;

      const rows = await db
        .select({
          id: posts.id,
          updatedAt: threadModifiedAt,
          featuredAt: posts.featuredAt,
          language: posts.language,
          translationGroupId: posts.translationGroupId,
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
            language: row.language,
            translationGroupId: row.translationGroupId,
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

    async aggregateMany(filters, base) {
      if (filters.length === 0) return [];

      const baseConditions = buildFilterConditions(base);
      // The row is its own Thread root here — callers exclude replies — so the
      // activity expression reads the columns in hand. No correlated subquery.
      const activityAt = buildRootActivityExpr({
        lastActivityAt: posts.lastActivityAt,
        publishedAt: posts.publishedAt,
        updatedAt: posts.updatedAt,
      });
      // A `SUM(CASE …)` and a `MAX(CASE …)` per filter, over one pass of the
      // rows the base predicate already narrows to. The aliases are positional
      // and generated here, so nothing a caller supplies reaches the SQL as an
      // identifier.
      const columns = Object.fromEntries(
        filters.flatMap((filter, index) => {
          const conditions = buildFilterConditions({ ...base, ...filter });
          const predicate =
            conditions.length > 0 ? and(...conditions) : sql`1 = 1`;
          return [
            [
              `n${index}`,
              sql<number>`CAST(SUM(CASE WHEN (${predicate}) THEN 1 ELSE 0 END) AS INTEGER)`,
            ],
            [
              `a${index}`,
              sql<
                number | null
              >`MAX(CASE WHEN (${predicate}) THEN ${activityAt} END)`,
            ],
          ];
        }),
      );

      const rows = await db
        .select(columns)
        .from(posts)
        .where(baseConditions.length > 0 ? and(...baseConditions) : undefined);

      const row = rows[0] as Record<string, number | null> | undefined;
      return filters.map((_, index) => {
        const activity = row?.[`a${index}`];
        return {
          count: Number(row?.[`n${index}`] ?? 0),
          recentActivityAt:
            activity === null || activity === undefined
              ? null
              : Number(activity),
        };
      });
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
      const axis = timeAxisColumn(filters);
      const conditions = [...buildFilterConditions(filters), isNotNull(axis)];
      const publishedYearMonthExpr = buildYearMonthExpr(axis);

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
      // Only replies can be quiet — a root has nothing to stay quiet about.
      const isQuietReply = Boolean(data.replyToId) && data.quietReply === true;

      const rawBody = data.bodyMarkdown
        ? markdownToTiptapJson(data.bodyMarkdown)
        : (data.body ?? null);
      const trimmedBody = rawBody ? trimTiptapBody(rawBody) : null;
      const preparedBody = trimmedBody
        ? tryPreparePostBodyHtml(id, trimmedBody)
        : null;
      const body = preparedBody?.ok ? preparedBody.body : trimmedBody;
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

      const bodyHtml = preparedBody?.ok
        ? preparedBody.html
        : body
          ? renderPostBodyHtml(id, body)
          : null;
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
      // Roots carry the requested language; replies overwrite this with the
      // root's value below so a Thread never mixes languages.
      let language = normalizePostLanguage(data.language);
      let translationGroupId: string | null = null;
      let sourceTranslationPostId: string | null = null;

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

        // Drafts count here: an unpublished reply already owns the tail slot,
        // and a sibling attached to the same parent would fork the chain.
        const tailId = (
          await this.getThreadTailIds([parent.threadId], {
            includeDrafts: true,
          })
        ).get(parent.threadId);
        if (tailId && tailId !== parent.id) {
          const tail = await this.getById(tailId);
          throw new ConflictError(
            tail?.status === "draft"
              ? "This thread ends with an unpublished draft. Finish that draft or discard it, then reply."
              : "This post is no longer the end of the thread. Reply to the latest post instead.",
          );
        }

        threadId = parent.threadId;

        // Replies inherit visibility from the root at read time.
        const root =
          parent.threadId === parent.id
            ? parent
            : await this.getById(parent.threadId);
        // A reply takes the root's status. A draft earlier in the chain does
        // not hold it back: readers never saw that post, so publishing past it
        // reads as continuous, and the draft stays parked until it is dealt
        // with on its own.
        if (root && data.status !== "draft") {
          status = root.status;
        }
        visibility = null;
        // A reply is part of the root's Thread, so it is written in the
        // Thread's language whatever the caller asked for. This is what keeps
        // language filters correct on member-grained queries.
        language = root?.language ?? parent.language ?? null;

        if (
          (data.collectionIds?.length ?? 0) > 0 ||
          (data.collectionEntries?.length ?? 0) > 0
        ) {
          throw new ConflictError(
            "Cannot set Collections while creating a Thread reply. Set them on the Thread root instead.",
          );
        }
      }

      const { primary, languages, reservedPrefixes } =
        await readLanguageSettings(db, siteId, databaseSchema);

      // Nobody named a language, so read one out of the text. Every write path
      // that bypasses compose — the API, the Telegram bot, MCP — lands here, so
      // a multilingual site never accumulates unlabelled posts. An explicit
      // choice is the author's and is left alone; replies already carry the
      // Thread's language.
      if (!data.replyToId && !language) {
        language = suggestPostLanguage({
          text: bodyText ?? title ?? quoteText,
          languages,
          primary,
        });
      }

      // "Add a translation" carries only the source ID until the author
      // submits; the group is minted here so abandoning the composer leaves
      // nothing behind (no draft row, no slug, no single-member group).
      if (data.translationOfId) {
        if (data.replyToId) {
          throw new ValidationError(
            "Translations link whole threads. Add the translation from the thread's first post.",
          );
        }
        const source = await requireTranslatableRoot(data.translationOfId);
        if (!language) {
          throw new ValidationError(
            "Choose a language for this translation before saving it.",
          );
        }
        if (source.language === language) {
          throw new ConflictError(
            "That post is already written in this language. Pick a different language for the translation.",
          );
        }
        if (source.translationGroupId) {
          await assertTranslationLanguageFree(
            source.translationGroupId,
            language,
          );
          translationGroupId = source.translationGroupId;
        } else {
          translationGroupId = createEntityId("translationGroup");
          sourceTranslationPostId = source.id;
        }
      }

      // Featured surfaces only list published posts, so featuring a draft
      // writes a flag that does nothing and shows nowhere. Say so instead.
      if (status === "draft" && resolvedFeaturedAt !== null) {
        throw new ConflictError("Publish this post before featuring it.");
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
      // Only a non-primary language earns a readable language suffix: the bare
      // namespace belongs to the primary language, and a suffix shared by two
      // same-language posts distinguishes nothing.
      const languageSuffix =
        language && language !== primary
          ? toLanguagePrefix(language)
          : undefined;

      if (data.path) {
        const normalized = normalizePath(data.path);
        if (isReservedPath(normalized, reservedPrefixes)) {
          throw new ValidationError(
            `Path "${normalized}" is reserved and cannot be used`,
          );
        }
        if (isValidSlug(normalized)) {
          // Path is a valid slug — use it directly
          slug = await generatePostSlug({
            slug: normalized,
            idLength: config.slugIdLength,
            reservedPrefixes,
            isAvailable: isSlugAvailable,
          });
        } else {
          // Path is not a valid slug — slugify it for the slug, keep original as alias
          const slugified = slugify(normalized);
          slug = await generatePostSlug({
            slug: slugified || undefined,
            title: titleForSlug,
            idLength: config.slugIdLength,
            languageSuffix,
            reservedPrefixes,
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
          languageSuffix,
          reservedPrefixes,
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

          // Mint the group on the source Post in the same write as the
          // translation itself, so a failure never leaves a one-member group.
          if (sourceTranslationPostId && translationGroupId) {
            writeQueries.push(
              db
                .update(posts)
                .set({ translationGroupId, updatedAt: timestamp })
                .where(
                  and(
                    eq(posts.siteId, siteId),
                    eq(posts.id, sourceTranslationPostId),
                    isNull(posts.translationGroupId),
                  ),
                ),
            );
          }

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
              bodyHtmlVersion: POST_BODY_HTML_VERSION,
              bodyText,
              quoteText,
              summary,
              rating,
              replyToId: data.replyToId ?? null,
              threadId,
              language,
              translationGroupId,
              quietReply: isQuietReply,
              publishedAt,
              lastActivityAt: publishedAt ?? timestamp,
              threadUpdatedAt: publishedAt ?? timestamp,
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
            if (sourceTranslationPostId && translationGroupId) {
              await tx
                .update(posts)
                .set({ translationGroupId, updatedAt: timestamp })
                .where(
                  and(
                    eq(posts.siteId, siteId),
                    eq(posts.id, sourceTranslationPostId),
                    isNull(posts.translationGroupId),
                  ),
                );
            }

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
              bodyHtmlVersion: POST_BODY_HTML_VERSION,
              bodyText,
              quoteText,
              summary,
              rating,
              replyToId: data.replyToId ?? null,
              threadId,
              language,
              translationGroupId,
              quietReply: isQuietReply,
              publishedAt,
              lastActivityAt: publishedAt ?? timestamp,
              threadUpdatedAt: publishedAt ?? timestamp,
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

      // A quiet reply still changes the Thread, it just isn't announced —
      // the recalculation reads the persisted quiet_reply flag and keeps
      // lastActivityAt where it was while moving threadUpdatedAt forward.
      if (data.replyToId && status === "published") {
        await recalculateThreadActivity(threadId);
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

      const extendsExistingThreadQuietly =
        items[0]?.data.replyToId !== undefined &&
        items[0].data.quietReply === true;
      const created: Post[] = [];

      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (!item) continue;
        const { data, attachments } = item;
        const prevPost = created[i - 1];
        // A reply with no date of its own belongs to the root's moment, not to
        // whenever the request happened to run. Without this, backdating the
        // root leaves its replies stamped today and the thread reads as if it
        // spanned years. Thread order is by `createdAt`/`id` (see the thread
        // queries), so sharing one `publishedAt` cannot reorder anything.
        const rootPublishedAt = created[0]?.publishedAt ?? undefined;
        const postData: CreatePost = {
          ...data,
          // Chain each post as a reply to the previous one (server-side chaining)
          replyToId: i === 0 ? data.replyToId : prevPost?.id,
          // Translation groups and languages are Thread-level: the root carries
          // them and every reply inherits, so later items must not restate them.
          translationOfId: i === 0 ? data.translationOfId : undefined,
          quietReply: extendsExistingThreadQuietly ? true : data.quietReply,
          publishedAt:
            i === 0 ? data.publishedAt : (data.publishedAt ?? rootPublishedAt),
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

      // Thread-wide, so it cannot ride along on the single-row write below.
      // Runs first: if the language is refused — the Thread's translation group
      // already holds it — nothing else should have been written either.
      if (
        data.language &&
        !existing.replyToId &&
        data.language !== existing.language
      ) {
        await this.setThreadLanguage(id, data.language);
      }

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
      const effectiveNextVisibility = nextVisibility ?? existing.visibility;
      const wasNavigationPageEligible =
        existing.format === "note" &&
        existing.status === "published" &&
        existing.visibility !== "private" &&
        !isThreadReply(existing) &&
        hasNonEmptyText(existing.title);
      const remainsNavigationPageEligible =
        nextFormat === "note" &&
        nextStatus === "published" &&
        effectiveNextVisibility !== "private" &&
        !isThreadReply(existing) &&
        hasNonEmptyText(nextTitle);

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
      // Same rule `create` enforces: nothing unpublished can be featured.
      // Only guards turning it on — an existing flag survives a trip back to
      // draft and takes effect again when the post is republished.
      if (nextStatus === "draft" && updates.featuredAt) {
        throw new ConflictError("Publish this post before featuring it.");
      }

      let updatedBody: string | null | undefined;
      if (data.body !== undefined || data.bodyMarkdown !== undefined) {
        const rawBody = data.bodyMarkdown
          ? markdownToTiptapJson(data.bodyMarkdown)
          : (data.body ?? null);
        const normalizedBody = rawBody ? trimTiptapBody(rawBody) : null;
        const preparedBody = normalizedBody
          ? tryPreparePostBodyHtml(existing.id, normalizedBody)
          : null;
        updatedBody = preparedBody?.ok ? preparedBody.body : normalizedBody;
        updates.body = updatedBody;
        updates.bodyHtml = preparedBody?.ok
          ? preparedBody.html
          : updatedBody
            ? renderPostBodyHtml(existing.id, updatedBody)
            : null;
        updates.bodyHtmlVersion = POST_BODY_HTML_VERSION;
        updates.bodyText = updatedBody
          ? extractBodyText(updatedBody, { includeLinkHrefs: true })
          : null;
      }

      // Recompute summary when body, title, or format change
      if (summaryConfig) {
        const format = nextFormat;
        const title = nextTitle;
        const body = updatedBody !== undefined ? updatedBody : existing.body;
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
      const needsPageNavDelete =
        wasNavigationPageEligible && !remainsNavigationPageEligible;
      const needsPageNavUrlUpdate =
        wasNavigationPageEligible &&
        remainsNavigationPageEligible &&
        slugChanged &&
        Boolean(data.slug);
      const hasExtraWrites =
        needsCascade ||
        needsReplyVisibilityCleanup ||
        needsCollectionSync ||
        needsPageNavDelete ||
        needsPageNavUrlUpdate;

      if (!hasExtraWrites) {
        // Simple case: only the post update
        const result = await db
          .update(posts)
          .set(updates)
          .where(and(eq(posts.siteId, siteId), eq(posts.id, id)))
          .returning();
        if (needsThreadActivityRecalc) {
          await recalculateThreadActivity(existing.threadId);
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

        if (needsPageNavDelete) {
          writeQueries.push(
            db
              .delete(navItems)
              .where(and(eq(navItems.siteId, siteId), eq(navItems.postId, id))),
          );
        } else if (needsPageNavUrlUpdate && data.slug) {
          writeQueries.push(
            db
              .update(navItems)
              .set({
                url: `/${normalizePath(data.slug)}`,
                updatedAt: timestamp,
              })
              .where(and(eq(navItems.siteId, siteId), eq(navItems.postId, id))),
          );
        }

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
          (typeof posts.$inferSelect)[] | undefined;
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

          if (needsPageNavDelete) {
            await tx
              .delete(navItems)
              .where(and(eq(navItems.siteId, siteId), eq(navItems.postId, id)));
          } else if (needsPageNavUrlUpdate && data.slug) {
            await tx
              .update(navItems)
              .set({
                url: `/${normalizePath(data.slug)}`,
                updatedAt: timestamp,
              })
              .where(and(eq(navItems.siteId, siteId), eq(navItems.postId, id)));
          }

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
        await recalculateThreadActivity(existing.threadId);
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
        await recalculateThreadActivity(existing.threadId);
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

    async getThreadPosition(postId) {
      const targetRows = await db
        .select({ replyToId: posts.replyToId, threadId: posts.threadId })
        .from(posts)
        .where(and(eq(posts.siteId, siteId), eq(posts.id, postId)))
        .limit(1);

      const target = targetRows[0];
      if (!target) return 0;
      if (!target.replyToId) return 1;

      // One read for the whole Thread, then walk up in memory: a chain of N
      // Posts would otherwise be N round trips.
      const threadRows = await db
        .select({ id: posts.id, replyToId: posts.replyToId })
        .from(posts)
        .where(
          and(eq(posts.siteId, siteId), eq(posts.threadId, target.threadId)),
        );

      const parentOf = new Map(
        threadRows.map((row) => [row.id, row.replyToId] as const),
      );

      let position = 1;
      let cursor: string | null = target.replyToId;
      // A cycle is impossible per the schema's CHECK constraints, but walking a
      // parent chain unguarded turns a bad row into a hung request.
      const visited = new Set<string>([postId]);
      while (cursor && !visited.has(cursor)) {
        visited.add(cursor);
        position += 1;
        cursor = parentOf.get(cursor) ?? null;
      }

      return position;
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
      await recalculateThreadActivity(rootId);
    },

    async setThreadLanguage(postId, language) {
      const normalized = normalizePostLanguage(language);
      if (!normalized) {
        throw new ValidationError("Choose a language for this post.");
      }

      // A language the site does not publish has no view, no feed and no
      // switcher entry, so the post would simply vanish. Only checked once the
      // site actually has a language set to belong to.
      const { languages } = await readLanguageSettings(
        db,
        siteId,
        databaseSchema,
      );
      if (
        languages.length > 0 &&
        !languages.some(
          (tag) => toLanguagePrefix(tag) === toLanguagePrefix(normalized),
        )
      ) {
        throw new ValidationError(
          "This site does not publish that language. Add it in Settings → Language first.",
        );
      }

      const rows = await db
        .select({
          threadId: posts.threadId,
          id: posts.id,
          translationGroupId: posts.translationGroupId,
        })
        .from(posts)
        .where(and(eq(posts.siteId, siteId), eq(posts.id, postId)))
        .limit(1);
      const row = rows[0];
      if (!row) {
        throw new NotFoundError("Post");
      }

      // The group lives on the root, so a reply's Thread has to be resolved
      // before the translation-group check can run.
      const rootRows =
        row.id === row.threadId
          ? [row]
          : await db
              .select({
                threadId: posts.threadId,
                id: posts.id,
                translationGroupId: posts.translationGroupId,
              })
              .from(posts)
              .where(and(eq(posts.siteId, siteId), eq(posts.id, row.threadId)))
              .limit(1);
      const root = rootRows[0];
      if (root?.translationGroupId) {
        await assertTranslationLanguageFree(
          root.translationGroupId,
          normalized,
          root.id,
        );
      }

      const timestamp = now();
      await db
        .update(posts)
        .set({ language: normalized, updatedAt: timestamp })
        .where(and(eq(posts.siteId, siteId), eq(posts.threadId, row.threadId)));
    },

    async materializeMissingLanguage(language) {
      const normalized = normalizePostLanguage(language);
      if (!normalized) {
        throw new ValidationError("Choose a primary language for this site.");
      }

      // Counted before the write rather than read back from it: the three
      // supported drivers report affected rows differently, and the caller only
      // needs the number for its confirmation copy.
      const pending = await this.countMissingLanguage();
      if (pending === 0) return 0;

      await db
        .update(posts)
        .set({ language: normalized })
        .where(and(eq(posts.siteId, siteId), isNull(posts.language)));
      return pending;
    },

    async countMissingLanguage() {
      const rows = await db
        .select({ count: sql<number>`CAST(count(*) AS INTEGER)` })
        .from(posts)
        .where(and(eq(posts.siteId, siteId), isNull(posts.language)));
      return Number(rows[0]?.count ?? 0);
    },

    async countByLanguage(language) {
      const normalized = normalizePostLanguage(language);
      if (!normalized) return 0;

      const rows = await db
        .select({ count: sql<number>`CAST(count(*) AS INTEGER)` })
        .from(posts)
        .where(and(eq(posts.siteId, siteId), eq(posts.language, normalized)));
      return Number(rows[0]?.count ?? 0);
    },

    async listLanguagesInUse() {
      const rows = await db
        .select({
          language: posts.language,
          count: sql<number>`CAST(count(*) AS INTEGER)`,
        })
        .from(posts)
        .where(and(eq(posts.siteId, siteId), isNotNull(posts.language)))
        .groupBy(posts.language);
      return rows
        .filter((row): row is { language: string; count: number } =>
          Boolean(row.language),
        )
        .map((row) => ({ language: row.language, count: Number(row.count) }));
    },

    async listTranslations(postId) {
      const map = await this.getTranslationsMap([postId]);
      return map.get(postId) ?? [];
    },

    async listTranslationCandidates(postId, options) {
      const term = options.query.trim();
      if (!term) return [];
      const limit = options.limit ?? 8;

      const source = await this.getById(postId);
      if (!source) return [];
      const root =
        source.replyToId === null
          ? source
          : await this.getById(source.threadId);
      if (!root?.language) return [];

      // Languages this Thread's group already speaks for, its own included.
      const taken = new Set([root.language]);
      if (root.translationGroupId) {
        for (const sibling of await this.listTranslations(root.id)) {
          if (sibling.language) taken.add(sibling.language);
        }
      }

      // Escaped with an explicit ESCAPE clause: the two dialects disagree on
      // the default escape character (see `paths.findPathsUnderSegment`).
      const like = `%${term.replace(/[\\%_]/g, "\\$&")}%`;
      const conditions: SQL[] = [
        eq(posts.siteId, siteId),
        eq(posts.status, "published"),
        // Thread roots only: a translation links whole Threads.
        sql`${posts.id} = ${posts.threadId}`,
        sql`${posts.id} != ${root.id}`,
        isNotNull(posts.language),
        notInArray(posts.language, [...taken]),
        sql`(${posts.title} LIKE ${like} ESCAPE '\\' OR ${posts.bodyText} LIKE ${like} ESCAPE '\\')`,
      ];

      if (root.translationGroupId) {
        // Both sides having a group would ask for a merge, which is refused.
        conditions.push(isNull(posts.translationGroupId));
      } else {
        // The candidate may carry a group, as long as joining it would not put
        // two Posts of this language in it.
        conditions.push(
          sql`(${posts.translationGroupId} IS NULL OR NOT EXISTS (
            SELECT 1
            FROM post AS group_member
            WHERE group_member.site_id = ${siteId}
              AND group_member.translation_group_id = "post"."translation_group_id"
              AND group_member.language = ${root.language}
          ))`,
        );
      }

      const rows = await db
        .select()
        .from(posts)
        .where(and(...conditions))
        .orderBy(desc(posts.publishedAt))
        .limit(limit);

      return hydratePosts(rows);
    },

    async resolveTranslationCandidate(postId, path) {
      const source = await this.getById(postId);
      if (!source) return { status: "not_found" };
      const root =
        source.replyToId === null
          ? source
          : await this.getById(source.threadId);
      if (!root?.language) return { status: "not_found" };

      const target = await resolvedPaths.resolveTarget(path);
      if (!target) return { status: "not_found" };
      if (target.targetType !== "post" || !target.postId) {
        return { status: "not_a_post" };
      }

      const found = await this.getById(target.postId);
      if (!found) return { status: "not_found" };
      // Translations link whole Threads, so an address that lands on a reply
      // is taken as naming the Thread it belongs to.
      const candidate =
        found.replyToId === null ? found : await this.getById(found.threadId);
      if (!candidate) return { status: "not_found" };

      if (candidate.id === root.id) return { status: "same_thread" };
      if (candidate.status !== "published") return { status: "unpublished" };
      if (!candidate.language) return { status: "no_language" };
      if (candidate.language === root.language) {
        return { status: "same_language" };
      }

      const siblings = root.translationGroupId
        ? await this.listTranslations(root.id)
        : [];
      if (siblings.some((post) => post.language === candidate.language)) {
        return { status: "language_taken", language: candidate.language };
      }

      if (candidate.translationGroupId) {
        // `linkTranslation` refuses to merge two groups, and refuses to join
        // one that already speaks for this Thread's language.
        if (root.translationGroupId) return { status: "group_conflict" };

        const theirGroup = await this.listTranslations(candidate.id);
        if (theirGroup.some((post) => post.language === root.language)) {
          return { status: "group_language_taken", language: root.language };
        }
      }

      return { status: "ok", post: candidate };
    },

    async getTranslationsMap(postIds) {
      const result = new Map<string, Post[]>();
      const uniqueIds = [...new Set(postIds)].filter(Boolean);
      if (uniqueIds.length === 0) return result;

      const seedRows = await db
        .select({ id: posts.id, translationGroupId: posts.translationGroupId })
        .from(posts)
        .where(
          and(
            eq(posts.siteId, siteId),
            inArray(posts.id, uniqueIds),
            isNotNull(posts.translationGroupId),
          ),
        );
      if (seedRows.length === 0) return result;

      const groupIds = [
        ...new Set(
          seedRows
            .map((row) => row.translationGroupId)
            .filter((groupId): groupId is string => groupId !== null),
        ),
      ];
      const memberRows = await db
        .select()
        .from(posts)
        .where(
          and(
            eq(posts.siteId, siteId),
            inArray(posts.translationGroupId, groupIds),
          ),
        );
      const members = await hydratePosts(memberRows);
      const byGroup = new Map<string, Post[]>();
      for (const member of members) {
        const groupId = member.translationGroupId;
        if (!groupId) continue;
        const bucket = byGroup.get(groupId);
        if (bucket) bucket.push(member);
        else byGroup.set(groupId, [member]);
      }

      for (const seed of seedRows) {
        const groupId = seed.translationGroupId;
        if (!groupId) continue;
        const siblings = (byGroup.get(groupId) ?? []).filter(
          (member) => member.id !== seed.id,
        );
        if (siblings.length > 0) result.set(seed.id, siblings);
      }
      return result;
    },

    async linkTranslation(postId, otherPostId) {
      if (postId === otherPostId) {
        throw new ValidationError("Pick a different post to link.");
      }

      const [post, other] = await Promise.all([
        requireTranslatableRoot(postId),
        requireTranslatableRoot(otherPostId),
      ]);

      if (!post.language || !other.language) {
        throw new ValidationError(
          "Both posts need a language before they can be linked as translations.",
        );
      }
      if (post.language === other.language) {
        throw new ConflictError(
          "These two posts are written in the same language. Translations need different languages.",
        );
      }
      if (post.translationGroupId && other.translationGroupId) {
        if (post.translationGroupId === other.translationGroupId) return;
        throw new ConflictError(
          "Both posts already belong to translation groups. Unlink one of them first.",
        );
      }

      const timestamp = now();
      if (post.translationGroupId ?? other.translationGroupId) {
        const groupId = (post.translationGroupId ??
          other.translationGroupId) as string;
        const joiningId = post.translationGroupId ? other.id : post.id;
        const joiningLanguage = post.translationGroupId
          ? other.language
          : post.language;
        await assertTranslationLanguageFree(groupId, joiningLanguage);
        await db
          .update(posts)
          .set({ translationGroupId: groupId, updatedAt: timestamp })
          .where(and(eq(posts.siteId, siteId), eq(posts.id, joiningId)));
        return;
      }

      const groupId = createEntityId("translationGroup");
      const setGroup = (targetId: string) =>
        db
          .update(posts)
          .set({ translationGroupId: groupId, updatedAt: timestamp })
          .where(and(eq(posts.siteId, siteId), eq(posts.id, targetId)));

      if (usesBatchWrites) {
        await db.batch([setGroup(post.id), setGroup(other.id)]);
      } else {
        await db.transaction(async (tx) => {
          await tx
            .update(posts)
            .set({ translationGroupId: groupId, updatedAt: timestamp })
            .where(and(eq(posts.siteId, siteId), eq(posts.id, post.id)));
          await tx
            .update(posts)
            .set({ translationGroupId: groupId, updatedAt: timestamp })
            .where(and(eq(posts.siteId, siteId), eq(posts.id, other.id)));
        });
      }
    },

    async unlinkTranslation(postId) {
      const post = await requireTranslatableRoot(postId);
      const groupId = post.translationGroupId;
      if (!groupId) return;

      const timestamp = now();
      await db
        .update(posts)
        .set({ translationGroupId: null, updatedAt: timestamp })
        .where(and(eq(posts.siteId, siteId), eq(posts.id, post.id)));

      // A group of one is indistinguishable from no group and would linger as
      // a dangling key, so collapse it as soon as the second-to-last member
      // leaves.
      const remaining = await db
        .select({ id: posts.id })
        .from(posts)
        .where(
          and(eq(posts.siteId, siteId), eq(posts.translationGroupId, groupId)),
        )
        .limit(2);
      const lastMember = remaining.length === 1 ? remaining[0] : undefined;
      if (lastMember) {
        await db
          .update(posts)
          .set({ translationGroupId: null, updatedAt: timestamp })
          .where(and(eq(posts.siteId, siteId), eq(posts.id, lastMember.id)));
      }
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

    async getPublishedThreads(rootIds, options = {}) {
      const result = new Map<string, Post[]>();
      if (rootIds.length === 0) return result;

      const unique = [...new Set(rootIds)];
      const conditions = [
        eq(posts.siteId, siteId),
        inArray(posts.threadId, unique),
        eq(posts.status, "published"),
      ];
      if (options.publishedBefore !== undefined) {
        conditions.push(sql`${posts.publishedAt} < ${options.publishedBefore}`);
      }
      const rows = await db
        .select()
        .from(posts)
        .where(and(...conditions))
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

    async getThreadTailIds(threadIds, options) {
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
            ...(options?.includeDrafts ? [] : [eq(posts.status, "published")]),
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
      const axis = timeAxisColumn(filters);
      const conditions = [...buildFilterConditions(filters), isNotNull(axis)];
      const publishedYearExpr = buildYearExpr(axis);

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

    async rebuildBodyHtml(options = {}) {
      const requested = options.limit ?? 50;
      const limit = Math.min(Math.max(Math.trunc(requested), 1), 100);
      const cursor = options.cursor;
      const dryRun = options.dryRun ?? false;

      const siteRows = await db
        .select({ id: sites.id })
        .from(sites)
        .where(eq(sites.id, siteId))
        .limit(1);
      if (!siteRows[0]) {
        throw new NotFoundError("Site");
      }

      const whereConditions = [eq(posts.siteId, siteId)];
      if (cursor) whereConditions.push(gt(posts.id, cursor));

      const rows = await db
        .select({
          id: posts.id,
          format: posts.format,
          title: posts.title,
          body: posts.body,
          bodyHtml: posts.bodyHtml,
          bodyHtmlVersion: posts.bodyHtmlVersion,
        })
        .from(posts)
        .where(and(...whereConditions))
        .orderBy(asc(posts.id))
        .limit(limit + 1);

      const hasMore = rows.length > limit;
      const batch = hasMore ? rows.slice(0, limit) : rows;
      const failures: Array<{ postId: string; error: string }> = [];
      let wouldRebuild = 0;
      let rebuilt = 0;
      let wouldUpgradeFootnotes = 0;
      let upgradedFootnotes = 0;
      let skipped = 0;
      let conflicted = 0;

      for (const row of batch) {
        if (row.bodyHtmlVersion > POST_BODY_HTML_VERSION) {
          skipped++;
          continue;
        }

        let nextBody = row.body;
        let nextBodyHtml: string | null = null;
        let upgradesLegacyFootnotes = false;
        if (row.body !== null) {
          const prepared = tryPreparePostBodyHtml(row.id, row.body);
          if (!prepared.ok) {
            failures.push({ postId: row.id, error: prepared.error });
            continue;
          }
          nextBody = prepared.body;
          nextBodyHtml = prepared.html;
          upgradesLegacyFootnotes = prepared.upgradedLegacyFootnotes;
        }

        if (
          row.bodyHtmlVersion === POST_BODY_HTML_VERSION &&
          row.body === nextBody &&
          row.bodyHtml === nextBodyHtml
        ) {
          skipped++;
          continue;
        }

        wouldRebuild++;
        if (upgradesLegacyFootnotes) wouldUpgradeFootnotes++;
        if (dryRun) continue;

        const bodyCondition =
          row.body === null ? isNull(posts.body) : eq(posts.body, row.body);
        const canonicalBodyChanged = row.body !== nextBody;
        const updates: Partial<typeof posts.$inferInsert> = {
          bodyHtml: nextBodyHtml,
          bodyHtmlVersion: POST_BODY_HTML_VERSION,
        };
        if (canonicalBodyChanged) {
          updates.body = nextBody;
          updates.bodyText = nextBody
            ? extractBodyText(nextBody, { includeLinkHrefs: true })
            : null;

          if (options.summaryConfig) {
            updates.summary =
              row.format === "note" && row.title && nextBody
                ? extractSummary(
                    nextBody,
                    options.summaryConfig.maxParagraphs,
                    options.summaryConfig.maxChars,
                  )
                : null;
          }
        }
        const updatedRows = await db
          .update(posts)
          .set(updates)
          .where(
            and(
              eq(posts.siteId, siteId),
              eq(posts.id, row.id),
              bodyCondition,
              eq(posts.bodyHtmlVersion, row.bodyHtmlVersion),
            ),
          )
          .returning({ id: posts.id });

        if (updatedRows.length === 0) {
          conflicted++;
        } else {
          rebuilt++;
          if (upgradesLegacyFootnotes) upgradedFootnotes++;
        }
      }

      const lastRow = batch.at(-1);
      const lastId = lastRow ? lastRow.id : null;

      return {
        processed: batch.length,
        wouldRebuild,
        rebuilt,
        wouldUpgradeFootnotes,
        upgradedFootnotes,
        skipped,
        conflicted,
        failed: failures.length,
        failures,
        nextCursor: hasMore ? lastId : null,
        done: !hasMore,
        targetVersion: POST_BODY_HTML_VERSION,
      };
    },
  };
}
