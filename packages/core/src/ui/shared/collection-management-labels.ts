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
    comment: "@context: Toast shown after creating a collection",
  }),
  descriptionLabel: msg({
    message: "Description (optional)",
    comment: "@context: Collection form field",
  }),
  descriptionPlaceholder: msg({
    message: "What's this collection about?",
    comment: "@context: Collection description placeholder",
  }),
  sortOrderLabel: msg({
    message: "Sort Order",
    comment: "@context: Collection form field",
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
  submitLabel: msg({
    message: "Save",
    comment: "@context: Button to save collection",
  }),
  cancelLabel: msg({
    message: "Cancel",
    comment: "@context: Button to cancel form",
  }),
} as const;

const collectionMutationMessages = {
  edit: msg({
    message: "Edit",
    comment: "@context: Per-collection edit action",
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
  descriptionLabel: i18n._(collectionFormMessages.descriptionLabel),
  descriptionPlaceholder: i18n._(collectionFormMessages.descriptionPlaceholder),
  sortOrderLabel: i18n._(collectionFormMessages.sortOrderLabel),
  sortNewest: i18n._(collectionFormMessages.sortNewest),
  sortOldest: i18n._(collectionFormMessages.sortOldest),
  sortRatingDesc: i18n._(collectionFormMessages.sortRatingDesc),
  submitLabel: i18n._(collectionFormMessages.submitLabel),
  cancelLabel: i18n._(collectionFormMessages.cancelLabel),
});

export const getCollectionMutationLabels = (i18n: Translator) => ({
  edit: i18n._(collectionMutationMessages.edit),
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
