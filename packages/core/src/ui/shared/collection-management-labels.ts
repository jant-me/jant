import { msg } from "@lingui/core/macro";
import type { I18n } from "../../i18n/i18n.js";

type Translator = Pick<I18n, "_">;

const collectionFormMessages = {
  titleLabel: msg({
    message: "Title",
    comment: "@context: Collection form field",
  }),
  titlePlaceholder: msg({
    message: "My Collection",
    comment: "@context: Collection title placeholder",
  }),
  slugLabel: msg({
    message: "Collection link",
    comment: "@context: Collection form field",
  }),
  slugHelp: msg({
    message: "This is the last part of the collection link.",
    comment: "@context: Collection link help text",
  }),
  slugInvalidHelp: msg({
    message: "Use lowercase letters, numbers, and hyphens only.",
    comment:
      "@context: Collection slug validation error for invalid characters",
  }),
  slugReservedHelp: msg({
    message: "This link is reserved. Choose something else.",
    comment: "@context: Collection slug validation error for reserved paths",
  }),
  slugTooLongHelp: msg({
    message: "Keep this link under 200 characters.",
    comment:
      "@context: Collection slug validation error for links that are too long",
  }),
  editSlugLabel: msg({
    message: "Edit link",
    comment: "@context: Button to manually edit the collection link",
  }),
  resetSlugLabel: msg({
    message: "Reset link",
    comment:
      "@context: Button to restore the automatically generated collection link from the title",
  }),
  quickHint: msg({
    message: "More options are available after you create it.",
    comment: "@context: Helper text in the quick-create collection dialog",
  }),
  quickSubmitLabel: msg({
    message: "Done",
    comment: "@context: Primary button in the quick-create collection dialog",
  }),
  createdLabel: msg({
    message: "Collection created.",
    comment: "@context: Confirmation shown after creating a collection",
  }),
  cancelLabel: msg({
    message: "Cancel",
    comment: "@context: Button to cancel form",
  }),
} as const;

/**
 * The editing dialog's own strings.
 *
 * The address and validation wording it shares with the quick-create form
 * stays in {@link collectionFormMessages}; only what the dialog alone says
 * lives here.
 */
const collectionDialogMessages = {
  createHeading: msg({
    message: "New Collection",
    comment: "@context: Title of the dialog that creates a collection",
  }),
  editHeading: msg({
    message: "Edit Collection",
    comment: "@context: Title of the dialog that edits an existing collection",
  }),
  descriptionLabel: msg({
    message: "Description (optional)",
    comment: "@context: Collection form field",
  }),
  descriptionPlaceholder: msg({
    message: "What's this collection about?",
    comment: "@context: Collection description placeholder",
  }),
  orderBy: msg({
    message: "Order by",
    comment: "@context: Collection editing dialog field",
  }),
  sortNewest: msg({
    message: "Newest first",
    comment: "@context: Collection sort order option",
  }),
  sortOldest: msg({
    message: "Oldest first",
    comment: "@context: Collection sort order option",
  }),
  sortRatingDesc: msg({
    message: "Highest rated",
    comment: "@context: Collection sort order option",
  }),
  loadFailed: msg({
    message: "Could not open this collection. Try again.",
    comment: "@context: Collection dialog load failure",
  }),
  titleAndLinkRequired: msg({
    message: "A collection needs a title and a link.",
    comment: "@context: Collection dialog validation message",
  }),
} as const;

/**
 * Address wording both editing dialogs share.
 *
 * A collection and a smart collection take the same kind of address out of the
 * same namespace, so a clash and a move read the same in both.
 */
const collectionLinkMessages = {
  linkTaken: msg({
    message: "This link is taken. Choose another.",
    comment:
      "@context: Collection editing dialog — the typed collection link is already in use",
  }),
  linkMovesWarning: msg({
    message: "Changing the link breaks the old one immediately.",
    comment:
      "@context: Collection editing dialog warning shown when editing moves an existing collection link",
  }),
} as const;

