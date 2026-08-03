/**
 * Compose Dialog
 *
 * Full-screen compose dialog for quick post creation.
 * Rendered server-side as part of SiteLayout for authenticated users.
 *
 * The Lit Web Component <jant-compose-dialog> handles all form state
 * and rendering. Server provides labels and collections as JSON attributes.
 */

import { msg } from "@lingui/core/macro";
import type { FC } from "hono/jsx";
import { MAX_THREAD_POSTS, type Collection } from "../../types.js";
import { useLingui } from "../../i18n/context.js";
import { getCollectionFormLabels } from "../shared/collection-management-labels.js";
import type { ComposeLabels } from "../../client/components/compose-types.js";

export interface ComposeDialogProps {
  collections?: Collection[];
  uploadMaxFileSize?: number;
  slashCommandDiscovered?: boolean;
}

export interface ComposeFormProps extends ComposeDialogProps {
  pageMode?: boolean;
  closeHref?: string;
  autoRestoreDraft?: boolean;
}

export const ComposeForm: FC<ComposeFormProps> = ({
  collections,
  uploadMaxFileSize,
  slashCommandDiscovered = false,
  pageMode = false,
  closeHref,
  autoRestoreDraft = false,
}) => {
  const { i18n } = useLingui();

  const labelsObject = {
    cancel: i18n._(
      msg({
        message: "Cancel",
        comment: "@context: Close compose dialog",
      }),
    ),
    imageNotRehosted: i18n._(
      msg({
        message:
          "An image couldn't be saved to your library — its original link was kept.",
        comment:
          "@context: Toast when a single pasted remote image couldn't be rehosted (e.g. blocked by the source's hotlink protection)",
      }),
    ),
    imagesNotRehosted: i18n._(
      msg({
        message:
          "{count} images couldn't be saved to your library — their original links were kept.",
        comment:
          "@context: Toast when several pasted remote images couldn't be rehosted; {count} is the number of images",
      }),
    ),
    brokenImageUnavailable: i18n._(
      msg({
        message: "Image unavailable",
        comment:
          "@context: Inline editor placeholder title shown when an image cannot load",
      }),
    ),
    brokenImageDelete: i18n._(
      msg({
        message: "Delete image",
        comment:
          "@context: Inline editor button label for removing a broken image",
      }),
    ),
    brokenImageReplace: i18n._(
      msg({
        message: "Replace image",
        comment:
          "@context: Inline editor button label for replacing a broken image",
      }),
    ),
    brokenImageOpen: i18n._(
      msg({
        message: "Open image URL",
        comment:
          "@context: Inline editor button label for opening the original URL of a broken image",
      }),
    ),
    note: i18n._(
      msg({
        message: "Note",
        comment: "@context: Compose format tab",
      }),
    ),
    link: i18n._(
      msg({
        message: "Link",
        comment: "@context: Compose format tab",
      }),
    ),
    quote: i18n._(
      msg({
        message: "Quote",
        comment: "@context: Compose format tab",
      }),
    ),
    saveDraft: i18n._(
      msg({
        message: "Save as Draft",
        comment: "@context: Header draft button tooltip",
      }),
    ),
    saveAsDraft: i18n._(
      msg({
        message: "Save as draft",
        comment: "@context: More menu - save draft",
      }),
    ),
    discard: i18n._(
      msg({
        message: "Discard",
        comment: "@context: More menu - discard post",
      }),
    ),
    titlePlaceholder: i18n._(
      msg({
        message: "Title (optional)",
        comment:
          "@context: Compose note title placeholder — a note can be published without one",
      }),
    ),
    bodyPlaceholder: i18n._(
      msg({
        message: "What's on your mind...",
        comment: "@context: Compose body placeholder",
      }),
    ),
    urlPlaceholder: i18n._(
      msg({
        message: "Paste a URL...",
        comment: "@context: Compose link URL placeholder",
      }),
    ),
    urlInvalid: i18n._(
      msg({
        message:
          "Enter a valid URL starting with http://, https://, or mailto:.",
        comment: "@context: Compose URL field error message",
      }),
    ),
    linkUrlRequired: i18n._(
      msg({
        message: "Add a URL before posting this link.",
        comment: "@context: Compose link URL required error",
      }),
    ),
    linkTitleRequired: i18n._(
      msg({
        message: "Add a title before posting this link.",
        comment: "@context: Compose link title required error",
      }),
    ),
    linkTitlePlaceholder: i18n._(
      msg({
        message: "Give it a title...",
        comment: "@context: Compose link title placeholder",
      }),
    ),
    thoughtsPlaceholder: i18n._(
      msg({
        message: "Your thoughts (optional)",
        comment: "@context: Compose thoughts placeholder",
      }),
    ),
    quotePlaceholder: i18n._(
      msg({
        message: "Type the quote...",
        comment: "@context: Compose quote text placeholder",
      }),
    ),
    authorPlaceholder: i18n._(
      msg({
        message: "Author (optional)",
        comment: "@context: Compose quote author placeholder",
      }),
    ),
    sourcePlaceholder: i18n._(
      msg({
        message: "Source link (optional)",
        comment: "@context: Compose quote source link placeholder",
      }),
    ),
    attachedText: i18n._(
      msg({
        message: "Text attachment",
        comment: "@context: Attached text panel title",
      }),
    ),
    attachedTextPlaceholder: i18n._(
      msg({
        message:
          "Paste a long article, AI response, or any text...\n\nMarkdown formatting will be preserved.",
        comment: "@context: Attached text placeholder",
      }),
    ),
    attachedTextHint: i18n._(
      msg({
        message: "Supplementary content attached to your post",
        comment: "@context: Attached text panel hint",
      }),
    ),
    done: i18n._(
      msg({
        message: "Done",
        comment: "@context: Close attached text panel",
      }),
    ),
    media: i18n._(
      msg({
        message: "Media",
        comment: "@context: Compose toolbar - media tooltip",
      }),
    ),
    rate: i18n._(
      msg({
        message: "Rate",
        comment: "@context: Compose toolbar - rate tooltip",
      }),
    ),
    emoji: i18n._(
      msg({
        message: "Emoji",
        comment: "@context: Compose toolbar - emoji picker tooltip",
      }),
    ),
    title: i18n._(
      msg({
        message: "Title",
        comment: "@context: Compose toolbar - show or hide the title field",
      }),
    ),
    fullscreen: i18n._(
      msg({
        message: "Fullscreen",
        comment: "@context: Compose dialog - open fullscreen editor",
      }),
    ),
    exitFullscreen: i18n._(
      msg({
        message: "Exit fullscreen",
        comment:
          "@context: Compose fullscreen - button tooltip to collapse back to normal editor",
      }),
    ),
    collection: i18n._(
      msg({
        message: "Collection",
        comment: "@context: Compose collection selector trigger label",
      }),
    ),
    searchCollections: i18n._(
      msg({
        message: "Search...",
        comment: "@context: Compose collection combobox search placeholder",
      }),
    ),
    noCollections: i18n._(
      msg({
        message: "No collections match that search. Try a different name.",
        comment:
          "@context: Compose collection combobox empty state when search has no results",
      }),
    ),
    emptyCollections: i18n._(
      msg({
        message: "Create a collection to get started.",
        comment:
          "@context: Compose collection combobox empty state when no collections exist",
      }),
    ),
    post: i18n._(
      msg({
        message: "Post",
        comment: "@context: Compose button - publish post",
      }),
    ),
    addAlt: i18n._(
      msg({
        message: "+ ALT",
        comment: "@context: Add alt text label under attachment thumbnail",
      }),
    ),
    addAltTitle: i18n._(
      msg({
        message: "Add alt text",
        comment: "@context: Alt text panel title",
      }),
    ),
    altPlaceholder: i18n._(
      msg({
        message: "Describe this for people with visual impairments...",
        comment: "@context: Alt text textarea placeholder",
      }),
    ),
    altHint: i18n._(
      msg({
        message: "Helps screen readers describe the image",
        comment: "@context: Hint text in alt text panel",
      }),
    ),
    addMore: i18n._(
      msg({
        message: "Add",
        comment: "@context: Add more attachments button",
      }),
    ),
    removeAttachment: i18n._(
      msg({
        message: "Remove attachment",
        comment: "@context: Button to remove an uploaded attachment in compose",
      }),
    ),
    uploading: i18n._(
      msg({
        message: "Uploading...",
        comment: "@context: Toast shown during background upload",
      }),
    ),
    loadingPost: i18n._(
      msg({
        message: "Loading post...",
        comment: "@context: Status text while opening the post editor",
      }),
    ),
    loadPostFailed: i18n._(
      msg({
        message: "Couldn't load this post. Try again.",
        comment: "@context: Toast shown when edit mode fails to load a post",
      }),
    ),
    published: i18n._(
      msg({
        message: "Published!",
        comment: "@context: Toast shown after successful deferred publish",
      }),
    ),
    view: i18n._(
      msg({
        message: "View",
        comment: "@context: Toast action button to view the published post",
      }),
    ),
    retryAll: i18n._(
      msg({
        message: "Tap to retry",
        comment:
          "@context: Label on failed upload overlay button, tells user tapping retries the upload",
      }),
    ),
    editPost: i18n._(
      msg({
        message: "Edit post",
        comment: "@context: Compose dialog header title in edit mode",
      }),
    ),
    update: i18n._(
      msg({
        message: "Done",
        comment: "@context: Compose button - update existing post",
      }),
    ),
    confirmCloseTitle: i18n._(
      msg({
        message: "Save to drafts?",
        comment: "@context: Confirm close action sheet title",
      }),
    ),
    confirmCloseSubtitle: i18n._(
      msg({
        message: "Save to drafts to edit and post at a later time.",
        comment: "@context: Confirm close action sheet subtitle",
      }),
    ),
    confirmCloseSave: i18n._(
      msg({
        message: "Save",
        comment: "@context: Confirm close action sheet - save draft button",
      }),
    ),
    confirmCloseCancel: i18n._(
      msg({
        message: "Cancel",
        comment:
          "@context: Confirm close action sheet - cancel and return to editor",
      }),
    ),
    confirmCloseDiscard: i18n._(
      msg({
        message: "Don't save",
        comment: "@context: Confirm close action sheet - discard button",
      }),
    ),
    confirmAttachedTitle: i18n._(
      msg({
        message: "Save text attachment?",
        comment:
          "@context: Confirm action sheet title when closing text attachment editor",
      }),
    ),
    confirmAttachedSubtitle: i18n._(
      msg({
        message:
          "Save these changes to the text attachment, discard them, or keep editing.",
        comment:
          "@context: Confirm action sheet subtitle when closing text attachment editor",
      }),
    ),
    confirmAttachedSave: i18n._(
      msg({
        message: "Save",
        comment:
          "@context: Confirm action sheet - save text attachment changes button",
      }),
    ),
    confirmAttachedDiscard: i18n._(
      msg({
        message: "Don't save",
        comment:
          "@context: Confirm action sheet - discard text attachment changes button",
      }),
    ),
    confirmEditTitle: i18n._(
      msg({
        message: "You have unsaved changes",
        comment:
          "@context: Confirm close action sheet title when editing a published post",
      }),
    ),
    confirmEditSubtitle: i18n._(
      msg({
        message: "Do you want to publish your changes or discard them?",
        comment:
          "@context: Confirm close action sheet subtitle when editing a published post",
      }),
    ),
    confirmEditPublish: i18n._(
      msg({
        message: "Publish",
        comment:
          "@context: Confirm close action sheet - publish update button for editing published post",
      }),
    ),
    confirmEditDiscard: i18n._(
      msg({
        message: "Discard",
        comment:
          "@context: Confirm close action sheet - discard changes button for editing published post",
      }),
    ),
    discardChangesConfirm: i18n._(
      msg({
        message: "Discard changes?",
        comment:
          "@context: Confirm dialog shown before discarding attached text edits",
      }),
    ),
    drafts: i18n._(
      msg({
        message: "Drafts",
        comment: "@context: Drafts panel title",
      }),
    ),
    draftsEmpty: i18n._(
      msg({
        message: "No drafts yet. Save a draft to find it here.",
        comment: "@context: Drafts panel empty state",
      }),
    ),
    previewDraft: i18n._(
      msg({
        message: "Preview",
        comment: "@context: Draft item action that opens its rendered preview",
      }),
    ),
    draftActions: i18n._(
      msg({
        message: "Draft actions",
        comment:
          "@context: Accessible label for a draft item's more-actions button",
      }),
    ),
    deleteDraft: i18n._(
      msg({
        message: "Delete Draft",
        comment: "@context: Draft item action",
      }),
    ),
    draftDeleted: i18n._(
      msg({
        message: "Draft deleted.",
        comment: "@context: Toast after draft deletion",
      }),
    ),
    publishFailedDraft: i18n._(
      msg({
        message: "Couldn't publish. Saved as draft.",
        comment:
          "@context: Toast when publish fails and post is auto-saved as draft",
      }),
    ),
    uploadFailedDraft: i18n._(
      msg({
        message: "Some uploads failed. Saved as draft.",
        comment:
          "@context: Toast when uploads fail and post is auto-saved as draft",
      }),
    ),
    reply: i18n._(
      msg({
        message: "Reply",
        comment: "@context: Compose button - reply to post",
      }),
    ),
    quietReplyLabel: i18n._(
      msg({
        message: "Reply quietly",
        comment:
          "@context: Compose publish settings switch label — reply without bumping thread to top of timeline",
      }),
    ),
    quietReplyHint: i18n._(
      msg({
        message: "Won't move the thread to the top of latest.",
        comment:
          "@context: Compose publish settings hint for quiet reply switch",
      }),
    ),
    threadLimitReached: i18n._(
      msg({
        message: "Threads can include up to {count} posts.",
        comment:
          "@context: Toast shown when compose reaches the maximum allowed thread length",
      }),
      { count: MAX_THREAD_POSTS },
    ),
    publishHideFromLatest: i18n._(
      msg({
        message: "Hide from Latest",
        comment:
          "@context: Compose dropdown option for hiding a post from the Latest view",
      }),
    ),
    publishPrivate: i18n._(
      msg({
        message: "Post as Private",
        comment:
          "@context: Compose dropdown option - publish post visible only when logged in",
      }),
    ),
    publishSettings: i18n._(
      msg({
        message: "Publish settings",
        comment: "@context: Compose publish settings panel title",
      }),
    ),
    publishVisibilityLabel: i18n._(
      msg({
        message: "Visibility",
        comment: "@context: Compose publish settings section label",
      }),
    ),
    publishVisibilityPublic: i18n._(
      msg({
        message: "Public",
        comment: "@context: Compose publish settings visibility option",
      }),
    ),
    publishVisibilityPublicHint: i18n._(
      msg({
        message: "Appears in Latest.",
        comment:
          "@context: Compose publish settings help text for public visibility",
      }),
    ),
    publishVisibilityHiddenFromLatest: i18n._(
      msg({
        message: "Hidden from Latest",
        comment: "@context: Compose publish settings visibility option",
      }),
    ),
    publishVisibilityHiddenFromLatestHint: i18n._(
      msg({
        message:
          "Doesn't appear in Latest. Still appears in collections you add it to.",
        comment:
          "@context: Compose publish settings help text for posts hidden from Latest",
      }),
    ),
    publishVisibilityPrivate: i18n._(
      msg({
        message: "Private",
        comment: "@context: Compose publish settings visibility option",
      }),
    ),
    publishVisibilityPrivateHint: i18n._(
      msg({
        message: "Only visible when signed in.",
        comment:
          "@context: Compose publish settings help text for private visibility",
      }),
    ),
    publishDateLabel: i18n._(
      msg({
        message: "Published on",
        comment:
          "@context: Compose publish settings publish date section label",
      }),
    ),
    publishDateHint: i18n._(
      msg({
        message:
          "Leave blank to publish now. Use an earlier date when importing older posts.",
        comment:
          "@context: Compose publish settings help text for publish date",
      }),
    ),
    publishDateReset: i18n._(
      msg({
        message: "Use current date",
        comment:
          "@context: Compose publish settings action to reset the publish date to the current date",
      }),
    ),
    publishDateInvalid: i18n._(
      msg({
        message: "Enter a valid date.",
        comment:
          "@context: Compose publish settings validation error for an invalid publish date",
      }),
    ),
    publishDateFutureError: i18n._(
      msg({
        message:
          "Choose today or an earlier date, or leave it blank to publish now.",
        comment:
          "@context: Compose publish settings validation error when a future publish date is selected",
      }),
    ),
    publishDateSummaryNow: i18n._(
      msg({
        message: "Now",
        comment:
          "@context: Value shown on a post's date control when it will publish at the current time",
      }),
    ),
    publishDateSummaryAction: i18n._(
      msg({
        message: "Edit publish date",
        comment:
          "@context: Compose action to reopen the publish date field from the action row summary",
      }),
    ),
    publishSlugLabel: i18n._(
      msg({
        message: "Custom link",
        comment: "@context: Compose publish settings slug section label",
      }),
    ),
    publishSlugPlaceholder: i18n._(
      msg({
        message: "your-post-link",
        comment: "@context: Compose publish settings slug input placeholder",
      }),
    ),
    publishSlugHint: i18n._(
      msg({
        message: "Leave blank to generate one automatically.",
        comment: "@context: Compose publish settings slug help text",
      }),
    ),
    publishSlugAuto: i18n._(
      msg({
        message: "Generate automatically",
        comment:
          "@context: Compose publish settings slug summary when no custom slug is set",
      }),
    ),
    publishSlugSummaryAuto: i18n._(
      msg({
        message: "/…",
        comment:
          "@context: Value shown on a post's permalink control when the link is generated automatically — a stand-in for the path the server will assign. Sits next to real permalinks rendered as /my-post, so keep the leading slash",
      }),
    ),
    publishSlugSummaryAction: i18n._(
      msg({
        message: "Edit custom link",
        comment:
          "@context: Compose action to reopen the custom link field from the action row summary",
      }),
    ),
    publishSlugReset: i18n._(
      msg({
        message: "Reset link",
        comment:
          "@context: Compose custom slug action that clears the manual slug and falls back to automatic generation",
      }),
    ),
    publishSlugSuggested: i18n._(
      msg({
        message: "Suggested link",
        comment:
          "@context: Compose custom slug helper label for the suggested slug",
      }),
    ),
    publishSlugGenerating: i18n._(
      msg({
        message: "Generating a link...",
        comment:
          "@context: Compose custom slug helper while generating a suggested slug",
      }),
    ),
    publishSlugChecking: i18n._(
      msg({
        message: "Checking link...",
        comment:
          "@context: Compose custom slug helper while checking whether a manual slug is available",
      }),
    ),
    publishSlugTaken: i18n._(
      msg({
        message: "This link is already in use. Choose something else.",
        comment:
          "@context: Compose custom slug validation error when the entered slug is already taken",
      }),
    ),
    publishSlugInvalid: i18n._(
      msg({
        message: "Use lowercase letters, numbers, and hyphens only.",
        comment:
          "@context: Compose custom slug validation error for invalid characters",
      }),
    ),
    publishSlugReserved: i18n._(
      msg({
        message: "This link is reserved. Choose something else.",
        comment:
          "@context: Compose custom slug validation error for reserved paths",
      }),
    ),
    postHiddenFromLatest: i18n._(
      msg({
        message: "Post hidden",
        comment:
          "@context: Compose publish button for posts hidden from Latest",
      }),
    ),
    postPrivately: i18n._(
      msg({
        message: "Post privately",
        comment: "@context: Compose publish button for private visibility",
      }),
    ),
    showMore: i18n._(
      msg({
        message: "Show more",
        comment: "@context: Expand reply context",
      }),
    ),
    showLess: i18n._(
      msg({
        message: "Show less",
        comment: "@context: Collapse reply context",
      }),
    ),
    addCollection: i18n._(
      msg({
        message: "Add Collection",
        comment: "@context: Action to create a new collection from compose",
      }),
    ),
    collectionCountLabel: i18n._(
      msg({
        message: "%name% + %count% more",
        comment:
          "@context: Compose collection trigger label when multiple collections selected. %name% is the first collection name, %count% is how many more",
      }),
    ),
    draftRestored: i18n._(
      msg({
        message: "Draft restored.",
        comment:
          "@context: Toast shown when a local draft is restored on compose open",
      }),
    ),
    closeCompose: i18n._(
      msg({
        message: "Close compose",
        comment:
          "@context: Post options row that leaves the composer; prompts to save a draft first if there is unsaved work",
      }),
    ),
    editing: i18n._(
      msg({
        message: "Editing",
        comment:
          "@context: Marker above the composer when changing a post that is already published",
      }),
    ),
    composeDialogLabel: i18n._(
      msg({
        message: "Compose",
        comment: "@context: Accessible name for the compose dialog",
      }),
    ),
    slashHint: i18n._(
      msg({
        message: "Type / for commands",
        comment:
          "@context: First-use hint shown over the compose editor to surface the slash command menu",
      }),
    ),
    tableControls: {
      toolbarLabel: i18n._(
        msg({
          message: "Table controls",
          comment: "@context: Accessible label for the compose table toolbar",
        }),
      ),
      addRowAbove: i18n._(
        msg({
          message: "Add row above",
          comment: "@context: Compose table action",
        }),
      ),
      addRowBelow: i18n._(
        msg({
          message: "Add row below",
          comment: "@context: Compose table action",
        }),
      ),
      addColumnBefore: i18n._(
        msg({
          message: "Add column before",
          comment: "@context: Compose table action",
        }),
      ),
      addColumnAfter: i18n._(
        msg({
          message: "Add column after",
          comment: "@context: Compose table action",
        }),
      ),
      options: i18n._(
        msg({
          message: "Table options",
          comment: "@context: Compose table menu button label",
        }),
      ),
      deleteRow: i18n._(
        msg({
          message: "Delete row",
          comment: "@context: Compose table action",
        }),
      ),
      deleteColumn: i18n._(
        msg({
          message: "Delete column",
          comment: "@context: Compose table action",
        }),
      ),
      toggleHeaderRow: i18n._(
        msg({
          message: "Toggle header row",
          comment: "@context: Compose table action",
        }),
      ),
      deleteTable: i18n._(
        msg({
          message: "Delete table",
          comment: "@context: Destructive compose table action",
        }),
      ),
      sizePickerLabel: i18n._(
        msg({
          message: "Choose table size",
          comment: "@context: Accessible title for the table dimension picker",
        }),
      ),
      insertTableSize: i18n._(
        msg({
          message: "Insert %rows% by %cols% table",
          comment:
            "@context: Accessible label for a table size option. %rows% and %cols% are replaced with dimensions",
        }),
      ),
    },
    collectionFormLabels: getCollectionFormLabels(i18n),
  } satisfies ComposeLabels;
  const labels = JSON.stringify(labelsObject).replace(/</g, "\\u003c");

  const collectionsJson = JSON.stringify(
    (collections ?? []).map((c) => ({
      id: c.id,
      title: c.title,
      slug: c.slug,
    })),
  ).replace(/</g, "\\u003c");

  return (
    <jant-compose-dialog
      collections={collectionsJson}
      labels={labels}
      upload-max-file-size={uploadMaxFileSize ?? 500}
      {...(pageMode ? { "page-mode": "" } : {})}
      {...(closeHref ? { "close-href": closeHref } : {})}
      {...(autoRestoreDraft ? { "auto-restore-draft": "" } : {})}
      {...(slashCommandDiscovered ? { "slash-command-discovered": "" } : {})}
    >
      {/* SSR fallback skeleton */}
      <div class="compose-dialog-inner">
        <div class="compose-body skel-section-md" />
      </div>
    </jant-compose-dialog>
  );
};

export const ComposeDialog: FC<ComposeDialogProps> = ({
  collections,
  uploadMaxFileSize,
  slashCommandDiscovered = false,
}) => {
  return (
    <dialog id="compose-dialog" class="compose-dialog">
      <ComposeForm
        collections={collections}
        uploadMaxFileSize={uploadMaxFileSize}
        slashCommandDiscovered={slashCommandDiscovered}
      />
    </dialog>
  );
};
