import { msg } from "@lingui/core/macro";
import type { I18n } from "../../i18n/i18n.js";
import type {
  DimensionContext,
  PostFilterSelection,
} from "../../lib/filter-dimensions.js";
import {
  describeFilterSelection,
  serializePostFilterSelection,
} from "../../lib/filter-dimensions.js";

type Translator = Pick<I18n, "_">;

/** Separator between conditions on the condition line. */
const CONDITION_SEPARATOR = " · ";

/**
 * What a smart collection gathers, in one line every reader sees.
 *
 * Not an owner-only detail. It changes how the page is read: a manual
 * collection is an editorial claim, a smart collection is a standing query, and
 * a reader who does not know which one they are looking at cannot tell whether
 * an absence means "not chosen" or "does not match".
 *
 * Safe to show to anyone by construction — a smart collection is always public,
 * so its conditions can only be made of public information.
 *
 * @param selection - The conditions
 * @param i18n - Translator
 * @param ctx - Collection vocabulary, for naming a selected collection
 * @returns One sentence, conditions joined by a middle dot
 * @example
 * describeSmartCollection({ format: "quote" }, i18n, ctx);
 * // "Automatically collects Quotes"
 */
export function describeSmartCollection(
  selection: PostFilterSelection,
  i18n: Translator,
  ctx: DimensionContext = {},
): string {
  const parts = describeFilterSelection(selection, i18n, ctx);

  if (parts.length === 0) {
    // True, and it explains why the number matches the whole site.
    return i18n._(
      msg({
        message: "Automatically collects every post.",
        comment:
          "@context: Smart collection page — what it gathers, when no condition narrows it",
      }),
    );
  }

  return i18n._(
    msg({
      message: "Automatically collects {conditions}",
      comment:
        "@context: Smart collection page — what it gathers. {conditions} is the list of conditions, already joined.",
    }),
    { conditions: parts.join(CONDITION_SEPARATOR) },
  );
}

/**
 * The archive URL showing the same posts this smart collection gathers.
 *
 * Ordinary navigation, not a coupling: the archive knows nothing about smart
 * collections. A reader who wants to narrow further ("these, but only 2024")
 * has somewhere to go, and the conditions are spelled in the vocabulary the
 * archive already reads.
 *
 * @param selection - The conditions
 * @param ctx - Collection vocabulary, for spelling a selected collection
 * @returns Path with query string, without any site or language prefix
 * @example
 * buildSmartCollectionArchiveHref({ format: "quote" }, ctx);
 * // "/archive?format=quote"
 */
export function buildSmartCollectionArchiveHref(
  selection: PostFilterSelection,
  ctx: DimensionContext = {},
): string {
  const query = serializePostFilterSelection(selection, ctx).toString();
  return query ? `/archive?${query}` : "/archive";
}

const smartCollectionMessages = {
  /** The word for the thing itself, wherever one has to be named. */
  noun: msg({
    message: "Smart Collection",
    comment:
      "@context: Name of a collection whose members come from conditions",
  }),
  newSmartCollection: msg({
    message: "New Smart Collection",
    comment:
      "@context: Menu item on the collections page that opens the smart collection dialog",
  }),
  editSmartCollection: msg({
    message: "Edit Smart Collection",
    comment: "@context: Dialog title when editing an existing smart collection",
  }),
  deleteSmartCollection: msg({
    message: "Delete Smart Collection",
    comment: "@context: Destructive action in the smart collection dialog",
  }),
  confirmDelete: msg({
    message: "Delete this smart collection? Its address stops working.",
    comment:
      "@context: Confirmation before deleting a smart collection, naming what is lost",
  }),
  emptyMatches: msg({
    message: "Nothing matches these conditions yet.",
    comment: "@context: Smart collection page when no post matches",
  }),
  turnIntoSmartCollection: msg({
    message: "Turn into a smart collection",
    comment:
      "@context: Menu item that opens the smart collection dialog prefilled from an archive URL",
  }),
} as const;

/** Every reusable smart-collection string, translated once per render. */
export const getSmartCollectionLabels = (i18n: Translator) => ({
  noun: i18n._(smartCollectionMessages.noun),
  newSmartCollection: i18n._(smartCollectionMessages.newSmartCollection),
  editSmartCollection: i18n._(smartCollectionMessages.editSmartCollection),
  deleteSmartCollection: i18n._(smartCollectionMessages.deleteSmartCollection),
  confirmDelete: i18n._(smartCollectionMessages.confirmDelete),
  emptyMatches: i18n._(smartCollectionMessages.emptyMatches),
  turnIntoSmartCollection: i18n._(
    smartCollectionMessages.turnIntoSmartCollection,
  ),
});

export type SmartCollectionLabels = ReturnType<typeof getSmartCollectionLabels>;
