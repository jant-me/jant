/**
 * Shared type definitions for the nav manager Lit component.
 */

import type { SystemNavKey } from "../../types/constants.js";
import type { CollectionFormLabels } from "./collection-types.js";

export interface NavManagerItem {
  id: string;
  type: "link" | "system" | "collection" | "page";
  systemKey?: SystemNavKey;
  collectionId?: string;
  postId?: string;
  /** Author's override, or `""` when the item follows its target's title */
  label: string;
  /** Resolved label from the server-rendered list */
  displayLabel?: string;
  /** Target's current title, present on mutation responses */
  targetTitle?: string;
  url: string;
  placement?: "header" | "more";
}

export interface NavManagerPage {
  id: string;
  title: string;
  slug: string;
  updatedAt: number;
}

/**
 * What the server made of an address the author pasted into the page picker:
 * the item it could become, or why it cannot become one.
 *
 * `address` is what to show back and what to prefill the link form with — the
 * public path for anything on this site, the pasted URL for anything else.
 */
export type NavAddressResolution =
  | { kind: "page"; address: string; page: NavManagerPage }
  | {
      kind: "collection";
      address: string;
      collection: { id: string; title: string; slug: string };
    }
  | {
      kind:
        | "external"
        | "link_only"
        | "untitled"
        | "unpublished"
        | "private"
        | "not_found";
      address: string;
    };

export interface SystemNavConfig {
  key: SystemNavKey;
  label: string;
  description: string;
}

/** A collection entry in the picker, with optional group context */
export interface NavManagerCollection {
  id: string;
  title: string;
  slug: string;
  /** Group label from directory divider, if this collection belongs to one */
  group?: string | null;
}

export interface NavManagerSuggestedLink {
  key: string;
  label: string;
  url: string;
  targetType: "page" | "collection" | "archive";
  targetLabel: string;
  navItemType: "link" | "collection" | "page";
  collectionId?: string;
  postId?: string;
}

export interface NavManagerLabels {
  preview: string;
  navigationItems: string;
  emptyState: string;
  link: string;
  page: string;
  system: string;
  toggleEdit: string;
  label: string;
  url: string;
  save: string;
  delete: string;
  remove: string;
  confirmDeleteLink: string;
  confirmDeletePage: string;
  orderSaved: string;
  labelRequired: string;
  saveFailed: string;
  deleteFailed: string;
  systemLinks: string;
  systemLinksDescription: string;
  addCustomLinkToNavigation: string;
  addLink: string;
  addLinkDescription: string;
  urlPlaceholder: string;
  labelAndUrlRequired: string;
  suggestedLinks: string;
  suggestedLinksDescription: string;
  addSuggestedLink: string;
  suggestedLinkAdded: string;
  addPageToNavigation: string;
  addPageDescription: string;
  addPage: string;
  searchPages: string;
  searchPagesHint: string;
  recentPages: string;
  addressMatch: string;
  addressAlreadyAdded: string;
  addressNotFound: string;
  addressUnpublished: string;
  addressPrivate: string;
  addressUntitled: string;
  addressExternal: string;
  addressLinkOnly: string;
  addressAddAsLink: string;
  searchingPages: string;
  noMatchingPages: string;
  noPages: string;
  pageSearchFailed: string;
  createNewPage: string;
  createPage: string;
  createPageDescription: string;
  pageTitle: string;
  pageAddress: string;
  pageVisibilityHint: string;
  titleRequired: string;
  slugInvalid: string;
  slugReserved: string;
  slugTooLong: string;
  slugUnavailable: string;
  checkingAddress: string;
  creatingPage: string;
  createPageFailed: string;
  pageCreated: string;
  pageCreatedDescription: string;
  addToNavigation: string;
  editPage: string;
  pageAdded: string;
  back: string;
  collection: string;
  addCollection: string;
  addCollectionToNavigation: string;
  addCollectionDescription: string;
  allCollectionsAdded: string;
  noCollections: string;
  createNewCollection: string;
  createCollection: string;
  creatingCollection: string;
  createCollectionFailed: string;
  collectionCreatedDescription: string;
  editCollection: string;
  collectionAdded: string;
  collectionFormLabels: CollectionFormLabels;
  confirmDeleteCollection: string;
  headerSection: string;
  moreSection: string;
  moreEmptyHint: string;
  placementSaved: string;
  cancel: string;
}
