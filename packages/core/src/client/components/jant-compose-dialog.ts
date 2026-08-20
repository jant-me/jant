/**
 * Compose Dialog
 *
 * Outer shell for the compose dialog: header with format switcher,
 * collection selector, action row, and attachment upload coordination.
 *
 * Light DOM only — BaseCoat and Tailwind classes apply directly.
 */

import { LitElement, html, nothing } from "lit";
import { classMap } from "lit/directives/class-map.js";
import { repeat } from "lit/directives/repeat.js";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
import { unsafeSVG } from "lit/directives/unsafe-svg.js";
import { ifDefined } from "lit/directives/if-defined.js";
import type { Editor, JSONContent } from "@tiptap/core";
import { extractBodyText } from "../../lib/summary.js";
import { readContentLanguage } from "../../lib/lang-detect.js";
import type {
  ComposeFormat,
  ComposeVisibility,
  ComposeLabels,
  ComposeCollection,
  ComposeLanguage,
  ComposeSubmitDetail,
  ComposeSubmitAttachment,
  ComposeAttachment,
  ComposeRowStatus,
  DraftItem,
  LocalDraft,
  LocalDraftMedia,
  ComposeFullscreenOpenDetail,
  ComposeFullscreenReplyContext,
  ComposeFullscreenCloseDetail,
} from "./compose-types.js";
import type { CollectionSubmitDetail } from "./collection-types.js";
import { showToast } from "../toast.js";
import { publicPath } from "../runtime-paths.js";
import { parseMarkdownDocument } from "../../lib/markdown-manager.js";
import {
  applyItemOrder,
  filterCollectionsBySearch,
  getSelectedFirstOrder,
} from "../collection-picker-order.js";
import type { JantComposeEditor } from "./jant-compose-editor.js";
import { convertComposeFormat } from "./compose-format-convert.js";
import { getMediaCategory } from "../../lib/upload.js";
import { getSlugValidationIssue } from "../../lib/slug-format.js";
import { createTiptapEditor } from "../tiptap/create-editor.js";
import { MAX_THREAD_POSTS } from "../../types.js";
import { randomUUID } from "../random-uuid.js";

interface ReplyToMedia {
  url: string;
  previewUrl: string;
  alt?: string;
  mimeType: string;
  width?: number;
  height?: number;
}

interface ReplyToData {
  contentHtml: string;
  dateText: string;
  media?: ReplyToMedia[];
}

interface ThreadItem {
  id: string;
  format: ComposeFormat;
  /**
   * Per-post publish date. Empty means "follows the thread" — the server fills
   * it from the root (see `createThreadWithAttachments`). The root's own date
   * stays on `_publishedAtInput` so every existing edit/draft/submit path keeps
   * working unchanged.
   */
  publishedAtInput?: string;
  publishedAtTimeMinutes?: number | null;
  /** Per-post permalink. Empty means the server assigns a random id. */
  slug?: string;
  /** Last availability answer for this post's slug. */
  slugTaken?: boolean;
}

interface ApiMediaAttachment {
  type: "media";
  id: string;
  previewUrl: string;
  posterUrl?: string | null;
  alt?: string;
  mimeType: string;
  url?: string;
  width?: number;
  height?: number;
  summary?: string;
  chars?: number;
  originalName?: string;
}

interface ApiTextAttachment {
  type: "text";
  id: string;
  contentUrl: string;
  summary?: string;
  chars?: number;
}

type ApiAttachment = ApiMediaAttachment | ApiTextAttachment;

interface ComposePostResponse {
  id: string;
  threadId?: string;
  threadPosition?: number;
  format: ComposeFormat;
  slug?: string | null;
  visibility?: ComposeVisibility | null;
  replyToId?: string | null;
  collectionIds?: string[];
  attachments?: ApiAttachment[];
  title?: string | null;
  body?: string | null;
  url?: string | null;
  sourceName?: string | null;
  sourceUrl?: string | null;
  quoteText?: string | null;
  rating?: number | null;
  publishedAt?: number | null;
  bodyHtml?: string | null;
  /**
   * The language this Post is filed under. Null on a single-language site, and
   * on posts written before the feature was turned on.
   */
  language?: string | null;
}

interface DraftsResponse {
  posts?: Record<string, unknown>[];
}

interface ComposeOpenOptions {
  collectionId?: string;
  restoreDraft?: boolean;
  initialFormat?: ComposeFormat;
  /** false suppresses the "Draft restored." toast (failure reopen: the error toast is enough) */
  restoreToast?: boolean;
  /** Uploads the bridge knows completed — merged over the draft's own media snapshot */
  restoreMedia?: LocalDraftMedia[];
}

interface ComposeReplyOpenOptions {
  restoreDraft?: boolean;
  initialFormat?: ComposeFormat;
  restoreToast?: boolean;
  restoreMedia?: LocalDraftMedia[];
}

interface ComposeStateSnapshot {
  format: ComposeFormat;
  collectionIds: string[];
  slug: string;
  publishedAtInput: string;
  publishedAtTimeMinutes: number | null;
  visibility: ComposeVisibility;
  /** The author's explicit language choice, not what detection reads. */
  language: string | null;
  title: string;
  bodyJson: JSONContent | null;
  url: string;
  quoteText: string;
  quoteAuthor: string;
  rating: number;
  showRating: boolean;
  attachments: Array<{
    clientId: string;
    mediaId: string | null;
    previewUrl: string;
    mimeType: string;
    alt: string;
    status: ComposeAttachment["status"];
    summary: string | null;
    chars: number | null;
  }>;
  attachedTexts: Array<{
    clientId: string;
    mediaId: string | null;
    bodyJson: JSONContent | null;
    bodyHtml: string;
    summary: string;
  }>;
  attachmentOrder: string[];
}

const EDITOR_FLOATING_UI_SELECTOR = "[data-editor-floating-ui]";

/**
 * Row key for the single-post composer. Thread posts key on their own id; a
 * lone post has no thread item to borrow one from.
 */
const SINGLE_ROW_ID = "single";

interface ComposeFilePickerCloseDetail {
  cancelled?: boolean;
}

const COMPOSE_PUBLISH_PANEL_FULLSCREEN_QUERY =
  "(max-width: 700px), (max-height: 760px), (hover: none) and (pointer: coarse)";

const COMPOSE_SHEET_ROW_ICONS = {
  drafts: `
    <rect x="3.85" y="3.45" width="7.85" height="8.35" rx="2.35" />
    <rect
      x="6.15"
      y="5.75"
      width="7.85"
      height="8.35"
      rx="2.35"
      fill="var(--compose-icon-paper-fill)"
      stroke="none"
    />
    <rect x="6.15" y="5.75" width="7.85" height="8.35" rx="2.35" />
    <path d="M8.55 8.55h3.2" stroke-width="1.2" />
    <path d="M8.55 10.8h3.95" stroke-width="1.2" />
    <path d="M8.55 13.05h2.45" stroke-width="1.2" />
  `,
  /* A bookmark: keep this where you can come back to it. One silhouette holds
     up at the 16px these rows render at, where the page-and-pencil it replaced
     turned to mush — and it stays clearly apart from the stacked pages above,
     which the page alone did not. The down-arrow/tray before that read as a
     download. */
  saveDraft: `
    <path d="M6.65 3.6h4.7a2 2 0 0 1 2 2v8.7L9 11.75l-4.35 2.55V5.6a2 2 0 0 1 2-2Z" />
  `,
} as const;

const COMPOSE_PUBLISH_VISIBILITY_ICONS: Record<ComposeVisibility, string> = {
  public: `
    <circle cx="8" cy="8" r="5.15" />
    <path d="M3.85 8h8.3" />
    <path d="M8 2.85c1.22 1.32 1.95 3.08 1.95 5.15S9.22 11.83 8 13.15" />
    <path d="M8 2.85C6.78 4.17 6.05 5.93 6.05 8S6.78 11.83 8 13.15" />
  `,
  latest_hidden: `
    <path
      d="M2.55 8c1.38-2.18 3.44-3.4 5.45-3.4S12.07 5.82 13.45 8c-1.38 2.18-3.44 3.4-5.45 3.4S3.93 10.18 2.55 8Z"
    />
    <path d="M4.35 11.1 11.65 4.9" />
  `,
  private: `
    <rect x="4.05" y="7.05" width="7.9" height="5.4" rx="1.75" />
    <path d="M5.95 7.05V5.9A2.05 2.05 0 0 1 8 3.85a2.05 2.05 0 0 1 2.05 2.05v1.15" />
  `,
};

/* Drawn on a 14 grid, which is also the size these render at: a 16-unit
   drawing shown at 14px scales every coordinate by 0.875, so no edge lands on
   a device pixel and the whole glyph greys out. Diagonals are antialiased
   whatever you do, so the checks and carets only needed the grid; the calendar
   is all horizontals and verticals, and those are what the scale was smearing.
   See its stroke width for the rest of that story. */
const COMPOSE_PUBLISH_ACTION_ICONS = {
  check: `
    <path d="M3.75 7.25 6 9.5l4.25-4.25" />
  `,
  caretRight: `
    <path d="M5.65 4.5 8.15 7l-2.5 2.5" />
  `,
  /* Every straight stroke is centred on a half unit and drawn 1 wide, which is
     the only combination that lands on whole device pixels at 1x, 2x and 3x
     alike: a 1px stroke centred at x.5 covers exactly one pixel at 1x, two at
     2x, three at 3x. Hence also the flat `stroke-width`, overriding the
     family's 1.35 — the weight is worth less here than the edges are. The
     rounded corners still antialias, as corners should. */
  calendar: `
    <rect x="2.5" y="3.5" width="9" height="8" rx="2" stroke-width="1" />
    <path d="M4.5 2.5v2" stroke-width="1" />
    <path d="M9.5 2.5v2" stroke-width="1" />
    <path d="M2.5 6.5h9" stroke-width="1" />
  `,
  /* Two sliders — "settings for this thing", without borrowing the gear, which
     elsewhere means site settings. No enclosing box: the trigger is already a
     round button, and a rounded square inside a circle read as two competing
     frames. Drawn on a 24 grid so the tracks have room to separate. */
  options: `
    <path d="M4 8.5h3.4" stroke-width="1.8" />
    <path d="M12.6 8.5H20" stroke-width="1.8" />
    <circle cx="10" cy="8.5" r="2.2" stroke-width="1.8" />
    <path d="M4 15.5h7.4" stroke-width="1.8" />
    <path d="M16.6 15.5H20" stroke-width="1.8" />
    <circle cx="14" cy="15.5" r="2.2" stroke-width="1.8" />
  `,
} as const;

/* The site header's globe, stroke for stroke. Language already has a symbol on
   this site — the switcher in the top right — and the author is the one person
   who sees both. A second glyph for the same idea would only be a second thing
   to learn. Drawn on a 24 grid like its counterpart, so the two are literally
   the same artwork at two sizes. */
const COMPOSE_LANGUAGE_ICON = `
  <circle cx="12" cy="12" r="10" />
  <path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" />
  <path d="M2 12h20" />
`;

const COMPOSE_COLLECTION_PICKER_ICONS = {
  /* A stack seen edge-on, not a folder: a collection is a post filed under
     several topics at once, and the folder glyph promises a single container
     the model does not have. Drawn spanning y 3.5–12.5 so the artwork's centre
     is the viewBox's — it used to sit at 6.9 against a centre of 8, and since
     layout centres the svg *box*, that 1.1-unit drift rode straight through as
     an icon floating above its own label. */
  collection: `
    <path d="M2.5 6.3 8 3.5l5.5 2.8L8 9.1 2.5 6.3Z" />
    <path d="M2.5 9.7 8 12.5l5.5-2.8" />
  `,
  search: `
    <circle cx="7.1" cy="7.1" r="3.65" />
    <path d="m10.1 10.1 2.45 2.45" />
  `,
  plus: `
    <path d="M8 3.5v9" />
    <path d="M3.5 8h9" />
  `,
  plusCircle: `
    <circle cx="8" cy="8" r="5.7" />
    <path d="M8 5.55v4.9" />
    <path d="M5.55 8h4.9" />
  `,
} as const;

function renderComposeSheetRowIcon(
  icon: (typeof COMPOSE_SHEET_ROW_ICONS)[keyof typeof COMPOSE_SHEET_ROW_ICONS],
) {
  return html`<svg
    class="compose-sheet-row-icon"
    width="18"
    height="18"
    viewBox="0 0 18 18"
    fill="none"
    stroke="currentColor"
    stroke-width="1.25"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    ${unsafeSVG(icon)}
  </svg>`;
}

function renderComposePublishVisibilityIcon(
  icon: string,
  classes: string | ReturnType<typeof classMap>,
) {
  return html`<span class=${classes} aria-hidden="true">
    <svg
      class="compose-publish-visibility-svg"
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      stroke-width="1.35"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      ${unsafeSVG(icon)}
    </svg>
  </span>`;
}

function renderComposeCollectionPickerIcon(
  icon: (typeof COMPOSE_COLLECTION_PICKER_ICONS)[keyof typeof COMPOSE_COLLECTION_PICKER_ICONS],
  classes: string,
) {
  return html`<svg
    class=${classes}
    width="16"
    height="16"
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    stroke-width="1.35"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    ${unsafeSVG(icon)}
  </svg>`;
}

function renderComposePublishActionIcon(
  icon: (typeof COMPOSE_PUBLISH_ACTION_ICONS)[keyof typeof COMPOSE_PUBLISH_ACTION_ICONS],
  classes: string,
) {
  return html`<svg
    class=${classes}
    width="14"
    height="14"
    viewBox="0 0 14 14"
    fill="none"
    stroke="currentColor"
    stroke-width="1.35"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    ${unsafeSVG(icon)}
  </svg>`;
}

function toComposeCollections(value: unknown): ComposeCollection[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];

    const id = Reflect.get(item, "id");
    const title = Reflect.get(item, "title");
    const slug = Reflect.get(item, "slug");
    if (typeof id !== "string" || typeof title !== "string") return [];

    return [{ id, title, slug: typeof slug === "string" ? slug : "" }];
  });
}

function isEmptyComposeDoc(json: JSONContent): boolean {
  if (!json.content || json.content.length === 0) return true;
  return json.content.every(
    (node) =>
      node.type === "paragraph" && (!node.content || node.content.length === 0),
  );
}

function normalizeComposeDoc(json: JSONContent | null): JSONContent | null {
  if (!json) return null;
  return isEmptyComposeDoc(json) ? null : json;
}

function padDateTimePart(value: number): string {
  return String(value).padStart(2, "0");
}

function toLocalDateInputValue(timestamp: number): string {
  const date = new Date(timestamp * 1000);
  return `${date.getFullYear()}-${padDateTimePart(
    date.getMonth() + 1,
  )}-${padDateTimePart(date.getDate())}`;
}

function parseLocalDateInputValue(
  value: string,
): { year: number; monthIndex: number; day: number } | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(year, month - 1, day);
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.getFullYear() !== year ||
    parsed.getMonth() !== month - 1 ||
    parsed.getDate() !== day
  ) {
    return null;
  }

  return { year, monthIndex: month - 1, day };
}

function getTimestampTimeMinutes(timestamp: number): number {
  const date = new Date(timestamp * 1000);
  return date.getHours() * 60 + date.getMinutes();
}

function buildTimestampFromLocalDate(
  value: string,
  timeMinutes: number,
): number | null {
  const parsed = parseLocalDateInputValue(value);
  if (!parsed) return null;

  const clampedMinutes = Math.min(Math.max(timeMinutes, 0), 23 * 60 + 59);
  const hours = Math.floor(clampedMinutes / 60);
  const minutes = clampedMinutes % 60;
  return Math.floor(
    new Date(
      parsed.year,
      parsed.monthIndex,
      parsed.day,
      hours,
      minutes,
      0,
      0,
    ).getTime() / 1000,
  );
}

/**
 * Split API attachments into media items and resolved text attachments
 * for use with `editor.populate()`.
 */
async function resolveApiAttachments(allAttachments: ApiAttachment[]) {
  const mediaItems = allAttachments.filter(
    (a): a is ApiMediaAttachment => a.type === "media",
  );
  const textItems = allAttachments.filter(
    (a): a is ApiTextAttachment => a.type === "text",
  );

  const media = mediaItems.map((m) => ({
    id: m.id,
    previewUrl: m.previewUrl,
    posterUrl: m.posterUrl ?? null,
    alt: m.alt,
    mimeType: m.mimeType,
    originalName: m.originalName,
    summary: m.summary,
    chars: m.chars,
  }));

  const textAttachments = await Promise.all(
    textItems.map(async (m) => {
      // Editing a post hydrates existing text attachments back into the
      // editor. Fetch the markdown source from the auth'd attachments API
      // (compose is always admin-authenticated) and parse it into a
      // Tiptap document on the client. The `.html` sibling is not used
      // here — the editor owns HTML rendering from the JSON source.
      try {
        const res = await fetch(m.contentUrl);
        if (res.ok) {
          const payload = (await res.json()) as {
            content?: string;
            contentFormat?: string;
          };
          const markdown =
            payload.contentFormat === "markdown" && payload.content
              ? payload.content
              : "";
          const doc = markdown ? parseMarkdownDocument(markdown) : null;
          if (doc) {
            return {
              bodyJson: JSON.stringify(doc),
              bodyHtml: "",
              summary: m.summary ?? "",
              mediaId: m.id,
            };
          }
        }
      } catch {
        // Fetch or parse failed — fall through to the empty-shell return
        // below. The attachment stays visible in the composer so the user
        // can decide whether to keep, edit, or remove it explicitly; we
        // do not silently drop it.
      }
      return {
        bodyJson: JSON.stringify({
          type: "doc",
          content: [{ type: "paragraph" }],
        }),
        bodyHtml: "",
        summary: m.summary ?? "",
        mediaId: m.id,
      };
    }),
  );

  const attachmentOrder = allAttachments.map((a) => a.id);

  return { media, textAttachments, attachmentOrder };
}

export class JantComposeDialog extends LitElement {
  private static _lastNewPostVisibility: ComposeVisibility = "public";

  /** The collection ID that triggered this compose session (for per-collection visibility memory). */
  private _sourceCollectionId: string | null = null;

  private static _collectionVisibilityKey(collectionId: string): string {
    return `jant:collection-visibility:${collectionId}`;
  }

  private static _getCollectionVisibility(
    collectionId: string,
  ): ComposeVisibility | null {
    try {
      const v = globalThis.localStorage.getItem(
        JantComposeDialog._collectionVisibilityKey(collectionId),
      );
      if (v === "public" || v === "latest_hidden" || v === "private") return v;
    } catch {
      // localStorage unavailable
    }
    return null;
  }

  private static _setCollectionVisibility(
    collectionId: string,
    visibility: ComposeVisibility,
  ) {
    try {
      globalThis.localStorage.setItem(
        JantComposeDialog._collectionVisibilityKey(collectionId),
        visibility,
      );
    } catch {
      // localStorage unavailable
    }
  }

  /**
   * Whether a note's title field starts visible, remembered per browser.
   * Titling notes is a habit rather than a per-post decision, so the last
   * deliberate answer carries over. One key, not one per collection: where the
   * note was started says nothing about whether it wants a name.
   */
  private static _NOTE_TITLE_KEY = "jant:compose-note-title";

  /** Defaults to on, so a browser with nothing stored behaves as it always has. */
  private static _getNoteTitleDefault(): boolean {
    try {
      return (
        globalThis.localStorage.getItem(JantComposeDialog._NOTE_TITLE_KEY) !==
        "0"
      );
    } catch {
      // localStorage unavailable
      return true;
    }
  }

  private static _setNoteTitleDefault(show: boolean) {
    try {
      globalThis.localStorage.setItem(
        JantComposeDialog._NOTE_TITLE_KEY,
        show ? "1" : "0",
      );
    } catch {
      // localStorage unavailable
    }
  }

  static properties = {
    collections: { type: Array },
    languages: { type: Array },
    contextLanguage: { type: String, attribute: "context-language" },
    labels: { type: Object },
    uploadMaxFileSize: { type: Number, attribute: "upload-max-file-size" },
    pageMode: { type: Boolean, attribute: "page-mode" },
    closeHref: { type: String, attribute: "close-href" },
    autoRestoreDraft: { type: Boolean, attribute: "auto-restore-draft" },
    slashCommandDiscovered: {
      type: Boolean,
      attribute: "slash-command-discovered",
    },
    _format: { state: true },
    _status: { state: true },
    _loading: { state: true },
    _openingEdit: { state: true },
    _collectionIds: { state: true },
    _showCollection: { state: true },
    _collectionSearch: { state: true },
    _altPanelOpen: { state: true },
    _altPanelIndex: { state: true },
    _attachedPanelOpen: { state: true },
    _attachedTextIndex: { state: true },
    _confirmPanelOpen: { state: true },
    _editPostId: { state: true },
    _draftSourceId: { state: true },
    _draftsPanelOpen: { state: true },
    _drafts: { state: true },
    _draftsLoading: { state: true },
    _draftsError: { state: true },
    _draftMenuOpenId: { state: true },
    _addCollectionPanelOpen: { state: true },
    _replyToId: { state: true },
    _replyToData: { state: true },
    _replyParentPosition: { state: true },
    _replyExpanded: { state: true },
    _threadItems: { state: true },
    _rowStatus: { state: true },
    _focusedThreadIndex: { state: true },
    _slug: { state: true },
    _publishedAtInput: { state: true },
    _visibility: { state: true },
    _showPublishPanel: { state: true },
    _postMetaIndex: { state: true },
    _publishPanelFullscreen: { state: true },
    _suggestedSlug: { state: true },
    _suggestedSlugLoading: { state: true },
    _slugCheckLoading: { state: true },
    _slugTaken: { state: true },
    _visibilityLocked: { state: true },
    _quietReply: { state: true },
    _language: { state: true },
    _showLanguagePicker: { state: true },
    _translationOf: { state: true },
    _translationCollapsed: { state: true },
  };

  declare collections: ComposeCollection[];
  declare languages: ComposeLanguage[];
  /** Content language of the page the composer opened from. */
  declare contextLanguage: string;
  declare labels: ComposeLabels;
  declare uploadMaxFileSize: number;
  declare pageMode: boolean;
  declare closeHref: string;
  declare autoRestoreDraft: boolean;
  declare slashCommandDiscovered: boolean;
  declare _format: ComposeFormat;
  declare _status: "published" | "draft";
  declare _loading: boolean;
  declare _openingEdit: boolean;
  declare _collectionIds: string[];
  declare _showCollection: boolean;
  declare _collectionSearch: string;
  declare _altPanelOpen: boolean;
  declare _altPanelIndex: number;
  declare _attachedPanelOpen: boolean;
  declare _attachedTextIndex: number;
  declare _confirmPanelOpen: boolean;
  declare _editPostId: string | null;
  declare _draftSourceId: string | null;
  declare _draftsPanelOpen: boolean;
  declare _drafts: DraftItem[];
  declare _draftsLoading: boolean;
  declare _draftsError: string | null;
  declare _draftMenuOpenId: string | null;
  declare _addCollectionPanelOpen: boolean;
  declare _replyToId: string | null;
  declare _replyToData: ReplyToData | null;
  /** Where the post being replied to sits in its own chain; see
   *  `_positionLabel`. Null until the parent has been read back. */
  declare _replyParentPosition: number | null;
  declare _replyExpanded: boolean;
  declare _threadItems: ThreadItem[];
  /** Each row's own answer, keyed by row id. See `_rowIds`. */
  declare _rowStatus: ReadonlyMap<string, ComposeRowStatus>;
  declare _focusedThreadIndex: number;
  declare _slug: string;
  declare _publishedAtInput: string;
  declare _visibility: ComposeVisibility;
  declare _showPublishPanel: boolean;
  /** Index of the post whose date/permalink panel is open; null when closed. */
  declare _postMetaIndex: number | null;
  declare _publishPanelFullscreen: boolean;
  declare _suggestedSlug: string;
  declare _suggestedSlugLoading: boolean;
  declare _slugCheckLoading: boolean;
  declare _slugTaken: boolean;
  declare _visibilityLocked: boolean;
  declare _quietReply: boolean;
  /** Author's explicit language choice. Null means "let Jant read it". */
  declare _language: string | null;
  /** Whether the language pill's list of choices is open. */
  declare _showLanguagePicker: boolean;
  /**
   * Thread root this post is being written as a translation of, with enough of
   * it to read: translating from a title alone means keeping the original open
   * in another tab.
   */
  declare _translationOf: {
    id: string;
    title: string;
    href: string;
    /** The post rendered server-side, exactly as its own page renders it. */
    previewHtml: string;
  } | null;
  /**
   * Whether the original is folded away.
   *
   * Per composer session, not remembered: an author who folds it to get room
   * for one paragraph should not find it gone the next time they open a
   * translation, when the first thing they need is to read.
   */
  declare _translationCollapsed: boolean;

  private _attachedEditor: Editor | null = null;
  private _attachedTextSnapshot: JSONContent | null = null;
  /** Whether this composer was pre-filled from the post it translates. */
  private _seededFromSource = false;
  private _confirmForDrafts = false;
  private _confirmForAttachedText = false;
  private _draftSaveTimer: ReturnType<typeof setTimeout> | null = null;
  private _draftRestored = false;
  private _initialSnapshot: string | null = null;
  private _pageFocusApplied = false;
  private _pageLeaveRequested = false;
  private _replyThreadRootId: string | null = null;
  private _replyRefreshKind:
    | "timeline-item"
    | "post-card"
    | "post-view"
    | null = null;
  private _replyRefreshId: string | null = null;
  private _publishedAtTimeMinutes: number | null = null;
  private _originalPublishedAt: number | null = null;
  private _initialPublishedAtTimeMinutes: number | null = null;
  private _initialPublishedAtInput = "";
  private _initialSlug = "";
  private _slugCheckTimer: ReturnType<typeof setTimeout> | null = null;
  private _slugSuggestTimer: ReturnType<typeof setTimeout> | null = null;
  private _slugSuggestRequestId = 0;
  private _slugCheckRequestId = 0;
  private _slugSuggestionKey = "";
  private _suppressBeforeUnload = false;
  private _dialogEl: HTMLDialogElement | null = null;
  private _mousedownOnBackdrop = false;
  private _mousedownPos: { x: number; y: number } | null = null;
  private _filePickerActive = false;
  private _ignoreNextEscapeClose = false;
  private _openEditRequestId = 0;
  private _collectionPickerOrder: string[] = [];
  private _suppressCollectionOptionClickUntil = 0;
  private _suppressedCollectionOptionId: string | null = null;

  createRenderRoot() {
    this.innerHTML = "";
    return this;
  }

