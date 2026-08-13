/**
 * Compose Dialog Types
 *
 * Shared type definitions for jant-compose-dialog and jant-compose-editor
 * Lit Web Components, and the compose bridge script.
 */

import type { JSONContent } from "@tiptap/core";
import type { CollectionFormLabels } from "./collection-types.js";
import type { TableControlLabels } from "../tiptap/table-control-labels.js";

export type ComposeFormat = "note" | "link" | "quote";

/**
 * What one composer row says about itself. An editor owns its fields, so it
 * owns these two answers too — the dialog reduces them over the rows it has
 * instead of reading editors back out of the DOM while it renders.
 */
export interface ComposeRowStatus {
  /** Anything worth keeping: the check behind "discard this?" and autosave. */
  hasContent: boolean;
  /** Enough to publish this row: its format's requirements met, fields valid. */
  publishable: boolean;
}

export interface ComposeAttachment {
  clientId: string;
  file: File;
  previewUrl: string;
  /**
   * Poster URL for video attachments, used as `<video poster>` so Safari shows
   * a preview frame (Chrome renders the first frame natively, Safari does not).
   * For new uploads this is a blob URL produced by `URL.createObjectURL`; for
   * edit mode it's the server-side poster URL.
   */
  posterUrl: string | null;
  status: "pending" | "processing" | "uploading" | "done" | "error";
  progress: number | null;
  mediaId: string | null;
  /**
   * Server URL of the uploaded file, set when the upload completes. Unlike
   * `previewUrl` (a blob URL revoked on editor reset) it stays valid, so
   * draft restore can rehydrate the attachment after the dialog closed.
   */
  remoteUrl: string | null;
  alt: string;
  error: string | null;
  /** Text content preview for text files (first ~100 chars) */
  summary: string | null;
  /** Character count of text content */
  chars: number | null;
}

export interface AttachedTextItem {
  clientId: string;
  bodyJson: JSONContent | null;
  /** Pre-rendered HTML from TipTap, used for preview on the public page */
  bodyHtml: string;
  summary: string;
  /** Set for already-persisted text media items (edit mode) */
  mediaId?: string;
  /** Snapshot from the persisted version, used to avoid rewriting unchanged text attachments */
  originalBodyJson?: JSONContent | null;
}

export interface DraftItem {
  id: string;
  slug: string;
  format: ComposeFormat;
  title: string | null;
  bodyText: string | null;
  bodyHtml: string | null;
  url: string | null;
  quoteText: string | null;
  replyToId: string | null;
  updatedAt: number;
  mediaAttachments: {
    id: string;
    previewUrl: string;
    alt: string | null;
    mimeType: string;
  }[];
}

/**
 * Snapshot of a media attachment whose upload completed. Stored in the local
 * draft (and passed by the bridge on failure restore) so uploaded images
 * survive a failed publish or a page reload — the bytes are already on the
 * server, only the reference needs restoring.
 */
export interface LocalDraftMedia {
  clientId: string;
  mediaId: string;
  url: string;
  mimeType: string;
  name?: string;
  alt?: string;
  summary?: string | null;
  chars?: number | null;
}

export interface LocalDraft {
  format: ComposeFormat;
  title: string;
  bodyJson: JSONContent | null;
  url: string;
  quoteText: string;
  quoteAuthor: string;
  slug: string;
  publishedAtInput?: string;
  publishedAtTimeMinutes?: number | null;
  visibility: ComposeVisibility;
  rating: number;
  showTitle: boolean;
  showRating: boolean;
  collectionIds: string[];
  replyToId: string | null;
  /** Language the author picked, if they picked one. */
  language?: string | null;
  /**
   * Thread root this draft is a translation of. Carried so a half-written
   * translation picked up later still knows what it belongs to.
   */
  translationOfId?: string | null;
  attachedTexts: Array<{
    clientId: string;
    bodyJson: JSONContent | null;
    bodyHtml: string;
    summary: string;
  }>;
  attachmentOrder?: string[];
  mediaAttachments?: LocalDraftMedia[];
  /** Present when the draft is a multi-post thread */
  threadItems?: Array<{
    format: ComposeFormat;
    /** Per-post publish date; empty means "follows the thread". */
    publishedAtInput?: string;
    publishedAtTimeMinutes?: number | null;
    /** Per-post permalink; empty means the server assigns a random id. */
    slug?: string;
    title: string;
    bodyJson: JSONContent | null;
    url: string;
    quoteText: string;
    quoteAuthor: string;
    attachedTexts: Array<{
      clientId: string;
      bodyJson: JSONContent | null;
      bodyHtml: string;
      summary: string;
    }>;
    attachmentOrder?: string[];
    mediaAttachments?: LocalDraftMedia[];
  }>;
  savedAt: number;
}

