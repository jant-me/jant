/**
 * Content Type Constants
 */

export const FORMATS = ["note", "link", "quote"] as const;
export type Format = (typeof FORMATS)[number];

export const STATUSES = ["draft", "published"] as const;
export type Status = (typeof STATUSES)[number];

export const VISIBILITIES = ["public", "latest_hidden", "private"] as const;
export type Visibility = (typeof VISIBILITIES)[number];

export const FEED_KINDS = ["latest", "featured"] as const;
export type FeedKind = (typeof FEED_KINDS)[number];

/**
 * Layouts the archive page can render in. `list` renders the same timeline the
 * rest of the nav trio uses; `grid` renders the tile catalogue.
 *
 * Named "layout", not "view": on the archive, `view` is reserved for the
 * saved-selection concept, and the URL param follows the same split
 * (`?layout=grid`, with `?view=` kept only as the legacy spelling).
 */
export const ARCHIVE_LAYOUTS = ["list", "grid"] as const;
export type ArchiveLayout = (typeof ARCHIVE_LAYOUTS)[number];

/**
 * Visibility values a signed-out reader may select on the archive.
 *
 * `featured` is a virtual member: it is a separate flag rather than a stored
 * visibility, and it lives here because the filter bar presents the two as one
 * dimension.
 *
 * `private` is deliberately absent. It names a set only the author can see, so
 * a reader who asks for it has to be told so — handing back a different set
 * under the same name is the one answer that is never right.
 */
export const PUBLIC_ARCHIVE_VISIBILITIES = [
  "public",
  "featured",
  "latest_hidden",
] as const;

/** Every visibility the author can select, in filter-bar order. */
export const ARCHIVE_VISIBILITIES = [
  ...PUBLIC_ARCHIVE_VISIBILITIES,
  "private",
] as const;

export type ArchiveVisibility = (typeof ARCHIVE_VISIBILITIES)[number];

/**
 * The range a `year` filter may name, inclusive at both ends.
 *
 * Unix timestamps start in 1970, so anything at or below it is a parse failure
 * rather than a very old archive.
 *
 * The ceiling is not pedantry. A year is translated into a pair of bounds with
 * `Date.UTC`, which returns `NaN` past year 275760 — and a `NaN` bound is a
 * comparison every row silently fails, so the page renders empty with nothing
 * to explain it. Four digits is the largest year a post can honestly carry, and
 * it is bounded in three places at once: the URL parser, the stored condition's
 * validator, and the table CHECK in both dialects.
 */
export const EARLIEST_FILTERABLE_YEAR = 1971;
export const LATEST_FILTERABLE_YEAR = 9999;

/**
 * How a chronological query orders its results.
 *
 * `newest` and `oldest` read whichever time axis `PostFilters.sortBy` selects,
 * so "newest" on the activity axis means "last gained a post" and on the
 * published axis means "published last".
 *
 * Not to be confused with the archive's `?sort=`, which names a *time axis*
 * (`published` / `updated`) and always runs newest-first. Two vocabularies, and
 * mixing them is how month headers stop agreeing with the order beneath them.
 */
export const SORT_ORDERS = ["newest", "oldest", "rating_desc"] as const;
export type SortOrder = (typeof SORT_ORDERS)[number];

/**
 * The orders a collection offers its readers — the same three, deliberately.
 *
 * Kept as its own name because the two vocabularies answer different questions
 * (one orders a query, one is stored on a collection row and shown in a menu),
 * and pointing them at one array is what keeps them from drifting apart the way
 * the smart collection's fourth order once did.
 */
export const COLLECTION_SORT_ORDERS = SORT_ORDERS;
export type CollectionSortOrder = SortOrder;

/**
 * How a smart collection orders the posts its conditions gather.
 *
 * Identical to a manual collection's orders, and for the same reasons: on both,
 * `newest` means the Thread that last gained a post, not the Thread published
 * last. A smart collection briefly carried a fourth order named `updated` that
 * said the same thing in different words; folding it into `newest` left one
 * menu the reader can learn once.
 */
export const SMART_COLLECTION_SORT_ORDERS = COLLECTION_SORT_ORDERS;
export type SmartCollectionSortOrder = CollectionSortOrder;

export const NAV_ITEM_TYPES = [
  "link",
  "system",
  "collection",
  "smart_collection",
  "page",
] as const;
export type NavItemType = (typeof NAV_ITEM_TYPES)[number];

export const NAV_ITEM_PLACEMENTS = ["header", "more"] as const;
export type NavItemPlacement = (typeof NAV_ITEM_PLACEMENTS)[number];

export const SYSTEM_NAV_KEY_VALUES = [
  "latest",
  "featured",
  "collections",
  "archive",
  "rss",
  "settings",
] as const;
export type SystemNavKey = (typeof SYSTEM_NAV_KEY_VALUES)[number];