  constructor() {
    super();
    this.collections = [];
    this.languages = [];
    this.contextLanguage = "";
    this.labels = {} as ComposeLabels;
    this.uploadMaxFileSize = 1024;
    this.pageMode = false;
    this.closeHref = "/";
    this.autoRestoreDraft = false;
    this.slashCommandDiscovered = false;
    this._format = "note";
    this._status = "published";
    this._loading = false;
    this._openingEdit = false;
    this._collectionIds = [];
    this._showCollection = false;
    this._collectionSearch = "";
    this._altPanelOpen = false;
    this._altPanelIndex = 0;
    this._attachedPanelOpen = false;
    this._attachedTextIndex = 0;
    this._confirmPanelOpen = false;
    this._editPostId = null;
    this._draftSourceId = null;
    this._draftsPanelOpen = false;
    this._drafts = [];
    this._draftsLoading = false;
    this._draftsError = null;
    this._draftMenuOpenId = null;
    this._addCollectionPanelOpen = false;
    this._replyToId = null;
    this._replyToData = null;
    this._replyExpanded = false;
    this._threadItems = [];
    this._rowStatus = new Map();
    this._focusedThreadIndex = 0;
    this._replyThreadRootId = null;
    this._replyParentPosition = null;
    this._replyRefreshKind = null;
    this._replyRefreshId = null;
    this._slug = "";
    this._publishedAtInput = "";
    this._publishedAtTimeMinutes = null;
    this._originalPublishedAt = null;
    this._initialPublishedAtTimeMinutes = null;
    this._initialPublishedAtInput = "";
    this._initialSlug = "";
    this._visibility = JantComposeDialog._lastNewPostVisibility;
    this._sourceCollectionId = null;
    this._showPublishPanel = false;
    this._publishPanelFullscreen = false;
    this._postMetaIndex = null;
    this._suggestedSlug = "";
    this._suggestedSlugLoading = false;
    this._slugCheckLoading = false;
    this._slugTaken = false;
    this._visibilityLocked = false;
    this._quietReply = false;
    this._language = null;
    this._showLanguagePicker = false;
    this._translationOf = null;
    this._translationCollapsed = false;
    this._seededFromSource = false;
  }

  private get _editor(): JantComposeEditor | null {
    return this.querySelector("jant-compose-editor");
  }

  /**
   * The rows the composer currently has, in order — thread posts by their own
   * id, or the single composer's one row.
   *
   * Everything derived from row content reduces over this list, so a row that
   * has been removed stops being asked the moment `_threadItems` changes. No
   * DOM read is involved, which is the point: a render reads the DOM as it
   * stands *before* that render's own changes are committed.
   */
  private get _rowIds(): string[] {
    return this._threadItems.length > 0
      ? this._threadItems.map((item) => item.id)
      : [SINGLE_ROW_ID];
  }

  private _handleRowStatus(rowId: string, status: ComposeRowStatus) {
    const previous = this._rowStatus.get(rowId);
    if (
      previous?.hasContent === status.hasContent &&
      previous?.publishable === status.publishable
    ) {
      return;
    }
    const next = new Map(this._rowStatus);
    next.set(rowId, status);
    this._rowStatus = next;
  }

  protected willUpdate(changed: Map<string, unknown>) {
    super.willUpdate(changed);

    // An answer belongs to the row that gave it. When the set of rows changes,
    // drop the ones that are gone so a row can never inherit an answer that
    // was never about it — leaving thread mode, in particular, hands the single
    // row's key back to a fresh editor.
    if (changed.has("_threadItems")) {
      const live = new Set(this._rowIds);
      if ([...this._rowStatus.keys()].some((id) => !live.has(id))) {
        this._rowStatus = new Map(
          [...this._rowStatus].filter(([id]) => live.has(id)),
        );
      }
    }
  }

  protected updated(changed: Map<string, unknown>) {
    super.updated(changed);
    if (this._initialSnapshot === null && this._editor) {
      this._captureInitialSnapshot();
    }
    this._adoptTranslationPreview();
    // The visible title used to be the dialog's accessible name. Nothing on
    // screen needs to replace it, but a screen reader announcing an unnamed
    // dialog does — so the name moves to an attribute, where it costs no space.
    if (changed.has("labels") && this._dialogEl && this.labels) {
      this._dialogEl.setAttribute("aria-label", this.labels.composeDialogLabel);
    }
    if (
      changed.has("_addCollectionPanelOpen") &&
      this._addCollectionPanelOpen
    ) {
      this.updateComplete.then(() => {
        const titleInput = this.querySelector<HTMLInputElement>(
          "[data-collection-quick-dialog] [data-collection-title-input]",
        );
        titleInput?.focus();
        titleInput?.select();
      });
    }
    if (changed.has("_showCollection") && this._showCollection) {
      this._scheduleCollectionPickerAutofocus();
    }
    if (
      changed.has("_collectionIds") ||
      changed.has("_slug") ||
      changed.has("_publishedAtInput") ||
      changed.has("_visibility")
    ) {
      // Schedule draft auto-save (new-post and edit modes, not draft-load).
      // `_format` is intentionally excluded: a bare format switch is exploratory
      // and shouldn't persist a draft on its own (see `_switchFormat`).
      if (!this._draftSourceId) {
        this._scheduleDraftSave();
      }
    }
    if (this._showPublishPanel) {
      this._updatePublishPanelLayout();
    }
    if (this._showCollection) {
      this._updateCollectionPopoverSide();
    }
    if (this._postMetaIndex !== null) {
      this._updatePostMetaPanelLayout();
    }
  }

  reset() {
    this._openEditRequestId += 1;
    this._format = "note";
    this._status = "published";
    this._loading = false;
    this._openingEdit = false;
    this._collectionIds = [];
    this._closeCollectionPicker();
    this._altPanelOpen = false;
    this._altPanelIndex = 0;
    this._attachedPanelOpen = false;
    this._attachedTextIndex = 0;
    this._confirmPanelOpen = false;
    this._editPostId = null;
    this._draftSourceId = null;
    this._draftsPanelOpen = false;
    this._drafts = [];
    this._draftsLoading = false;
    this._draftsError = null;
    this._draftMenuOpenId = null;
    this._addCollectionPanelOpen = false;
    this._replyToId = null;
    this._replyToData = null;
    this._replyExpanded = false;
    this._threadItems = [];
    this._rowStatus = new Map();
    this._focusedThreadIndex = 0;
    this._replyThreadRootId = null;
    this._replyParentPosition = null;
    this._replyRefreshKind = null;
    this._replyRefreshId = null;
    this._slug = "";
    this._publishedAtInput = "";
    this._publishedAtTimeMinutes = null;
    this._originalPublishedAt = null;
    this._initialPublishedAtTimeMinutes = null;
    this._initialPublishedAtInput = "";
    this._initialSlug = "";
    this._visibility = JantComposeDialog._lastNewPostVisibility;
    this._sourceCollectionId = null;
    this._showPublishPanel = false;
    this._suggestedSlug = "";
    this._suggestedSlugLoading = false;
    this._slugCheckLoading = false;
    this._slugTaken = false;
    this._slugSuggestionKey = "";
    this._visibilityLocked = false;
    this._quietReply = false;
    this._language = null;
    this._showLanguagePicker = false;
    this._translationOf = null;
    this._translationCollapsed = false;
    this._seededFromSource = false;
    this._confirmForDrafts = false;
    this._confirmForAttachedText = false;
    this._initialSnapshot = null;
    this._pageFocusApplied = false;
    this._pageLeaveRequested = false;
    this._slugSuggestRequestId += 1;
    this._slugCheckRequestId += 1;
    this._suppressBeforeUnload = false;
    this._filePickerActive = false;
    this._ignoreNextEscapeClose = false;
    this._cancelSlugTimers();
    this._destroyAttachedEditor();
    this._editor?.reset();
    this._captureInitialSnapshot();
  }

  async refreshCollections(): Promise<boolean> {
    try {
      const res = await fetch("/api/collections?view=compose", {
        cache: "no-store",
        headers: { Accept: "application/json" },
      });
      if (!res.ok) return false;

      const body = (await res.json().catch(() => null)) as {
        collections?: unknown;
      } | null;
      if (!Array.isArray(body?.collections)) return false;

      this.collections = toComposeCollections(body.collections);
      return true;
    } catch {
      return false;
    }
  }

  async openEdit(id: string, options?: { restoreToast?: boolean }) {
    this.reset();
    const requestId = ++this._openEditRequestId;
    this._openingEdit = true;
    this._editPostId = id;

    const dialog = this.closest("dialog");
    if (dialog && !dialog.open) {
      dialog.showModal();
    }
    await this.updateComplete;
    this._focusDialogShell();

    try {
      const res = await fetch(`/api/posts/${id}`);
      if (!res.ok) throw new Error("Failed to load post");
      const post = (await res.json()) as ComposePostResponse;
      if (requestId !== this._openEditRequestId) return;

      this._format = post.format;
      this._slug = post.slug ?? "";
      this._slugTaken = false;
      this._slugCheckLoading = false;
      this._suggestedSlug = "";
      this._suggestedSlugLoading = false;
      this._slugSuggestionKey = "";
      this._publishedAtInput = post.publishedAt
        ? toLocalDateInputValue(post.publishedAt)
        : "";
      this._publishedAtTimeMinutes = post.publishedAt
        ? getTimestampTimeMinutes(post.publishedAt)
        : null;
      this._originalPublishedAt = post.publishedAt ?? null;
      this._initialPublishedAtTimeMinutes = this._publishedAtTimeMinutes;
      this._initialPublishedAtInput = this._publishedAtInput;
      this._initialSlug = this._slug.trim();
      this._visibility = post.visibility ?? "public";
      this._visibilityLocked = Boolean(post.replyToId);
      // A published post's language is a settled fact, so it comes back as the
      // author's own choice rather than as something to re-read: editing a
      // Chinese post from an English page must not quietly re-file it, and the
      // pill next to Post has to show what this post *is*, not a fresh guess.
      this._language = post.language ?? null;

      if (post.replyToId) {
        this._replyToId = post.replyToId;
        await this._fetchReplyContext(post.replyToId);
        if (requestId !== this._openEditRequestId) return;
      }

      if (!post.replyToId && post.collectionIds?.length) {
        this._collectionIds = post.collectionIds;
      }

      const allAttachments = post.attachments ?? [];
      const { media, textAttachments, attachmentOrder } =
        await resolveApiAttachments(allAttachments);
      if (requestId !== this._openEditRequestId) return;

      this._openingEdit = false;
      await this.updateComplete;
      if (requestId !== this._openEditRequestId) return;

      // Check for a local edit draft (unsaved changes from a previous session)
      const restored = this._restoreEditDraftIfAvailable(
        id,
        options?.restoreToast,
      );

      if (!restored) {
        this._editor?.populate({
          format: post.format,
          title:
            post.format === "quote" ? undefined : (post.title ?? undefined),
          bodyJson: post.body ?? undefined,
          url:
            post.format === "quote"
              ? (post.sourceUrl ?? undefined)
              : (post.url ?? undefined),
          quoteText: post.quoteText ?? undefined,
          quoteAuthor:
            post.format === "quote"
              ? (post.sourceName ?? undefined)
              : undefined,
          rating: post.rating ?? undefined,
          media,
          textAttachments,
          attachmentOrder,
        });
      }

      globalThis.requestAnimationFrame(() => {
        if (requestId !== this._openEditRequestId) return;
        this._focusDialogShell();
        this._captureInitialSnapshot();
      });
    } catch {
      if (requestId !== this._openEditRequestId) return;
      this._openingEdit = false;
      this._closeDialog();
      this.reset();
      showToast(this.labels.loadPostFailed, "error");
    }
  }

  async openDraft(id: string) {
    const dialog = this.closest("dialog");
    if (dialog && !dialog.open) {
      dialog.showModal();
    }
    await this.updateComplete;
    this._focusDialogShell();
    await this._loadDraft(id);
  }

  async openNew(options?: ComposeOpenOptions) {
    this.reset();

    // `reset()` seeds the toggle from `titleByDefault`, which Lit only refreshes
    // on the next render — after a reply, that value is still the reply's. Say
    // it outright here. A restored draft overwrites it below with its own
    // answer, which is right: that one belongs to the draft, not to the habit.
    this._editor?.setTitleDefault(JantComposeDialog._getNoteTitleDefault());

    if (options?.restoreDraft !== false) {
      await this.restoreLocalDraft({
        notify: options?.restoreToast,
        extraMedia: options?.restoreMedia,
      });
    }

    if (options?.initialFormat) {
      this._format = options.initialFormat;
    }

    if (
      options?.collectionId &&
      !this._collectionIds.includes(options.collectionId)
    ) {
      this._collectionIds = [options.collectionId, ...this._collectionIds];
    }

    // Restore per-collection visibility preference (only for new posts, not restored drafts)
    if (options?.collectionId) {
      this._sourceCollectionId = options.collectionId;
      const saved = JantComposeDialog._getCollectionVisibility(
        options.collectionId,
      );
      if (saved) {
        this._visibility = saved;
      }
    }

    this.closest("dialog")?.showModal();
    await this.updateComplete;
    this._editor?.focusInput();
    this._captureInitialSnapshot();
  }

  /**
   * Open the composer on a new post that translates an existing one.
   *
   * Nothing is created server-side here: the source ID and the target language
   * ride along in memory, and the translation group is minted only if the
   * author saves. Closing the composer leaves no trace — no draft row, no slug,
   * no single-member group.
   *
   * @param sourcePostId - Thread root the new post translates
   * @param language - Language to write it in
   */
  async openTranslation(sourcePostId: string, language: string) {
    this.reset();
    this._editor?.setTitleDefault(JantComposeDialog._getNoteTitleDefault());

    if (this.languages.some((entry) => entry.tag === language)) {
      this._language = language;
    }

    this.closest("dialog")?.showModal();
    await this.updateComplete;
    this._editor?.focusInput();
    this._captureInitialSnapshot();

    // Deliberately after the open: the original is context, not a
    // precondition, and blocking the composer on a fetch would trade a visible
    // delay for it. `seed` is safe this late because it stands down the moment
    // the author has typed anything.
    await this._loadTranslationSource(sourcePostId, { seed: true });
  }

  /**
   * Open compose dialog in reply mode.
   *
   * @param id - TypeID of the post being replied to
   * @param replyData - Pre-captured content from the DOM (avoids API fetch)
   * @param threadRootId - TypeID of the thread root (used for in-place timeline refresh)
   * @param refreshTarget - Current view to patch after publishing the reply
   */
  async openReply(
    id: string,
    replyData?: ReplyToData,
    threadRootId?: string,
    refreshTarget?: {
      kind: "timeline-item" | "post-card" | "post-view";
      id: string;
    },
    options?: ComposeReplyOpenOptions,
  ) {
    this.reset();
    this._replyToId = id;
    this._replyThreadRootId = threadRootId ?? id;
    this._replyRefreshKind = refreshTarget?.kind ?? null;
    this._replyRefreshId = refreshTarget?.id ?? null;
    this._replyToData = replyData ?? null;
    this._visibilityLocked = true;
    this._format = options?.initialFormat ?? "note";

    if (options?.restoreDraft !== false) {
      await this.restoreLocalDraft({
        expectedReplyToId: id,
        notify: options?.restoreToast,
        extraMedia: options?.restoreMedia,
      });
    }
    // Collection membership belongs to the existing Thread. Reply compose
    // must not restore or submit stale per-compose Collection state.
    this._collectionIds = [];

    this.closest("dialog")?.showModal();
    await this.updateComplete;
    this._editor?.focusInput();
    this._captureInitialSnapshot();
    // Deliberately not awaited: this only feeds the `3/3` marker, and blocking
    // the composer's open on it would trade a visible delay for a decoration.
    // The marker stays hidden until the number is known rather than counting
    // from 1 and then correcting itself.
    void this._loadReplyParentPosition(id);
  }

  /**
   * Read back where the parent sits in its own chain, so the editors below it
   * can be numbered from there. Failure is silent — a missing marker is a much
   * smaller problem than a wrong one.
   */
  private async _loadReplyParentPosition(replyToId: string) {
    try {
      const res = await fetch(`/api/posts/${replyToId}`);
      if (!res.ok) return;
      const post = (await res.json()) as ComposePostResponse;
      // The composer may have been closed, or pointed at another post, while
      // this was in flight.
      if (this._replyToId !== replyToId) return;
      this._replyParentPosition = post.threadPosition ?? null;
    } catch {
      // Leave the marker hidden.
    }
  }

  /**
   * Fetch parent post from API to populate reply context preview.
   * Falls back gracefully if the parent is unavailable (deleted, etc.).
   */
  private async _fetchReplyContext(replyToId: string) {
    try {
      const res = await fetch(`/api/posts/${replyToId}`);
      if (!res.ok) return;
      const post = (await res.json()) as ComposePostResponse;
      this._replyThreadRootId = (post.replyToId as string | null)
        ? (post.threadId as string)
        : (post.id as string);
      this._replyParentPosition = post.threadPosition ?? null;
      const dateText = post.publishedAt
        ? new Date(post.publishedAt * 1000).toLocaleDateString(undefined, {
            month: "short",
            day: "numeric",
          })
        : "";
      const media: ReplyToMedia[] = (post.attachments ?? [])
        .filter((a): a is ApiMediaAttachment => a.type === "media")
        .map((m) => ({
          url: m.url ?? m.previewUrl,
          previewUrl: m.previewUrl,
          alt: m.alt,
          mimeType: m.mimeType,
          width: m.width,
          height: m.height,
        }));
      this._replyToData = {
        contentHtml: (post.bodyHtml as string) ?? "",
        dateText,
        media: media.length > 0 ? media : undefined,
      };
    } catch {
      // Parent unavailable — reply mode still works, just no preview
    }
  }

  set loading(v: boolean) {
    this._loading = v;
  }

  private _closeDialog() {
    const dialog = this.closest("dialog");
    if (dialog) {
      dialog.close();
      // Prevent browsers from leaving the opener in a lingering :focus-visible state.
      (document.activeElement as HTMLElement)?.blur();
      return;
    }

    if (this.pageMode) {
      this._suppressBeforeUnload = true;
      globalThis.location.assign(this.closeHref || publicPath("/"));
    }
  }

  requestCloseAndLeave() {
    this._pageLeaveRequested = true;
    this.requestClose();
  }

  consumePageLeaveRequest(): boolean {
    const shouldLeave = this._pageLeaveRequested;
    this._pageLeaveRequested = false;
    return shouldLeave;
  }

  preparePageLeave() {
    this._suppressBeforeUnload = true;
  }

  private _clearFilePickerEscapeState() {
    this._filePickerActive = false;
    this._ignoreNextEscapeClose = false;
  }

  private _shouldIgnoreEscapeClose(): boolean {
    if (this._filePickerActive || this._ignoreNextEscapeClose) {
      this._clearFilePickerEscapeState();
      return true;
    }
    return false;
  }

  /**
   * Whether any row holds something worth keeping.
   *
   * Collection selection alone isn't content — it's metadata that only matters
   * when paired with actual post content.
   */
  private _hasContent(): boolean {
    return this._rowIds.some(
      (id) => this._rowStatus.get(id)?.hasContent === true,
    );
  }

  /**
   * Whether closing would throw away something the author wrote.
   *
   * Normally "is there content" answers that, because a new composer opens
   * empty. A translation opens pre-seeded with the original's citation, though,
   * and being asked to save a draft of a URL you never typed is worse than the
   * prompt is worth — so once seeded, the question becomes whether anything has
   * changed since it opened.
   */
  private _hasWorkToLose(): boolean {
    if (!this._hasContent()) return false;
    return this._seededFromSource ? this._hasUnsavedChanges() : true;
  }

  private _buildSnapshot(): ComposeStateSnapshot | null {
    const editor = this._editor;
    if (!editor) return null;

    const editorData = editor.getData();
    const attachedTexts = editor.getEffectiveAttachedTexts();
    // No `showTitle` here: a hidden title reads back as an empty one, so the
    // toggle is already visible in `title`.
    const showRating = editorData.rating > 0 ? editor._showRating : false;

    return {
      format: this._format,
      collectionIds: [...this._collectionIds],
      slug: this._slug,
      publishedAtInput: this._publishedAtInput,
      publishedAtTimeMinutes: this._publishedAtTimeMinutes,
      visibility: this._visibility,
      language: this._language,
      title: editorData.title,
      bodyJson: editor.getNormalizedBodyJson(),
      url: editorData.url,
      quoteText: editorData.quoteText,
      quoteAuthor: editorData.quoteAuthor,
      rating: editorData.rating,
      showRating,
      attachments: editor._attachments.map((attachment) => ({
        clientId: attachment.clientId,
        mediaId: attachment.mediaId,
        previewUrl: attachment.previewUrl,
        mimeType: attachment.file.type,
        alt: attachment.alt,
        status: attachment.status,
        summary: attachment.summary,
        chars: attachment.chars,
      })),
      attachedTexts: attachedTexts.map((item) => ({
        clientId: item.clientId,
        mediaId: item.mediaId ?? null,
        bodyJson: item.bodyJson,
        bodyHtml: item.bodyHtml,
        summary: item.summary,
      })),
      attachmentOrder: editor.getEffectiveAttachmentOrder(),
    };
  }

  private _serializeSnapshot(
    snapshot: ComposeStateSnapshot | null,
  ): string | null {
    if (!snapshot) return null;
    return JSON.stringify(snapshot);
  }

  private _captureInitialSnapshot() {
    this._initialSnapshot = this._serializeSnapshot(this._buildSnapshot());
  }

  private _hasUnsavedChanges(): boolean {
    const currentSnapshot = this._serializeSnapshot(this._buildSnapshot());
    if (currentSnapshot === null) return false;
    if (!this._editPostId && !this._draftSourceId && !this._hasContent()) {
      return false;
    }
    if (this._initialSnapshot === null) return this._hasContent();
    return currentSnapshot !== this._initialSnapshot;
  }

  requestClose() {
    if (this._loading) return;

    // Dismiss any open dropdowns first
    if (this._showCollection) {
      this._closeCollectionPicker();
    }
    if (this._showPublishPanel) {
      this._showPublishPanel = false;
    }
    this._showLanguagePicker = false;

    if (this._confirmPanelOpen) {
      const restoreAttachedFocus = this._confirmForAttachedText;
      this._confirmPanelOpen = false;
      this._confirmForDrafts = false;
      this._confirmForAttachedText = false;
      this._pageLeaveRequested = false;
      this.updateComplete.then(() => {
        if (restoreAttachedFocus) {
          this._attachedEditor?.commands.focus();
          return;
        }
        this._editor?.focusInput();
      });
      return;
    }

    // In edit mode, only prompt if actual changes were made
    if (this._editPostId) {
      if (this._hasUnsavedChanges()) {
        this._confirmForDrafts = false;
        this._confirmForAttachedText = false;
        this._confirmPanelOpen = true;
      } else {
        this._closeDialog();
        this.reset();
      }
      return;
    }

    if (this._hasWorkToLose()) {
      this._confirmForDrafts = false;
      this._confirmForAttachedText = false;
      this._confirmPanelOpen = true;
    } else {
      this._closeDialog();
      this.reset();
    }
  }

  private _discardAndClose() {
    if (this._draftSourceId) {
      const id = this._draftSourceId;
      fetch(`/api/posts/${id}`, { method: "DELETE" }).catch(() => {});
      showToast(this.labels.draftDeleted);
    }
    this._clearDraftFromStorage();
    this._confirmPanelOpen = false;
    this._confirmForAttachedText = false;
    this._closeDialog();
    this.reset();
  }

  private _discardAttachedPanel() {
    this._confirmForAttachedText = false;
    this._destroyAttachedEditor();
    this._attachedPanelOpen = false;
    this._editor?.closeAttachedPanel(this._attachedTextIndex);
  }

  private _handleConfirmSave() {
    if (this._confirmForAttachedText) {
      this._confirmPanelOpen = false;
      this._confirmForAttachedText = false;
      this._doneAttachedPanel();
    } else if (this._confirmForDrafts) {
      this._confirmPanelOpen = false;
      if (!this._editor?.hasPendingInlineImageUploads()) {
        this._finishDraftSaveAndOpenDrafts();
      } else {
        void this._saveDraftAndOpenDrafts();
      }
    } else if (this._editPostId) {
      // Editing a published post — publish the update directly
      this._confirmPanelOpen = false;
      void this._submit("published");
    } else {
      this._confirmPanelOpen = false;
      void this._submit("draft");
    }
  }

  private _handleConfirmDiscard() {
    if (this._confirmForAttachedText) {
      this._confirmPanelOpen = false;
      this._discardAttachedPanel();
    } else if (this._confirmForDrafts) {
      if (this._draftSourceId) {
        const id = this._draftSourceId;
        fetch(`/api/posts/${id}`, { method: "DELETE" }).catch(() => {});
        showToast(this.labels.draftDeleted);
      }
      this._confirmPanelOpen = false;
      this.reset();
      this._openDraftsPanel();
    } else {
      this._discardAndClose();
    }
  }

  /** Build the submit payload for a single thread editor (index-aware). */
  private _buildEditorPostDetail(
    editor: JantComposeEditor,
    format: ComposeFormat,
    index: number,
    status: "published" | "draft",
  ): ComposeSubmitDetail {
    editor.promoteLeadingH1Title({ force: true });
    const editorData = editor.getData();
    const mediaAttachments = new Map(
      (editorData.attachments ?? []).map((a) => [a.clientId, a]),
    );
    const textAttachments = new Map(
      editorData.attachedTexts.map((t) => [t.clientId, t]),
    );
    const orderedAttachments: ComposeSubmitAttachment[] = [];
    for (const clientId of editorData.attachmentOrder) {
      const media = mediaAttachments.get(clientId);
      if (media) {
        orderedAttachments.push({
          type: "media",
          clientId,
          mediaId: media.mediaId,
          alt: media.alt || undefined,
        });
        continue;
      }
      const text = textAttachments.get(clientId);
      if (text?.bodyJson) {
        orderedAttachments.push({
          type: "text",
          clientId,
          bodyJson: text.bodyJson,
          summary: text.summary,
          mediaId: text.mediaId,
          originalBodyJson: normalizeComposeDoc(text.originalBodyJson ?? null),
        });
      }
    }
    // Only root post (index 0) carries shared publish settings
    const isRoot = index === 0;
    return {
      format,
      title: editorData.title,
      body: editorData.body,
      url: editorData.url,
      quoteText: editorData.quoteText,
      quoteAuthor: editorData.quoteAuthor,
      status,
      slug: this._getPostSlug(index).trim() || undefined,
      // Every post carries its own date; a reply that left it blank sends
      // undefined and the server fills it from the root.
      publishedAt: this._getPostPublishedAtSubmitValue(index, status),
      visibility: isRoot
        ? this._visibilityLocked
          ? undefined
          : this._visibility
        : undefined,
      rating: editorData.rating,
      collectionIds: isRoot && !this._replyToId ? [...this._collectionIds] : [],
      attachments: orderedAttachments,
      replyToId: isRoot ? (this._replyToId ?? undefined) : undefined,
      quietReply:
        isRoot && this._canReplyQuietly()
          ? this._quietReply || undefined
          : undefined,
      replyThreadRootId: isRoot
        ? (this._replyThreadRootId ?? undefined)
        : undefined,
      replyRefreshKind: isRoot
        ? (this._replyRefreshKind ?? undefined)
        : undefined,
      replyRefreshId: isRoot ? (this._replyRefreshId ?? undefined) : undefined,
    };
  }

