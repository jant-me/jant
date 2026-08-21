/**
 * Page-Level Props & Feed Data Types
 */

import type {
  ArchiveLayout,
  ArchiveVisibility,
  CollectionSortOrder,
  SmartCollectionSortOrder,
} from "./constants.js";
import type { PostFilterSelection } from "../lib/filter-dimensions.js";
import type {
  Collection,
  CollectionDirectoryItem,
  SmartCollection,
} from "./entities.js";
import type {
  PostView,
  FeedPostView,
  LanguageSwitcherOption,
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

/** A link to another language's version of a post. */
export interface PostTranslationLinkView {
  href: string;
  /** The language's own name for itself, e.g. "日本語". */
  label: string;
  /** Canonical BCP 47 tag. */
  lang: string;
}

/** Props for the single post page component */
export interface PostPageProps {
  post: PostView;
  threadPosts?: PostView[];
  /** Hide owner-only actions while preserving the public post rendering. */
  isPreview?: boolean;
  /**
   * Other-language versions of this post. Rendered as one quiet sentence
   * after the post — a reader who cannot read this one needs a way out that
   * does not involve guessing at the language switcher.
   */
  translations?: PostTranslationLinkView[];
}

/** Props for the featured page component */
export interface FeaturedPageProps {
  items: TimelineItemView[];
  currentPage: number;
  totalPages: number;
  baseUrl: string;
}

export type { ArchiveLayout, ArchiveVisibility };

/**
 * Time axis for the archive page.
 *
 * `published` (default) orders and buckets by when a thread was first
 * published — the stable historical record. `updated` switches the whole axis
 * to thread activity, so a thread moves to the month it last gained a post.
 * Edits are not activity.
 */
export type ArchiveSort = "published" | "updated";

/**
 * What the archive page is currently showing.
 *
 * The selection itself is the shared dimension vocabulary — the chip bar builds
 * its links by handing an edited copy back to the same serializer the route
 * parses with, so a chip can never spell a filter the route cannot read.
 * `layout` and `sort` sit beside it because they shape the rendering, not the
 * result set.
 */
export interface ArchiveFilters {
  selection: PostFilterSelection;
  /** Omitted when the site's configured default layout is active */
  layout?: ArchiveLayout;
  /** Omitted when the default `published` axis is active */
  sort?: ArchiveSort;
}

/** Props for the archive page component */
export interface ArchivePageProps {
  /** Month-based groups used by grid view */
  groups: ArchiveGroup[];
  /** Flat timeline items used by list view (skips month grouping) */
  items?: TimelineItemView[];
  /**
   * Layout to use when the URL names none. Comes from the site's
   * `ARCHIVE_DEFAULT_LAYOUT` setting.
   */
  defaultLayout?: ArchiveLayout;
  totalCount: number;
  /**
   * Matches the same view with every filter cleared. Lets the count say how
   * much the active filter removed; omitted when nothing is filtered.
   */
  baselineCount?: number;
  currentPage: number;
  totalPages: number;
  filters: ArchiveFilters;
  availableYears: number[];
  availableCollections: { id: string; slug: string; title: string }[];
  isAuthenticated: boolean;
  /**
   * Public path this page's own URLs are built from — the deployment prefix
   * plus, in a language view, that language's prefix (`/blog/en`). Every link
   * the archive generates is a link back to itself with different filters, so
   * this is the only prefix it needs.
   */
  basePath?: string;
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
  /** Public path this page's own URLs are built from. See `ArchivePageProps`. */
  basePath?: string;
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
  /** Deployment path prefix. Used for links to admin surfaces. */
  sitePathPrefix?: string;
  /**
   * Public path prefix for reader-facing links, which in a language view also
   * carries that language's prefix. Defaults to `sitePathPrefix`.
   */
  basePath?: string;
  /**
   * Set when the collection is empty in this language but not in the others.
   * The empty state then says which language is missing and offers the ones
   * that have something — an empty page with no way out is a dead end.
   */
  emptyInLanguage?: {
    /** The current language's own name for itself. */
    languageLabel: string;
    /** This collection in each of the site's other languages. */
    alternatives: LanguageSwitcherOption[];
  };
  /** Href for this collection selection's Atom feed when feeds are enabled. */
  feedHref?: string;
}

/** Props for the smart collection page component */
export interface SmartCollectionPageProps {
  smartCollection: SmartCollection;
  items: TimelineItemView[];
  totalThreadCount: number;
  currentPage: number;
  totalPages: number;
  pagePath: string;
  baseUrl: string;
  currentSort: SmartCollectionSortOrder;
  defaultSort: SmartCollectionSortOrder;
  showRatingSort: boolean;
  /** One sentence naming what the conditions gather. Shown to every reader. */
  conditionSummary: string;
  /** Archive URL showing the same posts, for a reader who wants to narrow. */
  conditionHref: string;
  isAuthenticated: boolean;
  isInNavigation?: boolean;
  /** Deployment path prefix. Used for links to admin surfaces. */
  sitePathPrefix?: string;
  /**
   * Public path prefix for reader-facing links, which in a language view also
   * carries that language's prefix. Defaults to `sitePathPrefix`.
   */
  basePath?: string;
  /** Href for this smart collection's Atom feed when feeds are enabled. */
  feedHref?: string;
}

/** Props for the collections list page component */
export interface CollectionsPageProps {
  items: CollectionDirectoryItem[];
  isAuthenticated: boolean;
  /**
   * TypeIDs of the collections and smart collections already in the site
   * navigation. Both kinds share one list: the directory offers them the
   * same action, and their ID prefixes keep them apart.
   */
  navigationCollectionIds?: string[];
  /** Deployment path prefix. Used for links to admin surfaces. */
  sitePathPrefix?: string;
  /**
   * Public path prefix for reader-facing links, which in a language view also
   * carries that language's prefix. Defaults to `sitePathPrefix`.
   */
  basePath?: string;
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
