import { msg } from "@lingui/core/macro";
import type { I18n } from "../../i18n/i18n.js";
import type {
  DimensionContext,
  PostFilterSelection,
} from "../../lib/filter-dimensions.js";
import {
  describeFilterSelection,
  FILTER_DIMENSION_KEYS,
  FILTER_DIMENSIONS,
  getMediaKindLabel,
  serializePostFilterSelection,
} from "../../lib/filter-dimensions.js";
import { MEDIA_KINDS } from "../../types/constants.js";
import { getCollectionDialogLabels } from "./collection-management-labels.js";

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
 * @returns A label and its conditions, joined by a middle dot — or one plain
 *   sentence when nothing narrows the selection
 * @example
 * describeSmartCollection({ format: "quote" }, i18n, ctx);
 * // "Automatically collects: Quotes"
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
      message: "Automatically collects: {conditions}",
      comment:
        '@context: Smart collection page — what it gathers. {conditions} is the list of conditions, already joined. A label and a list, not a sentence: the conditions are named in the archive\'s own words, which are noun fragments like "Titled" or "With media".',
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
    message: "Delete",
    comment:
      "@context: Destructive menu item on a smart collection's row and page. The row says which one; the confirmation names what is lost.",
  }),
  confirmDelete: msg({
    message: "Delete this smart collection? Its link stops working.",
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
  whatItIs: msg({
    message:
      "Conditions choose what belongs here, not you. Posts you write later join on their own.",
    comment:
      "@context: One line under the New Smart Collection heading, saying how it differs from an ordinary collection",
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

/**
 * Every string the editing dialog renders, translated on the server.
 *
 * The dialog is a Lit component and cannot reach the i18n catalogs itself, so
 * the page that can open it hands them down. Dimension names and value labels
 * come from the shared registry, so the words in the dialog and the words on
 * the condition line are the same words.
 */
export function getSmartCollectionDialogLabels(i18n: Translator) {
  // The address, the ordering and the buttons are the same decisions a
  // collection's dialog asks about, in the same words.
  const shared = getCollectionDialogLabels(i18n);
  const dimensions: Record<string, string> = {};
  const values: Record<string, string> = {};

  for (const key of FILTER_DIMENSION_KEYS) {
    const dimension = FILTER_DIMENSIONS[key];
    dimensions[key] = i18n._(dimension.label);

    const control = dimension.control;
    if (control.kind === "enum") {
      for (const option of control.options) {
        // Stored under the URL spelling, because that is what the control
        // emits and what the registry parses back.
        const spelled =
          serializePostFilterSelection(
            { [key]: option } as PostFilterSelection,
            {},
          ).get(dimension.url.param) ?? option;
        values[`${key}.${spelled}`] = i18n._(control.labelOf(option));
      }
    }
    if (control.kind === "presence") {
      values[`${key}.any`] = i18n._(control.yes);
      values[`${key}.none`] = i18n._(control.no);
    }
  }

  // The media control folds presence and kinds into one vocabulary, so its
  // value labels are assembled rather than enumerated from a single shape.
  values["media.any"] = i18n._(
    msg({
      message: "With media",
      comment: "@context: Archive filter - posts carrying any media attachment",
    }),
  );
  values["media.none"] = i18n._(
    msg({
      message: "Without media",
      comment: "@context: Archive filter - posts with no media attachment",
    }),
  );
  for (const kind of MEDIA_KINDS) {
    values[`media.${kind}`] = getMediaKindLabel(kind, i18n);
  }

  return {
    createHeading: i18n._(smartCollectionMessages.newSmartCollection),
    editHeading: i18n._(smartCollectionMessages.editSmartCollection),
    whatItIs: i18n._(smartCollectionMessages.whatItIs),
    title: i18n._(
      msg({
        message: "Title",
        comment: "@context: Smart collection dialog field",
      }),
    ),
    link: shared.link,
    linkHelp: shared.linkHelp,
    editLink: shared.editLink,
    resetLink: shared.resetLink,
    linkInvalid: shared.linkInvalid,
    linkReserved: shared.linkReserved,
    linkTooLong: shared.linkTooLong,
    linkTaken: shared.linkTaken,
    linkMovesWarning: shared.linkMovesWarning,
    description: i18n._(
      msg({
        message: "Description",
        comment: "@context: Smart collection dialog field",
      }),
    ),
    conditionsHeading: i18n._(
      msg({
        message: "Conditions",
        comment: "@context: Smart collection dialog section heading",
      }),
    ),
    matchAllHint: i18n._(
      msg({
        message: "Posts matching all of these",
        comment:
          "@context: Smart collection dialog — conditions are combined with AND",
      }),
    ),
    noConditions: i18n._(
      msg({
        message: "No conditions yet. Add one to choose what lands here.",
        comment: "@context: Smart collection dialog with no conditions set",
      }),
    ),
    addCondition: i18n._(
      msg({
        message: "Add condition",
        comment: "@context: Smart collection dialog button",
      }),
    ),
    removeCondition: i18n._(
      msg({
        message: "Remove condition",
        comment: "@context: Smart collection dialog condition row button",
      }),
    ),
    // Interpolated in the browser, where the numbers live. The placeholders
    // stay in the message so translators can reorder them.
    countSummary: i18n._(
      msg({
        message: "{count} of {total} threads",
        comment:
          "@context: Smart collection dialog live count — how many threads the conditions gather out of the site total",
      }),
      { count: "{count}", total: "{total}" },
    ),
    counting: i18n._(
      msg({
        message: "Counting…",
        comment: "@context: Smart collection dialog while the count is loading",
      }),
    ),
    displayHeading: i18n._(
      msg({
        message: "Display",
        comment: "@context: Smart collection dialog section heading",
      }),
    ),
    orderBy: shared.orderBy,
    layout: i18n._(
      msg({
        message: "Layout",
        comment: "@context: Smart collection dialog field",
      }),
    ),
    cancel: shared.cancel,
    save: shared.save,
    saved: i18n._(
      msg({
        message: "Smart collection saved.",
        comment: "@context: Confirmation after saving a smart collection",
      }),
    ),
    saveFailed: i18n._(
      msg({
        message: "Could not save. Try again.",
        comment: "@context: Smart collection dialog save failure",
      }),
    ),
    loadFailed: i18n._(
      msg({
        message: "Could not open this smart collection. Try again.",
        comment: "@context: Smart collection dialog load failure",
      }),
    ),
    titleAndLinkRequired: i18n._(
      msg({
        message: "A smart collection needs a title and a link.",
        comment: "@context: Smart collection dialog validation message",
      }),
    ),
    dimensions,
    values,
    sortOptions: {
      newest: shared.sortOptions.newest,
      oldest: shared.sortOptions.oldest,
      rating_desc: shared.sortOptions.rating_desc,
    },
    layoutOptions: {
      "": i18n._(
        msg({
          message: "Follow site default",
          comment:
            "@context: Smart collection layout option — use the site's configured archive layout",
        }),
      ),
      list: i18n._(
        msg({
          message: "List",
          comment: "@context: Smart collection layout option",
        }),
      ),
      grid: i18n._(
        msg({
          message: "Grid",
          comment: "@context: Smart collection layout option",
        }),
      ),
    },
  };
}

export type SmartCollectionDialogLabels = ReturnType<
  typeof getSmartCollectionDialogLabels
>;