  private _buildSubmitDetail(
    status: "published" | "draft",
  ): ComposeSubmitDetail | null {
    const editor = this._editor;
    if (!editor) return null;

    editor.promoteLeadingH1Title({ force: true });
    const editorData = editor.getData();
    const mediaAttachments = new Map(
      (editorData.attachments ?? []).map((attachment) => [
        attachment.clientId,
        attachment,
      ]),
    );
    const textAttachments = new Map(
      editorData.attachedTexts.map((item) => [item.clientId, item]),
    );
    const orderedAttachments: ComposeSubmitAttachment[] = [];
    for (const clientId of editorData.attachmentOrder) {
      const mediaAttachment = mediaAttachments.get(clientId);
      if (mediaAttachment) {
        orderedAttachments.push({
          type: "media",
          clientId,
          mediaId: mediaAttachment.mediaId,
          alt: mediaAttachment.alt || undefined,
        });
        continue;
      }

      const textAttachment = textAttachments.get(clientId);
      if (textAttachment?.bodyJson) {
        orderedAttachments.push({
          type: "text",
          clientId,
          bodyJson: textAttachment.bodyJson,
          summary: textAttachment.summary,
          mediaId: textAttachment.mediaId,
          originalBodyJson: normalizeComposeDoc(
            textAttachment.originalBodyJson ?? null,
          ),
        });
      }
    }

    return {
      format: this._format,
      title: editorData.title,
      body: editorData.body,
      url: editorData.url,
      quoteText: editorData.quoteText,
      quoteAuthor: editorData.quoteAuthor,
      slug: this._slug.trim() || undefined,
      publishedAt: this._getPublishedAtSubmitValue(status),
      status,
      visibility: this._visibilityLocked ? undefined : this._visibility,
      rating: editorData.rating,
      collectionIds: this._replyToId ? [] : [...this._collectionIds],
      attachments: orderedAttachments,
      editPostId: this._editPostId ?? this._draftSourceId ?? undefined,
      draftSourceId: this._draftSourceId ?? undefined,
      replyToId: this._replyToId ?? undefined,
      quietReply: this._canReplyQuietly()
        ? this._quietReply || undefined
        : undefined,
      replyThreadRootId: this._replyThreadRootId ?? undefined,
      replyRefreshKind: this._replyRefreshKind ?? undefined,
      replyRefreshId: this._replyRefreshId ?? undefined,
      // Only the root carries a language: a reply belongs to its Thread and
      // inherits it server-side. An automatic choice resolves here to whatever
      // the pill beside this button has been showing — what detection read, or
      // the page's language while it has read nothing. Absent only on a
      // single-language site, where the server decides.
      language: this._replyToId
        ? undefined
        : (this._effectiveLanguage() ?? undefined),
      translationOfId: this._translationOf?.id,
    };
  }

  private _focusBlockedSubmitField(status: "published" | "draft"): boolean {
    if (status === "published") {
      const posts = Math.max(1, this._threadItems.length);
      for (let i = 0; i < posts; i++) {
        if (this._getPostPublishedAtValidationMessage(i) !== null) {
          this._revealPublishedAtField(i);
          return true;
        }
      }
    }

    {
      const posts = Math.max(1, this._threadItems.length);
      for (let i = 0; i < posts; i++) {
        if (this._getPostSlugValidationMessage(i)) {
          this._revealSlugField(i);
          return true;
        }
      }
    }

    // ── Thread mode: validate each editor against its own format ──────
    if (this._threadItems.length > 0) {
      const editors = Array.from(
        this.querySelectorAll<JantComposeEditor>("jant-compose-editor"),
      );
      for (let i = 0; i < this._threadItems.length; i++) {
        const item = this._threadItems[i];
        const editor = editors[i];
        if (!editor) continue;
        if (editor.getUrlValidationMessage()) {
          editor.revealUrlValidation();
          editor.focusUrlInput("end");
          return true;
        }
        if (editor.getLinkTitleValidationMessage()) {
          editor.revealLinkTitleValidation();
          editor.focusLinkTitleInput("end");
          return true;
        }
        if (item.format === "quote" && !editor._quoteText.trim()) {
          editor.focusInput("end");
          return true;
        }
      }
      return false;
    }

    // ── Single-post mode ─────────────────────────────────────────────
    const editor = this._editor;
    if (!editor) return false;

    if (editor.getUrlValidationMessage()) {
      editor.revealUrlValidation();
      editor.focusUrlInput("end");
      return true;
    }

    if (editor.getLinkTitleValidationMessage()) {
      editor.revealLinkTitleValidation();
      editor.focusLinkTitleInput("end");
      return true;
    }

    if (this._format === "quote" && !editor._quoteText.trim()) {
      editor.focusInput("end");
      return true;
    }

    return false;
  }

  private _dispatchSubmit(status: "published" | "draft"): boolean {
    if (this._loading) return false;
    if (this._focusBlockedSubmitField(status)) return false;
    if (!this._draftSourceId) {
      this._cancelDraftSaveTimer();
      this._saveDraftToStorage();
    }

    // ── Thread mode ────────────────────────────────────────────────────
    if (this._threadItems.length > 0) {
      if (this._threadItems.length > MAX_THREAD_POSTS) {
        showToast(this._getThreadLimitMessage(), "error");
        return false;
      }

      const editors = Array.from(
        this.querySelectorAll<JantComposeEditor>("jant-compose-editor"),
      );
      if (editors.length !== this._threadItems.length) return false;

      const threadPosts: ComposeSubmitDetail[] = [];
      const allPending: ComposeAttachment[] = [];

      for (let i = 0; i < this._threadItems.length; i++) {
        const item = this._threadItems[i];
        const editor = editors[i];
        if (!editor) return false;
        threadPosts.push(
          this._buildEditorPostDetail(editor, item.format, i, status),
        );
        allPending.push(
          ...(editor._attachments ?? []).filter(
            (a) =>
              a.status === "pending" ||
              a.status === "processing" ||
              a.status === "uploading",
          ),
        );
      }
      this.dispatchEvent(
        new CustomEvent("jant:compose-submit-deferred", {
          bubbles: true,
          detail: {
            ...threadPosts[0],
            editPostId: this._editPostId ?? this._draftSourceId ?? undefined,
            draftSourceId: this._draftSourceId ?? undefined,
            threadPosts,
            pendingAttachments: allPending,
          },
        }),
      );
      return true;
    }

    // ── Single-post mode ───────────────────────────────────────────────
    const editor = this._editor;
    if (!editor) return false;

    const detail = this._buildSubmitDetail(status);
    if (!detail) return false;

    const pendingAttachments = (editor._attachments ?? []).filter(
      (a) =>
        a.status === "pending" ||
        a.status === "processing" ||
        a.status === "uploading",
    );

    this.dispatchEvent(
      new CustomEvent("jant:compose-submit-deferred", {
        bubbles: true,
        detail: { ...detail, pendingAttachments },
      }),
    );
    return true;
  }

  private _saveDraftAndOpenDrafts() {
    this._finishDraftSaveAndOpenDrafts();
  }

  private _finishDraftSaveAndOpenDrafts() {
    if (!this._dispatchSubmit("draft")) return;
    this.reset();
    // The bridge writes the draft asynchronously via fetch after we dispatch
    // the submit event, so fetching the drafts list immediately would miss
    // the new draft. Wait for the bridge's completion event before loading.
    const onComplete = () => {
      clearTimeout(fallbackTimer);
      if (!this.isConnected) return;
      void this._openDraftsPanel();
    };
    const fallbackTimer = globalThis.setTimeout(() => {
      document.removeEventListener("jant:compose-submit-complete", onComplete);
    }, 10_000);
    document.addEventListener("jant:compose-submit-complete", onComplete, {
      once: true,
    });
  }

  private _finishSubmit(status: "published" | "draft") {
    if (!this._dispatchSubmit(status)) return;
    if (this.pageMode) {
      this._loading = true;
      return;
    }
    this._closeDialog();
    this.reset();
  }

  private _submit(status: "published" | "draft") {
    this._showPublishPanel = false;
    this._finishSubmit(status);
  }

  private _toggleCollection(id: string) {
    if (this._collectionIds.includes(id)) {
      this._collectionIds = this._collectionIds.filter((cid) => cid !== id);
    } else {
      this._collectionIds = [...this._collectionIds, id];
    }
  }

  private _selectedCollectionLabel(collections: ComposeCollection[]): string {
    const ids = this._collectionIds;
    const first = collections.find((c) => c.id === ids[0]);
    if (!first) return "";
    if (ids.length === 1) return first.title;
    if (ids.length === 2) {
      const second = collections.find((c) => c.id === ids[1]);
      return second ? `${first.title}, ${second.title}` : first.title;
    }
    return this.labels.collectionCountLabel
      .replace("%name%", first.title)
      .replace("%count%", String(ids.length - 1));
  }

  private _prepareCollectionPickerOrder() {
    this._collectionPickerOrder = getSelectedFirstOrder(
      this.collections ?? [],
      this._collectionIds,
    );
  }

  private _focusCollectionPickerInitialTarget() {
    this.querySelector<HTMLElement>(
      ".compose-collection-search-input, .compose-collection-option, .compose-collection-add-action",
    )?.focus();
  }

  private _focusCollectionSearchInput() {
    const searchInput = this.querySelector<HTMLInputElement>(
      ".compose-collection-search-input",
    );
    if (!searchInput) return false;

    searchInput.focus();
    const cursor = searchInput.value.length;
    searchInput.setSelectionRange(cursor, cursor);
    return true;
  }

  private _closeCollectionPicker(options?: {
    restoreFocus?: "trigger" | "editor";
  }) {
    this._showCollection = false;
    this._collectionSearch = "";
    this._suppressedCollectionOptionId = null;
    this._suppressCollectionOptionClickUntil = 0;

    if (options?.restoreFocus === "trigger") {
      this.updateComplete.then(() => {
        this.querySelector<HTMLElement>(".compose-collection-trigger")?.focus();
      });
      return;
    }

    if (options?.restoreFocus === "editor") {
      this._restorePageEditorFocus();
    }
  }

  private _suppressNextCollectionOptionClick(collectionId: string) {
    this._suppressedCollectionOptionId = collectionId;
    this._suppressCollectionOptionClickUntil = Date.now() + 250;
  }

  private _isTouchViewport() {
    return (
      globalThis.matchMedia?.("(hover: none) and (pointer: coarse)")?.matches ??
      false
    );
  }

  private _shouldAutofocusCollectionPicker() {
    return !this._isTouchViewport();
  }

  private _shouldAutofocusFormatInput() {
    return !this._isTouchViewport();
  }

  private _scheduleCollectionPickerAutofocus() {
    if (!this._shouldAutofocusCollectionPicker()) return;

    globalThis.requestAnimationFrame(() => {
      if (!this._showCollection) return;
      this._focusCollectionPickerInitialTarget();
    });
  }

  private _scheduleCollectionSearchFocus() {
    globalThis.requestAnimationFrame(() => {
      if (!this._showCollection) return;
      if (!this._focusCollectionSearchInput()) {
        this._focusCollectionPickerInitialTarget();
      }
    });
  }

  private _isPrintableCollectionSearchKey(key: string) {
    return key.length === 1 && key.trim().length > 0;
  }

  private _handleCollectionTriggerKeydown = (
    event: globalThis.KeyboardEvent,
  ) => {
    if (
      event.defaultPrevented ||
      event.isComposing ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey
    ) {
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      this._scheduleCollectionSearchFocus();
      return;
    }

    if (
      !this._showCollection ||
      !this._isPrintableCollectionSearchKey(event.key)
    ) {
      return;
    }

    event.preventDefault();
    this._collectionSearch += event.key;
    this._scheduleCollectionSearchFocus();
  };

  private _getCollectionOptionElements() {
    return Array.from(
      this.querySelectorAll<HTMLButtonElement>(".compose-collection-option"),
    );
  }

  private _handleCollectionSearchKeydown = (
    event: globalThis.KeyboardEvent,
  ) => {
    if (
      event.defaultPrevented ||
      event.isComposing ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey
    ) {
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      this._closeCollectionPicker({ restoreFocus: "trigger" });
      return;
    }

    if (event.key !== "ArrowDown") {
      return;
    }

    const [firstOption] = this._getCollectionOptionElements();
    const addAction = this.querySelector<HTMLButtonElement>(
      ".compose-collection-add-action",
    );
    const nextTarget = firstOption ?? addAction;
    if (!nextTarget) return;

    event.preventDefault();
    nextTarget.focus();
  };

  private _handleCollectionOptionKeydown = (
    event: globalThis.KeyboardEvent,
    collectionId: string,
  ) => {
    if (
      event.defaultPrevented ||
      event.isComposing ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey
    ) {
      return;
    }

    const options = this._getCollectionOptionElements();
    const currentTarget = event.currentTarget as HTMLButtonElement | null;
    const currentIndex = currentTarget ? options.indexOf(currentTarget) : -1;

    if (event.key === "ArrowDown") {
      const addAction = this.querySelector<HTMLButtonElement>(
        ".compose-collection-add-action",
      );
      const nextTarget =
        currentIndex >= 0
          ? (options[currentIndex + 1] ?? addAction)
          : options[0];
      if (!nextTarget) return;

      event.preventDefault();
      nextTarget.focus();
      return;
    }

    if (event.key === "ArrowUp") {
      const searchInput = this.querySelector<HTMLInputElement>(
        ".compose-collection-search-input",
      );
      const previousTarget =
        currentIndex > 0 ? options[currentIndex - 1] : searchInput;
      if (!previousTarget) return;

      event.preventDefault();
      previousTarget.focus();
      return;
    }

    if (event.key === " " || event.key === "Spacebar") {
      event.preventDefault();
      this._suppressNextCollectionOptionClick(collectionId);
      this._toggleCollection(collectionId);
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      this._suppressNextCollectionOptionClick(collectionId);
      this._closeCollectionPicker({ restoreFocus: "trigger" });
    }
  };

  private _handleCollectionOptionClick = (collectionId: string) => {
    if (
      this._suppressedCollectionOptionId === collectionId &&
      Date.now() <= this._suppressCollectionOptionClickUntil
    ) {
      this._suppressedCollectionOptionId = null;
      this._suppressCollectionOptionClickUntil = 0;
      return;
    }

    this._suppressedCollectionOptionId = null;
    this._suppressCollectionOptionClickUntil = 0;
    this._toggleCollection(collectionId);
  };

  private _handleCollectionAddActionKeydown = (
    event: globalThis.KeyboardEvent,
  ) => {
    if (
      event.defaultPrevented ||
      event.isComposing ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      event.key !== "ArrowUp"
    ) {
      return;
    }

    const options = this._getCollectionOptionElements();
    const searchInput = this.querySelector<HTMLInputElement>(
      ".compose-collection-search-input",
    );
    const previousTarget = options.at(-1) ?? searchInput;
    if (!previousTarget) return;

    event.preventDefault();
    previousTarget.focus();
  };

  private _updateCollectionPopoverSide() {
    const trigger = this.querySelector<HTMLElement>(
      ".compose-collection-trigger",
    );
    const popover = this.querySelector<HTMLElement>(
      ".compose-collection-popover[data-popover]",
    );
    if (!trigger || !popover) return;

    const visualViewport = globalThis.visualViewport;
    const viewportTop = visualViewport?.offsetTop ?? 0;
    const viewportBottom =
      viewportTop + (visualViewport?.height ?? globalThis.innerHeight);
    const triggerRect = trigger.getBoundingClientRect();
    const edgePadding = 12;
    const gap = 4;
    const availableBelow = Math.max(
      0,
      viewportBottom - edgePadding - triggerRect.bottom - gap,
    );
    const availableAbove = Math.max(
      0,
      triggerRect.top - viewportTop - edgePadding - gap,
    );

    popover.dataset.side = availableBelow >= availableAbove ? "bottom" : "top";
  }

  private _cancelSlugTimers() {
    if (this._slugCheckTimer !== null) {
      clearTimeout(this._slugCheckTimer);
      this._slugCheckTimer = null;
    }
    if (this._slugSuggestTimer !== null) {
      clearTimeout(this._slugSuggestTimer);
      this._slugSuggestTimer = null;
    }
  }

  private _currentSlugOwnerId(): string | undefined {
    return this._editPostId ?? this._draftSourceId ?? undefined;
  }

  private _hasManualSlug(): boolean {
    return this._slug.trim().length > 0;
  }

  private _currentSuggestionTitle(): string {
    return this._editor?.getData().title.trim() ?? "";
  }

  private _canSuggestSlug(): boolean {
    return this._currentSuggestionTitle().length > 0;
  }

  private _currentSuggestionKey(): string {
    return `${this._currentSlugOwnerId() ?? ""}::${this._currentSuggestionTitle()}`;
  }

  private _scheduleSuggestedSlugRefresh(immediate = false) {
    // Only worth fetching while the slug UI is on screen — which is the post's
    // own panel now, not the publish panel.
    if (this._postMetaIndex !== 0 || this._hasManualSlug()) return;
    if (!this._canSuggestSlug()) {
      this._slugSuggestRequestId += 1;
      this._suggestedSlug = "";
      this._suggestedSlugLoading = false;
      this._slugSuggestionKey = "";
      return;
    }

    const key = this._currentSuggestionKey();
    if (this._slugSuggestionKey !== key) {
      this._suggestedSlug = "";
    }
    if (
      !immediate &&
      !this._suggestedSlugLoading &&
      this._suggestedSlug &&
      this._slugSuggestionKey === key
    ) {
      return;
    }

    if (this._slugSuggestTimer !== null) {
      clearTimeout(this._slugSuggestTimer);
      this._slugSuggestTimer = null;
    }

    const run = () => void this._refreshSuggestedSlug(key);
    if (immediate) {
      run();
      return;
    }
    this._slugSuggestTimer = setTimeout(run, 250);
  }

  private async _refreshSuggestedSlug(key: string) {
    this._slugSuggestTimer = null;
    if (this._hasManualSlug() || !this._canSuggestSlug()) return;

    const requestId = ++this._slugSuggestRequestId;
    this._suggestedSlugLoading = true;

    const params = new URLSearchParams({ mode: "suggest" });
    const title = this._currentSuggestionTitle();
    if (title) params.set("title", title);
    const postId = this._currentSlugOwnerId();
    if (postId) params.set("postId", postId);

    try {
      const res = await fetch(`/api/posts/slug?${params.toString()}`);
      if (!res.ok) return;
      const json = (await res.json()) as { slug?: string };
      if (
        requestId !== this._slugSuggestRequestId ||
        this._hasManualSlug() ||
        this._postMetaIndex !== 0
      ) {
        return;
      }
      this._suggestedSlug = json.slug?.trim() ?? "";
      this._slugSuggestionKey = key;
    } catch {
      // Suggestion is a convenience only — publish still works without it.
    } finally {
      if (requestId === this._slugSuggestRequestId) {
        this._suggestedSlugLoading = false;
      }
    }
  }

  private _scheduleSlugAvailabilityCheck(index = 0) {
    if (!this._hasPostManualSlug(index)) {
      this._setPostSlugTaken(index, false);
      this._slugCheckLoading = false;
      return;
    }

    if (this._slugCheckTimer !== null) {
      clearTimeout(this._slugCheckTimer);
      this._slugCheckTimer = null;
    }

    if (this._getPostSlugSyncValidationMessage(index)) {
      this._setPostSlugTaken(index, false);
      this._slugCheckLoading = false;
      return;
    }

    this._slugCheckLoading = true;
    const slug = this._getPostSlug(index).trim();
    this._slugCheckTimer = setTimeout(() => {
      void this._checkSlugAvailability(slug, index);
    }, 250);
  }

  private async _checkSlugAvailability(slug: string, index = 0) {
    this._slugCheckTimer = null;
    const requestId = ++this._slugCheckRequestId;

    const params = new URLSearchParams({
      mode: "check",
      slug,
    });
    const postId = this._currentSlugOwnerId();
    if (postId) params.set("postId", postId);

    try {
      const res = await fetch(`/api/posts/slug?${params.toString()}`);
      if (!res.ok) return;
      const json = (await res.json()) as { available?: boolean };
      if (
        requestId !== this._slugCheckRequestId ||
        this._getPostSlug(index).trim() !== slug
      ) {
        return;
      }
      this._setPostSlugTaken(index, json.available === false);
    } catch {
      // Server-side create/update remains the final authority.
    } finally {
      if (requestId === this._slugCheckRequestId) {
        this._slugCheckLoading = false;
      }
    }
  }

  private _useSuggestedSlug() {
    if (!this._suggestedSlug) return;
    this._slug = this._suggestedSlug;
    this._slugTaken = false;
    this._slugCheckLoading = false;
    this.updateComplete.then(() => {
      this.querySelector<HTMLInputElement>(
        ".compose-publish-slug-input",
      )?.focus();
    });
  }

  private _resetCustomSlug(index = 0) {
    this._setPostSlug(index, "");
    this._setPostSlugTaken(index, false);
    this._slugCheckLoading = false;
    this._scheduleSuggestedSlugRefresh(true);
    this.updateComplete.then(() => {
      this.querySelector<HTMLInputElement>(
        ".compose-publish-slug-input",
      )?.focus();
    });
  }

  connectedCallback() {
    super.connectedCallback();
    this._syncPublishPanelPresentation();
    this.addEventListener("keydown", this._handleKeydown);
    this.addEventListener("jant:alt-panel-open", this._handleAltPanelOpen);
    this.addEventListener("jant:alt-panel-close", this._handleAltPanelClose);
    this.addEventListener(
      "jant:attached-panel-open",
      this._handleAttachedPanelOpen,
    );
    this.addEventListener(
      "jant:compose-content-changed",
      this._onContentChanged,
    );
    this.addEventListener(
      "jant:title-toggle",
      this._handleTitleToggle as EventListener,
    );
    this.addEventListener("jant:file-picker-open", this._handleFilePickerOpen);
    this.addEventListener(
      "jant:file-picker-close",
      this._handleFilePickerClose as EventListener,
    );
    this.addEventListener(
      "jant:fullscreen-open",
      this._handleFullscreenOpen as EventListener,
    );
    this.addEventListener("pointerdown", this._handlePointerDown);
    // Listen on document — fullscreen element lives on document.body, outside the dialog
    document.addEventListener(
      "jant:fullscreen-close",
      this._handleFullscreenClose as EventListener,
    );

    // Flush pending draft save before page unload (covers refresh/close mid-debounce)
    window.addEventListener("beforeunload", this._onBeforeUnload);
    window.addEventListener("resize", this._handleViewportChange);
    window.addEventListener("scroll", this._handleViewportChange, {
      passive: true,
    });
    document.addEventListener("scroll", this._handleAnyScroll, {
      capture: true,
      passive: true,
    });
    globalThis.visualViewport?.addEventListener(
      "resize",
      this._handleViewportChange,
    );
    globalThis.visualViewport?.addEventListener(
      "scroll",
      this._handleViewportChange,
    );

    // Intercept native dialog cancel (ESC) to route through requestClose
    this._dialogEl = this.closest("dialog");
    if (this._dialogEl) {
      this._dialogEl.addEventListener("cancel", this._handleDialogCancel);
      this._dialogEl.addEventListener("mousedown", this._handleDialogMousedown);
      this._dialogEl.addEventListener("click", this._handleDialogClick);
    }

    if (this.pageMode) {
      this.updateComplete.then(() => this._focusPageEditorOnMount());
    }
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.removeEventListener("keydown", this._handleKeydown);
    this.removeEventListener("jant:alt-panel-open", this._handleAltPanelOpen);
    this.removeEventListener("jant:alt-panel-close", this._handleAltPanelClose);
    this.removeEventListener(
      "jant:attached-panel-open",
      this._handleAttachedPanelOpen,
    );
    this.removeEventListener(
      "jant:compose-content-changed",
      this._onContentChanged,
    );
    this.removeEventListener(
      "jant:title-toggle",
      this._handleTitleToggle as EventListener,
    );
    this.removeEventListener(
      "jant:file-picker-open",
      this._handleFilePickerOpen,
    );
    this.removeEventListener(
      "jant:file-picker-close",
      this._handleFilePickerClose as EventListener,
    );
    this.removeEventListener(
      "jant:fullscreen-open",
      this._handleFullscreenOpen as EventListener,
    );
    this.removeEventListener("pointerdown", this._handlePointerDown);
    document.removeEventListener(
      "jant:fullscreen-close",
      this._handleFullscreenClose as EventListener,
    );
    window.removeEventListener("beforeunload", this._onBeforeUnload);
    window.removeEventListener("resize", this._handleViewportChange);
    window.removeEventListener("scroll", this._handleViewportChange);
    document.removeEventListener("scroll", this._handleAnyScroll, {
      capture: true,
    });
    globalThis.visualViewport?.removeEventListener(
      "resize",
      this._handleViewportChange,
    );
    globalThis.visualViewport?.removeEventListener(
      "scroll",
      this._handleViewportChange,
    );
    this._cancelSlugTimers();
    this._destroyAttachedEditor();
    this._cancelDraftSaveTimer();

    if (this._dialogEl) {
      this._dialogEl.removeEventListener("cancel", this._handleDialogCancel);
      this._dialogEl.removeEventListener(
        "mousedown",
        this._handleDialogMousedown,
      );
      this._dialogEl.removeEventListener("click", this._handleDialogClick);
      this._dialogEl = null;
    }
  }

  private _handleFilePickerOpen = () => {
    this._filePickerActive = true;
    this._ignoreNextEscapeClose = false;
  };

  private _handleFilePickerClose = (
    e: CustomEvent<ComposeFilePickerCloseDetail>,
  ) => {
    this._filePickerActive = false;
    this._ignoreNextEscapeClose = Boolean(e.detail?.cancelled);
  };

  private _handlePointerDown = () => {
    this._clearFilePickerEscapeState();
  };

  private _syncPublishPanelPresentation() {
    const nextValue =
      globalThis.matchMedia?.(COMPOSE_PUBLISH_PANEL_FULLSCREEN_QUERY)
        ?.matches ?? false;
    if (nextValue !== this._publishPanelFullscreen) {
      this._publishPanelFullscreen = nextValue;
    }
  }

  private _handleViewportChange = () => {
    this._syncPublishPanelPresentation();
    if (this._showPublishPanel) {
      this.updateComplete.then(() => this._updatePublishPanelLayout());
    }
    if (this._showCollection) {
      this.updateComplete.then(() => this._updateCollectionPopoverSide());
    }
    if (this._postMetaIndex !== null) {
      this.updateComplete.then(() => this._updatePostMetaPanelLayout());
    }
  };

  /**
   * The date/permalink panel is pinned to a pill inside `.compose-scroll`, and
   * a `scroll` event on that box never reaches `window` — it doesn't bubble.
   * Capture phase catches it wherever it fires, so the panel travels with its
   * pill instead of hanging in place once the composer moves under it.
   */
  private _handleAnyScroll = () => {
    if (this._postMetaIndex === null) return;
    this._updatePostMetaPanelLayout();
  };

  private _handleDialogCancel = (e: Event) => {
    e.preventDefault();
    // Defensive: some browsers dispatch <dialog> `cancel` for Escape even
    // when the IME consumed it. Mirror the guard from _handleKeydown.
    const ke = e as Partial<globalThis.KeyboardEvent>;
    if (ke.isComposing || ke.keyCode === 229) return;
    if (this._shouldIgnoreEscapeClose()) return;
    if (this._dismissEscapeOverlay()) return;
    this.requestClose();
  };

