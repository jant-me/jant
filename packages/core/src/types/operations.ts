/**
 * Operation Types (create/update DTOs)
 */

import type {
  Format,
  Status,
  Visibility,
  CollectionSortOrder,
  SystemNavKey,
  NavItemPlacement,
  TextAttachmentContentFormat,
} from "./constants.js";

export type PostAttachmentInput =
  | {
      type: "media";
      mediaId: string;
      alt?: string;
    }
  | {
      type: "text";
      contentFormat: TextAttachmentContentFormat;
      content: string;
      summary?: string;
    };

export interface TextAttachmentContent {
  id: string;
  type: "text";
  contentFormat: TextAttachmentContentFormat;
  content: string;
  summary: string | null;
  chars: number | null;
}

/**
 * A single Thread collection membership entry, with all the per-row metadata
 * the `thread_collection` junction table carries. Used by the Hugo importer to
 * restore per-entry `createdAt` / `position` / `pinnedAt` losslessly.
 */
export interface ThreadCollectionEntry {
  collectionId: string;
  /** Unix seconds — when the Thread was added to the collection. Defaults to now() when omitted. */
  createdAt?: number;
  /** Sort position within the collection. Defaults to append-at-end when omitted. */
  position?: number;
  /** Unix seconds when the Thread was pinned in this specific collection; null means unpinned. */
  pinnedAt?: number | null;
}

export interface CreatePost {
  format: Format;
  status?: Status;
  visibility?: Visibility;
  /**
   * Admin-UI shorthand. `true` = pinned at `now()`, `false` = not pinned.
   * Mutually exclusive with `pinnedAt`; if both are set, `pinnedAt` wins.
   */
  pinned?: boolean;
  /** See `pinned`. */
  featured?: boolean;
  /**
   * Explicit featured timestamp (Unix seconds). `null` = not featured.
   * Preferred for lossless import; wins over `featured` when both are set.
   */
  featuredAt?: number | null;
  /**
   * Explicit pinned timestamp (Unix seconds). `null` = not pinned.
   * Preferred for lossless import; wins over `pinned` when both are set.
   */
  pinnedAt?: number | null;
  slug?: string;
  path?: string;
  title?: string;
  url?: string;
  body?: string;
  bodyMarkdown?: string;
  quoteText?: string;
  rating?: number;
  /**
   * Simple slug/ID list for the shared Thread collection set. Set this while
   * creating a Thread root; reply creation rejects non-empty membership input.
   * Uses `now()` for `createdAt` and append-at-end for `position`. For lossless
   * import that preserves those fields, use `collectionEntries` instead.
   */
  collectionIds?: string[];
  /**
   * Structured per-collection entries. When provided, replaces any
   * `collectionIds` and restores per-entry `createdAt` / `position` /
   * `pinnedAt` losslessly.
   */
  collectionEntries?: ThreadCollectionEntry[];
  replyToId?: string;
  quietReply?: boolean;
  /**
   * BCP 47 content language. Ignored for replies, which always inherit the
   * Thread root's language so a language filter stays a plain column predicate.
   * Omitted on single-language sites, where the column stays NULL.
   */
  language?: string | null;
  /**
   * Thread root ID this Post is a translation of. The service joins both into
   * one translation group when the Post is created, minting the group on the
   * source Post if it does not have one yet. Roots only.
   */
  translationOfId?: string;
  publishedAt?: number;
  attachments?: PostAttachmentInput[];
}

export interface UpdatePost {
  format?: Format;
  status?: Status;
  visibility?: Visibility;
  /** See `CreatePost.pinned`. */
  pinned?: boolean;
  /** See `CreatePost.featured`. */
  featured?: boolean;
  /** Explicit featured timestamp. `undefined` leaves the field unchanged. */
  featuredAt?: number | null;
  /** Explicit pinned timestamp. `undefined` leaves the field unchanged. */
  pinnedAt?: number | null;
  slug?: string;
  title?: string | null;
  url?: string | null;
  body?: string | null;
  bodyMarkdown?: string | null;
  quoteText?: string | null;
  rating?: number | null;
  collectionIds?: string[];
  collectionEntries?: ThreadCollectionEntry[];
  publishedAt?: number;
  /**
   * Content language. Applied to the whole Thread, like
   * `PostService.setThreadLanguage` — a Thread is written in one language, and
   * that is what keeps every language filter a plain column predicate. Ignored
   * on replies, which follow their root.
   */
  language?: string | null;
  attachments?: PostAttachmentInput[];
}

export type CreateNavItem =
  | {
      type: "link";
      label: string;
      url: string;
      placement?: NavItemPlacement;
      position?: string;
    }
  | {
      type: "system";
      systemKey: SystemNavKey;
      placement?: NavItemPlacement;
      position?: string;
    }
  | {
      // The URL is derived from the collection's slug and is not accepted
      // here; an omitted label means the item follows the collection's title.
      type: "collection";
      collectionId: string;
      label?: string;
      placement?: NavItemPlacement;
      position?: string;
    }
  | {
      type: "page";
      postId: string;
      label?: string;
      placement?: NavItemPlacement;
      position?: string;
    };

export interface UpdateNavItem {
  label?: string;
  url?: string;
  placement?: NavItemPlacement;
  position?: string;
}

export interface CreateCollection {
  slug: string;
  title: string;
  description?: string;
  sortOrder?: CollectionSortOrder;
}

export interface UpdateCollection {
  slug?: string;
  title?: string;
  description?: string | null;
  sortOrder?: CollectionSortOrder;
}

export type CreateCollectionDirectoryEntry =
  | {
      type: "collection";
      collectionId: string;
    }
  | {
      type: "divider";
      label?: string | null;
    }
  | {
      type: "link";
      label: string;
      url: string;
      description?: string | null;
    };

export interface UpdateCollectionDirectoryEntry {
  label?: string | null;
  url?: string;
  description?: string | null;
}
