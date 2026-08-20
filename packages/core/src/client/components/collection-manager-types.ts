/**
 * Type definitions for the collections page manager component.
 */

import type { CollectionFormLabels } from "./collection-types.js";

export interface CollectionManagerLabels {
  collectionsTitle: string;
  newSmartCollection: string;
  editSmartCollection: string;
  deleteSmartCollection: string;
  confirmDeleteSmartCollection: string;
  turnIntoSmartCollection: string;
  smartCollectionDeleted: string;
  organize: string;
  done: string;
  organizeHint: string;
  newDivider: string;
  newLink: string;
  addLink: string;
  addLinkDescription: string;
  dividerLabel: string;
  dividerLabelPlaceholder: string;
  newCollection: string;
  edit: string;
  addToNavigation: string;
  addingToNavigation: string;
  addedToNavigation: string;
  editNavigation: string;
  addToNavigationFailed: string;
  notNow: string;
  label: string;
  url: string;
  linkLabelPlaceholder: string;
  linkUrlPlaceholder: string;
  linkDescriptionLabel: string;
  linkDescriptionPlaceholder: string;
  labelAndUrlRequired: string;
  deleteDivider: string;
  moreActions: string;
  deleteCollection: string;
  confirmDelete: string;
  deleteLink: string;
  confirmDeleteLink: string;
  cancel: string;
  threadSingular: string;
  threadPlural: string;
  emptyState: string;
  orderSaved: string;
  saved: string;
  linkCreated: string;
  linkSaved: string;
  saveFailed: string;
  deleted: string;
  linkDeleted: string;
  formLabels: CollectionFormLabels;
}

export interface ManagedCollection {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  sortOrder: string;
  threadCount: number;
  recentActivityAt: number;
}

/**
 * A smart collection as the directory manager sees it.
 *
 * `recentActivityAt` has no counterpart here. A manual collection's freshness
 * is when a thread was last added to it — an editorial act with a timestamp. A
 * smart collection has no such act: membership follows the conditions, so there
 * is nothing to date.
 */
export interface ManagedSmartCollection {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  /** Conditions, in the shared dimension vocabulary. */
  selection: Record<string, unknown>;
  sort: string;
  layout: string | null;
  threadCount: number;
}

export interface CollectionManagerItem {
  id: string;
  type: "collection" | "smart_collection" | "divider" | "link";
  collectionId?: string | null;
  smartCollectionId?: string | null;
  label?: string | null;
  url?: string | null;
  description?: string | null;
  position?: string;
  collection?: ManagedCollection;
  smartCollection?: ManagedSmartCollection;
}