export interface ComposeLabels {
  cancel: string;
  note: string;
  link: string;
  quote: string;
  saveDraft: string;
  saveAsDraft: string;
  discard: string;
  titlePlaceholder: string;
  bodyPlaceholder: string;
  urlPlaceholder: string;
  urlInvalid: string;
  linkUrlRequired: string;
  linkTitleRequired: string;
  linkTitlePlaceholder: string;
  thoughtsPlaceholder: string;
  quotePlaceholder: string;
  authorPlaceholder: string;
  sourcePlaceholder: string;
  attachedText: string;
  attachedTextPlaceholder: string;
  attachedTextHint: string;
  done: string;
  media: string;
  rate: string;
  emoji: string;
  title: string;
  fullscreen: string;
  exitFullscreen: string;
  collection: string;
  searchCollections: string;
  noCollections: string;
  emptyCollections: string;
  post: string;
  addAlt: string;
  addAltTitle: string;
  altPlaceholder: string;
  altHint: string;
  addMore: string;
  removeAttachment: string;
  uploading: string;
  /** Toast when exactly one pasted remote image couldn't be rehosted. */
  imageNotRehosted?: string;
  /** Toast when several pasted remote images couldn't be rehosted (uses a {count} placeholder). */
  imagesNotRehosted?: string;
  /** Inline editor label shown when an image node cannot load. */
  brokenImageUnavailable?: string;
  /** Button label for removing a broken inline image. */
  brokenImageDelete?: string;
  /** Button label for replacing a broken inline image. */
  brokenImageReplace?: string;
  /** Button label for opening the original broken image URL. */
  brokenImageOpen?: string;
  loadingPost: string;
  loadPostFailed: string;
  published: string;
  view: string;
  retryAll: string;
  editPost: string;
  update: string;
  confirmCloseTitle: string;
  confirmCloseSubtitle: string;
  confirmCloseSave: string;
  confirmCloseCancel: string;
  confirmCloseDiscard: string;
  confirmAttachedTitle: string;
  confirmAttachedSubtitle: string;
  confirmAttachedSave: string;
  confirmAttachedDiscard: string;
  confirmEditTitle: string;
  confirmEditSubtitle: string;
  confirmEditPublish: string;
  confirmEditDiscard: string;
  discardChangesConfirm: string;
  drafts: string;
  draftsEmpty: string;
  previewDraft: string;
  draftActions: string;
  deleteDraft: string;
  draftDeleted: string;
  publishFailedDraft: string;
  uploadFailedDraft: string;
  addCollection: string;
  collectionCountLabel: string;
  draftRestored: string;
  reply: string;
  publishHideFromLatest: string;
  publishPrivate: string;
  publishSettings: string;
  languageLabel: string;
  languageAuto: string;
  languageAutoHint: string;
  languageAutoDetected: string;
  languageAutoPending: string;
  languageTriggerLabel: string;
  translationOf: string;
  translationContext: string;
  translationContextInLanguage: string;
  translationContextOpen: string;
  translationContextOriginal: string;
  translationContextHide: string;
  translationContextHideLong: string;
  translationContextShow: string;
  translationContextShowLong: string;
  publishVisibilityLabel: string;
  publishVisibilityPublic: string;
  publishVisibilityPublicHint: string;
  publishVisibilityHiddenFromLatest: string;
  publishVisibilityHiddenFromLatestHint: string;
  publishVisibilityPrivate: string;
  publishVisibilityPrivateHint: string;
  publishDateLabel: string;
  publishDateHint: string;
  publishDateReset: string;
  publishDateInvalid: string;
  publishDateFutureError: string;
  publishDateSummaryNow: string;
  publishDateSummaryAction: string;
  publishSlugLabel: string;
  publishSlugPlaceholder: string;
  publishSlugHint: string;
  publishSlugAuto: string;
  publishSlugSummaryAuto: string;
  publishSlugSummaryAction: string;
  publishSlugReset: string;
  publishSlugSuggested: string;
  publishSlugGenerating: string;
  publishSlugChecking: string;
  publishSlugTaken: string;
  publishSlugInvalid: string;
  publishSlugReserved: string;
  postHiddenFromLatest: string;
  postPrivately: string;
  quietReplyLabel: string;
  quietReplyHint: string;
  threadLimitReached: string;
  showMore: string;
  showLess: string;
  closeCompose: string;
  editing: string;
  composeDialogLabel: string;
  slashHint: string;
  tableControls: TableControlLabels;
  collectionFormLabels: CollectionFormLabels;
}

