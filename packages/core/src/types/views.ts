/**
 * View Model Types (render-ready, for theme components)
 */

import type {
  Format,
  Status,
  Visibility,
  NavItemType,
  NavItemPlacement,
  SystemNavKey,
} from "./constants.js";
import type { Post, Collection } from "./entities.js";

/**
 * Render-ready collection tag for display in post footers.
 * Pre-computed at the viewmodel layer -- no lib/ imports needed.
 */
export interface CollectionTagView {
  slug: string;
  title: string;
  /** Public collection URL, including any configured site path prefix. */
  url: string;
}

/**
 * Render-ready post data for theme components.
 * All fields are pre-computed -- no lib/ imports needed.
 */
export interface PostView {
  // Identity
  /** TypeID identifier */
  id: string;
  /** Pre-computed permalink: "/{slug}" */
  permalink: string;
  /** Post slug */
  slug: string;

  // Content
  title?: string;
  /** Pre-sanitized HTML */
  bodyHtml?: string;
  /** Unified plain-text preview summary for cards, lists, and meta fallbacks */
  summary?: string;
  /** Pre-computed excerpt, max 160 chars */
  excerpt?: string;
  /** HTML excerpt for article previews (paragraph-aware, ~500 chars) */
  summaryHtml?: string;
  /** Whether summaryHtml was truncated (content continues beyond excerpt) */
  summaryHasMore?: boolean;
  /** URL for link/quote formats */
  url?: string;
  /** Quoted text for quote format */
  quoteText?: string;

  // Metadata
  format: Format;
  status: Status;
  visibility: Visibility;
  pinned: boolean;
  /** Whether pinned within the current collection context */
  pinnedInCollection?: boolean;
  featured: boolean;
  /** ISO 8601 string for when the post was added to Featured. */
  featuredAt?: string;
  /** Human-readable featured date, e.g. "Feb 1, 2024" */
  featuredAtFormatted?: string;
  /** 24-hour featured time, e.g. "23:05" */
  featuredAtTime?: string;
  rating?: number;
  /**
   * BCP 47 content language, on Thread roots of a multilingual site. Absent on
   * replies (they follow the root) and on sites that publish one language.
   */
  language?: string;

  // Link preview
  /** Preview kind: "video", "image", etc. */
  previewKind?: string;
  /** Preview provider: "youtube", "vimeo", etc. */
  previewProvider?: string;
  /** Pre-computed preview image URL */
  previewImageUrl?: string;

  // Time -- pre-formatted
  /** ISO 8601 string */
  publishedAt: string;
  /** Human-readable, e.g. "Feb 1, 2024" */
  publishedAtFormatted: string;
  /** 24-hour time, e.g. "23:05" */
  publishedAtTime: string;
  /** Short relative time, e.g. "5m", "3h", "2d", "Feb 1" */
  publishedAtRelative: string;
  /** ISO 8601 string */
  updatedAt: string;

  // Media -- URLs pre-computed
  media: MediaView[];

  // Thread-level Collections projected onto this post
  collections: CollectionTagView[];

  // Thread context
  /** TypeID of the parent post */
  replyToId?: string;
  /** TypeID of the thread root post */
  threadRootId?: string;
  /** Whether this post is the last (most recent) in its thread. Controls reply button visibility. */
  isLastInThread: boolean;
  /**
   * TypeID of an unpublished draft that already ends this thread, set only for
   * the signed-in author on surfaces that do not render drafts. Replying here
   * would fork the chain, so the reply affordance resumes that draft instead.
   */
  draftTailId?: string;
  /** Number of published replies in this thread when relevant to the current view. */
  replyCount?: number;

  // Raw content (for forms/editing, not typical theme use)
  body?: string;
}

/**
 * Render-ready post data for feeds.
 * Feed timestamps can differ from on-page timestamps when a feed represents a
 * curation event rather than original publication time.
 */
export interface FeedPostView extends PostView {
  /** Optional ISO 8601 timestamp used for Atom `<published>` */
  feedPublishedAt?: string;
  /** Optional ISO 8601 timestamp used for Atom `<updated>` */
  feedUpdatedAt?: string;
  /** Thread replies to render inline in the feed entry content */
  threadReplies?: PostView[];
}

/**
 * Render-ready media data for theme components.
 * URLs are pre-computed -- no lib/ imports needed.
 */
export interface MediaView {
  id: string;
  /** Full-size URL, pre-computed */
  url: string;
  /** Thumbnail URL, pre-computed */
  thumbnailUrl: string;
  mimeType: string;
  altText?: string;
  width?: number;
  height?: number;
  durationSeconds?: number;
  size?: number;
  blurhash?: string;
  waveform?: string;
  posterUrl?: string;
  originalName?: string;
  summary?: string;
  chars?: number;
}