export const SYSTEM_NAV_KEYS = {
  latest: {
    defaultLabel: "Latest",
    url: "/latest",
    defaultPlacement: "header",
  },
  featured: {
    defaultLabel: "Featured",
    url: "/featured",
    defaultPlacement: "header",
  },
  collections: {
    defaultLabel: "Collections",
    url: "/collections",
    // The header switches between how much of one list you see (Featured /
    // Latest / All). Collections is a different axis — what a post is about —
    // and readers reach that through the collection tags on posts they are
    // already reading, so it starts one level down instead of widening the
    // header for everyone.
    defaultPlacement: "more",
  },
  archive: {
    defaultLabel: "All",
    url: "/archive",
    defaultPlacement: "header",
  },
  rss: { defaultLabel: "RSS", url: "/feed", defaultPlacement: "more" },
  settings: {
    defaultLabel: "Settings",
    url: "/settings",
    defaultPlacement: "more",
  },
} as const satisfies Record<
  SystemNavKey,
  {
    defaultLabel: string;
    url: string;
    defaultPlacement: NavItemPlacement;
  }
>;

export interface DefaultNavigationProfile {
  version: number;
  systemKeys: readonly SystemNavKey[];
}

/**
 * Append-only default navigation profiles. A profile is materialized during
 * initial setup/provisioning and incomplete-setup recovery. Existing rows are
 * never removed, updated, or reordered to match a profile.
 */
export const DEFAULT_NAVIGATION_PROFILES = {
  1: {
    version: 1,
    systemKeys: ["featured", "collections", "archive", "rss", "settings"],
  },
  // Featured and All sit next to each other because they are the same list at
  // two widths; version 1 split that pair with Collections, which reads as a
  // third unrelated section rather than the wide end of one range.
  2: {
    version: 2,
    systemKeys: ["featured", "archive", "collections", "rss", "settings"],
  },
} as const satisfies Record<number, DefaultNavigationProfile>;

export const DEFAULT_NAVIGATION_PROFILE_VERSION = 2 as const;
export const DEFAULT_NAVIGATION_PROFILE =
  DEFAULT_NAVIGATION_PROFILES[DEFAULT_NAVIGATION_PROFILE_VERSION];

export const MAX_MEDIA_ATTACHMENTS = 20;
export const MAX_THREAD_POSTS = 20;
export const MAX_PINNED_POSTS = 3;
export const MAX_COLLECTION_SLUG_LENGTH = 200;
export const MAX_COLLECTION_TITLE_LENGTH = 120;
export const MAX_COLLECTION_DESCRIPTION_LENGTH = 2000;
export const MAX_SITE_NAME_LENGTH = 120;
export const MAX_SITE_DESCRIPTION_LENGTH = 1000;
export const MAX_SITE_FOOTER_LENGTH = 5000;

export const TEXT_ATTACHMENT_CONTENT_FORMATS = ["markdown"] as const;
export type TextAttachmentContentFormat =
  (typeof TEXT_ATTACHMENT_CONTENT_FORMATS)[number];

export const MEDIA_KINDS = [
  "image",
  "video",
  "audio",
  "text",
  "document",
] as const;
export type MediaKind = (typeof MEDIA_KINDS)[number];

export const STORAGE_DRIVERS = ["r2", "s3", "local"] as const;
export type StorageDriver = (typeof STORAGE_DRIVERS)[number];

export const PATH_KINDS = ["slug", "alias", "redirect", "archive"] as const;
export type PathKind = (typeof PATH_KINDS)[number];

/**
 * Row kinds the collections directory can hold.
 *
 * A `collection` row points at a collection and carries no text of its own; a
 * `divider` and a `link` carry text and point at nothing. The table CHECK in
 * both dialects is generated from this list, so a new kind is one edit here
 * plus the shape branch that describes which columns it fills.
 */
export const COLLECTION_DIRECTORY_ENTRY_TYPES = [
  "collection",
  "smart_collection",
  "divider",
  "link",
] as const;
export type CollectionDirectoryEntryType =
  (typeof COLLECTION_DIRECTORY_ENTRY_TYPES)[number];

/** How long a collection nav item stays "fresh" after new content is added */
export const COLLECTION_FRESHNESS_WINDOW_SECONDS = 48 * 60 * 60;

export const SITE_STATUSES = ["active", "suspended"] as const;
export type SiteStatus = (typeof SITE_STATUSES)[number];

export const SITE_DOMAIN_KINDS = ["primary", "alias"] as const;
export type SiteDomainKind = (typeof SITE_DOMAIN_KINDS)[number];

export const SITE_MEMBER_ROLES = ["owner", "admin", "editor"] as const;
export type SiteMemberRole = (typeof SITE_MEMBER_ROLES)[number];

export const UPLOAD_SESSION_STATES = [
  "pending",
  "uploaded",
  "completed",
  "aborted",
  "failed",
] as const;
export type UploadSessionState = (typeof UPLOAD_SESSION_STATES)[number];

/** How a stored object is served: rendered in place, or downloaded. */
export const CONTENT_DISPOSITIONS = ["inline", "attachment"] as const;
export type ContentDisposition = (typeof CONTENT_DISPOSITIONS)[number];

export const GITHUB_APP_ACCOUNT_TYPES = ["User", "Organization"] as const;
export type GithubAppAccountType = (typeof GITHUB_APP_ACCOUNT_TYPES)[number];