  // Returns true if the given point is inside any open top-layer popover.
  // Browsers sometimes fire backdrop click events even when the pointer is
  // over a popover that is rendered above the dialog in the top layer —
  // document.elementFromPoint() ignores the top layer, so we check bounding
  // rects manually.
  private _pointInOpenPopover(x: number, y: number): boolean {
    for (const el of document.querySelectorAll<HTMLElement>(":popover-open")) {
      const r = el.getBoundingClientRect();
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
        return true;
      }
    }
    return false;
  }

  private _handleDialogMousedown = (e: Event) => {
    // Track whether the mousedown originated on the backdrop (the <dialog>
    // itself). When the user drag-selects text inside the editor and the
    // pointer overshoots to the backdrop, the subsequent click event fires
    // with target === dialog. Without this guard, that click triggers
    // requestClose() and the unsaved-changes confirmation pops up.
    const me = e as MouseEvent;
    // Treat as backdrop only when target is the dialog AND the cursor is not
    // over an open popover (e.g. a toast notification in the top layer).
    this._mousedownOnBackdrop =
      e.target === this._dialogEl &&
      !this._pointInOpenPopover(me.clientX, me.clientY);
    this._mousedownPos = this._mousedownOnBackdrop
      ? { x: me.clientX, y: me.clientY }
      : null;
  };

  private _handleDialogClick = (e: Event) => {
    if (!this._dialogEl || e.target !== this._dialogEl) return;
    // Only treat as backdrop click when mousedown also started on the backdrop
    if (!this._mousedownOnBackdrop) return;

    const mouseEvent = e as MouseEvent;

    // If the pointer moved more than 4px since mousedown, the user was
    // dragging (e.g. selecting text in a toast on top of the backdrop) —
    // don't treat that as an intentional dismiss click.
    if (this._mousedownPos) {
      const dx = mouseEvent.clientX - this._mousedownPos.x;
      const dy = mouseEvent.clientY - this._mousedownPos.y;
      if (dx * dx + dy * dy > 16) return;
    }

    // Also guard against text-selection drags that end back on the backdrop.
    const selection = document.getSelection();
    if (selection && !selection.isCollapsed) return;

    // Guard against click pass-through from a top-layer popover: browsers can
    // route a click on a popover to the dialog backdrop simultaneously.
    if (this._pointInOpenPopover(mouseEvent.clientX, mouseEvent.clientY)) {
      return;
    }

    const hitTarget = document.elementFromPoint(
      mouseEvent.clientX,
      mouseEvent.clientY,
    );
    if (
      hitTarget instanceof globalThis.Element &&
      hitTarget.closest(EDITOR_FLOATING_UI_SELECTOR)
    ) {
      return;
    }

    this.requestClose();
  };

  private _focusDialogShell() {
    const shell = this.querySelector<HTMLElement>(".compose-dialog-inner");
    if (shell) {
      shell.focus();
      return;
    }
    this._dialogEl?.focus();
  }

  private _restorePageEditorFocus() {
    this.updateComplete.then(() => this._editor?.focusInput());
  }

  private _dismissEscapeOverlay(): boolean {
    if (this._confirmPanelOpen) {
      this.requestClose();
      return true;
    }

    if (this._addCollectionPanelOpen) {
      this._closeAddCollectionPanel();
      return true;
    }

    if (this._editor?.isEmojiPickerOpen()) {
      this._editor.closeEmojiPicker({ restoreFocus: true });
      return true;
    }

    if (this._showLanguagePicker) {
      this._closeLanguagePicker(true);
      return true;
    }

    if (this._showCollection) {
      this._closeCollectionPicker({ restoreFocus: "editor" });
      return true;
    }

    if (this._showPublishPanel) {
      this._closePublishPanel(true);
      return true;
    }

    if (this._postMetaIndex !== null) {
      // `_closePostMeta` hands focus back to the post itself.
      this._closePostMeta();
      return true;
    }

    if (this._altPanelOpen) {
      this._closeAltPanel();
      this._restorePageEditorFocus();
      return true;
    }

    if (this._draftMenuOpenId) {
      this._draftMenuOpenId = null;
      return true;
    }

    if (this._draftsPanelOpen) {
      this._closeDraftsPanel();
      return true;
    }

    if (this._attachedPanelOpen) {
      this._cancelAttachedPanel();
      return true;
    }

    return false;
  }

  private _handleKeydown = (e: Event) => {
    const ke = e as globalThis.KeyboardEvent;
    // Let IME consume keys during composition (e.g. CJK candidate selection).
    // Without this, pressing Escape to dismiss the IME popup would trigger the
    // "Save to drafts?" prompt. See GitHub issue #120.
    if (ke.isComposing || ke.keyCode === 229) return;
    if (ke.key !== "Escape") {
      this._clearFilePickerEscapeState();
    }
    if (ke.key === "Escape") {
      ke.preventDefault();
      ke.stopPropagation();
      if (this._shouldIgnoreEscapeClose()) return;
      if (this._dismissEscapeOverlay()) return;
      this.requestClose();
    } else if (ke.key === "Enter" && this._confirmPanelOpen) {
      ke.preventDefault();
      this._handleConfirmSave();
    } else if ((ke.metaKey || ke.ctrlKey) && ke.key === "Enter") {
      e.preventDefault();
      this._publishFromShortcut();
    } else if (
      (ke.metaKey || ke.ctrlKey) &&
      !ke.altKey &&
      !ke.shiftKey &&
      ke.key >= "1" &&
      ke.key <= String(JantComposeDialog._FORMATS.length)
    ) {
      ke.preventDefault();
      const target = JantComposeDialog._FORMATS[Number(ke.key) - 1];
      if (this._threadItems.length > 0) {
        const editor = this.querySelectorAll<JantComposeEditor>(
          "jant-compose-editor",
        )[this._focusedThreadIndex];
        editor?.dispatchEvent(
          new CustomEvent("jant:format-change", {
            detail: { format: target },
            bubbles: true,
          }),
        );
      } else {
        this._switchFormat(target);
      }
    }
  };

  private _publishFromShortcut() {
    if (this._attachedPanelOpen) {
      this._doneAttachedPanel();
      return;
    }
    if (!this._canPublish()) {
      this._focusBlockedSubmitField("published");
      return;
    }
    void this._submit("published");
  }

  private _handleAltPanelOpen = (e: Event) => {
    const detail = (e as CustomEvent<{ index: number }>).detail;
    this._altPanelIndex = detail.index;
    this._altPanelOpen = true;
    this.updateComplete.then(() => {
      this.querySelector<HTMLInputElement>(".compose-alt-input")?.focus();
    });
  };

  private _handleAltPanelClose = () => {
    this._altPanelOpen = false;
  };

  private _getAltAttachment(): ComposeAttachment | null {
    return this._editor?._attachments[this._altPanelIndex] ?? null;
  }

  private _onAltInput(e: Event) {
    const value = (e.target as HTMLInputElement).value;
    this._editor?.updateAlt(this._altPanelIndex, value);
  }

  private _closeAltPanel() {
    this._altPanelOpen = false;
  }

  private _handleFullscreenClose = (
    e: CustomEvent<ComposeFullscreenCloseDetail>,
  ) => {
    const editors = Array.from(
      this.querySelectorAll<JantComposeEditor>("jant-compose-editor"),
    );
    const editor = editors[e.detail.editorIndex ?? 0] ?? this._editor;
    if (editor) {
      editor.setEditorState(
        e.detail.json as import("@tiptap/core").JSONContent,
        e.detail.title,
        e.detail.showTitle,
        e.detail.selection,
      );
      // Adopt any in-flight inline image uploads from the fullscreen editor
      // so blob: placeholder URLs get replaced when uploads complete.
      editor.adoptPendingUploads();
      if (e.detail.intent !== "publish") {
        this.updateComplete.then(() =>
          editor.focusSelection(e.detail.selection),
        );
      }
    }
    this._replyExpanded = e.detail.replyExpanded;
    if (e.detail.intent === "publish") {
      this._publishFromShortcut();
    }
  };

  private _buildFullscreenReplyContext(): ComposeFullscreenReplyContext | null {
    if (!this._replyToId || !this._replyToData) return null;

    return {
      contentHtml: this._replyToData.contentHtml,
      dateText: this._replyToData.dateText,
      expanded: this._replyExpanded,
    };
  }

  private _handleFullscreenOpen = (
    e: CustomEvent<ComposeFullscreenOpenDetail>,
  ) => {
    e.detail.replyContext = this._buildFullscreenReplyContext();
    const editors = Array.from(
      this.querySelectorAll<JantComposeEditor>("jant-compose-editor"),
    );
    const editorIndex = editors.indexOf(e.target as JantComposeEditor);
    e.detail.editorIndex = editorIndex >= 0 ? editorIndex : 0;
  };

  private _handleAttachedPanelOpen = (e: Event) => {
    const detail = (e as CustomEvent<{ index: number }>).detail;
    this._attachedTextIndex = detail.index;
    this._attachedPanelOpen = true;
    this.updateComplete.then(() => {
      const container = this.querySelector<HTMLElement>(
        ".compose-attached-tiptap",
      );
      if (!container) return;
      const item = this._editor?._attachedTexts[this._attachedTextIndex];
      const content = item?.bodyJson ?? null;
      this._attachedTextSnapshot = content
        ? JSON.parse(JSON.stringify(content))
        : null;
      this._attachedEditor = createTiptapEditor({
        element: container,
        placeholder: this.labels.attachedTextPlaceholder,
        content,
        toolbarMode: "compose",
        tableControlLabels: this.labels.tableControls,
      });
      this._focusAttachedEditorBoundary(content);
    });
  };

  private _focusAttachedEditorBoundary(content?: JSONContent | null) {
    if (!this._attachedEditor) return;
    const targetContent = content ?? this._attachedEditor.getJSON();
    const focusTarget: "start" | "end" = normalizeComposeDoc(targetContent)
      ? "end"
      : "start";
    this._attachedEditor.commands.focus(focusTarget);
  }

  private _isAttachedTextDirty(): boolean {
    if (!this._attachedEditor) return false;
    return (
      JSON.stringify(normalizeComposeDoc(this._attachedEditor.getJSON())) !==
      JSON.stringify(normalizeComposeDoc(this._attachedTextSnapshot))
    );
  }

  private _destroyAttachedEditor() {
    if (this._attachedEditor) {
      this._attachedEditor.destroy();
      this._attachedEditor = null;
    }
    this._attachedTextSnapshot = null;
  }

  private _doneAttachedPanel() {
    if (this._attachedEditor) {
      const json = this._attachedEditor.getJSON();
      const html = this._attachedEditor.getHTML();
      this._editor?.updateAttachedText(this._attachedTextIndex, json, html);
    }
    this._confirmForAttachedText = false;
    this._destroyAttachedEditor();
    this._attachedPanelOpen = false;
    this._editor?.closeAttachedPanel(this._attachedTextIndex);
  }

  private _cancelAttachedPanel() {
    if (this._isAttachedTextDirty()) {
      this._confirmForDrafts = false;
      this._confirmForAttachedText = true;
      this._confirmPanelOpen = true;
      return;
    }
    // Revert to snapshot — don't save current editor content
    this._discardAttachedPanel();
  }

  private _handleAttachedEditorMouseDown(event: MouseEvent) {
    if (event.target !== event.currentTarget) return;
    event.preventDefault();
    this._focusAttachedEditorBoundary();
  }

  // ── Drafts panel ─────────────────────────────────────────────────

  private _handleDraftButtonClick() {
    if (this._loading) return;
    if (this._hasWorkToLose()) {
      this._confirmForDrafts = true;
      this._confirmPanelOpen = true;
    } else {
      this._openDraftsPanel();
    }
  }

  private async _openDraftsPanel() {
    this._draftsPanelOpen = true;
    this._draftsLoading = true;
    this._draftsError = null;
    this._draftMenuOpenId = null;

    try {
      const res = await fetch("/api/posts?status=draft&limit=50");
      if (!res.ok) throw new Error("Failed to load drafts");
      const json = (await res.json()) as
        | DraftsResponse
        | Record<string, unknown>[];
      const posts = Array.isArray(json) ? json : (json.posts ?? []);
      const allDraftItems = (posts as Record<string, unknown>[]).map(
        (p): DraftItem => ({
          id: p.id as string,
          slug: p.slug as string,
          format: p.format as ComposeFormat,
          title:
            ((p.format as ComposeFormat) === "quote"
              ? (p.sourceName as string)
              : (p.title as string)) ?? null,
          bodyText: (p.bodyText as string) ?? null,
          bodyHtml: (p.bodyHtml as string) ?? null,
          url:
            ((p.format as ComposeFormat) === "quote"
              ? (p.sourceUrl as string)
              : (p.url as string)) ?? null,
          quoteText: (p.quoteText as string) ?? null,
          replyToId: (p.replyToId as string) ?? null,
          updatedAt: p.updatedAt as number,
          mediaAttachments: (
            (p.attachments as ApiAttachment[] | undefined) ?? []
          )
            .filter((a): a is ApiMediaAttachment => a.type === "media")
            .map((m) => ({
              id: m.id,
              previewUrl: m.previewUrl,
              alt: m.alt ?? null,
              mimeType: m.mimeType,
            })),
        }),
      );
      // Filter out thread reply drafts: posts whose replyToId points to another
      // draft in the same list are inner thread posts — only the root should appear.
      const draftIds = new Set(allDraftItems.map((d) => d.id));
      this._drafts = allDraftItems.filter(
        (d) => !d.replyToId || !draftIds.has(d.replyToId),
      );
    } catch {
      this._draftsError = "Could not load drafts. Try again.";
      this._drafts = [];
    } finally {
      this._draftsLoading = false;
    }
  }

  private _closeDraftsPanel() {
    this._draftsPanelOpen = false;
    this._draftMenuOpenId = null;
    this.updateComplete.then(() => this._editor?.focusInput());
  }

  /**
   * Resolve text attachments for a post's media list and call editor.populate().
   * Shared between single-post and thread draft loading.
   */
  private async _populateEditorFromPost(
    editor: JantComposeEditor,
    post: ComposePostResponse,
  ) {
    const allAttachments = post.attachments ?? [];
    const { media, textAttachments, attachmentOrder } =
      await resolveApiAttachments(allAttachments);

    editor.populate({
      format: post.format,
      title: post.format === "quote" ? undefined : (post.title ?? undefined),
      bodyJson: post.body ?? undefined,
      url:
        post.format === "quote"
          ? (post.sourceUrl ?? undefined)
          : (post.url ?? undefined),
      quoteText: post.quoteText ?? undefined,
      quoteAuthor:
        post.format === "quote" ? (post.sourceName ?? undefined) : undefined,
      rating: post.rating ?? undefined,
      media,
      textAttachments,
      attachmentOrder,
    });
  }

  private async _loadDraft(id: string) {
    this._draftsPanelOpen = false;
    this._draftMenuOpenId = null;
    this.reset();

    const res = await fetch(`/api/posts/${id}`);
    if (!res.ok) return;
    const post = (await res.json()) as ComposePostResponse;

    this._draftSourceId = id;
    this._format = post.format;
    this._slug = post.slug ?? "";
    this._slugTaken = false;
    this._slugCheckLoading = false;
    this._suggestedSlug = "";
    this._suggestedSlugLoading = false;
    this._slugSuggestionKey = "";
    this._publishedAtInput = post.publishedAt
      ? toLocalDateInputValue(post.publishedAt)
      : "";
    this._publishedAtTimeMinutes = post.publishedAt
      ? getTimestampTimeMinutes(post.publishedAt)
      : null;
    this._originalPublishedAt = post.publishedAt ?? null;
    this._initialPublishedAtTimeMinutes = this._publishedAtTimeMinutes;
    this._initialPublishedAtInput = this._publishedAtInput;
    this._initialSlug = this._slug.trim();
    this._visibility = post.visibility ?? "public";
    this._visibilityLocked = Boolean(post.replyToId);

    if (!post.replyToId && post.collectionIds?.length) {
      this._collectionIds = post.collectionIds;
    }

    // Restore reply context if this draft was a reply to a published post
    if (post.replyToId) {
      this._replyToId = post.replyToId;
      await this._fetchReplyContext(post.replyToId);
    }

    // ── Thread draft: check if this root has other draft posts in its thread ──
    const isThreadRoot =
      post.threadId === post.id || post.threadId === undefined;
    if (isThreadRoot) {
      // Fetch all drafts to find other posts in this thread
      try {
        const draftsRes = await fetch("/api/posts?status=draft&limit=50");
        if (draftsRes.ok) {
          const draftsJson = (await draftsRes.json()) as
            | { posts?: Record<string, unknown>[] }
            | Record<string, unknown>[];
          const allDrafts = Array.isArray(draftsJson)
            ? draftsJson
            : (draftsJson.posts ?? []);
          // Collect other posts in the same thread, sorted by their implied order
          // (they have replyToId chains starting from the root)
          const threadDrafts = (allDrafts as Record<string, unknown>[])
            .filter(
              (p) =>
                p.id !== post.id &&
                p.threadId === post.id &&
                p.status === "draft",
            )
            .map((p) => ({
              id: p.id as string,
              format: p.format as ComposeFormat,
              replyToId: (p.replyToId as string) ?? null,
              title: (p.title as string) ?? null,
              body: (p.body as string) ?? null,
              url: (p.url as string) ?? null,
              sourceUrl: (p.sourceUrl as string) ?? null,
              sourceName: (p.sourceName as string) ?? null,
              quoteText: (p.quoteText as string) ?? null,
              rating: (p.rating as number) ?? null,
              attachments: (p.attachments as ApiAttachment[] | undefined) ?? [],
              visibility: (p.visibility as ComposeVisibility) ?? null,
            }));

          if (threadDrafts.length > 0) {
            // Sort by reply chain: walk replyToId to get ordered list
            const ordered: typeof threadDrafts = [];
            let prevId: string = post.id;
            for (let i = 0; i < threadDrafts.length; i++) {
              const next = threadDrafts.find((p) => p.replyToId === prevId);
              if (!next) break;
              ordered.push(next);
              prevId = next.id;
            }
            // Any remaining posts not in chain (shouldn't happen, but be safe)
            for (const p of threadDrafts) {
              if (!ordered.includes(p)) ordered.push(p);
            }

            // Enter thread mode
            this._threadItems = [
              { id: randomUUID(), format: post.format },
              ...ordered.map((p) => ({
                id: randomUUID(),
                format: p.format,
              })),
            ];
            this._focusedThreadIndex = 0;

            await this.updateComplete;

            const editors = Array.from(
              this.querySelectorAll<JantComposeEditor>("jant-compose-editor"),
            );

            // Populate root editor
            const rootEditor = editors[0];
            if (rootEditor) {
              await this._populateEditorFromPost(rootEditor, post);
            }

            // Populate reply editors
            for (let i = 0; i < ordered.length; i++) {
              const replyEditor = editors[i + 1];
              if (!replyEditor) continue;
              const p = ordered[i];
              await this._populateEditorFromPost(replyEditor, {
                id: p.id,
                threadId: post.id,
                format: p.format,
                replyToId: p.replyToId,
                title: p.title,
                body: p.body,
                url: p.url,
                sourceUrl: p.sourceUrl,
                sourceName: p.sourceName,
                quoteText: p.quoteText,
                rating: p.rating,
                attachments: p.attachments,
                visibility: p.visibility,
              });
            }

            globalThis.requestAnimationFrame(() => {
              editors[0]?.focusInput();
              this._captureInitialSnapshot();
            });
            return;
          }
        }
      } catch {
        // Fall through to single-post load if thread fetch fails
      }
    }

    // ── Single-post draft ─────────────────────────────────────────────
    await this.updateComplete;

    const editor = this._editor;
    if (editor) {
      await this._populateEditorFromPost(editor, post);
    }

    globalThis.requestAnimationFrame(() => {
      this._editor?.focusInput();
      this._captureInitialSnapshot();
    });
  }

  private async _deleteDraft(id: string) {
    this._draftMenuOpenId = null;
    this._drafts = this._drafts.filter((d) => d.id !== id);

    try {
      const res = await fetch(`/api/posts/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      showToast(this.labels.draftDeleted);
    } catch {
      showToast("Failed to delete draft. Try again.", "error");
      this._openDraftsPanel();
    }
  }

  private _formatDraftDate(timestamp: number): string {
    const now = Date.now() / 1000;
    const diff = now - timestamp;
    if (diff < 60) return "now";
    if (diff < 3600) return `${Math.floor(diff / 60)}m`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
    if (diff < 604800) return `${Math.floor(diff / 86400)}d`;
    const d = new Date(timestamp * 1000);
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }

  private _getDraftPreview(draft: DraftItem): string | null {
    if (draft.format === "quote") {
      if (draft.quoteText) return draft.quoteText;
      if (draft.title) return draft.title;
      if (draft.bodyText) return draft.bodyText;
      if (draft.url) return draft.url;
      return null;
    }

    if (draft.title) return draft.title;
    if (draft.bodyText) return draft.bodyText;
    if (draft.url) return draft.url;
    return null;
  }

  private _getThreadLimitMessage(): string {
    return (
      this.labels.threadLimitReached ||
      `Threads can include up to ${MAX_THREAD_POSTS} posts.`
    );
  }

  // ── Local draft auto-save (globalThis.localStorage) ──────────────────────────

  private static _DRAFT_KEY = "jant:compose-draft";
  private static _EDIT_DRAFT_KEY_PREFIX = "jant:compose-edit:";
  private static _DRAFT_MAX_AGE = 7 * 24 * 60 * 60 * 1000; // 7 days

  private _currentDraftStorageKey(): string {
    if (this._editPostId) {
      return JantComposeDialog._EDIT_DRAFT_KEY_PREFIX + this._editPostId;
    }
    return JantComposeDialog._DRAFT_KEY;
  }

  private _onContentChanged = () => {
    this.requestUpdate();
    if (!this._hasManualSlug()) {
      this._scheduleSuggestedSlugRefresh();
    }
    // Schedule localStorage auto-save (new-post and edit modes, not draft-load)
    if (!this._draftSourceId) {
      this._scheduleDraftSave();
    }
  };

  /**
   * Remember the note title toggle for the next new note. Same guard as
   * `_setVisibility`: an edit, a loaded draft, or a reply answers for that one
   * post, not for how this author writes. Thread rows are excluded too — the
   * toggle there answers for a position in a thread.
   */
  private _handleTitleToggle = (e: CustomEvent<{ showTitle: boolean }>) => {
    if (this._editPostId || this._draftSourceId || this._replyToId) return;
    if ((e.target as JantComposeEditor | null)?.threadItem) return;
    JantComposeDialog._setNoteTitleDefault(e.detail.showTitle);
  };

  private _cancelDraftSaveTimer() {
    if (this._draftSaveTimer !== null) {
      clearTimeout(this._draftSaveTimer);
      this._draftSaveTimer = null;
    }
  }

  private _scheduleDraftSave() {
    this._cancelDraftSaveTimer();
    this._draftSaveTimer = setTimeout(() => this._saveDraftToStorage(), 1000);
  }

  /** Flush pending draft save and warn on unsaved changes before page unload */
  private _onBeforeUnload = (e: globalThis.BeforeUnloadEvent) => {
    if (this._suppressBeforeUnload) return;

    // Flush any pending debounced draft save
    if (this._draftSaveTimer !== null) {
      this._cancelDraftSaveTimer();
      this._saveDraftToStorage();
    }
    // Warn if compose has unsaved modifications in either dialog or page mode.
    const dialog = this.closest("dialog");
    const shouldWarn =
      this._hasUnsavedChanges() && (this.pageMode || dialog?.open === true);
    if (shouldWarn) {
      e.preventDefault();
      e.returnValue = "";
    }
  };

  private _saveDraftToStorage() {
    // ── Thread mode ────────────────────────────────────────────────────
    if (this._threadItems.length > 0) {
      const editors = Array.from(
        this.querySelectorAll<JantComposeEditor>("jant-compose-editor"),
      );
      const hasContent = editors.some((editor) => {
        const data = editor.getData();
        return (
          !!data.body ||
          !!data.title.trim() ||
          !!data.url.trim() ||
          !!data.quoteText.trim() ||
          data.rating > 0 ||
          data.attachedTexts.length > 0 ||
          data.attachments.length > 0
        );
      });

      if (!hasContent) {
        globalThis.localStorage.removeItem(this._currentDraftStorageKey());
        return;
      }

      const threadItems = this._threadItems
        .map((item, i) => {
          const editor = editors[i];
          if (!editor) return null;
          const data = editor.getData();
          return {
            format: item.format,
            publishedAtInput: item.publishedAtInput,
            publishedAtTimeMinutes: item.publishedAtTimeMinutes,
            slug: item.slug,
            title: data.title,
            bodyJson: editor.getNormalizedBodyJson(),
            url: data.url,
            quoteText: data.quoteText,
            quoteAuthor: data.quoteAuthor,
            attachedTexts: data.attachedTexts.map((t) => ({
              clientId: t.clientId,
              bodyJson: t.bodyJson,
              bodyHtml: t.bodyHtml,
              summary: t.summary,
            })),
            attachmentOrder: [...data.attachmentOrder],
            mediaAttachments: JantComposeDialog._mediaSnapshotFromAttachments(
              data.attachments,
            ),
          };
        })
        .filter((item): item is NonNullable<typeof item> => item !== null);

      const draft: LocalDraft = {
        format: this._threadItems[0]?.format ?? this._format,
        title: "",
        bodyJson: null,
        url: "",
        quoteText: "",
        quoteAuthor: "",
        slug: this._slug,
        publishedAtInput: this._publishedAtInput,
        publishedAtTimeMinutes: this._publishedAtTimeMinutes,
        visibility: this._visibility,
        rating: 0,
        showTitle: false,
        showRating: false,
        collectionIds: [...this._collectionIds],
        replyToId: this._replyToId,
        language: this._language,
        translationOfId: this._translationOf?.id ?? null,
        attachedTexts: [],
        attachmentOrder: [],
        threadItems,
        savedAt: Date.now(),
      };

      try {
        globalThis.localStorage.setItem(
          this._currentDraftStorageKey(),
          JSON.stringify(draft),
        );
      } catch {
        // Storage full or unavailable — silently ignore
      }
      return;
    }

    // ── Single-post mode ───────────────────────────────────────────────
    const editor = this._editor;
    if (!editor) return;

    // Only persist genuine unsaved changes. Without this, merely opening a post
    // for edit (or restoring a draft) would write a local draft of the
    // unchanged content, since loading fires content-change events.
    if (!this._hasUnsavedChanges()) {
      globalThis.localStorage.removeItem(this._currentDraftStorageKey());
      return;
    }

    const data = editor.getData();
    const hasContent =
      !!data.body ||
      !!data.title.trim() ||
      !!data.url.trim() ||
      !!data.quoteText.trim() ||
      !!data.quoteAuthor.trim() ||
      data.rating > 0 ||
      data.attachments.length > 0 ||
      data.attachedTexts.length > 0;

    if (!hasContent) {
      globalThis.localStorage.removeItem(this._currentDraftStorageKey());
      return;
    }

    const draft: LocalDraft = {
      format: this._format,
      title: data.title,
      bodyJson: editor.getNormalizedBodyJson(),
      url: data.url,
      quoteText: data.quoteText,
      quoteAuthor: data.quoteAuthor,
      slug: this._slug,
      publishedAtInput: this._publishedAtInput,
      publishedAtTimeMinutes: this._publishedAtTimeMinutes,
      visibility: this._visibility,
      rating: data.rating,
      // The toggle as it stands, not "does a title exist" — restoring a draft
      // should put the editor back the way it was left, including an open but
      // still-empty title field.
      showTitle: this._format === "note" ? editor._showTitle : false,
      showRating: data.rating > 0 ? editor._showRating : false,
      collectionIds: [...this._collectionIds],
      replyToId: this._replyToId,
      language: this._language,
      translationOfId: this._translationOf?.id ?? null,
      attachedTexts: data.attachedTexts.map((t) => ({
        clientId: t.clientId,
        bodyJson: t.bodyJson,
        bodyHtml: t.bodyHtml,
        summary: t.summary,
      })),
      attachmentOrder: [...data.attachmentOrder],
      mediaAttachments: JantComposeDialog._mediaSnapshotFromAttachments(
        data.attachments,
      ),
      savedAt: Date.now(),
    };

    try {
      globalThis.localStorage.setItem(
        this._currentDraftStorageKey(),
        JSON.stringify(draft),
      );
    } catch {
      // Storage full or unavailable — silently ignore
    }
  }

  private _clearDraftFromStorage() {
    this._cancelDraftSaveTimer();
    globalThis.localStorage.removeItem(this._currentDraftStorageKey());
  }

  clearLocalDraftFromStorage() {
    this._clearDraftFromStorage();
  }

  clearEditDraftFromStorage(postId: string) {
    globalThis.localStorage.removeItem(
      JantComposeDialog._EDIT_DRAFT_KEY_PREFIX + postId,
    );
  }

  /**
   * Snapshot attachments whose upload completed. Only these can be restored
   * later — for the rest the bytes exist nowhere but in-memory.
   */
  private static _mediaSnapshotFromAttachments(
    attachments: ComposeAttachment[],
  ): LocalDraftMedia[] {
    return attachments.flatMap((a) =>
      a.status === "done" && a.mediaId && a.remoteUrl
        ? [
            {
              clientId: a.clientId,
              mediaId: a.mediaId,
              url: a.remoteUrl,
              mimeType: a.file.type,
              name: a.file.name || undefined,
              alt: a.alt || undefined,
              summary: a.summary,
              chars: a.chars,
            },
          ]
        : [],
    );
  }

  /** Convert stored media snapshots into `populate()` media entries. */
  private static _restoredMediaToPopulate(media: LocalDraftMedia[]) {
    return media.map((m) => ({
      id: m.mediaId,
      clientId: m.clientId,
      previewUrl: m.url,
      mimeType: m.mimeType,
      originalName: m.name,
      alt: m.alt,
      summary: m.summary ?? undefined,
      chars: m.chars ?? undefined,
    }));
  }

  /**
   * Merge a draft's media snapshot with bridge-supplied completed uploads.
   * Bridge entries win: they include uploads that finished after the dialog
   * closed, which the autosaved snapshot predates.
   */
  private static _mergeRestoredMedia(
    snapshot: LocalDraftMedia[] | undefined,
    extra: LocalDraftMedia[] | undefined,
  ): Map<string, LocalDraftMedia> {
    const merged = new Map<string, LocalDraftMedia>();
    for (const m of snapshot ?? []) merged.set(m.clientId, m);
    for (const m of extra ?? []) merged.set(m.clientId, m);
    return merged;
  }

  async restoreLocalDraft(options?: {
    expectedReplyToId?: string;
    /** false suppresses the "Draft restored." toast */
    notify?: boolean;
    /** Completed uploads known to the bridge at failure time */
    extraMedia?: LocalDraftMedia[];
  }) {
    // Don't restore if already in edit or draft-load mode
    if (this._editPostId || this._draftSourceId) return;
    // Don't restore if the editor already has content (e.g. reopened dialog)
    if (this._hasContent()) return;

    let raw: string | null;
    try {
      raw = globalThis.localStorage.getItem(JantComposeDialog._DRAFT_KEY);
    } catch {
      return;
    }
    if (!raw) return;

    let draft: LocalDraft;
    try {
      draft = JSON.parse(raw) as LocalDraft;
    } catch {
      globalThis.localStorage.removeItem(JantComposeDialog._DRAFT_KEY);
      return;
    }

    // Discard stale drafts
    if (Date.now() - draft.savedAt > JantComposeDialog._DRAFT_MAX_AGE) {
      globalThis.localStorage.removeItem(JantComposeDialog._DRAFT_KEY);
      return;
    }

    if (
      options?.expectedReplyToId !== undefined &&
      draft.replyToId !== options.expectedReplyToId
    ) {
      return;
    }

    this._collectionIds = draft.replyToId
      ? []
      : [...(draft.collectionIds ?? [])];
    this._slug = draft.slug ?? "";
    this._slugTaken = false;
    this._slugCheckLoading = false;
    this._suggestedSlug = "";
    this._suggestedSlugLoading = false;
    this._slugSuggestionKey = "";
    this._publishedAtInput = draft.publishedAtInput ?? "";
    this._publishedAtTimeMinutes = draft.publishedAtTimeMinutes ?? null;
    this._visibility = draft.visibility ?? "public";
    this._language = draft.language ?? null;
    if (draft.translationOfId) {
      await this._loadTranslationSource(draft.translationOfId);
    }

    // Restore reply context if this draft was a reply
    if (draft.replyToId) {
      this._replyToId = draft.replyToId;
      this._visibilityLocked = true;
      await this._fetchReplyContext(draft.replyToId);
    }

    // ── Thread draft restore ─────────────────────────────────────────
    if (draft.threadItems && draft.threadItems.length >= 2) {
      this._format = draft.threadItems[0].format;
      this._threadItems = draft.threadItems.map((item) => ({
        id: randomUUID(),
        format: item.format,
        publishedAtInput: item.publishedAtInput,
        publishedAtTimeMinutes: item.publishedAtTimeMinutes,
        slug: item.slug,
      }));
      this._focusedThreadIndex = 0;

      await this.updateComplete;

      const editors = Array.from(
        this.querySelectorAll<JantComposeEditor>("jant-compose-editor"),
      );
      for (let i = 0; i < draft.threadItems.length; i++) {
        const item = draft.threadItems[i];
        const editor = editors[i];
        if (!editor) continue;

        const textAttachments = item.attachedTexts?.flatMap((t) => {
          const bodyJson = normalizeComposeDoc(t.bodyJson);
          if (!bodyJson) return [];
          return [
            {
              clientId: t.clientId,
              bodyJson: JSON.stringify(bodyJson),
              bodyHtml: t.bodyHtml,
              summary: t.summary,
            },
          ];
        });

        // Bridge entries are a flat list — this item owns the clientIds in
        // its own attachmentOrder.
        const itemExtraMedia = options?.extraMedia?.filter((m) =>
          item.attachmentOrder?.includes(m.clientId),
        );
        const media = [
          ...JantComposeDialog._mergeRestoredMedia(
            item.mediaAttachments,
            itemExtraMedia,
          ).values(),
        ];

        editor.populate({
          format: item.format,
          title: item.title || undefined,
          bodyJson: item.bodyJson ? JSON.stringify(item.bodyJson) : undefined,
          url: item.url || undefined,
          quoteText: item.quoteText || undefined,
          quoteAuthor: item.quoteAuthor || undefined,
          media: media.length
            ? JantComposeDialog._restoredMediaToPopulate(media)
            : undefined,
          textAttachments: textAttachments?.length
            ? textAttachments
            : undefined,
          attachmentOrder: item.attachmentOrder,
        });
      }

      this._draftRestored = true;
      if (options?.notify !== false) showToast(this.labels.draftRestored);
      globalThis.requestAnimationFrame(() => {
        this._captureInitialSnapshot();
      });
      return;
    }

    // ── Single-post draft restore ────────────────────────────────────
    this._format = draft.format;

    await this.updateComplete;

    const textAttachments = draft.attachedTexts?.flatMap((t) => {
      const bodyJson = normalizeComposeDoc(t.bodyJson);
      if (!bodyJson) return [];
      return [
        {
          clientId: t.clientId,
          bodyJson: JSON.stringify(bodyJson),
          bodyHtml: t.bodyHtml,
          summary: t.summary,
        },
      ];
    });

    const media = [
      ...JantComposeDialog._mergeRestoredMedia(
        draft.mediaAttachments,
        options?.extraMedia,
      ).values(),
    ];

    this._editor?.populate({
      format: draft.format,
      title: draft.title || undefined,
      bodyJson: draft.bodyJson ? JSON.stringify(draft.bodyJson) : undefined,
      url: draft.url || undefined,
      quoteText: draft.quoteText || undefined,
      quoteAuthor: draft.quoteAuthor || undefined,
      rating: draft.rating || undefined,
      showTitle: draft.showTitle,
      showRating: draft.showRating,
      media: media.length
        ? JantComposeDialog._restoredMediaToPopulate(media)
        : undefined,
      textAttachments: textAttachments?.length ? textAttachments : undefined,
      attachmentOrder: draft.attachmentOrder,
    });

    this._draftRestored = true;
    if (options?.notify !== false) showToast(this.labels.draftRestored);
    globalThis.requestAnimationFrame(() => {
      this._captureInitialSnapshot();
    });
  }

  /**
   * Check for a local edit draft for the given post ID and restore it if valid.
   * Returns true if a draft was restored, false otherwise.
   */
  private _restoreEditDraftIfAvailable(
    postId: string,
    notify?: boolean,
  ): boolean {
    const key = JantComposeDialog._EDIT_DRAFT_KEY_PREFIX + postId;

    let raw: string | null;
    try {
      raw = globalThis.localStorage.getItem(key);
    } catch {
      return false;
    }
    if (!raw) return false;

    let draft: LocalDraft;
    try {
      draft = JSON.parse(raw) as LocalDraft;
    } catch {
      globalThis.localStorage.removeItem(key);
      return false;
    }

    if (Date.now() - draft.savedAt > JantComposeDialog._DRAFT_MAX_AGE) {
      globalThis.localStorage.removeItem(key);
      return false;
    }

    // Restore metadata
    this._format = draft.format;
    this._collectionIds = this._replyToId
      ? []
      : [...(draft.collectionIds ?? [])];
    this._slug = draft.slug ?? "";
    this._publishedAtInput = draft.publishedAtInput ?? "";
    this._publishedAtTimeMinutes = draft.publishedAtTimeMinutes ?? null;
    this._visibility = draft.visibility ?? "public";
    // The draft speaks for the language too, and its answer may be that the
    // author put this post back on automatic — so it replaces the one seeded
    // from the post rather than filling in for a missing one.
    this._language = draft.language ?? null;

    // Restore editor content
    const textAttachments = draft.attachedTexts?.flatMap((t) => {
      const bodyJson = normalizeComposeDoc(t.bodyJson);
      if (!bodyJson) return [];
      return [
        {
          clientId: t.clientId,
          bodyJson: JSON.stringify(bodyJson),
          bodyHtml: t.bodyHtml,
          summary: t.summary,
        },
      ];
    });

    this._editor?.populate({
      format: draft.format,
      title: draft.title || undefined,
      bodyJson: draft.bodyJson ? JSON.stringify(draft.bodyJson) : undefined,
      url: draft.url || undefined,
      quoteText: draft.quoteText || undefined,
      quoteAuthor: draft.quoteAuthor || undefined,
      rating: draft.rating || undefined,
      showTitle: draft.showTitle,
      showRating: draft.showRating,
      textAttachments: textAttachments?.length ? textAttachments : undefined,
      attachmentOrder: draft.attachmentOrder,
    });

    this._draftRestored = true;
    if (notify !== false) showToast(this.labels.draftRestored);
    return true;
  }

  /**
   * Pick up a "write the translation" request from the URL.
   *
   * The post menu sends the author here with the source Thread and the target
   * language in the query string, and nothing else exists yet: no draft row, no
   * slug, no group. Applied after any local draft restore so a draft the author
   * already started for this translation wins over the bare request.
   */
  private async _applyTranslationRequestFromUrl(): Promise<void> {
    const params = new URLSearchParams(globalThis.location?.search ?? "");
    const translationOf = params.get("translationOf");
    if (!translationOf) return;

    const lang = params.get("lang");
    if (lang && this.languages.some((language) => language.tag === lang)) {
      this._language = lang;
    }
    if (!this._translationOf) {
      // `seed` still stands down on its own if the restore above brought
      // content back, so a draft the author already started keeps its format.
      await this._loadTranslationSource(translationOf, { seed: true });
    }
  }

  private async _focusPageEditorOnMount() {
    if (this._pageFocusApplied) return;

    if (this.autoRestoreDraft) {
      await this.restoreLocalDraft();
    }
    await this._applyTranslationRequestFromUrl();

    await this.updateComplete;
    globalThis.requestAnimationFrame(() => {
      this._editor?.focusInput();
      this._pageFocusApplied = true;
    });
  }

  private _renderDraftsPanel() {
    if (!this._draftsPanelOpen) return nothing;

    return html`
      <div class="compose-drafts-panel">
        <div class="compose-alt-header">
          <button
            type="button"
            class="compose-attached-panel-back"
            @click=${() => this._closeDraftsPanel()}
          >
            <svg
              class="icon-fine"
              width="16"
              height="16"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              stroke-width="1.5"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="M11 3L6 8l5 5" />
            </svg>
          </button>
          <span class="compose-alt-title">${this.labels.drafts}</span>
        </div>
        ${this._draftsLoading
          ? html`<div class="compose-drafts-loading">
              <svg
                class="animate-spin size-5"
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <path d="M21 12a9 9 0 1 1-6.219-8.56" />
              </svg>
            </div>`
          : this._draftsError
            ? html`<div class="compose-drafts-empty">${this._draftsError}</div>`
            : this._drafts.length === 0
              ? html`<div class="compose-drafts-empty">
                  ${this.labels.draftsEmpty}
                </div>`
              : html`<div class="compose-drafts-list">
                  ${this._drafts.map(
                    (draft, i) => html`
                      ${i > 0
                        ? html`<div class="compose-drafts-divider"></div>`
                        : nothing}
                      ${this._renderDraftItem(draft)}
                    `,
                  )}
                </div>`}
      </div>
    `;
  }

  private _renderDraftItem(draft: DraftItem) {
    const preview = this._getDraftPreview(draft);
    const formatLabel = this.labels[draft.format];
    const menuId = `draft-actions-${draft.id}`;
    const menuOpen = this._draftMenuOpenId === draft.id;

    return html`
      <div class="compose-draft-item" @click=${() => this.openDraft(draft.id)}>
        <div class="compose-draft-content">
          ${preview
            ? html`<div class="compose-draft-preview">${preview}</div>`
            : html`<div
                class="compose-draft-preview compose-draft-preview-empty"
              >
                Empty draft
              </div>`}
          <div class="compose-draft-meta">
            <span class="compose-draft-format">${formatLabel}</span>
            <span aria-hidden="true">·</span>
            ${this._formatDraftDate(draft.updatedAt)}
          </div>
        </div>
        <div class="relative">
          ${menuOpen
            ? html`<div
                class="compose-dropdown-backdrop"
                @click=${(e: Event) => {
                  e.stopPropagation();
                  this._draftMenuOpenId = null;
                }}
              ></div>`
            : nothing}
          <button
            type="button"
            class="compose-draft-more"
            aria-label=${this.labels.draftActions}
            aria-haspopup="menu"
            aria-expanded=${menuOpen ? "true" : "false"}
            aria-controls=${menuId}
            @click=${(e: Event) => {
              e.stopPropagation();
              this._draftMenuOpenId =
                this._draftMenuOpenId === draft.id ? null : draft.id;
            }}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
              <circle cx="4" cy="8" r="1.2" />
              <circle cx="8" cy="8" r="1.2" />
              <circle cx="12" cy="8" r="1.2" />
            </svg>
          </button>
          ${menuOpen
            ? html`
                <div
                  id=${menuId}
                  class="compose-dropdown compose-dropdown-right"
                  role="menu"
                >
                  <a
                    class="compose-dropdown-item"
                    href=${publicPath(`/preview/${draft.slug}`)}
                    target="_blank"
                    rel="noopener noreferrer"
                    role="menuitem"
                    @click=${(e: Event) => {
                      e.stopPropagation();
                      this._draftMenuOpenId = null;
                    }}
                  >
                    ${this.labels.previewDraft}
                  </a>
                  <div
                    class="compose-dropdown-separator"
                    role="separator"
                  ></div>
                  <button
                    type="button"
                    class="compose-dropdown-item compose-dropdown-item-danger"
                    role="menuitem"
                    @click=${(e: Event) => {
                      e.stopPropagation();
                      this._deleteDraft(draft.id);
                    }}
                  >
                    ${this.labels.deleteDraft}
                  </button>
                </div>
              `
            : nothing}
        </div>
      </div>
    `;
  }

  // ── Reply context rendering ──────────────────────────────────────

  /**
   * The original, above the composer that is translating it.
   *
   * Sits where the reply context sits, for the same reason: a composer that
   * was opened *about* something should say so before the author starts
   * typing, not bury it two panels deep.
   *
   * Three decisions worth keeping:
   *
   * - It shows the whole post as the site renders it — server-rendered by
   *   `/_/post-preview`, so a Quote arrives with its attribution and a Link
   *   with its card. Structure is part of what gets translated, and a
   *   `bodyHtml`-only preview silently dropped everything that is not body.
   * - It scrolls inside a fixed frame instead of expanding. Translation is
   *   read-a-bit, write-a-bit: a "show more" that hands a long post its full
   *   height pushes the editor off the screen exactly when both need to be
   *   visible. (The reply context expands, and is right to — it is read once,
   *   before writing, not alongside.)
   * - Nothing is bolted on to say "this is a link somewhere". The post's own
   *   permalink is inside the rendering already; `_adoptTranslationPreview`
   *   sends it to a new tab. An external-link glyph on a title made the whole
   *   card read as a Link post rather than as the article it is.
   *
   * The language goes on the divider underneath rather than at the top: it
   * belongs at the seam, where it reads as "…and below is that, in Japanese".
   */
  private _renderTranslationContext() {
    const source = this._translationOf;
    if (!source) return nothing;

    const languageLabel =
      this.languages.find((entry) => entry.tag === this._language)?.label ?? "";
    const seam = languageLabel
      ? this.labels.translationContextInLanguage.replace(
          "{language}",
          languageLabel,
        )
      : this.labels.translationContext;

    const collapsed = this._translationCollapsed;

    return html`
      <div class="compose-translation-context">
        ${collapsed
          ? nothing
          : source.previewHtml
            ? html`<div
                class="compose-translation-original"
                tabindex="0"
                role="region"
                aria-label=${this.labels.translationContextOriginal}
              >
                <div class="compose-translation-preview">
                  ${unsafeHTML(source.previewHtml)}
                </div>
              </div>`
            : html`<p class="compose-translation-fallback">
                ${source.href
                  ? html`<a
                      href=${source.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      title=${this.labels.translationContextOpen}
                      >${source.title}</a
                    >`
                  : source.title}
              </p>`}
        <div class="compose-translation-seam">
          <span class="compose-translation-seam-label">
            ${this._iconArrowDown()}${seam}
          </span>
          <span class="compose-translation-seam-dot" aria-hidden="true">·</span>
          <button
            type="button"
            class="compose-translation-seam-toggle"
            aria-expanded=${collapsed ? "false" : "true"}
            aria-label=${collapsed
              ? this.labels.translationContextShowLong
              : this.labels.translationContextHideLong}
            @click=${() => {
              this._translationCollapsed = !this._translationCollapsed;
            }}
          >
            ${collapsed
              ? this.labels.translationContextShow
              : this.labels.translationContextHide}
          </button>
        </div>
      </div>
    `;
  }

  /**
   * Make the server-rendered original safe to sit inside the composer.
   *
   * Two things have to be undone, both because this markup was written to *be*
   * a post rather than to be quoted inside one:
   *
   * - Every link leaves for a new tab. A link followed in place navigates the
   *   composer away and takes the unsaved translation with it.
   * - The post's identity comes off. `data-post-id` and friends are how the
   *   post menu, the keyboard shortcuts and `refreshArticleView` find a post;
   *   leaving a second copy of the original's id in the DOM lets any of them
   *   act on the preview believing it is the real card.
   *
   * Runs on every update because `unsafeHTML` re-creates the subtree whenever
   * the markup changes, and is cheap to repeat — the marker attribute makes it
   * a no-op once a given rendering has been adopted.
   */
  private _adoptTranslationPreview() {
    const preview = this.querySelector<HTMLElement>(
      ".compose-translation-preview:not([data-preview-adopted])",
    );
    if (!preview) return;
    preview.dataset.previewAdopted = "";

    for (const link of preview.querySelectorAll("a[href]")) {
      link.setAttribute("target", "_blank");
      link.setAttribute("rel", "noopener noreferrer");
    }

    for (const el of preview.querySelectorAll<HTMLElement>("[data-post-id]")) {
      delete el.dataset.postId;
      delete el.dataset.post;
      delete el.dataset.threadRootId;
      delete el.dataset.postMenuTarget;
      el.classList.remove("post-menu-target");
    }
    for (const trigger of preview.querySelectorAll(
      "[data-post-menu-trigger], [data-reply-trigger], [data-timeline-item]",
    )) {
      trigger.remove();
    }
  }

  /** Points at what comes next: the version being written, below. */
  private _iconArrowDown() {
    return html`<svg
      class="compose-translation-seam-icon"
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.9"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d="M12 5v14" />
      <path d="m19 12-7 7-7-7" />
    </svg>`;
  }

  private _renderReplyContext() {
    if (!this._replyToId || !this._replyToData) return nothing;

    const { contentHtml, dateText, media } = this._replyToData;
    const isExpanded = this._replyExpanded;

    return html`
      <div class="compose-reply-row">
        <div class="compose-thread-dot"></div>
        <div
          class=${classMap({
            "compose-reply-context": true,
            expanded: isExpanded,
          })}
        >
          <div class="compose-reply-context-body">
            ${unsafeHTML(contentHtml)}
            ${media?.length
              ? html`<div
                  class="compose-reply-context-media"
                  data-post-media
                  data-lightbox-group=${JSON.stringify(
                    media.map((m) => ({
                      url: m.url,
                      alt: m.alt ?? "",
                      width: m.width,
                      height: m.height,
                      mimeType: m.mimeType,
                    })),
                  )}
                >
                  ${media.map(
                    (m, i) => html`
                      <a
                        href=${m.url}
                        data-lightbox-index=${i}
                        class="compose-reply-context-media-link"
                      >
                        <img
                          src=${m.previewUrl}
                          alt=${m.alt ?? ""}
                          class="compose-reply-context-media-img"
                          loading="lazy"
                        />
                      </a>
                    `,
                  )}
                </div>`
              : nothing}
          </div>
          ${!isExpanded
            ? html`<div class="compose-reply-fade"></div>`
            : nothing}
        </div>
      </div>
      <div class="compose-reply-meta">
        ${dateText ? html`<span>${dateText}</span><span>·</span>` : nothing}
        <button
          type="button"
          class="compose-reply-toggle"
          @click=${() => {
            this._replyExpanded = !this._replyExpanded;
          }}
        >
          ${isExpanded ? this.labels.showLess : this.labels.showMore}
        </button>
      </div>
    `;
  }

  private static readonly _FORMATS: ComposeFormat[] = ["note", "link", "quote"];

  /**
   * Whether a format switch should convert fields (fold/extract). Only when
   * editing an existing post or a server draft — for a brand-new post, switching
   * just hides/shows fields and nothing is persisted yet, so conversion would
   * pollute the body for no benefit.
   */
  private _shouldConvertOnFormatSwitch(): boolean {
    return !!(this._editPostId || this._draftSourceId);
  }

  private _switchFormat(target: ComposeFormat) {
    if (this._format === target) return;
    const editor = this._editor;
    if (editor && this._shouldConvertOnFormatSwitch()) {
      // Fold fields the target can't hold into the body before the format
      // change recreates the editor from `_bodyJson`. Synchronous, so the old
      // Tiptap instance can't fire onUpdate and clobber what we just wrote.
      // `applyConvertedFields` suppresses the one content-change event the
      // conversion emits, so the switch itself never schedules a draft save.
      editor.applyConvertedFields(
        convertComposeFormat(
          this._format,
          target,
          editor.getConvertibleFields(),
        ),
      );
    }
    // A bare format switch shouldn't persist a local draft, so drop any save
    // already pending from loading the post.
    this._cancelDraftSaveTimer();
    this._format = target;
    this._showPublishPanel = false;
    if (this._shouldAutofocusFormatInput()) {
      globalThis.requestAnimationFrame(() => this._editor?.focusInput());
    }
  }

  // ── Render helpers ────────────────────────────────────────────────

  /**
   * The way out, sitting at the end of the post header row where a thread post
   * keeps its own ×. Compose has no title bar to hang a Cancel off any more:
   * "New post" restated what an empty composer already says, and Publish
   * already reads "Update" when editing, so the row was carrying nothing but
   * two controls that belong closer to the work.
   *
   * A thread's posts each own that slot for removing themselves, so there the
   * exit lives in the options panel instead — see `_renderCloseComposeRow`.
   */
  private _renderCloseComposeControl() {
    if (this.pageMode || this._threadItems.length > 0) return nothing;

    return html`
      <button
        type="button"
        class="compose-close-btn"
        aria-label=${this.labels.close}
        title=${this.labels.close}
        @click=${() => this.requestClose()}
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          stroke-width="1.8"
          stroke-linecap="round"
          aria-hidden="true"
        >
          <path d="M4.5 4.5 11.5 11.5M11.5 4.5 4.5 11.5" />
        </svg>
      </button>
    `;
  }

  private _renderCollectionSelector() {
    const collections = this.collections ?? [];
    const orderedCollections = applyItemOrder(
      collections,
      this._collectionPickerOrder,
    );
    const hasSearch = this._collectionSearch.trim().length > 0;
    const filtered = filterCollectionsBySearch(
      orderedCollections,
      this._collectionSearch,
    );
    const selectedCount = this._collectionIds.length;
    const selectedLabel =
      selectedCount > 0
        ? this._selectedCollectionLabel(collections)
        : this.labels.collection;
    const emptyLabel = hasSearch
      ? this.labels.noCollections
      : this.labels.emptyCollections;

    return html`
      <div class="flex-1 min-w-0">
        ${this._showCollection
          ? html`<div
              class="compose-dropdown-backdrop"
              @click=${() => this._closeCollectionPicker()}
            ></div>`
          : nothing}
        <div
          class="select compose-collection-select"
          data-select-initialized
          data-open=${this._showCollection ? "true" : nothing}
        >
          <button
            type="button"
            class="compose-collection-trigger"
            aria-haspopup="listbox"
            aria-expanded=${this._showCollection ? "true" : "false"}
            data-open=${this._showCollection ? "true" : nothing}
            data-selected=${selectedCount > 0 ? "true" : nothing}
            @keydown=${this._handleCollectionTriggerKeydown}
            @click=${() => {
              const nextOpen = !this._showCollection;
              this._showPublishPanel = false;
              this._showLanguagePicker = false;
              if (nextOpen) {
                this._prepareCollectionPickerOrder();
              }
              this._showCollection = nextOpen;
              if (!nextOpen) {
                this._closeCollectionPicker();
              }
            }}
          >
            <!-- No chevron: the glyph already says "picker", and a second one
                 pointing down only made the control wider. -->
            ${renderComposeCollectionPickerIcon(
              COMPOSE_COLLECTION_PICKER_ICONS.collection,
              "compose-collection-trigger-svg",
            )}
            <span class="compose-collection-label">${selectedLabel}</span>
          </button>
          <div
            class="compose-collection-popover"
            data-popover
            aria-hidden=${this._showCollection ? "false" : "true"}
          >
            ${collections.length > 0
              ? html`<div class="compose-collection-popover-header">
                  <label class="compose-collection-search-shell">
                    ${renderComposeCollectionPickerIcon(
                      COMPOSE_COLLECTION_PICKER_ICONS.search,
                      "compose-collection-search-icon",
                    )}
                    <input
                      type="text"
                      role="combobox"
                      class="compose-collection-search-input"
                      placeholder=${this.labels.searchCollections}
                      autocomplete="off"
                      autocorrect="off"
                      spellcheck="false"
                      .value=${this._collectionSearch}
                      @keydown=${this._handleCollectionSearchKeydown}
                      @input=${(e: Event) => {
                        this._collectionSearch = (
                          e.target as HTMLInputElement
                        ).value;
                      }}
                    />
                  </label>
                </div>`
              : nothing}
            <div
              role="listbox"
              class="compose-collection-options"
              aria-multiselectable="true"
            >
              ${filtered.length > 0
                ? filtered.map((col) => {
                    const selected = this._collectionIds.includes(col.id);

                    return html`
                      <button
                        type="button"
                        class=${classMap({
                          "compose-collection-option": true,
                          "compose-collection-option-selected": selected,
                        })}
                        role="option"
                        data-value=${col.id}
                        aria-selected=${selected ? "true" : "false"}
                        @keydown=${(event: globalThis.KeyboardEvent) =>
                          this._handleCollectionOptionKeydown(event, col.id)}
                        @click=${() =>
                          this._handleCollectionOptionClick(col.id)}
                      >
                        <span class="compose-collection-option-label"
                          >${col.title}</span
                        >
                        <span
                          class=${classMap({
                            "compose-collection-option-marker": true,
                            "compose-collection-option-marker-selected":
                              selected,
                            "compose-collection-option-marker-add": !selected,
                          })}
                        >
                          ${selected
                            ? html`<svg
                                xmlns="http://www.w3.org/2000/svg"
                                class="compose-collection-option-check-circle"
                                viewBox="0 0 24 24"
                                fill="none"
                                aria-hidden="true"
                              >
                                <circle
                                  cx="12"
                                  cy="12"
                                  r="10"
                                  fill="currentColor"
                                />
                                <path
                                  d="M8 12.5 10.7 15.2 16.4 9.5"
                                  stroke="var(--site-page-bg)"
                                  stroke-width="2.3"
                                  stroke-linecap="round"
                                  stroke-linejoin="round"
                                />
                              </svg>`
                            : renderComposeCollectionPickerIcon(
                                COMPOSE_COLLECTION_PICKER_ICONS.plusCircle,
                                "compose-collection-option-plus-circle",
                              )}
                        </span>
                      </button>
                    `;
                  })
                : html`<div class="compose-collection-empty">
                    ${emptyLabel}
                  </div>`}
            </div>
            <div class="compose-collection-footer">
              <button
                type="button"
                class="compose-collection-add-action"
                @keydown=${this._handleCollectionAddActionKeydown}
                @click=${() => {
                  this._closeCollectionPicker();
                  this._addCollectionPanelOpen = true;
                }}
              >
                <span class="compose-collection-add-icon">
                  ${renderComposeCollectionPickerIcon(
                    COMPOSE_COLLECTION_PICKER_ICONS.plus,
                    "compose-collection-add-svg",
                  )}
                </span>
                ${this.labels.addCollection}
              </button>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  // ── Add Collection dialog ───────────────────────────────────────

  private _closeAddCollectionPanel() {
    this._addCollectionPanelOpen = false;
    this.updateComplete.then(() => {
      this.querySelector<HTMLElement>(".compose-collection-trigger")?.focus();
    });
  }

  private async _handleAddCollectionSubmit(e: Event) {
    const event = e as CustomEvent<CollectionSubmitDetail>;
    event.stopPropagation();

    const detail = event.detail;
    if (!detail) return;

    const formEl = this.querySelector("jant-collection-form") as
      | (HTMLElement & { loading: boolean })
      | null;
    if (formEl) formEl.loading = true;

    try {
      const res = await fetch("/api/collections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(detail.data),
      });
      const created = (await res.json().catch(() => null)) as {
        id: string;
        title: string;
        slug?: string;
        error?: string;
      } | null;

      if (!res.ok) {
        throw new Error(
          created?.error || "Couldn't create collection. Try again.",
        );
      }
      if (!created?.id || !created.title) {
        throw new Error("Couldn't create collection. Try again.");
      }
      const newCollection: ComposeCollection = {
        id: created.id,
        title: created.title,
        slug: created.slug ?? "",
      };

      const refreshed = await this.refreshCollections();
      if (
        !refreshed ||
        !this.collections.some((col) => col.id === created.id)
      ) {
        this.collections = [...this.collections, newCollection];
      }
      this._collectionIds = [...this._collectionIds, created.id];
      this._closeAddCollectionPanel();
      showToast(this.labels.collectionFormLabels.createdLabel);
    } catch (error) {
      showToast(
        error instanceof Error
          ? error.message
          : "Couldn't create collection. Try again.",
        "error",
      );
    } finally {
      if (formEl) formEl.loading = false;
    }
  }

  private _submitAddCollectionForm() {
    const form = this.querySelector<HTMLFormElement>(
      "[data-collection-quick-dialog] form",
    );
    if (form) form.requestSubmit();
  }

  private _renderAddCollectionPanel() {
    if (!this._addCollectionPanelOpen) return nothing;

    const initial = {
      title: "",
      slug: "",
      description: "",
      sortOrder: "newest",
      icon: "",
    };

    return html`
      <div
        class="collection-quick-dialog-backdrop"
        @click=${() => this._closeAddCollectionPanel()}
      ></div>
      <div
        class="collection-quick-dialog"
        data-collection-quick-dialog
        role="dialog"
        aria-modal="true"
        aria-label=${this.labels.addCollection}
        @click=${(event: Event) => event.stopPropagation()}
      >
        <div class="collection-quick-dialog-header">
          <div class="collection-quick-dialog-title-block">
            <h2 class="collection-quick-dialog-title">
              ${this.labels.addCollection}
            </h2>
            <p class="collection-quick-dialog-note">
              ${this.labels.collectionFormLabels.quickHint}
            </p>
          </div>
          <button
            type="button"
            class="collection-quick-dialog-cancel"
            @click=${() => this._closeAddCollectionPanel()}
          >
            ${this.labels.collectionFormLabels.cancelLabel}
          </button>
        </div>
        <div class="collection-quick-dialog-body">
          <jant-collection-form
            variant="quick"
            .labels=${this.labels.collectionFormLabels}
            .initial=${initial}
            action=${publicPath("/api/collections")}
            cancel-href="javascript:void(0)"
            @jant:collection-submit=${(e: Event) =>
              this._handleAddCollectionSubmit(e)}
          ></jant-collection-form>
        </div>
        <div class="collection-quick-dialog-footer">
          <button
            type="button"
            class="compose-post-btn collection-quick-dialog-submit"
            @click=${() => this._submitAddCollectionForm()}
          >
            ${this.labels.collectionFormLabels.quickSubmitLabel}
          </button>
        </div>
      </div>
    `;
  }

  private _renderAttachedPanel() {
    if (!this._attachedPanelOpen) return nothing;

    return html`
      <div class="compose-attached-panel">
        <div class="compose-alt-header">
          <button
            type="button"
            class="compose-attached-cancel"
            @click=${() => this._cancelAttachedPanel()}
          >
            ${this.labels.cancel}
          </button>
          <span class="compose-alt-title">${this.labels.attachedText}</span>
          <button
            type="button"
            class="compose-attached-done"
            @click=${() => this._doneAttachedPanel()}
          >
            ${this.labels.done}
          </button>
        </div>
        <div class="flex-1 p-4 overflow-hidden flex flex-col">
          <div
            class="compose-attached-tiptap compose-tiptap-body"
            @mousedown=${(event: MouseEvent) =>
              this._handleAttachedEditorMouseDown(event)}
          ></div>
        </div>
      </div>
    `;
  }

  private _renderAltPanel() {
    if (!this._altPanelOpen) return nothing;
    const attachment = this._getAltAttachment();
    if (!attachment) return nothing;

    const category = getMediaCategory(attachment.file.type);

    return html`
      <div class="compose-alt-panel">
        <div class="compose-alt-header">
          <button
            type="button"
            class="compose-attached-panel-back"
            @click=${() => this._closeAltPanel()}
          >
            <svg
              class="icon-fine"
              width="16"
              height="16"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              stroke-width="1.5"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="M11 3L6 8l5 5" />
            </svg>
          </button>
          <span class="compose-alt-title">${this.labels.addAltTitle}</span>
        </div>
        <div class="compose-alt-preview">
          ${category === "image"
            ? html`<img
                src=${attachment.previewUrl}
                alt=""
                class="compose-alt-preview-img"
              />`
            : category === "video"
              ? html`<video
                  src=${attachment.previewUrl}
                  class="compose-alt-preview-img"
                  preload="metadata"
                  muted
                ></video>`
              : html`<span class="text-sm text-muted-foreground"
                  >${attachment.file.name}</span
                >`}
        </div>
        <div class="compose-alt-input-row">
          <input
            type="text"
            .value=${attachment.alt}
            @input=${(e: Event) => this._onAltInput(e)}
            class="compose-input compose-alt-input"
            placeholder=${this.labels.altPlaceholder}
          />
        </div>
        <div class="compose-alt-footer">
          <span class="text-xs text-muted-foreground"
            >${this.labels.altHint}</span
          >
          <button
            type="button"
            class="compose-post-btn"
            @click=${() => this._closeAltPanel()}
          >
            ${this.labels.done}
          </button>
        </div>
      </div>
    `;
  }

  private _renderConfirmPanel() {
    if (!this._confirmPanelOpen) return nothing;

    const isEdit = !!this._editPostId;
    const title = this._confirmForAttachedText
      ? this.labels.confirmAttachedTitle
      : isEdit
        ? this.labels.confirmEditTitle
        : this.labels.confirmCloseTitle;
    const subtitle = this._confirmForAttachedText
      ? this.labels.confirmAttachedSubtitle
      : isEdit
        ? this.labels.confirmEditSubtitle
        : this.labels.confirmCloseSubtitle;
    const saveLabel = this._confirmForAttachedText
      ? this.labels.confirmAttachedSave
      : isEdit
        ? this.labels.confirmEditPublish
        : this.labels.confirmCloseSave;
    const discardLabel = this._confirmForAttachedText
      ? this.labels.confirmAttachedDiscard
      : isEdit
        ? this.labels.confirmEditDiscard
        : this.labels.confirmCloseDiscard;

    return html`
      <div class="compose-confirm-panel">
        <div class="compose-confirm-sheet">
          <div class="compose-confirm-header">
            <p class="compose-confirm-title">${title}</p>
            <p class="compose-confirm-subtitle">${subtitle}</p>
          </div>
          <button
            type="button"
            class="compose-confirm-action compose-confirm-save"
            @click=${() => this._handleConfirmSave()}
          >
            ${saveLabel}
          </button>
          <button
            type="button"
            class="compose-confirm-action compose-confirm-discard"
            @click=${() => this._handleConfirmDiscard()}
          >
            ${discardLabel}
          </button>
          <button
            type="button"
            class="compose-confirm-action compose-confirm-cancel"
            @click=${() => this.requestClose()}
          >
            ${this.labels.confirmCloseCancel}
          </button>
        </div>
      </div>
    `;
  }

  private _getSubmitLabel(): string {
    if (this._editPostId) return this.labels.update;
    if (this._replyToId) {
      return this._quietReply ? this.labels.quietReplyLabel : this.labels.reply;
    }
    if (this._visibility === "latest_hidden") {
      return this.labels.postHiddenFromLatest;
    }
    if (this._visibility === "private") return this.labels.postPrivately;
    return this.labels.post;
  }

  private _getSlugSyncValidationMessage(): string | null {
    const issue = getSlugValidationIssue(this._slug);
    if (issue === "invalid") return this.labels.publishSlugInvalid;
    if (issue === "reserved") return this.labels.publishSlugReserved;
    return null;
  }

  private _getSlugValidationMessage(): string | null {
    const syncMessage = this._getSlugSyncValidationMessage();
    if (syncMessage) return syncMessage;
    if (this._hasManualSlug() && this._slugTaken) {
      return this.labels.publishSlugTaken;
    }
    return null;
  }

  private _getSlugPreviewUrl(): string | null {
    if (!this._hasManualSlug() || this._getSlugValidationMessage()) {
      return null;
    }

    const path = publicPath(`/${this._slug.trim()}`);
    const origin =
      globalThis.location?.origin && globalThis.location.origin !== "null"
        ? globalThis.location.origin
        : "http://localhost";
    return new URL(path, `${origin}/`).toString();
  }

  private _getSlugPreviewParts(): {
    full: string;
    origin: string;
    path: string;
  } | null {
    const previewUrl = this._getSlugPreviewUrl();
    if (!previewUrl) return null;

    const url = new URL(previewUrl);
    return {
      full: previewUrl,
      origin: url.origin,
      path: `${url.pathname}${url.search}${url.hash}`,
    };
  }

  private _getSlugStatusMessage(): string | null {
    if (this._hasManualSlug()) {
      if (this._getSlugValidationMessage()) {
        return this._getSlugValidationMessage();
      }
      return null;
    }

    if (this._suggestedSlugLoading) {
      return this.labels.publishSlugGenerating;
    }

    return null;
  }

  private _getCurrentTimestamp(): number {
    return Math.floor(Date.now() / 1000);
  }

  private _getPublishedAtMaxInput(): string {
    return toLocalDateInputValue(this._getCurrentTimestamp());
  }

  private _getPublishedAtTimeMinutes(): number {
    return (
      this._publishedAtTimeMinutes ??
      getTimestampTimeMinutes(this._getCurrentTimestamp())
    );
  }

  private _hasPublishedAtValue(): boolean {
    return this._publishedAtInput.trim().length > 0;
  }

  private _getPublishedAtValidationMessage(): string | null {
    if (!this._hasPublishedAtValue()) return null;

    const parsedDate = parseLocalDateInputValue(this._publishedAtInput);
    if (parsedDate === null) {
      return this.labels.publishDateInvalid;
    }

    if (this._publishedAtInput > this._getPublishedAtMaxInput()) {
      return this.labels.publishDateFutureError;
    }

    return null;
  }

  private _getPublishedAtSummary(): { input: string; text: string } | null {
    if (this._editPostId || this._draftSourceId) {
      if (this._publishedAtInput === this._initialPublishedAtInput) {
        return null;
      }
      if (!this._hasPublishedAtValue()) {
        return {
          input: "",
          text: this.labels.publishDateSummaryNow,
        };
      }
    }

    if (this._getPublishedAtValidationMessage() !== null) return null;

    const parsedDate = parseLocalDateInputValue(this._publishedAtInput);
    if (parsedDate === null) return null;

    return {
      input: this._publishedAtInput,
      text: new Intl.DateTimeFormat(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
      }).format(
        new Date(parsedDate.year, parsedDate.monthIndex, parsedDate.day),
      ),
    };
  }

  private _getPostPublishedAtSubmitValue(
    index: number,
    status: "published" | "draft",
  ): number | undefined {
    if (index === 0) return this._getPublishedAtSubmitValue(status);
    if (status === "draft") return undefined;

    const item = this._threadItems[index];
    const input = item?.publishedAtInput ?? "";
    if (!input.trim()) return undefined;

    const timestamp = buildTimestampFromLocalDate(
      input,
      item?.publishedAtTimeMinutes ??
        getTimestampTimeMinutes(this._getCurrentTimestamp()),
    );
    if (timestamp === null) return undefined;
    return Math.min(timestamp, this._getCurrentTimestamp());
  }

  private _getPublishedAtSubmitValue(
    status: "published" | "draft",
  ): number | undefined {
    if (status === "draft") return undefined;

    const publishedAt = buildTimestampFromLocalDate(
      this._publishedAtInput,
      this._getPublishedAtTimeMinutes(),
    );
    if (publishedAt !== null) {
      // If editing and the user didn't change date or time, preserve the
      // original timestamp (including seconds) to avoid silent truncation.
      if (
        this._originalPublishedAt !== null &&
        this._publishedAtInput === this._initialPublishedAtInput &&
        this._publishedAtTimeMinutes === this._initialPublishedAtTimeMinutes
      ) {
        return Math.min(this._originalPublishedAt, this._getCurrentTimestamp());
      }
      return Math.min(publishedAt, this._getCurrentTimestamp());
    }

    if (this._publishedAtInput.trim().length > 0) {
      return undefined;
    }

    if (this._editPostId) {
      return this._getCurrentTimestamp();
    }

    return undefined;
  }

  private _openPublishPanelAndFocus(selector: string, index = 0) {
    this._showCollection = false;
    this._collectionSearch = "";
    this._showPublishPanel = false;
    this._showLanguagePicker = false;
    this._postMetaIndex = index;
    this._confirmPanelOpen = false;
    this._scheduleSuggestedSlugRefresh(true);
    this._placeAndFocusPostMetaPanel(selector);
  }

  private _revealSlugField(index = 0) {
    this._openPublishPanelAndFocus(".compose-publish-slug-input", index);
  }

  private _revealPublishedAtField(index = 0) {
    this._openPublishPanelAndFocus(".compose-publish-date-input", index);
  }

  /** Every row ready, and every row's own date and permalink accepted. */
  private _canPublish(): boolean {
    if (this._loading) return false;
    const rowIds = this._rowIds;
    for (let i = 0; i < rowIds.length; i++) {
      if (this._getPostPublishedAtValidationMessage(i)) return false;
      if (this._getPostSlugValidationMessage(i)) return false;
    }
    return rowIds.every((id) => this._rowStatus.get(id)?.publishable === true);
  }

  private _focusPublishPanelInitialField() {
    const selector = this._visibilityLocked
      ? ".compose-publish-date-input"
      : ".compose-publish-option[role='radio']";
    this.querySelector<HTMLElement>(selector)?.focus();
  }

  private _closePublishPanel(restoreFocus = false) {
    if (!this._showPublishPanel) return;
    this._showPublishPanel = false;
    if (restoreFocus) {
      this.updateComplete.then(() => this._restorePageEditorFocus());
    }
  }

  private _togglePublishPanel() {
    this._showCollection = false;
    this._collectionSearch = "";
    this._showLanguagePicker = false;
    const nextOpen = !this._showPublishPanel;
    this._showPublishPanel = nextOpen;
    if (nextOpen) {
      this._scheduleSuggestedSlugRefresh(true);
      this.updateComplete.then(() => this._focusPublishPanelInitialField());
    }
  }

  private _setVisibility(visibility: ComposeVisibility) {
    if (this._visibilityLocked) return;
    this._visibility = visibility;
    // Choosing is the whole job of the panel, so dismiss it. Nothing here
    // needs confirming — a radio selection is not a form.
    if (this._showPublishPanel) this._closePublishPanel(true);
    if (!this._editPostId && !this._draftSourceId && !this._replyToId) {
      JantComposeDialog._lastNewPostVisibility = visibility;
      if (this._sourceCollectionId) {
        JantComposeDialog._setCollectionVisibility(
          this._sourceCollectionId,
          visibility,
        );
      }
    }
  }

  private _onSlugInput(e: Event, index = 0) {
    const value = (e.target as HTMLInputElement).value;
    this._setPostSlug(index, value.toLowerCase());
    this._setPostSlugTaken(index, false);
    this._slugCheckLoading = false;
    if (this._hasPostManualSlug(index)) {
      this._scheduleSlugAvailabilityCheck(index);
      return;
    }
    this._scheduleSuggestedSlugRefresh();
  }

  private _resetPublishedAt(index = 0) {
    const currentTimestamp = this._getCurrentTimestamp();
    this._setPostPublishedAtInput(
      index,
      toLocalDateInputValue(currentTimestamp),
    );
    this._setPostPublishedAtTimeMinutes(
      index,
      getTimestampTimeMinutes(currentTimestamp),
    );
    this.updateComplete.then(() => {
      this.querySelector<HTMLInputElement>(
        ".compose-publish-date-input",
      )?.focus();
    });
  }

  private _renderVisibilityIcon(
    visibility: ComposeVisibility,
    variant: "menu" | "toggle" = "menu",
  ) {
    const iconClasses = classMap({
      "compose-publish-visibility-icon": true,
      "compose-publish-visibility-icon-toggle": variant === "toggle",
      "compose-publish-visibility-icon-public": visibility === "public",
      "compose-publish-visibility-icon-latest_hidden":
        visibility === "latest_hidden",
      "compose-publish-visibility-icon-private": visibility === "private",
    });
    return renderComposePublishVisibilityIcon(
      COMPOSE_PUBLISH_VISIBILITY_ICONS[visibility],
      iconClasses,
    );
  }

  /**
   * One choice in the options sheet: title, one-line explanation, and a check
   * on the selected row. Every option carries its own hint so they can be
   * compared before choosing, which a single hint under a chip group can't do.
   */
  private _renderVisibilityRow(
    visibility: ComposeVisibility,
    label: string,
    hint: string,
  ) {
    const selected = this._visibility === visibility;

    return html`
      <button
        type="button"
        class=${classMap({
          "compose-sheet-row": true,
          "compose-sheet-row-selected": selected,
        })}
        role="radio"
        aria-checked=${selected ? "true" : "false"}
        ?disabled=${this._visibilityLocked}
        @click=${() => this._setVisibility(visibility)}
      >
        ${this._renderVisibilityIcon(visibility)}
        <span class="compose-sheet-main">
          <span class="compose-sheet-title">${label}</span>
          <span class="compose-sheet-sub">${hint}</span>
        </span>
        ${selected
          ? html`<span class="compose-sheet-check" aria-hidden="true">
              ${renderComposePublishActionIcon(
                COMPOSE_PUBLISH_ACTION_ICONS.check,
                "compose-sheet-check-icon",
              )}
            </span>`
          : nothing}
      </button>
    `;
  }

  /**
   * Load the post a translation is being written for.
   *
   * Only the ID is carried around — through the URL that opens the composer,
   * and through a local draft picked up later — so everything shown above the
   * editor is fetched when it is needed. A post that has since been deleted
   * simply drops the link rather than blocking the composer.
   *
   * @param postId - Thread root the new post translates
   * @param options.seed - Also take the original's shape: its format, and the
   *   citation fields that name a source rather than say anything in a
   *   language. Only for a composer opened fresh on this translation; a
   *   restored draft already carries the author's own answers.
   */
  private async _loadTranslationSource(
    postId: string,
    options: { seed?: boolean } = {},
  ): Promise<void> {
    try {
      const response = await fetch(publicPath(`/api/posts/${postId}`), {
        credentials: "same-origin",
      });
      if (!response.ok) return;
      const post = (await response.json()) as ComposePostResponse & {
        displayTitle?: string;
      };
      // `displayTitle` is derived server-side for untitled notes; a slug is a
      // URL, not a name, and only stands in when there is nothing else.
      this._translationOf = {
        id: post.id,
        title: post.displayTitle || post.slug || "",
        href: post.slug ? publicPath(`/${post.slug}`) : "",
        previewHtml: await this._fetchTranslationPreview(post.id),
      };

      if (options.seed) await this._seedFromTranslationSource(post);
    } catch {
      // Offline or the post is gone. The composer still works; the author is
      // writing a post, just not a linked one.
    }
  }

  /**
   * The original rendered as it renders anywhere else on the site.
   *
   * Server-side rather than rebuilt here: a Quote's attribution and a Link's
   * card are not `bodyHtml`, and reproducing each format's markup in the
   * composer would be a second renderer to keep in step with the first.
   *
   * @param postId - Thread root the new post translates
   * @returns The post's markup, or "" when it cannot be fetched
   */
  private async _fetchTranslationPreview(postId: string): Promise<string> {
    try {
      const response = await fetch(
        publicPath(`/_/post-preview/${encodeURIComponent(postId)}`),
        { headers: { Accept: "text/html" }, credentials: "same-origin" },
      );
      if (!response.ok) return "";
      return await response.text();
    } catch {
      return "";
    }
  }

  /**
   * Start the translation in the shape of its original.
   *
   * A quote stays a quote — the format is a property of what was said, not of
   * the language it was said in — and the citation travels with it: the URL a
   * quote or a link points at is the same source whichever language describes
   * it. Collections, visibility and rating come along for the same reason:
   * they describe the post's place and its subject, neither of which changes
   * when the words do. The prose is the part the author is here to write, so
   * that is all that starts empty.
   *
   * Skipped the moment the author has typed anything: the fetch runs after the
   * composer opens, and overwriting their first sentence to save them a format
   * click is a bad trade.
   */
  private async _seedFromTranslationSource(
    post: ComposePostResponse,
  ): Promise<void> {
    if (this._hasContent() || this._editPostId || this._draftSourceId) return;

    const format = post.format;
    this._format = format;
    if (post.collectionIds?.length) {
      this._collectionIds = [...post.collectionIds];
    }
    if (post.visibility) this._visibility = post.visibility;
    await this.updateComplete;

    this._editor?.populate({
      format,
      url:
        format === "quote"
          ? (post.sourceUrl ?? undefined)
          : (post.url ?? undefined),
      quoteAuthor:
        format === "quote" ? (post.sourceName ?? undefined) : undefined,
      rating: post.rating ?? undefined,
    });
    await this.updateComplete;
    // The author has still typed nothing, so none of this counts as a change
    // they would be asked to discard on close.
    this._seededFromSource = true;
    this._captureInitialSnapshot();
  }

  /**
   * Plain text of the post being written, for the language suggestion.
   *
   * Read on demand rather than tracked: the panel is something the author
   * opens deliberately, so reading the editor at that moment is both cheaper
   * than watching every keystroke and more accurate than a cached value.
   */
  private _composeTextForDetection(): string {
    const editor = this._editor;
    if (!editor) return "";
    const data = editor.getData();
    const bodyText = data.body ? (extractBodyText(data.body) ?? "") : "";
    return [data.title, data.quoteText, bodyText].filter(Boolean).join(" ");
  }

  /**
   * The language of the page the composer opened from, as the automatic
   * choice's default. Falls back to the primary language when the page's
   * language is unknown or not one the site publishes.
   */
  private _contextLanguageTag(): string | null {
    const tags = this.languages.map((language) => language.tag);
    if (tags.length === 0) return null;
    return tags.includes(this.contextLanguage)
      ? this.contextLanguage
      : (tags[0] as string);
  }

  /**
   * What detection actually reads out of the text as it stands, or null when
   * the text does not say yet.
   *
   * Null is a distinct answer from "the page's language", and the "Detect" row
   * has to tell them apart: a row offering to read what you write cannot claim
   * to have read something out of two words. It also ignores an explicit
   * choice — the row describes what picking it would do, not what the author
   * picked instead.
   */
  private _readLanguage(): string | null {
    return readContentLanguage(this._composeTextForDetection(), {
      languages: this.languages.map((language) => language.tag),
    });
  }

  /** The language this post would be saved with if submitted right now. */
  private _effectiveLanguage(): string | null {
    return this._language ?? this._readLanguage() ?? this._contextLanguageTag();
  }

  private _renderLanguageRow(tag: string | null, label: string, hint: string) {
    const selected = this._language === tag;

    return html`
      <button
        type="button"
        class=${classMap({
          "compose-sheet-row": true,
          "compose-sheet-row-selected": selected,
        })}
        role="radio"
        aria-checked=${selected ? "true" : "false"}
        lang=${ifDefined(tag ?? undefined)}
        data-compose-language-row
        @click=${() => {
          this._language = tag;
          this._scheduleDraftSave();
          // Choosing is the whole job of this list, so it closes behind the
          // choice — the same as picking a visibility in the options sheet.
          this._closeLanguagePicker(true);
        }}
      >
        <span class="compose-sheet-main">
          <span class="compose-sheet-title">${label}</span>
          ${hint
            ? html`<span class="compose-sheet-sub">${hint}</span>`
            : nothing}
        </span>
        ${selected
          ? html`<span class="compose-sheet-check" aria-hidden="true">
              ${renderComposePublishActionIcon(
                COMPOSE_PUBLISH_ACTION_ICONS.check,
                "compose-sheet-check-icon",
              )}
            </span>`
          : nothing}
      </button>
    `;
  }

  private _closeLanguagePicker(restoreFocus = false) {
    if (!this._showLanguagePicker) return;
    this._showLanguagePicker = false;
    if (!restoreFocus) return;
    this.updateComplete.then(() => {
      this.querySelector<HTMLElement>(
        "[data-compose-language-trigger]",
      )?.focus();
    });
  }

  private _toggleLanguagePicker() {
    const nextOpen = !this._showLanguagePicker;
    if (!nextOpen) {
      this._closeLanguagePicker(true);
      return;
    }
    this._showCollection = false;
    this._collectionSearch = "";
    this._showPublishPanel = false;
    this._postMetaIndex = null;
    this._showLanguagePicker = true;
    this.updateComplete.then(() => {
      const rows = this.querySelectorAll<HTMLElement>(
        "[data-compose-language-row]",
      );
      const selected = Array.from(rows).find(
        (row) => row.getAttribute("aria-checked") === "true",
      );
      (selected ?? rows[0])?.focus();
    });
  }

  /**
   * The post's content language, offered only once the site publishes more
   * than one. A single-language author never meets this control — that is the
   * point of the whole feature being opt-in.
   *
   * It sits next to Post rather than inside the options sheet because it is
   * not a setting so much as a statement about what is being written: the pill
   * names the language this would publish in right now, so the answer is
   * visible before the button that makes it public, not two clicks behind it.
   *
   * It only *names* it when there is something to say, though. Writing from
   * /ja in Japanese, the globe alone is the whole message — the answer is the
   * page you are standing on. The name appears when the answer stops being
   * obvious: detection has moved it somewhere else, or the author has pinned
   * it themselves. So a language that changes under you announces itself by
   * growing a word, and one that never changes never speaks.
   *
   * Replies are excluded: a Thread is written in one language, and a reply
   * takes the root's server-side.
   */
  private _renderLanguageControl() {
    if (this._replyToId || this.languages.length < 2) return nothing;

    const effective = this._effectiveLanguage();
    const effectiveLabel =
      this.languages.find((language) => language.tag === effective)?.label ??
      "";
    const chosen = this._language !== null;
    const named = chosen || effective !== this._contextLanguageTag();
    const open = this._showLanguagePicker;
    const accessibleLabel = this.labels.languageTriggerLabel.replace(
      "{language}",
      effectiveLabel,
    );

    return html`
      <div
        class=${classMap({
          "compose-language": true,
          "compose-language-open": open,
        })}
      >
        ${open
          ? html`<div
              class="compose-dropdown-backdrop"
              @click=${() => this._closeLanguagePicker(true)}
            ></div>`
          : nothing}
        <button
          type="button"
          class=${classMap({
            "compose-language-trigger": true,
            "compose-language-trigger-bare": !named,
          })}
          data-compose-language-trigger
          data-open=${open ? "true" : nothing}
          data-chosen=${chosen ? "true" : nothing}
          ?disabled=${this._loading}
          aria-haspopup="dialog"
          aria-expanded=${open ? "true" : "false"}
          aria-label=${accessibleLabel}
          title=${accessibleLabel}
          @click=${() => this._toggleLanguagePicker()}
        >
          <svg
            class="compose-language-trigger-svg"
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.9"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            ${unsafeSVG(COMPOSE_LANGUAGE_ICON)}
          </svg>
          ${named
            ? html`<span
                class="compose-language-label"
                lang=${ifDefined(effective ?? undefined)}
                >${effectiveLabel}</span
              >`
            : nothing}
        </button>
        ${open ? this._renderLanguagePicker() : nothing}
      </div>
    `;
  }

  private _renderLanguagePicker() {
    const labelOf = (tag: string | null) =>
      this.languages.find((language) => language.tag === tag)?.label ?? "";
    // Two states, and the row has to be straight about which one it is in: it
    // has read a language, or it has not read one yet and the page's language
    // is standing in until it does.
    const read = this._readLanguage();
    const pendingLabel = labelOf(this._contextLanguageTag());
    const autoHint = read
      ? this.labels.languageAutoDetected.replace("{language}", labelOf(read))
      : pendingLabel
        ? this.labels.languageAutoPending.replace("{language}", pendingLabel)
        : this.labels.languageAutoHint;

    return html`
      <div
        class="compose-language-popover"
        role="dialog"
        aria-label=${this.labels.languageLabel}
      >
        <p class="compose-sheet-label">${this.labels.languageLabel}</p>
        ${this._translationOf
          ? html`<p class="compose-sheet-note">
              ${this.labels.translationOf.replace(
                "{title}",
                this._translationOf.title,
              )}
            </p>`
          : nothing}
        <div role="radiogroup" aria-label=${this.labels.languageLabel}>
          ${this._renderLanguageRow(null, this.labels.languageAuto, autoHint)}
          ${this.languages.map((language) =>
            this._renderLanguageRow(language.tag, language.label, ""),
          )}
        </div>
      </div>
    `;
  }

  /**
   * The label above a field, with its reset on the right. The reset only shows
   * once there is something to reset, so the default state is a bare label.
   */
  private _renderMetaFieldHead(label: string, reset: unknown) {
    return html`
      <div class="compose-meta-field-head">
        <span class="compose-meta-label">${label}</span>
        ${reset}
      </div>
    `;
  }

  /**
   * Chrome opens the calendar only from its own indicator glyph — a ~13px
   * target that reads as a browser default next to everything else in this
   * panel, and that other engines place differently or not at all. The
   * indicator is hidden in CSS and this button drives the same picker through
   * `showPicker()`, so there is one target, it is ours, and it is the height of
   * the field. Typing a date into the field still works either way, which is
   * why the button is the only thing that opens the picker: taking over the
   * whole field would put the calendar in front of anyone reaching for the
   * keyboard.
   */
  private _openDatePicker(index: number) {
    const fields = this.querySelectorAll<HTMLInputElement>(
      ".compose-publish-date-input",
    );
    // One panel is open at a time, so the panel's own field is the only one in
    // the DOM; `index` is kept for the thread case if that ever changes.
    const input = fields[index] ?? fields[0];
    if (!input) return;

    input.focus();
    try {
      input.showPicker();
    } catch {
      // Older engines, or a browser that declined: the field is still typable.
    }
  }

  private _renderPublishDateSection(index: number) {
    const publishedAtError = this._getPostPublishedAtValidationMessage(index);
    const hasValue = this._hasPostPublishedAtValue(index);

    return html`
      <div class="compose-meta-field compose-publish-date-field">
        ${this._renderMetaFieldHead(
          this.labels.publishDateLabel,
          hasValue
            ? html`<button
                type="button"
                class="compose-publish-section-action"
                @click=${() => this._resetPublishedAt(index)}
              >
                ${this.labels.publishDateReset}
              </button>`
            : nothing,
        )}
        <div class="compose-publish-date-input-wrap">
          <input
            type="date"
            class=${classMap({
              "compose-input": true,
              "compose-publish-date-input": true,
              // The browser draws `yyyy-mm-dd` in the value's own colour, so an
              // empty field reads as a date that has been set. Dim it instead.
              "compose-publish-date-input-empty": !hasValue,
            })}
            .value=${this._getPostPublishedAtInput(index)}
            max=${this._getPublishedAtMaxInput()}
            aria-label=${this.labels.publishDateLabel}
            aria-invalid=${publishedAtError ? "true" : "false"}
            @input=${(e: Event) =>
              this._setPostPublishedAtInput(
                index,
                (e.target as HTMLInputElement).value,
              )}
          />
          <button
            type="button"
            class="compose-publish-date-picker"
            aria-label=${this.labels.publishDateSummaryAction}
            data-compose-date-picker
            @click=${() => this._openDatePicker(index)}
          >
            ${renderComposePublishActionIcon(
              COMPOSE_PUBLISH_ACTION_ICONS.calendar,
              "compose-publish-date-picker-icon",
            )}
          </button>
        </div>
        ${publishedAtError
          ? html`<p
              class="compose-publish-date-status compose-publish-date-status-error"
            >
              ${publishedAtError}
            </p>`
          : hasValue
            ? nothing
            : html`<p class="compose-sheet-hint">
                ${this.labels.publishDateHint}
              </p>`}
      </div>
    `;
  }

  private _renderPublishSlugSection(index: number) {
    const isRoot = index === 0;
    const slugError = this._getPostSlugValidationMessage(index);
    const slugStatus = isRoot ? this._getSlugStatusMessage() : slugError;
    const slugPreview = isRoot ? this._getSlugPreviewParts() : null;
    // Suggestions come from the title, which replies do not have.
    const showSuggestion =
      isRoot &&
      !this._hasManualSlug() &&
      !this._suggestedSlugLoading &&
      Boolean(this._suggestedSlug);

    return html`
      <div class="compose-meta-field compose-publish-slug-field">
        ${this._renderMetaFieldHead(
          this.labels.publishSlugLabel,
          this._hasManualSlug()
            ? html`<button
                type="button"
                class="compose-publish-section-action"
                @click=${() => this._resetCustomSlug()}
              >
                ${this.labels.publishSlugReset}
              </button>`
            : nothing,
        )}
        <div class="compose-publish-slug-input-wrap">
          <span class="compose-publish-slug-prefix" aria-hidden="true">/</span>
          <input
            type="text"
            class="compose-input compose-publish-slug-input"
            .value=${this._getPostSlug(index)}
            placeholder=${this.labels.publishSlugPlaceholder}
            aria-label=${this.labels.publishSlugLabel}
            aria-invalid=${slugError ? "true" : "false"}
            spellcheck="false"
            autocapitalize="off"
            autocomplete="off"
            @input=${(e: Event) => this._onSlugInput(e, index)}
          />
        </div>
        ${showSuggestion
          ? html`
              <button
                type="button"
                class="compose-slug-suggestion"
                @click=${() => this._useSuggestedSlug()}
              >
                <span class="compose-slug-suggestion-label"
                  >${this.labels.publishSlugSuggested}</span
                >
                <span class="compose-slug-suggestion-value"
                  >/${this._suggestedSlug}</span
                >
                <span class="compose-slug-suggestion-icon" aria-hidden="true">
                  <svg
                    width="13"
                    height="13"
                    viewBox="0 0 14 14"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.4"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  >
                    <path d="M3 7h8" />
                    <path d="m8 3 4 4-4 4" />
                  </svg>
                </span>
              </button>
            `
          : nothing}
        ${slugStatus
          ? html`<p
              class=${classMap({
                "compose-publish-slug-status": true,
                "compose-publish-slug-status-error": Boolean(slugError),
              })}
              data-compose-slug-error=${slugError ? "true" : nothing}
            >
              ${slugStatus}
            </p>`
          : slugPreview
            ? html`<p
                class="compose-publish-slug-preview"
                data-compose-slug-preview
                title=${slugPreview.full}
              >
                <span class="compose-publish-slug-preview-origin"
                  >${slugPreview.origin}</span
                ><span class="compose-publish-slug-preview-path"
                  >${slugPreview.path}</span
                >
              </p>`
            : this._hasPostManualSlug(index)
              ? nothing
              : html`<p class="compose-sheet-hint">
                  ${this.labels.publishSlugHint}
                </p>`}
      </div>
    `;
  }

  /**
   * Replying quietly is an instruction for the moment a reply is written: the
   * server's only job is to skip the thread-activity bump it would otherwise
   * do on create. Saving an existing post goes through the update path, which
   * has no such bump to skip and no way to carry the intent — so the switch is
   * not offered there rather than sitting dead. A thread draft is the one
   * exception: saving it deletes and recreates every post, so the flag lands.
   */
  private _canReplyQuietly(): boolean {
    if (!this._replyToId) return false;
    const editsExistingPost = !!(this._editPostId || this._draftSourceId);
    return !editsExistingPost || this._threadItems.length >= 2;
  }

  private _renderQuietReplySection() {
    if (!this._canReplyQuietly()) return nothing;

    return html`
      <label class="compose-sheet-row compose-sheet-row-switch">
        <span class="compose-sheet-main">
          <span class="compose-sheet-title"
            >${this.labels.quietReplyLabel}</span
          >
          <span class="compose-sheet-sub">${this.labels.quietReplyHint}</span>
        </span>
        <input
          type="checkbox"
          role="switch"
          class="input"
          .checked=${this._quietReply}
          @change=${(e: Event) => {
            this._quietReply = (e.target as HTMLInputElement).checked;
          }}
        />
      </label>
    `;
  }

  /**
   * Value shown on the collapsed "Published on" row. Always reflects the
   * current date — unlike the old summary chip, which deliberately stayed
   * silent when nothing had changed.
   */
  private _getPublishedAtRowValue(): string {
    const parsed = parseLocalDateInputValue(this._publishedAtInput);
    if (parsed === null) return this.labels.publishDateSummaryNow;

    return new Intl.DateTimeFormat(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    }).format(new Date(parsed.year, parsed.monthIndex, parsed.day));
  }

  /** Value shown on the collapsed "Custom link" row. */
  private _getPostSlugRowValue(index: number): string {
    const slug = this._getPostSlug(index).trim();
    return slug ? `/${slug}` : this.labels.publishSlugSummaryAuto;
  }

  /* ── Per-post publish date ───────────────────────────────────────────
     Only the root carries a permalink control: a reply's slug is a random id
     assigned at publish time, and overriding it is not a thing people do. The
     date is — backfilling an old thread is the whole reason this exists. */

  private _getPostSlug(index: number): string {
    if (index === 0) return this._slug;
    return this._threadItems[index]?.slug ?? "";
  }

  private _setPostSlug(index: number, value: string) {
    if (index === 0) {
      this._slug = value;
      return;
    }
    this._threadItems = this._threadItems.map((item, i) =>
      i === index ? { ...item, slug: value } : item,
    );
  }

  private _setPostSlugTaken(index: number, taken: boolean) {
    if (index === 0) {
      this._slugTaken = taken;
      return;
    }
    this._threadItems = this._threadItems.map((item, i) =>
      i === index ? { ...item, slugTaken: taken } : item,
    );
  }

  private _hasPostManualSlug(index: number): boolean {
    return this._getPostSlug(index).trim().length > 0;
  }

  private _getPostSlugSyncValidationMessage(index: number): string | null {
    const issue = getSlugValidationIssue(this._getPostSlug(index));
    if (issue === "invalid") return this.labels.publishSlugInvalid;
    if (issue === "reserved") return this.labels.publishSlugReserved;
    return null;
  }

  private _getPostSlugValidationMessage(index: number): string | null {
    const sync = this._getPostSlugSyncValidationMessage(index);
    if (sync) return sync;
    const taken =
      index === 0 ? this._slugTaken : this._threadItems[index]?.slugTaken;
    if (this._hasPostManualSlug(index) && taken) {
      return this.labels.publishSlugTaken;
    }
    return null;
  }

  private _getPostPublishedAtInput(index: number): string {
    if (index === 0) return this._publishedAtInput;
    return this._threadItems[index]?.publishedAtInput ?? "";
  }

  private _setPostPublishedAtInput(index: number, value: string) {
    if (index === 0) {
      this._publishedAtInput = value;
      return;
    }
    this._threadItems = this._threadItems.map((item, i) =>
      i === index ? { ...item, publishedAtInput: value } : item,
    );
  }

  private _setPostPublishedAtTimeMinutes(index: number, value: number | null) {
    if (index === 0) {
      this._publishedAtTimeMinutes = value;
      return;
    }
    this._threadItems = this._threadItems.map((item, i) =>
      i === index ? { ...item, publishedAtTimeMinutes: value } : item,
    );
  }

  private _hasPostPublishedAtValue(index: number): boolean {
    return this._getPostPublishedAtInput(index).trim().length > 0;
  }

  /** Same rules as the root's, applied to any post in the thread. */
  private _getPostPublishedAtValidationMessage(index: number): string | null {
    const input = this._getPostPublishedAtInput(index);
    if (!input.trim()) return null;
    if (parseLocalDateInputValue(input) === null) {
      return this.labels.publishDateInvalid;
    }
    if (input > this._getPublishedAtMaxInput()) {
      return this.labels.publishDateFutureError;
    }
    return null;
  }

  private _getPostPublishedAtRowValue(index: number): string {
    const parsed = parseLocalDateInputValue(
      this._getPostPublishedAtInput(index),
    );
    if (parsed !== null) {
      return new Intl.DateTimeFormat(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
      }).format(new Date(parsed.year, parsed.monthIndex, parsed.day));
    }
    // A reply with no date of its own inherits the root's — say so rather than
    // implying it publishes "now" independently.
    if (index > 0 && this._hasPublishedAtValue()) {
      return this._getPublishedAtRowValue();
    }
    return this.labels.publishDateSummaryNow;
  }

  /**
   * Date (and, on the root, permalink) describe one post, so they live on that
   * post rather than in the publish panel, which speaks for the whole
   * submission. The control stays quiet until the post is hovered, focused, or
   * carries a non-default value.
   */
  private _renderPostMetaControl(index: number) {
    if (this._openingEdit) return nothing;

    const isRoot = index === 0;
    const open = this._postMetaIndex === index;
    const custom =
      this._hasPostPublishedAtValue(index) || this._hasPostManualSlug(index);

    return html`
      <div
        class=${classMap({
          "compose-post-meta": true,
          "compose-post-meta-set": custom,
          "compose-post-meta-open": open,
        })}
      >
        ${open
          ? html`<div
              class="compose-dropdown-backdrop"
              @click=${() => this._closePostMeta()}
            ></div>`
          : nothing}
        <button
          type="button"
          class="compose-post-meta-pill"
          aria-haspopup="dialog"
          aria-expanded=${open ? "true" : "false"}
          data-compose-post-meta-pill
          data-post-index=${index}
          @click=${() => {
            if (open) return this._closePostMeta();
            this._showPublishPanel = false;
            this._showCollection = false;
            this._showLanguagePicker = false;
            this._postMetaIndex = index;
            if (isRoot) this._scheduleSuggestedSlugRefresh(true);
            // Focus the panel, not its first field: a focused `type="date"`
            // opens with its year segment highlighted in the OS accent colour,
            // which Chrome will not let us restyle. Tab reaches the fields.
            this._placeAndFocusPostMetaPanel();
          }}
        >
          ${renderComposePublishActionIcon(
            COMPOSE_PUBLISH_ACTION_ICONS.calendar,
            "compose-post-meta-icon",
          )}
          <span class="compose-post-meta-value"
            >${this._getPostPublishedAtRowValue(index)}</span
          >
          <span class="compose-post-meta-sep" aria-hidden="true">·</span>
          <!-- No link icon: the permalink already renders with its leading
               slash, and two icons in a control this quiet read as clutter. -->
          <span class="compose-post-meta-value compose-post-meta-value-slug"
            >${this._getPostSlugRowValue(index)}</span
          >
        </button>
        ${open
          ? html`<div
              class="compose-post-meta-panel"
              role="dialog"
              aria-label=${this.labels.publishSettings}
              tabindex="-1"
              data-compose-post-meta-panel
            >
              ${this._renderPublishDateSection(index)}
              ${this._renderPublishSlugSection(index)}
              <div class="compose-post-meta-footer">
                <button
                  type="button"
                  class="compose-publish-done"
                  data-compose-post-meta-done
                  @click=${() => this._closePostMeta()}
                >
                  ${this.labels.done}
                </button>
              </div>
            </div>`
          : nothing}
      </div>
    `;
  }

  /**
   * Places the just-opened date/permalink panel, then puts focus in it.
   *
   * Both wait on `updateComplete` because the panel is not ours to render: it
   * is handed to the post's editor row as `headerExtra`, so it only reaches the
   * DOM on the editor's own update, one below this one. Focus is `preventScroll`
   * — the panel is already pinned where it should be, and without it the browser
   * scrolls `.compose-scroll` to "reveal" a panel that is not in that box,
   * taking the format switcher off the top of the composer with it.
   */
  private _placeAndFocusPostMetaPanel(focusSelector?: string) {
    this.updateComplete.then(() => {
      this._updatePostMetaPanelLayout();
      this.querySelector<HTMLElement>(
        focusSelector ?? "[data-compose-post-meta-panel]",
      )?.focus({ preventScroll: true });
    });
  }

  /**
   * Pins the open date/permalink panel under the pill it belongs to.
   *
   * The pill sits inside `.compose-scroll`, and that box scrolls: an absolutely
   * positioned panel is clipped by it, and an empty post makes the box shorter
   * than the panel every time, so the whole footer — Done included — used to be
   * cut off. `position: fixed` takes the panel out of the scroller, which hands
   * the coordinates to us.
   *
   * They are not viewport coordinates. The dialog's open animation leaves a
   * transform behind, and a transformed ancestor becomes the containing block
   * for `fixed` descendants — so the panel is parked at 0,0 first and the rect
   * that comes back is the origin everything else is measured from. Reading it
   * beats naming the ancestor: the page-mode composer has no dialog at all.
   */
  private _updatePostMetaPanelLayout() {
    const index = this._postMetaIndex;
    if (index === null) return;

    const panel = this.querySelector<HTMLElement>(
      "[data-compose-post-meta-panel]",
    );
    const pill = this.querySelector<HTMLElement>(
      `[data-compose-post-meta-pill][data-post-index="${index}"]`,
    );
    if (!panel || !pill) return;

    const visualViewport = globalThis.visualViewport;
    const viewportTop = visualViewport?.offsetTop ?? 0;
    const viewportLeft = visualViewport?.offsetLeft ?? 0;
    const viewportBottom =
      viewportTop + (visualViewport?.height ?? globalThis.innerHeight);
    const viewportRight =
      viewportLeft + (visualViewport?.width ?? globalThis.innerWidth);
    const edgePadding = 12;
    const gap = 6;

    // Same rule as the publish panel: open into whichever side has more room,
    // and cap the panel at what that side actually offers so a short window
    // scrolls the panel's own body instead of hiding its footer.
    const pillRect = pill.getBoundingClientRect();
    const availableAbove = Math.max(
      0,
      pillRect.top - (viewportTop + edgePadding) - gap,
    );
    const availableBelow = Math.max(
      0,
      viewportBottom - edgePadding - pillRect.bottom - gap,
    );
    const direction = availableBelow >= availableAbove ? "down" : "up";
    const maxHeight = Math.max(
      1,
      Math.floor(direction === "up" ? availableAbove : availableBelow),
    );

    panel.style.top = "0px";
    panel.style.left = "0px";
    const origin = panel.getBoundingClientRect();
    // The dialog opens with a `scale(0.97)` animation, so for a third of a
    // second every measured rect is smaller than the box it describes while the
    // offsets we write are not. `offsetWidth` is the same box before the
    // transform, so their ratio is the scale to divide back out.
    const scale = origin.width / (panel.offsetWidth || origin.width || 1) || 1;

    panel.style.setProperty(
      "--compose-post-meta-panel-max-height",
      `${maxHeight / scale}px`,
    );
    // Read back rather than reuse `origin.height`: the cap above is what
    // decides how tall the panel actually is, and a panel opening upwards is
    // placed from its own bottom edge.
    const height = panel.offsetHeight * scale;

    const top =
      direction === "down"
        ? pillRect.bottom + gap
        : pillRect.top - gap - height;
    // Right-aligned to the pill, which is itself flush with the composer's
    // right edge — then held inside the viewport, since a narrow screen can
    // put the panel's left edge past it.
    const left = Math.min(
      Math.max(pillRect.right - origin.width, viewportLeft + edgePadding),
      Math.max(viewportRight - edgePadding - origin.width, viewportLeft),
    );

    panel.style.top = `${(top - origin.top) / scale}px`;
    panel.style.left = `${(left - origin.left) / scale}px`;
  }

  /**
   * Hands focus back to the post the panel belongs to. The panel takes focus
   * when it opens, so without this the closing panel takes the focus with it as
   * it leaves the DOM: focus lands on `<body>`, the editor loses
   * `:focus-within`, and on a wide screen the pill — quiet until hovered or
   * focused — fades out from under the pointer. It also leaves the compose
   * element entirely, which matters more: the `keydown` listener is bound to
   * this component, so Escape would stop closing compose afterwards.
   */
  private _closePostMeta() {
    const index = this._postMetaIndex;
    if (index === null) return;

    const heldFocus =
      this.querySelector("[data-compose-post-meta-panel]")?.contains(
        document.activeElement,
      ) ?? false;
    this._postMetaIndex = null;
    if (!heldFocus) return;

    this.updateComplete.then(() => {
      const editors = this.querySelectorAll<JantComposeEditor>(
        "jant-compose-editor",
      );
      (editors[index] ?? editors[0])?.focusInput();
    });
  }

  /**
   * Whether the settings panel would have anything in it.
   *
   * Asks the row renderers instead of restating their conditions, so it cannot
   * drift out of sync with what the panel actually shows — the same reason
   * `_renderQuickActionsRow` inspects its children rather than recomputing
   * them. Editing a thread reply empties every row (visibility belongs to the
   * root, the draft rows only apply to unsaved posts), and an Options button
   * that opens a blank sheet is worse than no button.
   */
  private _hasPublishPanelContent(): boolean {
    if (!this._visibilityLocked) return true;
    if (this._replyToId && this._renderQuietReplySection() !== nothing) {
      return true;
    }
    return (
      this._renderSaveDraftRow() !== nothing ||
      this._renderDraftsRow() !== nothing
    );
  }

  /**
   * A vertical list, not a toolbar: grouped by a muted label, one row per
   * setting, value or control on the right.
   */
  private _renderPublishPanelSections() {
    const divider = html`<div
      class="compose-sheet-divider"
      aria-hidden="true"
    ></div>`;
    const saveDraftRow = this._renderSaveDraftRow();
    const draftsRow = this._renderDraftsRow();
    const hasSessionRows = saveDraftRow !== nothing || draftsRow !== nothing;

    return html`
      <div class="compose-sheet">
        ${this._visibilityLocked
          ? nothing
          : html`
              <p class="compose-sheet-label">
                ${this.labels.publishVisibilityLabel}
              </p>
              <div
                role="radiogroup"
                aria-label=${this.labels.publishVisibilityLabel}
              >
                ${this._renderVisibilityRow(
                  "public",
                  this.labels.publishVisibilityPublic,
                  this.labels.publishVisibilityPublicHint,
                )}
                ${this._renderVisibilityRow(
                  "latest_hidden",
                  this.labels.publishVisibilityHiddenFromLatest,
                  this.labels.publishVisibilityHiddenFromLatestHint,
                )}
                ${this._renderVisibilityRow(
                  "private",
                  this.labels.publishVisibilityPrivate,
                  this.labels.publishVisibilityPrivateHint,
                )}
              </div>
            `}
        ${this._replyToId
          ? html`${this._visibilityLocked ? nothing : divider}
            ${this._renderQuietReplySection()}`
          : nothing}
        ${hasSessionRows
          ? html`${divider} ${saveDraftRow} ${draftsRow}`
          : nothing}
      </div>
    `;
  }

  /**
   * "Save as draft" is an action on what is in front of you; "Drafts" is a
   * place to go. One row cannot be both, which is what the old title-bar button
   * tried to do: it read "Save as draft" and then dropped you in the list. Once
   * there is something to save, both are offered and each does one thing.
   */
  private _renderSaveDraftRow() {
    if (this._editPostId || !this._hasWorkToLose()) return nothing;

    return html`
      <button
        type="button"
        class="compose-sheet-row"
        ?disabled=${this._loading}
        @click=${() => {
          this._closePublishPanel(false);
          void this._submit("draft");
        }}
      >
        ${renderComposeSheetRowIcon(COMPOSE_SHEET_ROW_ICONS.saveDraft)}
        <span class="compose-sheet-main">
          <span class="compose-sheet-title">${this.labels.saveAsDraft}</span>
        </span>
      </button>
    `;
  }

  /**
   * Drafts moved off the title bar and in here when that bar went away. It is
   * the rarer of the two things the bar held — a session action, not part of
   * writing — so it belongs behind the same trigger as the rest of them.
   *
   * Leaving unsaved work behind still asks first, but that prompt is now the
   * fallback rather than the only path: `_renderSaveDraftRow` is sitting right
   * above it for anyone who already knows what they want.
   */
  private _renderDraftsRow() {
    if (this._editPostId) return nothing;

    return html`
      <button
        type="button"
        class="compose-sheet-row"
        ?disabled=${this._loading}
        @click=${() => {
          this._closePublishPanel(false);
          this._handleDraftButtonClick();
        }}
      >
        ${renderComposeSheetRowIcon(COMPOSE_SHEET_ROW_ICONS.drafts)}
        <span class="compose-sheet-main">
          <span class="compose-sheet-title">${this.labels.drafts}</span>
        </span>
        ${renderComposePublishActionIcon(
          COMPOSE_PUBLISH_ACTION_ICONS.caretRight,
          "compose-sheet-caret",
        )}
      </button>
    `;
  }

  /**
   * A thread's posts each spend their × on removing themselves, so the exit
   * cannot live in a post header there — and a phone has no Escape key and no
   * backdrop to tap, so it has to be visible somewhere.
   *
   * It goes at the near edge of the quick actions row, the strip that already
   * carries thread-wide switches: leaving is thread-wide too, and the row's
   * near half was empty. Diagonally opposite Publish, and in the muted weight
   * of the switches beside it rather than Publish's — an exit should neither
   * compete with the thing it is an exit from nor sit next to it.
   *
   * The word is "Close", not "Cancel": leaving may keep the work as a draft, so
   * nothing is cancelled, and a thread puts N posts on screen that each own a ×
   * — "Cancel" would not say which of them it meant. It also keeps this out of
   * a Cancel/Post pair, which would read as Publish's peer rather than the
   * quiet way out. Same word as the single-post ×, which is the same action.
   *
   * It routes through `requestClose`, so unsaved work still gets the "Save to
   * drafts?" prompt.
   *
   * Page mode sits this out for the same reason the × does: the page's own
   * Back link is the exit there, and it already routes through the same
   * prompt. The row would be the wrong place to argue otherwise — page mode
   * pins the action row to the viewport bottom and leaves this strip below it.
   */
  private _renderCloseComposeQuickAction() {
    if (this.pageMode || this._threadItems.length === 0) return nothing;

    return html`
      <button
        type="button"
        class="compose-quick-actions-close"
        ?disabled=${this._loading}
        @click=${() => this.requestClose()}
      >
        ${this.labels.close}
      </button>
    `;
  }

  private _renderDesktopPublishPanel() {
    if (!this._showPublishPanel || this._publishPanelFullscreen) {
      return nothing;
    }

    return html`
      <div
        class="compose-publish-panel compose-publish-panel-desktop"
        role="dialog"
        aria-label=${this.labels.publishSettings}
        data-position="up"
        data-compose-publish-panel
        data-compose-publish-panel-desktop
      >
        ${this._renderPublishPanelSections()}
      </div>
    `;
  }

  private _renderMobilePublishPanel() {
    if (!this._showPublishPanel || !this._publishPanelFullscreen) {
      return nothing;
    }

    return html`
      <div
        class="compose-publish-panel compose-publish-panel-mobile"
        role="dialog"
        aria-label=${this.labels.publishSettings}
        aria-modal="true"
        data-compose-publish-panel
        data-compose-publish-panel-mobile
      >
        <div class="compose-alt-header compose-publish-mobile-header">
          <button
            type="button"
            class="compose-attached-panel-back"
            @click=${() => this._closePublishPanel(true)}
          >
            <svg
              class="icon-fine"
              width="16"
              height="16"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              stroke-width="1.5"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="M11 3L6 8l5 5" />
            </svg>
          </button>
          <span class="compose-alt-title">${this.labels.publishSettings}</span>
          <button
            type="button"
            class="compose-attached-cancel compose-publish-mobile-done"
            @click=${() => this._closePublishPanel(true)}
          >
            ${this.labels.done}
          </button>
        </div>
        <div class="compose-publish-mobile-body">
          ${this._renderPublishPanelSections()}
        </div>
      </div>
    `;
  }

  private _updatePublishPanelLayout() {
    if (this._publishPanelFullscreen) return;

    const publishGroup = this.querySelector<HTMLElement>(
      ".compose-publish-group",
    );
    const panel = this.querySelector<HTMLElement>(
      "[data-compose-publish-panel-desktop]",
    );
    if (!publishGroup || !panel) return;

    const visualViewport = globalThis.visualViewport;
    const viewportTop = visualViewport?.offsetTop ?? 0;
    const viewportBottom =
      viewportTop + (visualViewport?.height ?? globalThis.innerHeight);
    const groupRect = publishGroup.getBoundingClientRect();
    const edgePadding = 12;
    const gap = 10;
    const topBoundary = viewportTop + edgePadding;
    const bottomBoundary = viewportBottom - edgePadding;
    const availableAbove = Math.max(0, groupRect.top - topBoundary - gap);
    const availableBelow = Math.max(0, bottomBoundary - groupRect.bottom - gap);
    const direction = availableBelow >= availableAbove ? "down" : "up";
    const maxHeight = Math.max(
      1,
      Math.floor(direction === "up" ? availableAbove : availableBelow),
    );

    panel.dataset.position = direction;
    panel.style.setProperty(
      "--compose-publish-panel-max-height",
      `${maxHeight}px`,
    );
  }

  private _renderPublishButton() {
    const spinner = html`<svg
      class="animate-spin size-4"
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      role="status"
    >
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </svg>`;
    const canPublish = this._canPublish();

    return html`
      <div class="compose-publish-shell">
        <div
          class=${classMap({
            "compose-publish-group": true,
            "compose-publish-group-open": this._showPublishPanel,
          })}
        >
          ${this._showPublishPanel && !this._publishPanelFullscreen
            ? html`<div
                class="compose-dropdown-backdrop"
                @click=${() => this._closePublishPanel(true)}
              ></div>`
            : nothing}
          <div
            role="group"
            class=${classMap({
              "compose-publish-buttons": true,
              "compose-publish-buttons-inactive": !canPublish && !this._loading,
            })}
          >
            <button
              type="button"
              class=${classMap({
                "compose-publish-main": true,
                "compose-publish-main-loading": this._loading,
              })}
              ?disabled=${!canPublish}
              @click=${() => void this._submit("published")}
            >
              ${this._loading ? spinner : nothing} ${this._getSubmitLabel()}
            </button>
          </div>
          <!-- Options sits past Publish as its own control rather than a
               chevron welded to it: a split button reads as one button, which
               is why nobody found the settings. -->
          ${this._hasPublishPanelContent()
            ? html`<button
                type="button"
                class=${classMap({
                  "compose-options-trigger": true,
                  "compose-options-trigger-open": this._showPublishPanel,
                })}
                ?disabled=${this._loading}
                aria-haspopup="dialog"
                aria-expanded=${this._showPublishPanel ? "true" : "false"}
                aria-label=${this.labels.publishSettings}
                title=${this.labels.publishSettings}
                @click=${() => this._togglePublishPanel()}
              >
                <svg
                  class="compose-options-trigger-icon"
                  width="22"
                  height="22"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  aria-hidden="true"
                >
                  ${unsafeSVG(COMPOSE_PUBLISH_ACTION_ICONS.options)}
                </svg>
              </button>`
            : nothing}
          ${this._renderDesktopPublishPanel()}
        </div>
      </div>
    `;
  }

  /**
   * Shortcuts for the two settings that get reached for constantly, sitting
   * under Publish where they can be flipped without opening the panel. Both are
   * mirrors of a row inside it, not a second source of truth.
   */
  private _renderQuickActionsRow() {
    const close = this._renderCloseComposeQuickAction();
    const hideFromLatest = this._renderHideFromLatestQuickToggle();
    const quietReply = this._renderQuietReplyQuickToggle();
    if (
      close === nothing &&
      hideFromLatest === nothing &&
      quietReply === nothing
    ) {
      return nothing;
    }
    return html`
      <div class="compose-quick-actions-row">
        ${close} ${hideFromLatest} ${quietReply}
      </div>
    `;
  }

  private _renderQuietReplyQuickToggle() {
    if (!this._canReplyQuietly()) return nothing;
    return html`
      <label class="compose-publish-quick-toggle">
        <input
          type="checkbox"
          class="input compose-publish-quick-toggle-input"
          .checked=${this._quietReply}
          ?disabled=${this._loading}
          @change=${(e: Event) => {
            this._quietReply = (e.target as HTMLInputElement).checked;
          }}
        />
        <span>${this.labels.quietReplyLabel}</span>
      </label>
    `;
  }

  /**
   * Visibility has three states, so a checkbox cannot speak for all of them: it
   * covers the public ↔ hidden-from-Latest pair and steps aside once the post
   * is private, where the panel's radio list is the only honest control.
   */
  private _renderHideFromLatestQuickToggle() {
    if (this._visibilityLocked) return nothing;
    if (this._visibility === "private") return nothing;

    const checked = this._visibility === "latest_hidden";
    return html`
      <label class="compose-publish-quick-toggle">
        <input
          type="checkbox"
          class="input compose-publish-quick-toggle-input"
          .checked=${checked}
          ?disabled=${this._loading}
          @change=${(e: Event) => {
            const target = e.target as HTMLInputElement;
            this._setVisibility(target.checked ? "latest_hidden" : "public");
          }}
        />
        <span>${this.labels.publishHideFromLatest}</span>
      </label>
    `;
  }

  private _renderEditLoadingState() {
    return html`
      <div
        class="compose-edit-loading"
        role="status"
        aria-live="polite"
        aria-busy="true"
      >
        <!-- The post header this normally rides on has not rendered yet, so the
             close control gets its own row rather than leaving a fetch with no
             way out on a phone, where there is no Escape key. -->
        <div class="compose-edit-loading-close">
          ${this._renderCloseComposeControl()}
        </div>
        <div class="compose-edit-loading-status">
          <svg
            class="animate-spin size-5"
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <path d="M21 12a9 9 0 1 1-6.219-8.56" />
          </svg>
          <span>${this.labels.loadingPost}</span>
        </div>
        <div class="compose-edit-loading-skeleton">
          <div class="skel-input compose-edit-loading-title"></div>
          <div class="skel-section-lg compose-edit-loading-body"></div>
          <div class="compose-edit-loading-footer">
            <div class="skel-input compose-edit-loading-chip"></div>
            <div class="skel-input compose-edit-loading-submit"></div>
          </div>
        </div>
      </div>
    `;
  }

  // ── Thread compose ───────────────────────────────────────────────

  private _addThreadItem() {
    const nextCount =
      this._threadItems.length === 0 ? 2 : this._threadItems.length + 1;
    if (nextCount > MAX_THREAD_POSTS) {
      showToast(this._getThreadLimitMessage(), "error");
      return;
    }

    const lastFormat =
      this._threadItems.length > 0
        ? this._threadItems[this._threadItems.length - 1].format
        : this._format;

    if (this._threadItems.length === 0) {
      // Entering thread mode: snapshot current single editor's state
      const currentEditor = this._editor;
      const editorState = currentEditor?.getEditorState() ?? null;
      const editorData = currentEditor?.getData();
      const bodyJson = currentEditor?.getNormalizedBodyJson() ?? null;

      this._threadItems = [
        { id: randomUUID(), format: this._format },
        { id: randomUUID(), format: lastFormat },
      ];

      // Capture rating state before re-render (these can't change asynchronously)
      const capturedRating = currentEditor?._rating ?? 0;
      const capturedShowRating = currentEditor?._showRating ?? false;

      // Restore first thread item's content from the snapshot
      if (editorState || editorData) {
        this.updateComplete.then(() => {
          const editors = this.querySelectorAll<JantComposeEditor>(
            "jant-compose-editor",
          );
          const firstEditor = editors[0];
          if (!firstEditor) return;
          if (editorState) {
            firstEditor.setEditorState(
              editorState.json,
              editorState.title,
              editorState.showTitle,
              editorState.selection,
            );
          }
          if (editorData) {
            if (this._format === "link" && editorData.url) {
              firstEditor._url = editorData.url;
            } else if (this._format === "quote") {
              if (editorData.quoteText)
                firstEditor._quoteText = editorData.quoteText;
              if (editorData.quoteAuthor)
                firstEditor._quoteAuthor = editorData.quoteAuthor;
            }
            if (bodyJson) {
              firstEditor._bodyJson = bodyJson;
            }
          }
          // Read attachment state from the old editor NOW (after re-render) so
          // we get the latest mediaId for any uploads that completed during the
          // render cycle. The old editor element is still in memory even though
          // it has been removed from the DOM.
          const latestAttachments = currentEditor?._attachments ?? [];
          const latestAttachmentOrder = currentEditor?._attachmentOrder ?? [];
          const latestAttachedTexts = currentEditor?._attachedTexts ?? [];
          if (latestAttachments.length > 0) {
            firstEditor._attachments = [...latestAttachments];
            firstEditor._attachmentOrder = [...latestAttachmentOrder];
          }
          if (latestAttachedTexts.length > 0) {
            firstEditor._attachedTexts = [...latestAttachedTexts];
          }
          if (capturedRating > 0) {
            firstEditor._rating = capturedRating;
            firstEditor._showRating = capturedShowRating;
          }
        });
      }
    } else {
      this._threadItems = [
        ...this._threadItems,
        { id: randomUUID(), format: lastFormat },
      ];
    }

    this._focusedThreadIndex = this._threadItems.length - 1;
    this.updateComplete.then(() => {
      const editors = this.querySelectorAll<JantComposeEditor>(
        "jant-compose-editor",
      );
      editors[this._focusedThreadIndex]?.focusInput();
      const scroller = this.querySelector<HTMLElement>(".compose-scroll");
      if (scroller) {
        scroller.scrollTop = scroller.scrollHeight;
      }
    });
  }

  private _removeThreadItem(index: number) {
    if (this._threadItems.length <= 1) return;
    const newItems = this._threadItems.filter((_, i) => i !== index);

    if (newItems.length === 1) {
      // Exiting thread mode: capture remaining thread editor's state and restore
      // it to the single-post editor after thread mode is cleared.
      const editors = this.querySelectorAll<JantComposeEditor>(
        "jant-compose-editor",
      );
      const remainingIndex = index === 0 ? 1 : 0;
      const remainingEditor = editors[remainingIndex] ?? null;
      const editorState = remainingEditor?.getEditorState() ?? null;
      const editorData = remainingEditor?.getData();
      const bodyJson = remainingEditor?.getNormalizedBodyJson() ?? null;
      const remainingFormat = newItems[0].format;
      // Capture rating state before re-render (can't change asynchronously)
      const capturedRating = remainingEditor?._rating ?? 0;
      const capturedShowRating = remainingEditor?._showRating ?? false;

      this._threadItems = [];
      this._focusedThreadIndex = 0;
      this._format = remainingFormat;

      this.updateComplete.then(() => {
        const singleEditor = this._editor;
        if (!singleEditor) return;
        singleEditor.format = remainingFormat;
        if (editorState) {
          singleEditor.setEditorState(
            editorState.json,
            editorState.title,
            editorState.showTitle,
            editorState.selection,
          );
        }
        if (editorData) {
          if (remainingFormat === "link" && editorData.url) {
            singleEditor._url = editorData.url;
          } else if (remainingFormat === "quote") {
            if (editorData.quoteText)
              singleEditor._quoteText = editorData.quoteText;
            if (editorData.quoteAuthor)
              singleEditor._quoteAuthor = editorData.quoteAuthor;
          }
          if (bodyJson) {
            singleEditor._bodyJson = bodyJson;
          }
        }
        // Read attachment state from the old editor NOW so we capture any
        // mediaIds set by uploads that completed during the render cycle.
        const latestAttachments = remainingEditor?._attachments ?? [];
        const latestAttachmentOrder = remainingEditor?._attachmentOrder ?? [];
        const latestAttachedTexts = remainingEditor?._attachedTexts ?? [];
        if (latestAttachments.length > 0) {
          singleEditor._attachments = [...latestAttachments];
          singleEditor._attachmentOrder = [...latestAttachmentOrder];
        }
        if (latestAttachedTexts.length > 0) {
          singleEditor._attachedTexts = [...latestAttachedTexts];
        }
        if (capturedRating > 0) {
          singleEditor._rating = capturedRating;
          singleEditor._showRating = capturedShowRating;
        }
        singleEditor.focusInput();
      });
    } else {
      this._threadItems = newItems;
      this._focusedThreadIndex = Math.min(
        this._focusedThreadIndex,
        newItems.length - 1,
      );
    }
  }

  /**
   * Where this editor sits in the thread it is extending, as `3/3`.
   *
   * A reply continues a chain that already exists, so it counts from the end of
   * that chain, not from 1: replying to the second post of a thread makes the
   * third. Only the parent's own depth can tell us this, so the marker stays
   * hidden until `_loadReplyParentPosition` has read it back — a number that
   * starts at 2 and jumps to 3 is worse than one that arrives late.
   *
   * Empty when there is no chain to place the post in: a lone new post is not
   * "1/1", and an edit says the more useful thing through its "Editing" marker
   * (the post being edited may have replies below that compose cannot see, so a
   * total would be a guess).
   */
  private _positionLabel(index: number): string {
    if (this._editPostId) return "";
    const isReply = !!(this._replyToId && this._replyToData);
    if (isReply && this._replyParentPosition === null) return "";
    const posted = isReply ? (this._replyParentPosition ?? 0) : 0;
    const total = posted + (this._threadItems.length || 1);
    if (total < 2) return "";
    return `${posted + index + 1}/${total}`;
  }

  private _renderThreadPost(
    item: ThreadItem,
    index: number,
    showRemove: boolean,
    startsThread: boolean,
  ) {
    return html`
      <div
        class=${classMap({
          "compose-editor-row": true,
          "compose-thread-post": true,
          // Marks the post the cursor is in, which is what the rail's accent
          // dot points at. Every post in a thread is equally "new", so being an
          // editor row is not what makes one of them current.
          "is-current": index === this._focusedThreadIndex,
        })}
        data-thread-index=${index}
        @focusin=${() => {
          this._focusedThreadIndex = index;
        }}
        @jant:format-change=${(e: CustomEvent<{ format: ComposeFormat }>) => {
          e.stopPropagation();
          this._threadItems = this._threadItems.map((it, i) =>
            i === index ? { ...it, format: e.detail.format } : it,
          );
          this._format = e.detail.format;
          // Move focus to the new format's input, mirroring the single-post
          // composer's `_switchFormat`. The editor re-renders its fields only
          // after both this dialog and the editor itself finish updating, so
          // wait for both before routing focus to the now-visible control.
          if (this._shouldAutofocusFormatInput()) {
            this.updateComplete.then(() => {
              const editor = this.querySelectorAll<JantComposeEditor>(
                "jant-compose-editor",
              )[index];
              editor?.updateComplete.then(() => editor.focusInput());
            });
          }
        }}
        @jant:thread-remove=${(e: Event) => {
          e.stopPropagation();
          this._removeThreadItem(index);
        }}
        @jant:compose-status=${(e: CustomEvent<ComposeRowStatus>) => {
          e.stopPropagation();
          this._handleRowStatus(item.id, e.detail);
        }}
      >
        <div class="compose-thread-dot"></div>
        <jant-compose-editor
          .format=${item.format}
          .labels=${this.labels}
          .uploadMaxFileSize=${this.uploadMaxFileSize}
          .threadItem=${true}
          .removable=${showRemove}
          .titleByDefault=${startsThread}
          .positionLabel=${this._positionLabel(index)}
          .headerExtra=${this._renderPostMetaControl(index)}
          .slashCommandDiscovered=${this.slashCommandDiscovered}
          data-thread-id=${item.id}
        ></jant-compose-editor>
      </div>
    `;
  }

  private _renderAddToThreadRow() {
    const rowIds = this._rowIds;
    const lastId = rowIds[rowIds.length - 1];
    const lastEmpty = !this._rowStatus.get(lastId)?.hasContent;
    const atLimit = this._threadItems.length >= MAX_THREAD_POSTS;
    return html`
      <div class="compose-thread-add-row">
        <div class="compose-thread-add-dot"></div>
        <button
          type="button"
          class="compose-thread-add-btn"
          ?disabled=${lastEmpty || atLimit}
          @click=${() => this._addThreadItem()}
        >
          Add to thread
        </button>
      </div>
    `;
  }

  private _renderThreadComposeLayout() {
    const isReply = !!(this._replyToId && this._replyToData);
    const items = this._threadItems;
    const showRemove = items.length > 1;

    return html`
      <div
        class=${classMap({
          "compose-thread-layout": true,
          "compose-thread-compose-layout": true,
          "compose-reply-compose-layout": isReply,
        })}
        @jant:compose-content-changed=${() => this._scheduleDraftSave()}
      >
        ${isReply
          ? this._renderReplyContext()
          : this._renderTranslationContext()}
        <!-- Keyed by row id, not by position: an editor holds its own content,
             so an unkeyed list would reuse elements by position and drop the
             last one when a middle post is removed — taking that post's text
             with it, and pairing the survivors with the wrong dates and
             permalinks. -->
        ${repeat(
          items,
          (item) => item.id,
          (item, i) =>
            this._renderThreadPost(
              item,
              i,
              showRemove,
              // Only the post that opens a thread of its own gets a title field
              // by default — everything downstream of it continues a thought
              // that is already named.
              i === 0 && !isReply,
            ),
        )}
        ${this._renderAddToThreadRow()}
      </div>
    `;
  }

  // `onRail` is for the reply composer, which is already a thread layout: the
  // row joins the rail with the same dashed dot thread compose uses, so the
  // placeholder sits where the next post will land instead of floating out at
  // the dialog's own left edge, a rail's width clear of everything above it.
  private _renderAddThreadTrigger(onRail: boolean) {
    const disabled = !this._hasWorkToLose();
    const button = html`
      <button
        type="button"
        class="compose-thread-add-btn"
        ?disabled=${disabled}
        @click=${() => this._addThreadItem()}
      >
        Add to thread
      </button>
    `;
    return onRail
      ? html`
          <div class="compose-thread-add-row">
            <div class="compose-thread-add-dot"></div>
            ${button}
          </div>
        `
      : html`<div class="compose-add-thread-trigger">${button}</div>`;
  }

  render() {
    const isReply = !!(this._replyToId && this._replyToData);
    const isThreadMode = this._threadItems.length > 0;
    const isOpeningEdit = this._openingEdit;
    const editor = html`<jant-compose-editor
      .format=${this._format}
      .labels=${this.labels}
      .uploadMaxFileSize=${this.uploadMaxFileSize}
      .inlineFormat=${isReply}
      .titleByDefault=${!isReply && JantComposeDialog._getNoteTitleDefault()}
      .positionLabel=${this._positionLabel(0)}
      .badgeLabel=${this._editPostId ? this.labels.editing : ""}
      .headerExtra=${html`${this._renderPostMetaControl(0)}
      ${this._renderCloseComposeControl()}`}
      .slashCommandDiscovered=${this.slashCommandDiscovered}
      @jant:format-change=${(e: CustomEvent<{ format: ComposeFormat }>) => {
        e.stopPropagation();
        this._switchFormat(e.detail.format);
      }}
      @jant:compose-status=${(e: CustomEvent<ComposeRowStatus>) => {
        e.stopPropagation();
        this._handleRowStatus(SINGLE_ROW_ID, e.detail);
      }}
    ></jant-compose-editor>`;
    // The handler sits on the editor itself rather than a delegating wrapper.
    // Single-post mode renders this editor as a direct child of
    // `.compose-scroll`, and the rules that lay it out are keyed on that child
    // relationship — a wrapper breaks them even at `display: contents`, which
    // drops the box but not the DOM parentage a selector matches on.
    // (Thread mode builds its own editors in `_renderThreadPost`.)

    // Thread mode grows its own row at the end of the layout, and editing an
    // existing post has no next slot to offer at all.
    const addThreadRow =
      isOpeningEdit || isThreadMode || this._editPostId
        ? nothing
        : this._renderAddThreadTrigger(isReply);

    return html`
      <div
        class=${classMap({
          "compose-dialog-inner": true,
          "compose-dialog-inner-page": this.pageMode,
          "compose-dialog-inner-suspended": this._addCollectionPanelOpen,
        })}
        tabindex="-1"
        aria-hidden=${this._addCollectionPanelOpen ? "true" : "false"}
        ?inert=${this._addCollectionPanelOpen}
      >
        <div class="compose-scroll">
          ${isOpeningEdit
            ? this._renderEditLoadingState()
            : isThreadMode
              ? this._renderThreadComposeLayout()
              : isReply
                ? html`
                    <div
                      class="compose-thread-layout compose-reply-compose-layout"
                    >
                      ${this._renderReplyContext()}
                      <div class="compose-editor-row is-current">
                        <div class="compose-thread-dot"></div>
                        ${editor}
                      </div>
                      ${addThreadRow}
                    </div>
                  `
                : html`${this._renderTranslationContext()}${editor}${addThreadRow}`}
        </div>
        ${isOpeningEdit
          ? nothing
          : html`<div
                class=${classMap({
                  "compose-action-row": true,
                  "compose-action-row-without-collection": !!this._replyToId,
                  "compose-action-row-overlay-open":
                    this._showPublishPanel ||
                    this._showCollection ||
                    this._showLanguagePicker,
                })}
              >
                ${this._replyToId ? nothing : this._renderCollectionSelector()}
                ${this._renderLanguageControl()} ${this._renderPublishButton()}
              </div>
              ${this._renderQuickActionsRow()}`}
        ${this._renderMobilePublishPanel()} ${this._renderAttachedPanel()}
        ${this._renderAltPanel()} ${this._renderDraftsPanel()}
        ${this._renderConfirmPanel()}
      </div>
      ${this._renderAddCollectionPanel()}
    `;
  }
}

customElements.define("jant-compose-dialog", JantComposeDialog);
