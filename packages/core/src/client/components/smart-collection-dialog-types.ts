/**
 * Type definitions for the smart collection dialog.
 */

import type { FILTER_DIMENSION_KEYS } from "../../lib/filter-dimensions.js";

/** One condition row: which dimension, and the value it holds. */
export interface SmartConditionRow {
  key: (typeof FILTER_DIMENSION_KEYS)[number];
  /**
   * The value in its URL spelling.
   *
   * The same string the query string carries, because the registry's parser is
   * the only thing that turns a control's output into a stored value. A control
   * that invented its own encoding would be a second vocabulary.
   */
  value: string;
}

/** Everything the dialog can be opened with. */
export interface SmartCollectionDialogState {
  title?: string;
  description?: string | null;
  selection?: Record<string, unknown>;
  sort?: string;
  layout?: string | null;
}

export interface SmartCollectionDialogLabels {
  createHeading: string;
  editHeading: string;
  title: string;
  address: string;
  addressTaken: string;
  addressMovesWarning: string;
  description: string;
  conditionsHeading: string;
  matchAllHint: string;
  noConditions: string;
  addCondition: string;
  removeCondition: string;
  countSummary: string;
  counting: string;
  displayHeading: string;
  orderBy: string;
  layout: string;
  deleteSmartCollection: string;
  confirmDelete: string;
  cancel: string;
  save: string;
  saved: string;
  deleted: string;
  saveFailed: string;
  loadFailed: string;
  titleAndAddressRequired: string;
  /** Dimension names, keyed by dimension key. */
  dimensions: Record<string, string>;
  /** Value labels, keyed by `<dimension>.<value>`. */
  values: Record<string, string>;
  sortOptions: Record<string, string>;
  layoutOptions: Record<string, string>;
}
