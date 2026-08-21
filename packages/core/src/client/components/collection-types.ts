/**
 * Shared type definitions for the collection quick-create form.
 */

export interface CollectionFormLabels {
  titleLabel: string;
  titlePlaceholder: string;
  slugLabel: string;
  slugHelp: string;
  slugInvalidHelp: string;
  slugReservedHelp: string;
  slugTooLongHelp?: string;
  editSlugLabel: string;
  resetSlugLabel: string;
  quickHint: string;
  quickSubmitLabel: string;
  createdLabel: string;
  cancelLabel: string;
}

export interface CollectionFormInitial {
  title: string;
  slug: string;
}

export interface CollectionSubmitDetail {
  endpoint: string;
  data: {
    title: string;
    slug: string;
  };
}
