/**
 * Type definitions for the collections page manager component.
 */

import type { CollectionFormLabels } from "./collection-types.js";

export interface CollectionManagerLabels {
  collectionsTitle: string;
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

export interface CollectionManagerItem {
  id: string;
  type: "collection" | "divider" | "link";
  collectionId?: string | null;
  label?: string | null;
  url?: string | null;
  description?: string | null;
  position?: string;
  collection?: ManagedCollection;
}