const collectionMutationMessages = {
  save: msg({
    message: "Save",
    comment: "@context: Button to save collection",
  }),
  edit: msg({
    message: "Edit",
    comment: "@context: Per-collection edit action",
  }),
  addToNavigation: msg({
    message: "Add to Navigation",
    comment: "@context: Action that adds a Collection to site navigation",
  }),
  addingToNavigation: msg({
    message: "Adding…",
    comment:
      "@context: Loading label while adding a Collection to site navigation",
  }),
  addedToNavigation: msg({
    message: "Collection added to navigation.",
    comment:
      "@context: Confirmation after adding a Collection to site navigation",
  }),
  editNavigation: msg({
    message: "Edit Navigation",
    comment:
      "@context: Action that opens Navigation settings for a Collection already in navigation",
  }),
  addToNavigationFailed: msg({
    message: "Couldn't add this collection to navigation. Try again.",
    comment:
      "@context: Error after a Collection could not be added to site navigation",
  }),
  moreActions: msg({
    message: "More actions",
    comment: "@context: Aria-label for collections page more button",
  }),
  label: msg({
    message: "Label",
    comment: "@context: Field label for a custom collections link",
  }),
  url: msg({
    message: "URL",
    comment: "@context: Field label for a custom collections link URL",
  }),
  deleteCollection: msg({
    message: "Delete",
    comment: "@context: Delete collection action",
  }),
  confirmDelete: msg({
    message:
      "Delete this collection permanently? Threads inside won't be removed.",
    comment: "@context: Confirm dialog for deleting a collection",
  }),
  cancel: msg({
    message: "Cancel",
    comment: "@context: Button label to dismiss a dialog or action",
  }),
  saved: msg({
    message: "Collection saved.",
    comment: "@context: Toast after saving a collection",
  }),
  saveFailed: msg({
    message: "Couldn't save. Try again in a moment.",
    comment: "@context: Toast when save fails",
  }),
  deleted: msg({
    message: "Collection deleted.",
    comment: "@context: Toast after deleting a collection",
  }),
  deleteLink: msg({
    message: "Remove Link",
    comment: "@context: Delete custom link action on collections page",
  }),
  confirmDeleteLink: msg({
    message: "Remove this link from Collections? The destination won't change.",
    comment: "@context: Confirm dialog for deleting a custom collections link",
  }),
  linkCreated: msg({
    message: "Link added.",
    comment: "@context: Toast after creating a custom collections link",
  }),
  linkSaved: msg({
    message: "Link updated.",
    comment: "@context: Toast after saving a custom collections link",
  }),
  linkDeleted: msg({
    message: "Link removed.",
    comment: "@context: Toast after deleting a custom collections link",
  }),
  addLink: msg({
    message: "Add Link",
    comment:
      "@context: Primary action to add a custom link on collections page",
  }),
  addLinkDescription: msg({
    message: "Add a custom shortcut to any page or site.",
    comment:
      "@context: Helper text for the custom collections link form on collections page",
  }),
  linkLabelPlaceholder: msg({
    message: "Quotes",
    comment: "@context: Placeholder for the custom collections link label",
  }),
  linkUrlPlaceholder: msg({
    message: "/archive?format=quote or https://example.com",
    comment: "@context: Placeholder for the custom collections link URL",
  }),
  linkDescriptionLabel: msg({
    message: "Description (optional)",
    comment: "@context: Field label for a custom collections link description",
  }),
  linkDescriptionPlaceholder: msg({
    message: "Link",
    comment:
      "@context: Placeholder for the custom collections link description editor, shown on the directory when no description is provided",
  }),
  labelAndUrlRequired: msg({
    message: "Add a label and URL.",
    comment:
      "@context: Validation message when creating or editing a custom collections link",
  }),
} as const;

export const getCollectionFormLabels = (i18n: Translator) => ({
  titleLabel: i18n._(collectionFormMessages.titleLabel),
  titlePlaceholder: i18n._(collectionFormMessages.titlePlaceholder),
  slugLabel: i18n._(collectionFormMessages.slugLabel),
  slugHelp: i18n._(collectionFormMessages.slugHelp),
  slugInvalidHelp: i18n._(collectionFormMessages.slugInvalidHelp),
  slugReservedHelp: i18n._(collectionFormMessages.slugReservedHelp),
  slugTooLongHelp: i18n._(collectionFormMessages.slugTooLongHelp),
  editSlugLabel: i18n._(collectionFormMessages.editSlugLabel),
  resetSlugLabel: i18n._(collectionFormMessages.resetSlugLabel),
  quickHint: i18n._(collectionFormMessages.quickHint),
  quickSubmitLabel: i18n._(collectionFormMessages.quickSubmitLabel),
  createdLabel: i18n._(collectionFormMessages.createdLabel),
  cancelLabel: i18n._(collectionFormMessages.cancelLabel),
});

