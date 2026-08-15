/**
 * Entity Types (database-level models)
 */

import type {
  Format,
  Status,
  Visibility,
  CollectionSortOrder,
  NavItemType,
  NavItemPlacement,
  SystemNavKey,
  MediaKind,
  PathKind,
  SiteStatus,
  SiteDomainKind,
  SiteMemberRole,
} from "./constants.js";

export interface Site {
  id: string;
  key: string;
  status: SiteStatus;
  createdAt: number;
  updatedAt: number;
}

export interface SiteDomain {
  id: string;
  siteId: string;
  host: string;
  pathPrefix: string | null;
  kind: SiteDomainKind;
  redirectToPrimary: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface SiteMember {
  siteId: string;
  userId: string;
  role: SiteMemberRole;
  createdAt: number;
  updatedAt: number;
}

export interface Post {
  id: string;
  siteId: string;
  format: Format;
  status: Status;
  visibility: Visibility;
  pinnedAt: number | null;
  featuredAt: number | null;
  slug: string;
  title: string | null;
  url: string | null;
  body: string | null;
  bodyHtml: string | null;
  bodyText: string | null;
  quoteText: string | null;
  summary: string | null;
  rating: number | null;
  previewImageKey: string | null;
  previewKind: string | null;
  previewProvider: string | null;
  replyToId: string | null;
  threadId: string;
  /**
   * BCP 47 content language, canonical form. Uniform across a Thread. `null`
   * only until the site first enables multilingual content.
   */
  language: string | null;
  /**
   * Shared key for Posts that are translations of one another. Roots only.
   */
  translationGroupId: string | null;
  /** Reply published without announcing it on Latest. Always false on roots. */
  quietReply: boolean;
  publishedAt: number | null;
  /** Root only: newest published post in the Thread, quiet replies excluded. */
  lastActivityAt: number;
  /** Root only: newest published post in the Thread, quiet replies included. */
  threadUpdatedAt: number;
  createdAt: number;
  updatedAt: number;
}

export interface Media {
  id: string; // TypeID
  siteId: string;
  postId: string | null;
  filename: string;
  originalName: string;
  mimeType: string;
  size: number;
  storageKey: string;
  provider: string;
  width: number | null;
  height: number | null;
  durationSeconds: number | null;
  alt: string | null;
  position: string;
  blurhash: string | null;
  waveform: string | null;
  posterKey: string | null;
  summary: string | null;
  chars: number | null;
  mediaKind: MediaKind;
  createdAt: number;
  updatedAt: number;
}

export interface MediaAttachment {
  id: string;
  url: string;
  previewUrl: string;
  alt: string | null;
  blurhash: string | null;
  waveform: string | null;
  posterUrl: string | null;
  width: number | null;
  height: number | null;
  durationSeconds: number | null;
  position: string;
  mimeType: string;
  originalName: string;
  size: number;
  summary: string | null;
  chars: number | null;
}

export interface PostWithMedia extends Post {
  mediaAttachments: MediaAttachment[];
}

export interface Collection {
  id: string;
  siteId: string;
  slug: string;
  title: string;
  description: string | null;
  sortOrder: CollectionSortOrder;
  createdAt: number;
  updatedAt: number;
}

export interface CollectionDirectoryCollection extends Collection {
  threadCount: number;
  recentActivityAt: number;
}

export type CollectionDirectoryEntryType = "collection" | "divider" | "link";

export interface CollectionDirectoryEntry {
  id: string;
  siteId: string;
  type: CollectionDirectoryEntryType;
  collectionId: string | null;
  label: string | null;
  url: string | null;
  description: string | null;
  position: string;
  createdAt: number;
  updatedAt: number;
}

export interface CollectionDirectoryItem {
  id: string;
  type: CollectionDirectoryEntryType;
  label?: string | null;
  url?: string | null;
  description?: string | null;
  collection?: CollectionDirectoryCollection;
}

export interface CollectionsDirectoryData {
  collections: CollectionDirectoryCollection[];
  items: CollectionDirectoryItem[];
  directoryItems: CollectionDirectoryEntry[];
}

export interface ThreadCollection {
  siteId: string;
  threadId: string;
  collectionId: string;
}

export interface NavItem {
  id: string;
  siteId: string;
  type: NavItemType;
  systemKey?: SystemNavKey;
  collectionId?: string;
  postId?: string;
  /**
   * Author's override, or `""` when the item follows whatever it points at.
   *
   * Empty is the normal state: a page or collection item shows its target's
   * current title, a built-in item shows its translated default. Only a label
   * the author typed is stored here, and it then wins in every language view.
   */
  label: string;
  url: string;
  /**
   * Current title of the post or collection this item points at, resolved at
   * read time. The display label when `label` is empty — see
   * `getNavItemDisplayLabel`. Absent for `link` and `system` items, which have
   * no target row to follow.
   */
  targetTitle?: string;
  placement: NavItemPlacement;
  position: string;
  createdAt: number;
  updatedAt: number;
}

export interface CustomUrl {
  id: string;
  path: string;
  targetType: "post" | "collection" | "redirect" | "archive";
  targetId: string | null;
  toPath: string | null;
  redirectType: 301 | 302 | null;
  archiveQuery: string | null;
  createdAt: number;
}

export interface PathRecord {
  id: string;
  siteId: string;
  path: string;
  kind: PathKind;
  postId: string | null;
  collectionId: string | null;
  redirectToPath: string | null;
  redirectType: 301 | 302 | null;
  archiveQuery: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface Setting {
  siteId: string;
  key: string;
  value: string;
  updatedAt: number;
}

export interface ApiToken {
  id: string;
  siteId: string;
  name: string;
  prefix: string;
  lastUsedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

/** Bounded reply context for a thread root, used in timeline display. */
export interface ThreadTimelineContext {
  /** Earliest published replies, in chronological order. */
  leadingReplies: Post[];
  /** Published replies immediately before latest, in chronological order. */
  trailingReplies: Post[];
  latestReply: Post;
  totalReplyCount: number;
}