export interface ComposeFullscreenReplyContext {
  contentHtml: string;
  dateText: string;
  expanded: boolean;
}

export interface ComposeEditorSelection {
  from: number;
  to: number;
}

export interface ComposeFullscreenOpenDetail {
  json: JSONContent | null;
  title: string;
  showTitle: boolean;
  selection?: ComposeEditorSelection | null;
  labels?: ComposeLabels;
  replyContext?: ComposeFullscreenReplyContext | null;
  editorIndex?: number;
}

export interface ComposeFullscreenCloseDetail {
  json: JSONContent | null;
  title: string;
  showTitle: boolean;
  selection?: ComposeEditorSelection | null;
  replyExpanded: boolean;
  intent?: "publish";
  editorIndex?: number;
}

export type ComposeVisibility = "public" | "latest_hidden" | "private";

export type ComposeSubmitAttachment =
  | {
      type: "media";
      clientId: string;
      mediaId: string | null;
      alt?: string;
    }
  | {
      type: "text";
      clientId: string;
      bodyJson: JSONContent;
      summary: string;
      mediaId?: string;
      originalBodyJson?: JSONContent | null;
    };

export interface ComposeSubmitDetail {
  format: ComposeFormat;
  title: string;
  body: string;
  url: string;
  quoteText: string;
  quoteAuthor: string;
  status: "published" | "draft";
  visibility?: ComposeVisibility;
  slug?: string;
  publishedAt?: number;
  rating: number;
  collectionIds: string[];
  attachments: ComposeSubmitAttachment[];
  editPostId?: string;
  /** Identifies an existing server draft loaded through the drafts workflow. */
  draftSourceId?: string;
  replyToId?: string;
  quietReply?: boolean;
  replyThreadRootId?: string;
  replyRefreshKind?: "timeline-item" | "post-card" | "post-view";
  replyRefreshId?: string;
  /**
   * Content language chosen by the author. Absent means "nobody said" — the
   * server reads one out of the text rather than guessing in the browser,
   * because it sees the final text.
   */
  language?: string;
  /** Thread root this post is being written as a translation of. */
  translationOfId?: string;
  /** Present when submitting a multi-post thread; index 0 is the root */
  threadPosts?: ComposeSubmitDetail[];
}

/** One language the site publishes, as offered in the composer. */
export interface ComposeLanguage {
  /** Canonical BCP 47 tag. */
  tag: string;
  /** The language's own name for itself, e.g. "日本語". */
  label: string;
}

export interface ComposeCollection {
  id: string;
  title: string;
  slug: string;
}