/**
 * Every string the editing dialog renders, translated on the server.
 *
 * The dialog is a Lit component and cannot reach the i18n catalogs itself, so
 * whichever page can open it hands them down \u2014 the same arrangement the
 * smart collection dialog uses.
 */
export const getCollectionDialogLabels = (i18n: Translator) => ({
  createHeading: i18n._(collectionDialogMessages.createHeading),
  editHeading: i18n._(collectionDialogMessages.editHeading),
  title: i18n._(collectionFormMessages.titleLabel),
  titlePlaceholder: i18n._(collectionFormMessages.titlePlaceholder),
  link: i18n._(collectionFormMessages.slugLabel),
  linkHelp: i18n._(collectionFormMessages.slugHelp),
  editLink: i18n._(collectionFormMessages.editSlugLabel),
  resetLink: i18n._(collectionFormMessages.resetSlugLabel),
  linkInvalid: i18n._(collectionFormMessages.slugInvalidHelp),
  linkReserved: i18n._(collectionFormMessages.slugReservedHelp),
  linkTooLong: i18n._(collectionFormMessages.slugTooLongHelp),
  linkTaken: i18n._(collectionLinkMessages.linkTaken),
  linkMovesWarning: i18n._(collectionLinkMessages.linkMovesWarning),
  description: i18n._(collectionDialogMessages.descriptionLabel),
  descriptionPlaceholder: i18n._(
    collectionDialogMessages.descriptionPlaceholder,
  ),
  orderBy: i18n._(collectionDialogMessages.orderBy),
  sortOptions: {
    newest: i18n._(collectionDialogMessages.sortNewest),
    oldest: i18n._(collectionDialogMessages.sortOldest),
    rating_desc: i18n._(collectionDialogMessages.sortRatingDesc),
  },
  cancel: i18n._(collectionMutationMessages.cancel),
  save: i18n._(collectionMutationMessages.save),
  saved: i18n._(collectionMutationMessages.saved),
  saveFailed: i18n._(collectionMutationMessages.saveFailed),
  loadFailed: i18n._(collectionDialogMessages.loadFailed),
  titleAndLinkRequired: i18n._(collectionDialogMessages.titleAndLinkRequired),
});

export const getCollectionMutationLabels = (i18n: Translator) => ({
  save: i18n._(collectionMutationMessages.save),
  edit: i18n._(collectionMutationMessages.edit),
  addToNavigation: i18n._(collectionMutationMessages.addToNavigation),
  addingToNavigation: i18n._(collectionMutationMessages.addingToNavigation),
  addedToNavigation: i18n._(collectionMutationMessages.addedToNavigation),
  editNavigation: i18n._(collectionMutationMessages.editNavigation),
  addToNavigationFailed: i18n._(
    collectionMutationMessages.addToNavigationFailed,
  ),
  moreActions: i18n._(collectionMutationMessages.moreActions),
  label: i18n._(collectionMutationMessages.label),
  url: i18n._(collectionMutationMessages.url),
  deleteCollection: i18n._(collectionMutationMessages.deleteCollection),
  confirmDelete: i18n._(collectionMutationMessages.confirmDelete),
  deleteLink: i18n._(collectionMutationMessages.deleteLink),
  confirmDeleteLink: i18n._(collectionMutationMessages.confirmDeleteLink),
  cancel: i18n._(collectionMutationMessages.cancel),
  saved: i18n._(collectionMutationMessages.saved),
  linkCreated: i18n._(collectionMutationMessages.linkCreated),
  linkSaved: i18n._(collectionMutationMessages.linkSaved),
  saveFailed: i18n._(collectionMutationMessages.saveFailed),
  deleted: i18n._(collectionMutationMessages.deleted),
  linkDeleted: i18n._(collectionMutationMessages.linkDeleted),
  addLink: i18n._(collectionMutationMessages.addLink),
  addLinkDescription: i18n._(collectionMutationMessages.addLinkDescription),
  linkLabelPlaceholder: i18n._(collectionMutationMessages.linkLabelPlaceholder),
  linkUrlPlaceholder: i18n._(collectionMutationMessages.linkUrlPlaceholder),
  linkDescriptionLabel: i18n._(collectionMutationMessages.linkDescriptionLabel),
  linkDescriptionPlaceholder: i18n._(
    collectionMutationMessages.linkDescriptionPlaceholder,
  ),
  labelAndUrlRequired: i18n._(collectionMutationMessages.labelAndUrlRequired),
  formLabels: getCollectionFormLabels(i18n),
});
