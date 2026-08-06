/**
 * Page-Level Props & Feed Data Types
 */

import type { CollectionSortOrder, Format, MediaKind } from "./constants.js";
import type { Collection, CollectionDirectoryItem } from "./entities.js";
import type {
  PostView,
  FeedPostView,
  TimelineItemView,
  SearchResultView,
  ArchiveGroup,
} from "./views.js";

// =============================================================================
// Page-Level Props
// =============================================================================

/** Props for the home page component */
export interface HomePageProps {
  items: TimelineItemView[];
  currentPage: number;
  totalPages: number;
  baseUrl: string;
  isAuthenticated: boolean;
  signinUrl: string;
}

/** Props for the single post page component */
export interface PostPageProps {
  post: PostView;
  threadPosts?: PostView[];
  /** Hide owner-only actions while preserving the public post rendering. */
  isPreview?: boolean;
}

/** Props for the featured page component */
export interface FeaturedPageProps {
  items: TimelineItemView[];
  currentPage: number;
  totalPages: number;
  baseUrl: string;
}

/** Visibility filter values for the archive page (includes "featured" as a virtual value). */
export type ArchiveVisibility =
  | "public"
  | "latest_hidden"
  | "private"
  | "featured";

/** View mode for the archive page. */
export type ArchiveView = "grid" | "list";

/**
 * Time axis for the archive page.
 *
 * `published` (default) orders and buckets by when a thread was first
 * published — the stable historical record. `updated` switches the whole axis
 * to thread activity, so a thread moves to the month it last gained a post.
 * Edits are not activity.
 */
export type ArchiveSort = "published" | "updated";

/** Filters currently active on the archive page */
export interface ArchiveFilters {
  year?: number;
  collectionSlug?: string;
  collectionTitle?: string;
  format?: Format;
  mediaKinds?: MediaKind[];
  hasMedia?: boolean;
  hasTitle?: boolean;
  /** true = threads (roots with replies), false = single posts (no replies) */
  hasReplies?: boolean;
  visibility?: ArchiveVisibility;
  view?: ArchiveView;
  /** Omitted when the default `published` axis is active */
  sort?: ArchiveSort;
}

/** Props for the archive page component */
export interface ArchivePageProps {
  /** Month-based groups used by grid view */
  groups: ArchiveGroup[];
  /** Flat timeline items used by list view (skips month grouping) */
  items?: TimelineItemView[];
  totalCount: number;
  currentPage: number;
  totalPages: number;
  filters: ArchiveFilters;
  availableYears: number[];
  availableCollections: { slug: string; title: string }[];
  isAuthenticated: boolean;
  sitePathPrefix?: string;
  timeZone?: string;
  /** Href for the RSS feed matching current filters */
  feedHref?: string;
}

/** Props for the search page component */
export interface SearchPageProps {
  query: string;
  results: SearchResultView[];
  error?: string;
  hasMore: boolean;
  page: number;
  sitePathPrefix?: string;
  isAuthenticated?: boolean;
}

/** Props for the single collection page component */
export interface CollectionPageProps {
  collections: Collection[];
  items: TimelineItemView[];
  totalThreadCount: number;
  currentPage: number;
  totalPages: number;
  pagePath: string;
  baseUrl: string;
  currentSort: CollectionSortOrder;
  defaultSort: CollectionSortOrder;
  showRatingSort: boolean;
  isAuthenticated: boolean;
  isInNavigation?: boolean;
  sitePathPrefix?: string;
  /** Href for this collection selection's Atom feed when feeds are enabled. */
  feedHref?: string;
}

/** Props for the collection editor page component */
export interface CollectionEditorPageProps {
  mode: "create" | "edit";
  collection?: Collection;
  cancelHref: string;
  sitePathPrefix?: string;
}

/** Props for the collections list page component */
export interface CollectionsPageProps {
  items: CollectionDirectoryItem[];
  isAuthenticated: boolean;
  navigationCollectionIds?: string[];
  sitePathPrefix?: string;
  siteOrigin?: string;
}

// =============================================================================
// Feed Data Types
// =============================================================================

/** Data passed to RSS/Atom feed renderers */
export interface FeedData {
  siteName: string;
  siteDescription: string;
  siteUrl: string;
  siteLanguage: string;
  /** Optional feed-specific title shown in RSS/Atom readers. */
  title?: string;
  selfUrl: string;
  posts: FeedPostView[];
}

// =============================================================================
// Timeline Types
// =============================================================================

/**
 * Display mode for timeline cards.
 * - `compact` — condensed view for constrained contexts
 * - `feed`    — standard timeline card (default)
 * - `detail`  — full single-post page view
 */
export type CardMode = "compact" | "feed" | "detail";

export interface PostFooterDisplayOptions {
  hideActions?: boolean;
  hideReply?: boolean;
  hideTimestamp?: boolean;
}

export interface TimelineCardDisplayOptions {
  hideStatusBadges?: boolean;
  hideRating?: boolean;
  /** Render full body HTML in feed contexts that would otherwise use summaries. */
  showFullBody?: boolean;
  footer?: PostFooterDisplayOptions;
}

/** Props for per-type timeline cards */
export interface TimelineCardProps {
  post: PostView;
  mode?: CardMode;
  display?: TimelineCardDisplayOptions;
}

/** Props for thread inline preview */
export interface ThreadPreviewProps {
  rootPost: PostView;
  leadingReplies: PostView[];
  trailingReplies: PostView[];
  latestReply: PostView;
  totalReplyCount: number;
}

/** Props for the timeline feed wrapper */
export interface TimelineFeedProps {
  items: TimelineItemView[];
  baseUrl: string;
  currentPage?: number;
  totalPages?: number;
}
