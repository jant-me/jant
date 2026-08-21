/**
 * Type definitions for the collection dialog.
 */

import type { CollectionSortOrder } from "../../types.js";

/** What the dialog hands back to whoever opened it. */
export interface CollectionDialogResult {
  /** Whether anything was created or saved. */
  changed: boolean;
  /**
   * The collection as it stands after saving.
   *
   * The caller needs it: a directory flags the row it just created, and a
   * collection page has to follow its own address when the link moved.
   */
  collection?: {
    id: string;
    slug: string;
    title: string;
  };
}

export interface CollectionDialogLabels {
  createHeading: string;
  editHeading: string;
  title: string;
  titlePlaceholder: string;
  /** The collection link, in the collection form's own words. */
  link: string;
  linkHelp: string;
  editLink: string;
  resetLink: string;
  linkTaken: string;
  linkInvalid: string;
  linkReserved: string;
  linkTooLong: string;
  linkMovesWarning: string;
  description: string;
  descriptionPlaceholder: string;
  orderBy: string;
  sortOptions: Record<CollectionSortOrder, string>;
  cancel: string;
  save: string;
  saved: string;
  saveFailed: string;
  loadFailed: string;
  titleAndLinkRequired: string;
}