/**
 * Render-ready navigation item for theme components.
 * Active/external state pre-computed.
 */
export interface NavItemView {
  /** TypeID identifier */
  id: string;
  type: NavItemType;
  systemKey?: SystemNavKey;
  collectionId?: string;
  postId?: string;
  label: string;
  url: string;
  /** "header" = visible in nav bar, "more" = under More dropdown */
  placement: NavItemPlacement;
  /** Pre-computed based on currentPath */
  isActive: boolean;
  /** Pre-computed: starts with http(s):// */
  isExternal: boolean;
  /** Collection nav items: true when collection has recent activity */
  isFresh?: boolean;
  /** Unix timestamp of the latest activity that triggered freshness */
  freshAt?: number;
}

export type SuggestedNavLinkTargetType = "page" | "collection" | "archive";

export type SuggestedNavLinkNavItemType = "link" | "collection" | "page";

export interface SuggestedNavLink {
  key: string;
  label: string;
  url: string;
  targetType: SuggestedNavLinkTargetType;
  navItemType: SuggestedNavLinkNavItemType;
  collectionId?: string;
  postId?: string;
}

/** A published titled note eligible to be added to site navigation. */
export interface NavigationPageCandidate {
  id: string;
  title: string;
  slug: string;
  updatedAt: number;
}

/**
 * Search result from FTS5
 */
export interface SearchResult {
  post: Post;
  /** FTS5 rank score (lower is better) */
  rank: number;
  /** Highlighted snippet from content */
  snippet?: string;
}

/**
 * Render-ready search result for theme components.
 */
export interface SearchResultView {
  post: PostView;
  rank: number;
  /** FTS5 snippet from body_text column with <mark> tags */
  snippet?: string;
  /** Title with matched query terms wrapped in <mark> */
  titleHighlighted?: string;
  /** quoteText (truncated) with matched query terms wrapped in <mark> */
  quoteHighlighted?: string;
}

/**
 * Render-ready timeline item for theme components.
 */
export interface TimelineItemView {
  post: PostView;
  threadPreview?: {
    leadingReplies: PostView[];
    trailingReplies: PostView[];
    latestReply: PostView;
    totalReplyCount: number;
  };
  curatedThread?: {
    rootPost: PostView;
    /** Show ratings on non-highlighted context posts (complete Collection Threads). */
    showContextRatings: boolean;
    segments: {
      post: PostView;
      hiddenBeforeCount: number;
      highlighted: boolean;
    }[];
  };
}

/**
 * Typed archive group with pre-formatted label.
 */
export interface ArchiveGroup {
  /** e.g. "2024" */
  year: string;
  /** e.g. "02" */
  month: string;
  /** Pre-formatted, e.g. "February 2024" */
  label: string;
  /** Total thread roots in this month across the full filtered result set */
  totalCount?: number;
  posts: PostView[];
  items?: TimelineItemView[];
}

/**
 * Site Layout Props
 */
/** One `<link rel="alternate" hreflang>` target. */
export interface LanguageAlternate {
  /** BCP 47 tag, or `x-default` for the entry point. */
  hreflang: string;
  /** Absolute URL. */
  href: string;
}

/** One entry in the site's language switcher. */
export interface LanguageSwitcherOption {
  /** Canonical BCP 47 tag. */
  lang: string;
  /** The language's own name for itself, e.g. "日本語". */
  label: string;
  /** Where switching to this language takes the reader. */
  href: string;
  /** Whether this is the language currently on screen. */
  isCurrent: boolean;
}

export interface SiteLayoutProps {
  siteName: string;
  links: NavItemView[];
  currentPath: string;
  sitePathPrefix?: string;
  isAuthenticated?: boolean;
  collections?: Collection[];
  siteAvatarUrl?: string;
  showHeaderAvatar?: boolean;
  siteDescriptionHtml?: string;
  siteFooterHtml?: string;
  showHomeBranding?: boolean;
  sidebar?: import("hono/jsx").Child;
  uploadMaxFileSize?: number;
  showComposeDialog?: boolean;
  showHeader?: boolean;
  composeOpenShortcutDiscovered?: boolean;
  slashCommandDiscovered?: boolean;
  /** When set, the mobile compose FAB pre-selects this collection. */
  composeCollectionId?: string;
  /**
   * Languages this site publishes in, for the header's language switcher.
   * Empty on a single-language site, which renders no switcher at all.
   */
  languageSwitcher?: LanguageSwitcherOption[];
  /** Languages offered in the composer. Empty on a single-language site. */
  composeLanguages?: Array<{ tag: string; label: string }>;
}
