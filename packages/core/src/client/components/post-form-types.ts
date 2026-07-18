/**
 * Shared type definitions for the post form Lit component.
 */

export type PostFormat = "note" | "link" | "quote";
export type PostStatus = "published" | "draft";
export type PostVisibility = "public" | "latest_hidden";

export interface PostFormLabels {
  formatLabel: string;
  noteOption: string;
  linkOption: string;
  quoteOption: string;
  titleLabel: string;
  titlePlaceholder: string;
  slugLabel: string;
  slugPlaceholder: string;
  slugHelp: string;
  bodyLabel: string;
  bodyPlaceholder: string;
  urlLabel: string;
  urlPlaceholder: string;
  quoteTextLabel: string;
  quoteTextPlaceholder: string;
  mediaLabel: string;
  mediaAddButton: string;
  mediaRemoveButton: string;
  mediaEmptyLabel: string;
  statusLabel: string;
  statusPublished: string;
  statusDraft: string;
  visibilityLabel: string;
  visibilityPublic: string;
  visibilityHiddenFromLatest: string;
  pinnedLabel: string;
  collectionsLabel: string;
  submitLabel: string;
  cancelLabel: string;
  mediaDialogTitle: string;
  mediaDialogDone: string;
  mediaDialogLoading: string;
  submitSuccessMessage: string;
  submitErrorMessage: string;
  draftFallbackMessage: string;
}

export interface PostFormInitial {
  format: PostFormat;
  title: string;
  slug: string;
  body: string;
  url: string;
  quoteText: string;
  status: PostStatus;
  visibility: PostVisibility;
  pinned: boolean;
  rating: number;
  collectionIds: number[];
  mediaIds: string[];
}

export interface ThreadCollectionOption {
  id: number;
  title: string;
}

export interface PostMediaItem {
  id: string;
  thumbUrl: string;
  alt: string;
  mimeType: string;
  originalName: string;
}

export interface PostSubmitDetail {
  endpoint: string;
  isEdit: boolean;
  data: {
    format: PostFormat;
    title?: string;
    slug?: string;
    body?: string;
    status: PostStatus;
    visibility: PostVisibility;
    pinned: boolean;
    url?: string;
    quoteText?: string;
    rating?: number;
    collectionIds: number[];
    mediaIds: string[];
  };
  messages: {
    success: string;
    error: string;
  };
}
