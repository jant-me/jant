/**
 * Compose Editor
 *
 * Format-specific content editing sub-component for the compose dialog.
 * Handles note/link/quote fields, star rating, attached text panel,
 * file attachments with thumbnail strip, and alt text editing.
 *
 * Light DOM only — BaseCoat and Tailwind classes apply directly.
 */

import { LitElement, html, nothing } from "lit";
import { classMap } from "lit/directives/class-map.js";
import { ifDefined } from "lit/directives/if-defined.js";
import { unsafeSVG } from "lit/directives/unsafe-svg.js";
import type { Editor, JSONContent } from "@tiptap/core";
import Sortable from "sortablejs";
import {
  captureSortableRevertNextSibling,
  getSortableMove,
  readSortableDataIds,
  responsiveSortableOptions,
  revertSortableDomMove,
  setSortableDraggingState,
} from "../sortable-list.js";
import type {
  ComposeFormat,
  ComposeLabels,
  ComposeAttachment,
  AttachedTextItem,
  ComposeEditorSelection,
  ComposeFullscreenOpenDetail,
} from "./compose-types.js";
import {
  UPLOAD_ACCEPT,
  getMediaCategory,
  validateUploadFile,
} from "../../lib/upload.js";
import type { MediaCategory } from "../../lib/upload.js";
import {
  DECORATIVE_QUOTE_MARK_SVG_CONTENT,
  DECORATIVE_QUOTE_MARK_VIEWBOX,
} from "../../lib/decorative-quote-mark.js";
import { showToast } from "../toast.js";
import { createTiptapEditor } from "../tiptap/create-editor.js";
import {
  uploadAndInsertInlineImage,
  adoptPendingInlineImageUploads,
} from "../tiptap/inline-image-upload.js";
import { isSafeAbsoluteUrl } from "../../lib/url.js";
import { randomUUID } from "../random-uuid.js";

interface ComposeFilePickerCloseDetail {
  cancelled: boolean;
}

const COMPOSE_TOOLBAR_ICONS = {
  media: `
    <rect x="2.75" y="3" width="12.5" height="11.25" rx="3" />
    <circle cx="6.15" cy="6.85" r="0.85" fill="currentColor" stroke="none" />
    <path d="M3.6 11.95 6.75 8.8c.42-.42 1.11-.42 1.53 0l1.4 1.4" />
    <path d="m8.95 10.2 1.38-1.38c.46-.46 1.21-.46 1.67 0l2.4 2.4" />
  `,
  attachedText: `
    <rect x="3" y="2.75" width="12" height="12.5" rx="3.1" />
    <path d="M5.85 6.35h6.3" />
    <path d="M5.85 9h6.3" />
    <path d="M5.85 11.65h4.35" />
  `,
  emoji: `
    <circle cx="9" cy="9" r="6.8" />
    <path d="M6.2 10.55c.52 1.08 1.46 1.8 2.8 1.8s2.28-.72 2.8-1.8" />
    <circle cx="6.5" cy="7.15" r="0.7" fill="currentColor" stroke="none" />
    <circle cx="11.5" cy="7.15" r="0.7" fill="currentColor" stroke="none" />
  `,
  rate: `
    <path
      d="m9 1.95 2.08 4.21 4.65.67-3.36 3.29.8 4.63L9 12.55l-4.17 2.2.8-4.63-3.36-3.29 4.65-.67z"
      fill="currentColor"
      fill-opacity="0.12"
      stroke="none"
    />
    <path
      d="m9 1.95 2.08 4.21 4.65.67-3.36 3.29.8 4.63L9 12.55l-4.17 2.2.8-4.63-3.36-3.29 4.65-.67z"
      stroke-width="1.6"
    />
  `,
  title: `
    <rect
      x="3.35"
      y="3.2"
      width="11.3"
      height="2.05"
      rx="0.68"
      fill="currentColor"
      stroke="none"
    />
    <rect
      x="7.8"
      y="4.6"
      width="2.4"
      height="9.45"
      rx="0.78"
      fill="currentColor"
      stroke="none"
    />
    <rect
      x="6.75"
      y="13.15"
      width="4.5"
      height="1.12"
      rx="0.56"
      fill="currentColor"
      stroke="none"
    />
  `,
  fullscreen: `
    <path d="M5.85 3H3v2.85" stroke-width="1.48" />
    <path d="M12.15 3H15v2.85" stroke-width="1.48" />
    <path d="M3 12.15V15h2.85" stroke-width="1.48" />
    <path d="M15 12.15V15h-2.85" stroke-width="1.48" />
  `,
} as const;

function renderComposeToolbarIcon(
  icon: (typeof COMPOSE_TOOLBAR_ICONS)[keyof typeof COMPOSE_TOOLBAR_ICONS],
) {
  return html`<svg
    class="compose-tool-icon"
    width="18"
    height="18"
    viewBox="0 0 18 18"
    fill="none"
    stroke="currentColor"
    stroke-width="1.55"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    ${unsafeSVG(icon)}
  </svg>`;
}

function renderDecorativeQuoteMark(className: string) {
  return html`<span
    class=${`decorative-quote-mark ${className}`}
    aria-hidden="true"
  >
    <svg
      viewBox=${DECORATIVE_QUOTE_MARK_VIEWBOX}
      role="presentation"
      focusable="false"
    >
      ${unsafeSVG(DECORATIVE_QUOTE_MARK_SVG_CONTENT)}
    </svg>
  </span>`;
}

function clampEditorSelection(
  editor: Editor,
  selection: ComposeEditorSelection,
): ComposeEditorSelection {
  const max = editor.state.doc.content.size;
  const from = Math.max(1, Math.min(selection.from, max));
  const to = Math.max(from, Math.min(selection.to, max));
  return { from, to };
}

export class JantComposeEditor extends LitElement {
  static properties = {
    format: { type: String },
    labels: { type: Object },
    uploadMaxFileSize: { type: Number },
    threadItem: { type: Boolean, attribute: "thread-item" },
    removable: { type: Boolean },
    _title: { state: true },
    _bodyJson: { state: true },
    _url: { state: true },
    _quoteText: { state: true },
    _quoteAuthor: { state: true },
    _rating: { state: true },
    _showTitle: { state: true },
    _showRating: { state: true },
    _attachedTexts: { state: true },
    _attachments: { state: true },
    _attachmentOrder: { state: true },
    _failedAttachmentPreviews: { state: true },
    _showAltPanel: { state: true },
    _altPanelIndex: { state: true },
    _showEmojiPicker: { state: true },
    _showUrlValidation: { state: true },
    _showLinkTitleValidation: { state: true },
  };

  declare format: ComposeFormat;
  declare labels: ComposeLabels;
  declare uploadMaxFileSize: number;
  declare threadItem: boolean;
  declare removable: boolean;
  declare _title: string;
  declare _bodyJson: JSONContent | null;
  declare _url: string;
  declare _quoteText: string;
  declare _quoteAuthor: string;
  declare _rating: number;
  declare _showTitle: boolean;
  declare _showRating: boolean;
  declare _attachedTexts: AttachedTextItem[];
  declare _attachments: ComposeAttachment[];
  declare _attachmentOrder: string[];
  declare _failedAttachmentPreviews: string[];
  declare _showAltPanel: boolean;
  declare _altPanelIndex: number;
  declare _showEmojiPicker: boolean;
  declare _showUrlValidation: boolean;
  declare _showLinkTitleValidation: boolean;

  private _editor: Editor | null = null;
  private _fileInput: HTMLInputElement | null = null;
  private _lastFocusedField: HTMLTextAreaElement | HTMLInputElement | null =
    null;
  private _lastEditorSelection: ComposeEditorSelection | null = null;
  private _emojiPickerEl: HTMLElement | null = null;
  private _emojiContainer: HTMLElement | null = null;
  private readonly _urlStatusId = `compose-url-status-${randomUUID()}`;
  private _onDocClickBound = this._onDocumentClick.bind(this);
  private _scrollBufferApplied = false;
  private _filePickerCleanup: (() => void) | null = null;
  private _suppressAttachedTextOpenUntil = 0;
  #inlineImageUploadGeneration = 0;
  #inlineImageUploadPromises = new Set<Promise<void>>();
  #sortable: { destroy(): void } | null = null;
  #revertNextSibling: globalThis.Node | null = null;

  createRenderRoot() {
    return this;
  }

  constructor() {
    super();
    this.format = "note";
    this.labels = {} as ComposeLabels;
    this.uploadMaxFileSize = 500;
    this.threadItem = false;
    this.removable = false;
    this._title = "";
    this._bodyJson = null;
    this._url = "";
    this._quoteText = "";
    this._quoteAuthor = "";
    this._rating = 0;
    this._showTitle = false;
    this._showRating = false;
    this._attachedTexts = [];
    this._attachments = [];
    this._attachmentOrder = [];
    this._failedAttachmentPreviews = [];
    this._showAltPanel = false;
    this._altPanelIndex = 0;
    this._showEmojiPicker = false;
    this._showUrlValidation = false;
    this._showLinkTitleValidation = false;
  }

  connectedCallback() {
    super.connectedCallback();
    document.addEventListener("jant:slash-image", this._onSlashImage);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.#clearPendingInlineImageUploads();
    this._editor?.destroy();
    this._editor = null;
    this.#sortable?.destroy();
    this.#sortable = null;
    document.removeEventListener("jant:slash-image", this._onSlashImage);
    document.removeEventListener("click", this._onDocClickBound);
    this._emojiContainer?.remove();
    this._emojiPickerEl = null;
    this._filePickerCleanup?.();
    this._filePickerCleanup = null;
  }

  private _onSlashImage = () => {
    // Skip when fullscreen is open — it has its own handler
    if (document.querySelector(".compose-fullscreen-dialog[open]")) return;
    if (!this._editor) return;
    this._triggerSlashImagePicker();
  };

  private _slashImageInput: HTMLInputElement | null = null;

  private _triggerSlashImagePicker() {
    if (!this._slashImageInput) {
      this._slashImageInput = document.createElement("input");
      this._slashImageInput.type = "file";
      this._slashImageInput.accept = "image/*";
      this._slashImageInput.style.display = "none";
      this._slashImageInput.addEventListener("change", () => {
        const file = this._slashImageInput?.files?.[0];
        if (file && this._editor) {
          this._uploadAndInsertImage(file);
        }
        if (this._slashImageInput) this._slashImageInput.value = "";
      });
      document.body.appendChild(this._slashImageInput);
    }
    this._trackFilePickerSession(this._slashImageInput);
    this._slashImageInput.click();
  }

  private _uploadAndInsertImage(file: File) {
    const editor = this._editor;
    if (!editor) return Promise.resolve();

    const generation = this.#inlineImageUploadGeneration;
    const uploadPromise = uploadAndInsertInlineImage(editor, file).finally(
      () => {
        if (generation !== this.#inlineImageUploadGeneration) return;
        this.#inlineImageUploadPromises.delete(uploadPromise);
      },
    );
    this.#inlineImageUploadPromises.add(uploadPromise);
    return uploadPromise;
  }

  hasPendingInlineImageUploads(): boolean {
    return this.#inlineImageUploadPromises.size > 0;
  }

  async waitForPendingInlineImageUploads(): Promise<void> {
    const generation = this.#inlineImageUploadGeneration;
    while (
      generation === this.#inlineImageUploadGeneration &&
      this.#inlineImageUploadPromises.size > 0
    ) {
      await Promise.allSettled(Array.from(this.#inlineImageUploadPromises));
    }
  }

  #clearPendingInlineImageUploads() {
    this.#inlineImageUploadGeneration += 1;
    this.#inlineImageUploadPromises.clear();
  }

  /** Adopt in-flight inline image uploads from another editor (e.g. fullscreen). */
  adoptPendingUploads() {
    if (!this._editor) return;
    const generation = this.#inlineImageUploadGeneration;
    const adopted = adoptPendingInlineImageUploads(this._editor);
    for (const promise of adopted) {
      const tracked = promise.finally(() => {
        if (generation !== this.#inlineImageUploadGeneration) return;
        this.#inlineImageUploadPromises.delete(tracked);
      });
      this.#inlineImageUploadPromises.add(tracked);
    }
  }

  private _dispatchFilePickerEvent(
    type: "jant:file-picker-open" | "jant:file-picker-close",
    detail?: ComposeFilePickerCloseDetail,
  ) {
    this.dispatchEvent(
      new CustomEvent(type, {
        bubbles: true,
        composed: true,
        detail,
      }),
    );
  }

  private _trackFilePickerSession(input: HTMLInputElement) {
    this._filePickerCleanup?.();

    let closed = false;
    const close = (cancelled: boolean) => {
      if (closed) return;
      closed = true;
      cleanup();
      this._dispatchFilePickerEvent("jant:file-picker-close", { cancelled });
    };
    const onChange = () => close(false);
    const onCancel = () => close(true);
    const onWindowFocus = () => {
      globalThis.setTimeout(() => {
        close(!(input.files && input.files.length > 0));
      }, 0);
    };
    const cleanup = () => {
      input.removeEventListener("change", onChange);
      input.removeEventListener("cancel", onCancel as EventListener);
      window.removeEventListener("focus", onWindowFocus);
      if (this._filePickerCleanup === cleanup) {
        this._filePickerCleanup = null;
      }
    };

    this._filePickerCleanup = cleanup;
    input.addEventListener("change", onChange, { once: true });
    input.addEventListener("cancel", onCancel as EventListener, { once: true });
    window.addEventListener("focus", onWindowFocus, { once: true });
    this._dispatchFilePickerEvent("jant:file-picker-open");
  }

  private _isEmptyDoc(json: JSONContent): boolean {
    if (!json.content || json.content.length === 0) return true;
    return json.content.every(
      (node) =>
        node.type === "paragraph" &&
        (!node.content ||
          node.content.length === 0 ||
          node.content.every((child) => child.type === "hardBreak")),
    );
  }

  private _normalizeDocJson(json: JSONContent | null): JSONContent | null {
    if (!json) return null;
    return this._isEmptyDoc(json) ? null : json;
  }

  getNormalizedBodyJson(): JSONContent | null {
    return this._normalizeDocJson(this._bodyJson);
  }

  getEffectiveAttachedTexts(): AttachedTextItem[] {
    return this._attachedTexts.flatMap((item) => {
      const bodyJson = this._normalizeDocJson(item.bodyJson);
      if (!bodyJson) return [];
      return [
        {
          ...item,
          bodyJson,
          originalBodyJson: this._normalizeDocJson(
            item.originalBodyJson ?? null,
          ),
        },
      ];
    });
  }

  getEffectiveAttachmentOrder(): string[] {
    const attachedTextIds = new Set(
      this.getEffectiveAttachedTexts().map((item) => item.clientId),
    );
    const attachmentIds = new Set(
      this._attachments.map((item) => item.clientId),
    );

    return this._attachmentOrder.filter(
      (clientId) =>
        attachmentIds.has(clientId) || attachedTextIds.has(clientId),
    );
  }

  private _getEffectiveRating(): number {
    return this._showRating ? this._rating : 0;
  }

  getData() {
    const bodyJson = this.getNormalizedBodyJson();
    const attachedTexts = this.getEffectiveAttachedTexts();
    const attachmentOrder = this.getEffectiveAttachmentOrder();
    const body = bodyJson ? JSON.stringify(bodyJson) : "";
    const shared = {
      rating: this._getEffectiveRating(),
      attachedTexts,
      attachments: this._attachments,
      attachmentOrder,
    };

    switch (this.format) {
      case "link":
        return {
          ...shared,
          title: this._title,
          body,
          url: this._url,
          quoteText: "",
          quoteAuthor: "",
        };
      case "quote":
        return {
          ...shared,
          title: "",
          body,
          url: this._url,
          quoteText: this._quoteText,
          quoteAuthor: this._quoteAuthor,
        };
      default:
        return {
          ...shared,
          title: this._showTitle ? this._title : "",
          body,
          url: "",
          quoteText: "",
          quoteAuthor: "",
        };
    }
  }

  reset() {
    this.#clearPendingInlineImageUploads();
    this._title = "";
    this._bodyJson = null;
    this._editor?.commands.clearContent();
    this._lastEditorSelection = null;
    this._url = "";
    this._quoteText = "";
    this._quoteAuthor = "";
    this._rating = 0;
    this._showTitle = false;
    this._showRating = false;
    this._attachedTexts = [];
    // Revoke preview URLs before clearing
    for (const a of this._attachments) {
      URL.revokeObjectURL(a.previewUrl);
      if (a.posterUrl) URL.revokeObjectURL(a.posterUrl);
    }
    this._attachments = [];
    this._attachmentOrder = [];
    this._failedAttachmentPreviews = [];
    this._showAltPanel = false;
    this._altPanelIndex = 0;
    this._showUrlValidation = false;
    this._showLinkTitleValidation = false;
    this.closeEmojiPicker();
  }

  updateAttachmentStatus(
    clientId: string,
    status: ComposeAttachment["status"],
    mediaId: string | null,
    error: string | null,
  ) {
    this._attachments = this._attachments.map((a) =>
      a.clientId === clientId ? { ...a, status, mediaId, error } : a,
    );
  }

  updateAttachmentPreview(clientId: string, file: File) {
    this._setAttachmentPreviewFailure(clientId, false);
    this._attachments = this._attachments.map((a) => {
      if (a.clientId !== clientId) return a;
      URL.revokeObjectURL(a.previewUrl);
      if (a.posterUrl) URL.revokeObjectURL(a.posterUrl);
      return {
        ...a,
        file,
        previewUrl: URL.createObjectURL(file),
        posterUrl: null,
      };
    });
  }

  updateAttachmentPoster(clientId: string, poster: Blob) {
    const posterUrl = URL.createObjectURL(poster);
    this._attachments = this._attachments.map((a) =>
      a.clientId === clientId ? { ...a, posterUrl } : a,
    );
  }

  updateAttachmentProgress(clientId: string, progress: number) {
    this._attachments = this._attachments.map((a) =>
      a.clientId === clientId ? { ...a, progress } : a,
    );
  }

  focusInput(position?: "start" | "end") {
    if (this.format === "link") {
      this.focusUrlInput(position);
      return;
    }
    if (this.format === "quote") {
      this._focusTextControl(
        this.querySelector<HTMLTextAreaElement>(".compose-quote-text"),
        position,
      );
      return;
    }
    if (position) {
      this._editor?.commands.focus(position);
      return;
    }
    this._editor?.commands.focus();
  }

  focusSelection(selection?: ComposeEditorSelection | null) {
    if (this.format !== "note" || !this._editor) {
      this.focusInput();
      return;
    }

    const targetSelection = selection ?? this.getEditorSelection();
    if (!targetSelection) {
      this.focusInput();
      return;
    }

    const normalizedSelection = clampEditorSelection(
      this._editor,
      targetSelection,
    );
    this._lastEditorSelection = normalizedSelection;
    this._editor.chain().focus().setTextSelection(normalizedSelection).run();
  }

  focusUrlInput(position?: "start" | "end") {
    this._focusTextControl(
      this.querySelector<HTMLInputElement>(".compose-url-input"),
      position,
    );
  }

  focusLinkTitleInput(position?: "start" | "end") {
    this._focusTextControl(
      this.querySelector<HTMLInputElement>(".compose-link-title"),
      position,
    );
  }

  getUrlValidationMessage(): string | null {
    if (this.format === "note") return null;
    if (!this._url.trim()) {
      return this.format === "link" ? this.labels.linkUrlRequired : null;
    }
    return isSafeAbsoluteUrl(this._url) ? null : this.labels.urlInvalid;
  }

  getLinkTitleValidationMessage(): string | null {
    if (this.format !== "link") return null;
    return this._title.trim() ? null : this.labels.linkTitleRequired;
  }

  private _getInlineUrlValidationMessage(): string | null {
    if (this.format === "link" && !this._url.trim()) {
      return null;
    }
    return this.getUrlValidationMessage();
  }

  private _getInlineLinkTitleValidationMessage(): string | null {
    if (this.format !== "link" || !this._title.trim()) {
      return null;
    }
    return this.getLinkTitleValidationMessage();
  }

  revealUrlValidation(): string | null {
    this._showUrlValidation = true;
    return this.getUrlValidationMessage();
  }

  revealLinkTitleValidation(): string | null {
    this._showLinkTitleValidation = true;
    return this.getLinkTitleValidationMessage();
  }

  getEditorSelection(): ComposeEditorSelection | null {
    return this._readEditorSelection() ?? this._lastEditorSelection;
  }

  isEmojiPickerOpen(): boolean {
    return this._showEmojiPicker;
  }

  private _readEditorSelection(): ComposeEditorSelection | null {
    if (!this._editor) return null;
    const { from, to } = this._editor.state.selection;
    return { from, to };
  }

  private _focusTextControl(
    field: HTMLInputElement | HTMLTextAreaElement | null,
    position?: "start" | "end",
  ) {
    if (!field) return;
    field.focus();
    if (!position) return;
    const caret = position === "end" ? field.value.length : 0;
    field.setSelectionRange(caret, caret);
  }

  private _initEditor() {
    const container = this.querySelector<HTMLElement>(".compose-tiptap-body");
    if (!container || this._editor) return;

    this._editor = createTiptapEditor({
      element: container,
      placeholder:
        this.format === "note"
          ? this.labels.bodyPlaceholder
          : this.labels.thoughtsPlaceholder,
      content: this._bodyJson,
      toolbarMode: "compose",
      onUpdate: (json) => {
        this._bodyJson = json;
        this._ensureScrollBuffer();
      },
      onFocus: () => {
        this._lastFocusedField = null;
      },
      onSelectionUpdate: (selection) => {
        this._lastEditorSelection = selection;
      },
      pasteMedia: {
        shouldInsertInline: (file) => this._shouldPasteInlineImage(file),
        uploadInlineImage: (file) => this._uploadAndInsertImage(file),
        onPasteFiles: (files) => {
          this.addFiles(files);
        },
      },
    });
    this._lastEditorSelection = this._readEditorSelection();

    // Lock editor min-height once so new lines fill existing space
    // instead of growing the dialog line-by-line.
    // Skip in page mode where the editor grows freely with the page.
    this._scrollBufferApplied = false;
    const dom = this._editor.view.dom as HTMLElement;
    const isPageMode = !!this.closest(".compose-page-shell");
    if (!isPageMode) {
      const last = dom.lastElementChild as HTMLElement | null;
      const contentH = last ? last.offsetTop + last.offsetHeight : 0;
      const buffer = this.format !== "note" ? 60 : 120;
      dom.style.minHeight = `${contentH + buffer}px`;
    }
  }

  /**
   * One-time: adds bottom padding for scroll buffer once the
   * compose-body starts scrolling. Since the dialog is already at
   * max-height by that point, the extra padding doesn't grow it.
   */
  private _ensureScrollBuffer() {
    if (this._scrollBufferApplied) return;
    const dom = this._editor?.view?.dom as HTMLElement | undefined;
    if (!dom) return;
    const body = this.querySelector(".compose-body") as HTMLElement | null;
    if (!body) return;
    if (body.scrollHeight > body.clientHeight + 20) {
      dom.style.paddingBottom = "40px";
      this._scrollBufferApplied = true;
    }
  }

  private _destroyEditor() {
    this.#clearPendingInlineImageUploads();
    this._editor?.destroy();
    this._editor = null;
  }

  /** Content-relevant properties that trigger a change event for draft auto-save */
  private static _CONTENT_PROPS = new Set([
    "_title",
    "_bodyJson",
    "_url",
    "_quoteText",
    "_quoteAuthor",
    "_rating",
    "_showTitle",
    "_showRating",
    "_attachedTexts",
    "_attachmentOrder",
  ]);

  protected updated(changed: Map<string, unknown>) {
    super.updated(changed);

    // Initialize editor after first render or when format changes
    if (!this._editor) {
      this._initEditor();
    }

    if (changed.has("format") && changed.get("format") !== undefined) {
      if (this._showUrlValidation) {
        this._showUrlValidation = false;
      }
      if (this._showLinkTitleValidation) {
        this._showLinkTitleValidation = false;
      }
      // Format changed — recreate editor with appropriate placeholder
      this._destroyEditor();
      // Schedule init after Lit re-renders the new template
      this.updateComplete.then(() => this._initEditor());
    }

    if (
      changed.has("_attachmentOrder") ||
      changed.has("_attachments") ||
      changed.has("_attachedTexts")
    ) {
      if (changed.has("_attachments")) {
        this._syncFailedAttachmentPreviews();
      }
      if (this._attachmentOrder.length > 1) {
        this.#initSortable();
      } else {
        this.#sortable?.destroy();
        this.#sortable = null;
      }
    }

    // Notify parent dialog of content changes for draft auto-save
    for (const key of changed.keys()) {
      if (JantComposeEditor._CONTENT_PROPS.has(key as string)) {
        this.dispatchEvent(
          new Event("jant:compose-content-changed", { bubbles: true }),
        );
        break;
      }
    }
  }

  /** Returns Tiptap editor content and title for fullscreen handoff */
  getEditorState() {
    return {
      json: this._editor?.getJSON() ?? this._bodyJson,
      title: this._title,
      showTitle: this._showTitle,
      selection: this.getEditorSelection(),
    };
  }

  /** Pre-fill all fields for edit mode or draft restore */
  populate(data: {
    format: string;
    title?: string;
    bodyJson?: string;
    url?: string;
    quoteText?: string;
    quoteAuthor?: string;
    rating?: number;
    showTitle?: boolean;
    showRating?: boolean;
    media?: Array<{
      id: string;
      previewUrl: string;
      posterUrl?: string | null;
      alt?: string;
      mimeType: string;
      originalName?: string;
      summary?: string;
      chars?: number;
    }>;
    textAttachments?: Array<{
      clientId?: string;
      bodyJson: string;
      bodyHtml?: string;
      summary: string;
      mediaId?: string;
    }>;
    attachmentOrder?: string[];
  }) {
    if (data.title) this._title = data.title;
    if (data.url) this._url = data.url;
    if (data.quoteText) this._quoteText = data.quoteText;
    if (data.quoteAuthor) this._quoteAuthor = data.quoteAuthor;
    if (data.rating && data.rating > 0) {
      this._rating = data.rating;
      this._showRating = true;
    }
    if (data.showTitle !== undefined) this._showTitle = data.showTitle;
    else if (data.title && data.format === "note") this._showTitle = true;
    if (data.showRating !== undefined) this._showRating = data.showRating;
    this._failedAttachmentPreviews = [];

    // Parse body JSON and set editor content
    if (data.bodyJson) {
      try {
        const parsed = JSON.parse(data.bodyJson) as JSONContent;
        this._bodyJson = parsed;
        if (this._editor) {
          this._editor.commands.setContent(parsed);
        }
      } catch {
        // Body is not valid JSON — ignore
      }
    }

    // Convert media attachments to ComposeAttachment[] with status "done"
    if (data.media?.length) {
      const attachments = data.media.map((m) => ({
        clientId: randomUUID(),
        file: new File([], m.originalName ?? "existing", { type: m.mimeType }),
        previewUrl: m.previewUrl,
        posterUrl: m.posterUrl ?? null,
        status: "done" as const,
        progress: null,
        mediaId: m.id,
        alt: m.alt ?? "",
        error: null,
        summary: m.summary ?? null,
        chars: m.chars ?? null,
      }));
      this._attachments = attachments;
      this._attachmentOrder = attachments.map((a) => a.clientId);
    }

    // Restore attached texts from server data
    if (data.textAttachments?.length) {
      const texts: AttachedTextItem[] = data.textAttachments.map((t) => {
        let parsed: JSONContent | null = null;
        try {
          parsed = JSON.parse(t.bodyJson) as JSONContent;
        } catch {
          // Invalid JSON — leave as null
        }
        return {
          clientId: t.clientId ?? randomUUID(),
          bodyJson: parsed,
          bodyHtml: t.bodyHtml ?? "",
          summary: t.summary,
          mediaId: t.mediaId,
          originalBodyJson: parsed,
        };
      });
      this._attachedTexts = texts;
      this._attachmentOrder = [
        ...this._attachmentOrder,
        ...texts.map((t) => t.clientId),
      ];
    }

    if (data.attachmentOrder?.length) {
      const orderedClientIds = data.attachmentOrder
        .map((attachmentId) => {
          const mediaClientId = this._attachments.find(
            (item) =>
              item.mediaId === attachmentId || item.clientId === attachmentId,
          )?.clientId;
          if (mediaClientId) return mediaClientId;
          return this._attachedTexts.find(
            (item) =>
              item.mediaId === attachmentId || item.clientId === attachmentId,
          )?.clientId;
        })
        .filter((clientId): clientId is string => clientId !== undefined);

      const remainingClientIds = this._attachmentOrder.filter(
        (clientId) => !orderedClientIds.includes(clientId),
      );
      this._attachmentOrder = [...orderedClientIds, ...remainingClientIds];
    }

    this._showUrlValidation = false;
    this._showLinkTitleValidation = false;
  }

  /** Updates editor content and title from fullscreen close */
  setEditorState(
    json: JSONContent | null,
    title: string,
    showTitle: boolean,
    selection?: ComposeEditorSelection | null,
  ) {
    this._bodyJson = json;
    this._title = title;
    if (this.format === "note") {
      this._showTitle = showTitle || title.length > 0;
    }
    if (this._editor) {
      this._editor.commands.setContent(
        json ?? {
          type: "doc",
          content: [{ type: "paragraph" }],
        },
      );
    }
    this._lastEditorSelection = selection ?? this._readEditorSelection();
  }

  private static SUMMARY_LENGTH = 100;

  private _computeSummary(text: string): string {
    const plain = text.replace(/\s+/g, " ").trim();
    if (plain.length <= JantComposeEditor.SUMMARY_LENGTH) return plain;
    return plain.slice(0, JantComposeEditor.SUMMARY_LENGTH) + "…";
  }

  private _openAttachedText() {
    const item: AttachedTextItem = {
      clientId: randomUUID(),
      bodyJson: null,
      bodyHtml: "",
      summary: "",
    };
    this._attachedTexts = [...this._attachedTexts, item];
    this._attachmentOrder = [...this._attachmentOrder, item.clientId];
    const index = this._attachedTexts.length - 1;
    this.dispatchEvent(
      new CustomEvent("jant:attached-panel-open", {
        bubbles: true,
        detail: { index },
      }),
    );
  }

  private _moveAttachment(clientId: string, direction: -1 | 1) {
    const index = this._attachmentOrder.indexOf(clientId);
    const nextIndex = index + direction;
    if (
      index === -1 ||
      nextIndex < 0 ||
      nextIndex >= this._attachmentOrder.length
    ) {
      return;
    }

    const nextOrder = [...this._attachmentOrder];
    const [item] = nextOrder.splice(index, 1);
    if (!item) return;
    nextOrder.splice(nextIndex, 0, item);
    this._attachmentOrder = nextOrder;
    this.#scrollAttachmentIntoView(clientId);
  }

  private _handleAttachmentKeydown(
    clientId: string,
    e: globalThis.KeyboardEvent,
    onActivate?: () => void,
  ) {
    if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      e.preventDefault();
      this._moveAttachment(clientId, -1);
      return;
    }

    if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      e.preventDefault();
      this._moveAttachment(clientId, 1);
      return;
    }

    if (onActivate && (e.key === "Enter" || e.key === " ")) {
      e.preventDefault();
      onActivate();
    }
  }

  #initSortable() {
    const list = this.querySelector<HTMLElement>("[data-attachment-list]");
    if (!list || this.#sortable || this._attachmentOrder.length <= 1) return;

    this.#sortable = Sortable.create(list, {
      ...responsiveSortableOptions,
      chosenClass: "compose-attachment-chosen",
      direction: "horizontal",
      dragClass: "compose-attachment-drag",
      filter:
        "button, a, input, textarea, select, option, [contenteditable='true']",
      ghostClass: "compose-attachment-ghost",
      handle: "[data-attachment-sortable]",
      preventOnFilter: false,
      scroll: list,
      onChoose: () => {
        setSortableDraggingState(list, true);
      },
      onStart: (evt) => {
        this.#revertNextSibling = captureSortableRevertNextSibling(evt);
      },
      onUnchoose: () => {
        setSortableDraggingState(list, false);
      },
      onEnd: (evt) => {
        const orderedIds = readSortableDataIds(
          list,
          "[data-attachment-id]",
          "attachmentId",
        );
        revertSortableDomMove(list, evt, this.#revertNextSibling);
        this.#revertNextSibling = null;
        setSortableDraggingState(list, false);

        this.#sortable?.destroy();
        this.#sortable = null;

        if (orderedIds.length === this._attachmentOrder.length) {
          this._attachmentOrder = orderedIds;
          const { movedId } = getSortableMove(orderedIds, evt.newIndex);
          if (movedId) {
            this._suppressAttachedTextOpenUntil = Date.now() + 250;
            this.#scrollAttachmentIntoView(movedId);
          }
        }
      },
    });
  }

  #scrollAttachmentIntoView(clientId: string) {
    void this.updateComplete.then(() => {
      const target = this.querySelector<HTMLElement>(
        `[data-attachment-id="${clientId}"]`,
      );
      target?.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
        inline: "nearest",
      });
    });
  }

  private _maybeEditAttachedText(index: number) {
    if (Date.now() < this._suppressAttachedTextOpenUntil) {
      return;
    }
    this._editAttachedText(index);
  }

  private _editAttachedText(index: number) {
    this.dispatchEvent(
      new CustomEvent("jant:attached-panel-open", {
        bubbles: true,
        detail: { index },
      }),
    );
  }

  private _removeAttachedText(index: number) {
    const removed = this._attachedTexts[index];
    this._attachedTexts = this._attachedTexts.filter((_, i) => i !== index);
    if (removed) {
      this._attachmentOrder = this._attachmentOrder.filter(
        (id) => id !== removed.clientId,
      );
    }
  }

  updateAttachedText(
    index: number,
    bodyJson: JSONContent | null,
    bodyHtml?: string,
  ) {
    const normalizedBodyJson = this._normalizeDocJson(bodyJson);
    const plainText = this._extractPlainText(normalizedBodyJson);
    this._attachedTexts = this._attachedTexts.map((item, i) =>
      i === index
        ? {
            ...item,
            bodyJson: normalizedBodyJson,
            bodyHtml: normalizedBodyJson ? (bodyHtml ?? "") : "",
            summary: this._computeSummary(plainText),
          }
        : item,
    );
  }

  closeAttachedPanel(index: number) {
    const item = this._attachedTexts[index];
    if (!item) return;
    // Never auto-remove an attachment that's already persisted server-side:
    // if the user wanted to delete it, they'd click the X. Silently dropping
    // an existing attachment because its content briefly looked empty (e.g.
    // a transient fetch failure during edit-hydration) would be data loss
    // the user didn't ask for.
    if (item.mediaId) return;
    if (!this._hasAttachedTextContent(item.bodyJson)) {
      this._attachedTexts = this._attachedTexts.filter((_, i) => i !== index);
      this._attachmentOrder = this._attachmentOrder.filter(
        (id) => id !== item.clientId,
      );
    }
  }

  private _hasAttachedTextContent(bodyJson: JSONContent | null): boolean {
    const normalizedBodyJson = this._normalizeDocJson(bodyJson);
    if (!normalizedBodyJson) return false;
    return this._extractPlainText(normalizedBodyJson).trim().length > 0;
  }

  private _extractPlainText(json: JSONContent | null): string {
    if (!json) return "";
    let text = "";
    const walk = (node: JSONContent) => {
      if (node.text) text += node.text;
      if (node.content) node.content.forEach(walk);
    };
    walk(json);
    return text;
  }

  private _onInput(field: string, e: Event) {
    const target = e.target as HTMLInputElement | HTMLTextAreaElement;
    (this as Record<string, unknown>)[field] = target.value;
    if (target.tagName === "TEXTAREA") {
      this._autoResize(target as HTMLElement);
    }
  }

  private _autoResize(el: HTMLElement) {
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }

  private _setRating(star: number) {
    this._rating = this._rating === star ? 0 : star;
  }

  private _shouldPasteInlineImage(_file: File): boolean {
    // Always route pasted images to attachments in compose editor.
    // Inline images are inserted via /media slash command instead.
    // Fullscreen editor has its own handler that allows inline paste.
    return false;
  }

  private _openFilePicker() {
    if (!this._fileInput) {
      this._fileInput = document.createElement("input");
      this._fileInput.type = "file";
      this._fileInput.accept = UPLOAD_ACCEPT;
      this._fileInput.multiple = true;
      this._fileInput.style.display = "none";
      this._fileInput.addEventListener("change", () =>
        this._handleFilesSelected(),
      );
      this.appendChild(this._fileInput);
    }
    this._fileInput.value = "";
    this._trackFilePickerSession(this._fileInput);
    this._fileInput.click();
  }

  private _handleFilesSelected() {
    const files = this._fileInput?.files;
    if (!files || files.length === 0) return;
    this.addFiles(files);
  }

  addFiles(files: Iterable<File>) {
    const selectedFiles = Array.from(files);
    if (selectedFiles.length === 0) return;

    const newAttachments: ComposeAttachment[] = [];
    const uploadQueue: { file: File; clientId: string }[] = [];

    for (const file of selectedFiles) {
      // Validate before creating attachment preview
      const error = validateUploadFile(file, {
        maxFileSizeMB: this.uploadMaxFileSize,
      });
      if (error) {
        showToast(error, "error");
        continue;
      }

      const clientId = randomUUID();
      const previewUrl = URL.createObjectURL(file);
      newAttachments.push({
        clientId,
        file,
        previewUrl,
        posterUrl: null,
        status: "pending",
        progress: null,
        mediaId: null,
        alt: "",
        error: null,
        summary: null,
        chars: null,
      });
      uploadQueue.push({ file, clientId });
    }

    if (newAttachments.length === 0) return;

    this._attachments = [...this._attachments, ...newAttachments];
    this._attachmentOrder = [
      ...this._attachmentOrder,
      ...newAttachments.map((a) => a.clientId),
    ];

    // Extract summaries and char counts for text-category files asynchronously
    for (const att of newAttachments) {
      const category = getMediaCategory(att.file.type);
      if (category === "text") {
        att.file.text().then((content) => {
          const summary = this._computeSummary(content);
          const chars = content.length;
          this._attachments = this._attachments.map((a) =>
            a.clientId === att.clientId ? { ...a, summary, chars } : a,
          );
        });
      }
    }

    this.dispatchEvent(
      new CustomEvent("jant:files-selected", {
        bubbles: true,
        detail: { files: uploadQueue },
      }),
    );
  }

  removeAttachment(clientId: string) {
    const index = this._attachments.findIndex((a) => a.clientId === clientId);
    if (index !== -1) this._removeAttachment(index);
  }

  private _removeAttachment(index: number) {
    const attachment = this._attachments[index];
    if (attachment) {
      this._setAttachmentPreviewFailure(attachment.clientId, false);
      URL.revokeObjectURL(attachment.previewUrl);
      if (attachment.posterUrl) URL.revokeObjectURL(attachment.posterUrl);
      this.dispatchEvent(
        new CustomEvent("jant:attachment-removed", {
          bubbles: true,
          detail: {
            clientId: attachment.clientId,
            mediaId: attachment.mediaId,
          },
        }),
      );
    }
    if (attachment) {
      this._attachmentOrder = this._attachmentOrder.filter(
        (id) => id !== attachment.clientId,
      );
    }
    this._attachments = this._attachments.filter((_, i) => i !== index);
    // Close alt panel if it was showing the removed item
    if (this._showAltPanel && this._altPanelIndex === index) {
      this._showAltPanel = false;
      this.dispatchEvent(
        new CustomEvent("jant:alt-panel-close", { bubbles: true }),
      );
    } else if (this._showAltPanel && this._altPanelIndex > index) {
      this._altPanelIndex = this._altPanelIndex - 1;
    }
  }

  private _retryAllFailed() {
    const failed = this._attachments.filter((a) => a.status === "error");
    if (failed.length === 0) return;

    // Reset failed attachments to pending
    this._attachments = this._attachments.map((a) =>
      a.status === "error"
        ? { ...a, status: "pending" as const, progress: null, error: null }
        : a,
    );

    // Re-dispatch them through the normal upload flow
    this.dispatchEvent(
      new CustomEvent("jant:files-selected", {
        bubbles: true,
        detail: {
          files: failed.map((a) => ({ file: a.file, clientId: a.clientId })),
        },
      }),
    );
  }

  private _openAltPanel(index: number) {
    this._altPanelIndex = index;
    this._showAltPanel = true;
    this.dispatchEvent(
      new CustomEvent("jant:alt-panel-open", {
        bubbles: true,
        detail: { index },
      }),
    );
  }

  updateAlt(index: number, value: string) {
    this._attachments = this._attachments.map((a, i) =>
      i === index ? { ...a, alt: value } : a,
    );
  }

  // ── Emoji picker ────────────────────────────────────────────────

  private _onFieldFocus(e: Event) {
    const target = e.target as HTMLTextAreaElement | HTMLInputElement;
    this._lastFocusedField = target;
  }

  private _toggleEmojiPicker() {
    if (this._showEmojiPicker) {
      this.closeEmojiPicker();
    } else {
      this._showEmojiPicker = true;
      this._mountEmojiPicker();
      // Defer listener so the current click event doesn't immediately close it
      globalThis.setTimeout(() => {
        document.addEventListener("click", this._onDocClickBound);
      }, 0);
    }
  }

  closeEmojiPicker(options?: { restoreFocus?: boolean }) {
    if (!this._showEmojiPicker) {
      if (options?.restoreFocus) {
        this._restoreEmojiFocus();
      }
      return;
    }
    this._showEmojiPicker = false;
    this._emojiContainer?.remove();
    this._emojiPickerEl = null;
    document.removeEventListener("click", this._onDocClickBound);
    if (options?.restoreFocus) {
      this._restoreEmojiFocus();
    }
  }

  private _restoreEmojiFocus() {
    const field = this._lastFocusedField;
    if (field && this.contains(field) && !field.disabled) {
      field.focus();
      return;
    }
    this.focusSelection();
  }

  private _onDocumentClick(e: Event) {
    const target = e.target as globalThis.Node;
    const btn = this.querySelector(".compose-emoji-btn");
    if (btn?.contains(target)) return;
    if (this._emojiContainer?.contains(target)) return;
    this.closeEmojiPicker();
  }

  private async _mountEmojiPicker() {
    // Portal into the <dialog> element (shares top-layer, escapes inner overflow/transform)
    const dialog = this.closest("dialog");
    if (!this._emojiContainer) {
      this._emojiContainer = document.createElement("div");
      this._emojiContainer.className = "compose-emoji-picker";
    }
    (dialog ?? document.body).appendChild(this._emojiContainer);

    // Recreate the picker after every close. emoji-mart doesn't recover its
    // row observers reliably after disconnect/reconnect, which leaves later
    // categories empty on reopen.
    if (!this._emojiPickerEl) {
      const [{ default: data }, { Picker }] = await Promise.all([
        import("@emoji-mart/data"),
        import("emoji-mart"),
      ]);

      // Check we're still open after the async import
      if (!this._showEmojiPicker) return;

      const picker = new Picker({
        data,
        onEmojiSelect: (emoji: { native: string }) => {
          this._insertEmoji(emoji.native);
          this.closeEmojiPicker();
        },
        theme: "auto",
        previewPosition: "none",
        skinTonePosition: "none",
      });
      this._emojiPickerEl = picker as unknown as HTMLElement;
    }

    this._emojiContainer.innerHTML = "";
    this._emojiContainer.appendChild(this._emojiPickerEl);

    // Position relative to the dialog (whose transform makes fixed = absolute)
    const btn = this.querySelector(".compose-emoji-btn");
    if (btn && dialog) {
      const btnRect = btn.getBoundingClientRect();
      const dlgRect = dialog.getBoundingClientRect();
      const pickerWidth = 352;
      const pickerHeight = 435;

      // Button position relative to the dialog
      const btnRelLeft = btnRect.left - dlgRect.left;
      const btnRelTop = btnRect.top - dlgRect.top;

      let left = btnRelLeft + btnRect.width / 2 - pickerWidth / 2;
      left = Math.max(-dlgRect.left + 8, Math.min(left, dlgRect.width - 8));

      let top = btnRelTop - pickerHeight - 8;
      if (dlgRect.top + top < 8) {
        top = btnRelTop + btnRect.height + 8;
      }

      this._emojiContainer.style.left = `${left}px`;
      this._emojiContainer.style.top = `${top}px`;
    }
  }

  private _insertEmoji(emoji: string) {
    const field = this._lastFocusedField;
    if (!field) {
      // Insert into Tiptap editor
      if (this._editor) {
        this._editor.chain().focus().insertContent(emoji).run();
      }
      return;
    }

    const start = field.selectionStart ?? field.value.length;
    const end = field.selectionEnd ?? start;
    const before = field.value.slice(0, start);
    const after = field.value.slice(end);
    const newValue = before + emoji + after;

    // Update the Lit state that corresponds to this field
    field.value = newValue;
    field.dispatchEvent(new Event("input", { bubbles: true }));

    // Restore cursor position after the inserted emoji
    const cursorPos = start + emoji.length;
    globalThis.requestAnimationFrame(() => {
      field.focus();
      field.setSelectionRange(cursorPos, cursorPos);
    });
  }

  // ── Helpers ──────────────────────────────────────────────────────

  private _getCategory(a: ComposeAttachment): MediaCategory {
    return getMediaCategory(a.file.type);
  }

  private _formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  private _formatChars(count: number): string {
    if (count < 1000) return `${count} chars`;
    if (count < 1_000_000) {
      return `${parseFloat((count / 1000).toFixed(1))}k chars`;
    }
    return `${parseFloat((count / 1_000_000).toFixed(1))}M chars`;
  }

  private _renderFileIcon(mimeType: string, size: number) {
    const doc = `<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>`;

    let inner: string;
    if (mimeType === "application/pdf") {
      inner = `<text x="12" y="16.5" text-anchor="middle" fill="currentColor" stroke="none" font-size="6" font-weight="700" font-family="system-ui, sans-serif">PDF</text>`;
    } else if (mimeType === "text/markdown") {
      inner = `<text x="12" y="16.5" text-anchor="middle" fill="currentColor" stroke="none" font-size="10" font-weight="700" font-family="system-ui, sans-serif">#</text>`;
    } else if (mimeType === "text/csv") {
      inner = `<line x1="8" y1="12" x2="16" y2="12"/><line x1="8" y1="15" x2="16" y2="15"/><line x1="8" y1="18" x2="16" y2="18"/><line x1="10.7" y1="12" x2="10.7" y2="18"/><line x1="13.3" y1="12" x2="13.3" y2="18"/>`;
    } else if (getMediaCategory(mimeType) === "archive") {
      inner = `<line x1="12" y1="10" x2="12" y2="11.5"/><line x1="12" y1="13" x2="12" y2="14.5"/><line x1="12" y1="16" x2="12" y2="17.5"/>`;
    } else if (mimeType === "text/html; charset=utf-8") {
      inner = `<line x1="16" y1="11" x2="8" y2="11"/><line x1="16" y1="14" x2="8" y2="14"/><line x1="12" y1="17" x2="8" y2="17"/>`;
    } else {
      // Plain text default — 3 text lines
      inner = `<line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><line x1="10" y1="9" x2="8" y2="9"/>`;
    }

    return html`<svg
      width="${size}"
      height="${size}"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.5"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      ${unsafeSVG(doc + inner)}
    </svg>`;
  }

  private _hasFailedAttachmentPreview(clientId: string): boolean {
    return this._failedAttachmentPreviews.includes(clientId);
  }

  private _setAttachmentPreviewFailure(clientId: string, failed: boolean) {
    const hasFailure = this._failedAttachmentPreviews.includes(clientId);
    if (failed === hasFailure) return;
    this._failedAttachmentPreviews = failed
      ? [...this._failedAttachmentPreviews, clientId]
      : this._failedAttachmentPreviews.filter((id) => id !== clientId);
  }

  private _syncFailedAttachmentPreviews() {
    const attachmentIds = new Set(
      this._attachments.map((item) => item.clientId),
    );
    const nextFailures = this._failedAttachmentPreviews.filter((clientId) =>
      attachmentIds.has(clientId),
    );
    if (nextFailures.length === this._failedAttachmentPreviews.length) return;
    this._failedAttachmentPreviews = nextFailures;
  }

  private _renderAttachmentPreviewFallback(category: "image" | "video") {
    return html`
      <div
        class="compose-attachment-preview-fallback"
        data-preview-failed=${category}
        aria-hidden="true"
      >
        <svg
          width="28"
          height="28"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.5"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <rect x="3.5" y="5" width="17" height="14" rx="2.5" />
          <circle cx="9" cy="10" r="1.25" />
          <path d="m7 16 3.4-3.45 2.65 2.45 2.45-3.05 1.95 2.5" />
        </svg>
        ${category === "video"
          ? html`
              <div class="compose-attachment-play-icon">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="white">
                  <path d="M8 5v14l11-7z" />
                </svg>
              </div>
            `
          : nothing}
      </div>
    `;
  }

  // ── Render helpers ────────────────────────────────────────────────

  private _renderNoteFields() {
    return html`
      <div class="compose-field-enter">
        ${this._showTitle
          ? html`
              <div class="compose-note-title-row">
                <input
                  type="text"
                  .value=${this._title}
                  @input=${(e: Event) => this._onInput("_title", e)}
                  @focus=${(e: Event) => this._onFieldFocus(e)}
                  @keydown=${(e: globalThis.KeyboardEvent) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      this._editor?.commands.focus("start");
                    }
                  }}
                  class="compose-input compose-note-title"
                  placeholder=${this.labels.titlePlaceholder}
                />
                <button
                  type="button"
                  class="compose-note-title-dismiss"
                  @click=${() => {
                    this._showTitle = false;
                  }}
                >
                  ✕
                </button>
              </div>
            `
          : nothing}
        <div class="compose-tiptap-body"></div>
      </div>
    `;
  }

  private _renderLinkFields() {
    const urlError = this._showUrlValidation
      ? this._getInlineUrlValidationMessage()
      : null;
    const titleError = this._showLinkTitleValidation
      ? this._getInlineLinkTitleValidationMessage()
      : null;

    return html`
      <div class="compose-field-enter">
        <div
          class=${classMap({
            "compose-link-url-wrap": true,
            "compose-link-url-wrap-invalid": Boolean(urlError),
          })}
        >
          <span class="text-base opacity-50 shrink-0">🔗</span>
          <input
            type="url"
            .value=${this._url}
            @input=${(e: Event) => this._onInput("_url", e)}
            @focus=${(e: Event) => this._onFieldFocus(e)}
            @blur=${() => {
              this._showUrlValidation = true;
            }}
            class="compose-input compose-url-input"
            placeholder=${this.labels.urlPlaceholder}
            aria-invalid=${urlError ? "true" : "false"}
            aria-describedby=${ifDefined(
              urlError ? this._urlStatusId : undefined,
            )}
          />
        </div>
        ${urlError
          ? html`<p
              id=${this._urlStatusId}
              class="compose-url-status compose-url-status-error"
              data-compose-url-status="error"
            >
              ${urlError}
            </p>`
          : nothing}
        <input
          type="text"
          .value=${this._title}
          @input=${(e: Event) => this._onInput("_title", e)}
          @focus=${(e: Event) => this._onFieldFocus(e)}
          @blur=${() => {
            this._showLinkTitleValidation = true;
          }}
          class="compose-input compose-link-title"
          placeholder=${this.labels.linkTitlePlaceholder}
          aria-invalid=${titleError ? "true" : "false"}
        />
        ${titleError
          ? html`<p
              class="compose-url-status compose-url-status-error"
              data-compose-link-title-error="error"
            >
              ${titleError}
            </p>`
          : nothing}
        <div class="compose-divider"></div>
        <div
          class="compose-tiptap-body compose-tiptap-thoughts compose-tiptap-link"
        ></div>
      </div>
    `;
  }

  private _renderQuoteFields() {
    const urlError = this._showUrlValidation
      ? this.getUrlValidationMessage()
      : null;

    return html`
      <div class="compose-field-enter">
        <div class="compose-quote-wrap">
          ${renderDecorativeQuoteMark("compose-quote-mark")}
          <textarea
            .value=${this._quoteText}
            @input=${(e: Event) => this._onInput("_quoteText", e)}
            @focus=${(e: Event) => this._onFieldFocus(e)}
            class="compose-input compose-quote-text"
            placeholder=${this.labels.quotePlaceholder}
            rows="5"
          ></textarea>
        </div>
        <div class="compose-quote-author-row">
          <span class="compose-quote-dash" aria-hidden="true">—</span>
          <input
            type="text"
            .value=${this._quoteAuthor}
            @input=${(e: Event) => this._onInput("_quoteAuthor", e)}
            @focus=${(e: Event) => this._onFieldFocus(e)}
            class="compose-input compose-quote-author"
            placeholder=${this.labels.authorPlaceholder}
          />
        </div>
        <div class="compose-quote-source">
          <input
            type="url"
            .value=${this._url}
            @input=${(e: Event) => this._onInput("_url", e)}
            @focus=${(e: Event) => this._onFieldFocus(e)}
            @blur=${() => {
              this._showUrlValidation = true;
            }}
            class="compose-input compose-url-input compose-quote-source-input"
            placeholder=${this.labels.sourcePlaceholder}
            aria-invalid=${urlError ? "true" : "false"}
            aria-describedby=${ifDefined(
              urlError ? this._urlStatusId : undefined,
            )}
          />
          ${urlError
            ? html`<p
                id=${this._urlStatusId}
                class="compose-url-status compose-url-status-error"
                data-compose-url-status="error"
              >
                ${urlError}
              </p>`
            : nothing}
        </div>
        <div
          class="compose-divider compose-divider-quote"
          aria-hidden="true"
        ></div>
        <div
          class="compose-tiptap-body compose-tiptap-thoughts compose-tiptap-thoughts-quote"
        ></div>
      </div>
    `;
  }

  private _renderStarRating() {
    if (!this._showRating) return nothing;
    const stars = [1, 2, 3, 4, 5];
    return html`
      <div class="compose-star-rating">
        ${stars.map(
          (n) => html`
            <button
              type="button"
              class=${classMap({
                "compose-star": true,
                "compose-star-filled": this._rating >= n,
              })}
              @click=${() => this._setRating(n)}
            >
              ★
            </button>
          `,
        )}
        ${this._rating > 0
          ? html`<span class="compose-star-label">${this._rating}/5</span>`
          : nothing}
      </div>
    `;
  }

  private _renderAttachmentPreview(a: ComposeAttachment) {
    const category = this._getCategory(a);

    if (category === "video") {
      return html`
        <div class="compose-attachment-thumb">
          <video
            src=${a.previewUrl}
            class="compose-attachment-img"
            preload="metadata"
            muted
          ></video>
          <div class="compose-attachment-play-icon">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="white">
              <path d="M8 5v14l11-7z" />
            </svg>
          </div>
        </div>
      `;
    }

    if (category === "audio") {
      return html`
        <div class="compose-attachment-file-card">
          <div class="compose-attachment-file-icon">
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.5"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="M9 18V5l12-2v13" />
              <circle cx="6" cy="18" r="3" />
              <circle cx="18" cy="16" r="3" />
            </svg>
          </div>
          <span class="compose-attachment-file-name">${a.file.name}</span>
          <span class="compose-attachment-file-size"
            >${this._formatSize(a.file.size)}</span
          >
        </div>
      `;
    }

    if (category === "document") {
      return html`
        <div class="compose-attachment-file-card">
          <div class="compose-attachment-file-icon">
            ${this._renderFileIcon(a.file.type, 20)}
          </div>
          <span class="compose-attachment-file-name">${a.file.name}</span>
          <span class="compose-attachment-file-size"
            >${this._formatSize(a.file.size)}</span
          >
        </div>
      `;
    }

    if (category === "text") {
      return html`
        <div class="compose-attachment-file-card">
          <div class="compose-attachment-file-icon">
            ${this._renderFileIcon(a.file.type, 20)}
          </div>
          <span class="compose-attachment-file-name">${a.file.name}</span>
          ${a.summary
            ? html`<span class="compose-attachment-text-summary"
                >${a.summary}</span
              >`
            : nothing}
          ${typeof a.chars === "number" && a.chars > 0
            ? html`<span class="compose-attachment-file-size"
                >${this._formatChars(a.chars)}</span
              >`
            : nothing}
        </div>
      `;
    }

    // Default for non-visual types: generic file card (archive, office, font, 3d, code, etc.)
    if (category !== "image") {
      return html`
        <div class="compose-attachment-file-card">
          <div class="compose-attachment-file-icon">
            ${this._renderFileIcon(a.file.type, 20)}
          </div>
          <span class="compose-attachment-file-name">${a.file.name}</span>
          <span class="compose-attachment-file-size"
            >${this._formatSize(a.file.size)}</span
          >
        </div>
      `;
    }

    // Image
    return html`
      <div class="compose-attachment-thumb">
        <img src=${a.previewUrl} alt="" class="compose-attachment-img" />
      </div>
    `;
  }

  private _renderAttachmentOverlay(a: ComposeAttachment, index: number) {
    return html`
      ${a.status === "error"
        ? html`
            <button
              type="button"
              class="compose-attachment-overlay compose-attachment-retry"
              @click=${(e: Event) => {
                e.stopPropagation();
                this._retryAllFailed();
              }}
            >
              <span class="compose-retry-content">
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <path
                    d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"
                  />
                  <path d="M3 3v5h5" />
                  <path
                    d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"
                  />
                  <path d="M16 16h5v5" />
                </svg>
                <span class="compose-retry-label">${this.labels.retryAll}</span>
              </span>
              ${a.error
                ? html`<span class="compose-attachment-error-msg"
                    >${a.error}</span
                  >`
                : nothing}
            </button>
          `
        : nothing}
      ${this._renderAttachmentRemoveButton((e: Event) => {
        e.stopPropagation();
        this._removeAttachment(index);
      })}
    `;
  }

  private _renderAttachmentRemoveButton(onClick: (e: Event) => void) {
    return html`
      <button
        type="button"
        class="compose-attachment-remove"
        aria-label=${this.labels.removeAttachment}
        @click=${onClick}
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 14 14"
          fill="none"
          stroke="currentColor"
          stroke-width="1.9"
          stroke-linecap="round"
        >
          <path d="M3.5 3.5 10.5 10.5" />
          <path d="M10.5 3.5 3.5 10.5" />
        </svg>
      </button>
    `;
  }

  private _renderAttachedTextCard(item: AttachedTextItem, index: number) {
    return html`
      <div class="compose-attachment" data-attachment-id=${item.clientId}>
        <div
          class="compose-attachment-thumb compose-attachment-sortable"
          data-attachment-sortable
          tabindex="0"
          @click=${() => this._maybeEditAttachedText(index)}
          @keydown=${(e: globalThis.KeyboardEvent) =>
            this._handleAttachmentKeydown(item.clientId, e, () =>
              this._maybeEditAttachedText(index),
            )}
        >
          <div class="compose-attachment-text-card">
            <div class="compose-attachment-file-icon">
              ${this._renderFileIcon("text/html; charset=utf-8", 20)}
            </div>
            <span class="compose-attachment-text-summary">${item.summary}</span>
            ${item.bodyJson
              ? html`<span class="compose-attachment-file-size"
                  >${this._formatChars(
                    this._extractPlainText(item.bodyJson).length,
                  )}</span
                >`
              : nothing}
          </div>
          ${this._renderAttachmentRemoveButton((e: Event) => {
            e.stopPropagation();
            this._removeAttachedText(index);
          })}
        </div>
      </div>
    `;
  }

  private _renderMediaAttachment(a: ComposeAttachment, i: number) {
    const category = this._getCategory(a);
    const isFileCard = category !== "image" && category !== "video";
    const visualCategory = category === "video" ? "video" : "image";
    const previewFailed = this._hasFailedAttachmentPreview(a.clientId);

    return html`
      <div class="compose-attachment" data-attachment-id=${a.clientId}>
        ${isFileCard
          ? html`
              <div class="compose-attachment-thumb">
                <div
                  class="compose-attachment-sortable"
                  data-attachment-sortable
                  tabindex="0"
                  @keydown=${(e: globalThis.KeyboardEvent) =>
                    this._handleAttachmentKeydown(a.clientId, e)}
                >
                  ${this._renderAttachmentPreview(a)}
                </div>
                ${this._renderAttachmentOverlay(a, i)}
              </div>
            `
          : html`
              <div class="compose-attachment-thumb">
                <div
                  class="compose-attachment-sortable"
                  data-attachment-sortable
                  tabindex="0"
                  @keydown=${(e: globalThis.KeyboardEvent) =>
                    this._handleAttachmentKeydown(a.clientId, e)}
                >
                  ${previewFailed
                    ? this._renderAttachmentPreviewFallback(visualCategory)
                    : category === "video"
                      ? html`
                          <video
                            src=${a.previewUrl}
                            poster=${a.posterUrl ?? nothing}
                            class="compose-attachment-img"
                            preload="metadata"
                            .playsInline=${true}
                            .muted=${true}
                            @loadeddata=${() =>
                              this._setAttachmentPreviewFailure(
                                a.clientId,
                                false,
                              )}
                            @error=${() =>
                              this._setAttachmentPreviewFailure(
                                a.clientId,
                                true,
                              )}
                          ></video>
                          <div class="compose-attachment-play-icon">
                            <svg
                              width="24"
                              height="24"
                              viewBox="0 0 24 24"
                              fill="white"
                            >
                              <path d="M8 5v14l11-7z" />
                            </svg>
                          </div>
                        `
                      : a.status === "processing"
                        ? html`
                            <div class="compose-attachment-processing">
                              <svg
                                class="animate-spin size-5"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                stroke-width="2"
                              >
                                <path
                                  d="M12 2a10 10 0 1 0 10 10"
                                  stroke-linecap="round"
                                />
                              </svg>
                            </div>
                          `
                        : html`
                            <img
                              src=${a.previewUrl}
                              alt=""
                              class="compose-attachment-img"
                              @load=${() =>
                                this._setAttachmentPreviewFailure(
                                  a.clientId,
                                  false,
                                )}
                              @error=${() =>
                                this._setAttachmentPreviewFailure(
                                  a.clientId,
                                  true,
                                )}
                            />
                          `}
                </div>
                ${this._renderAttachmentOverlay(a, i)}
              </div>
            `}
        ${category === "image"
          ? html`
              <button
                type="button"
                class=${classMap({
                  "compose-attachment-alt": true,
                  "compose-attachment-alt-set": a.alt.length > 0,
                })}
                @click=${() => this._openAltPanel(i)}
              >
                ${a.alt.length > 0 ? "ALT" : "+ ALT"}
              </button>
            `
          : nothing}
      </div>
    `;
  }

  private _renderAttachments() {
    if (this._attachments.length === 0 && this._attachedTexts.length === 0)
      return nothing;

    return html`
      <div class="compose-attachments" data-attachment-list>
        ${this._attachmentOrder.map((clientId) => {
          const mediaIndex = this._attachments.findIndex(
            (a) => a.clientId === clientId,
          );
          if (mediaIndex !== -1) {
            return this._renderMediaAttachment(
              this._attachments[mediaIndex],
              mediaIndex,
            );
          }
          const textIndex = this._attachedTexts.findIndex(
            (t) => t.clientId === clientId,
          );
          if (textIndex !== -1) {
            return this._renderAttachedTextCard(
              this._attachedTexts[textIndex],
              textIndex,
            );
          }
          return nothing;
        })}
      </div>
    `;
  }

  private _renderAttachmentDock() {
    if (this._attachments.length === 0 && this._attachedTexts.length === 0)
      return nothing;

    return html`
      <div class="compose-attachments-dock">${this._renderAttachments()}</div>
    `;
  }

  private _renderToolsRow() {
    const hasAttached = this._attachedTexts.length > 0;
    return html`
      <div class="compose-tools-row">
        <button
          type="button"
          class=${classMap({
            "compose-tool-btn": true,
            "compose-tool-btn-add": this._attachments.length > 0,
          })}
          title=${this._attachments.length > 0 ? "" : this.labels.media}
          @click=${() => this._openFilePicker()}
        >
          ${renderComposeToolbarIcon(COMPOSE_TOOLBAR_ICONS.media)}
          ${this._attachments.length > 0
            ? html`<span class="compose-tool-label"
                >${this.labels.addMore}</span
              >`
            : nothing}
        </button>

        <button
          type="button"
          class=${classMap({
            "compose-tool-btn": true,
            "compose-tool-btn-add": hasAttached,
          })}
          title=${hasAttached ? "" : this.labels.attachedText}
          @click=${() => this._openAttachedText()}
        >
          ${renderComposeToolbarIcon(COMPOSE_TOOLBAR_ICONS.attachedText)}
          ${hasAttached
            ? html`<span class="compose-tool-label"
                >${this.labels.addMore}</span
              >`
            : nothing}
        </button>

        <button
          type="button"
          class=${classMap({
            "compose-tool-btn": true,
            "compose-emoji-btn": true,
            "compose-tool-btn-active": this._showEmojiPicker,
          })}
          title=${this.labels.emoji}
          @click=${() => this._toggleEmojiPicker()}
        >
          ${renderComposeToolbarIcon(COMPOSE_TOOLBAR_ICONS.emoji)}
        </button>

        <div class="compose-tool-sep"></div>

        <button
          type="button"
          class=${classMap({
            "compose-tool-btn": true,
            "compose-tool-btn-active": this._showRating,
          })}
          title=${this.labels.rate}
          @click=${() => {
            const willShow = !this._showRating;
            this._showRating = willShow;
            if (willShow) {
              this.updateComplete.then(() => {
                this.querySelector<HTMLElement>(
                  ".compose-star-rating",
                )?.scrollIntoView({ block: "nearest", behavior: "smooth" });
              });
            }
          }}
        >
          ${renderComposeToolbarIcon(COMPOSE_TOOLBAR_ICONS.rate)}
        </button>

        ${this.format === "note"
          ? html`
              <button
                type="button"
                class=${classMap({
                  "compose-tool-btn": true,
                  "compose-tool-btn-active": this._showTitle,
                })}
                title=${this.labels.title}
                @click=${() => {
                  const willShow = !this._showTitle;
                  this._showTitle = willShow;
                  if (willShow) {
                    this.updateComplete.then(() => {
                      this.querySelector<HTMLInputElement>(
                        ".compose-note-title",
                      )?.focus();
                    });
                  }
                }}
              >
                ${renderComposeToolbarIcon(COMPOSE_TOOLBAR_ICONS.title)}
              </button>
            `
          : nothing}
        ${this.format === "note"
          ? html`
              <div class="compose-tool-view-group">
                <button
                  type="button"
                  class="compose-tool-btn compose-tool-btn-view"
                  title=${this.labels.fullscreen}
                  aria-label=${this.labels.fullscreen}
                  @click=${() => this.openFullscreen()}
                >
                  ${renderComposeToolbarIcon(COMPOSE_TOOLBAR_ICONS.fullscreen)}
                </button>
              </div>
            `
          : nothing}
      </div>
    `;
  }

  private _renderThreadPostHeader() {
    const formatLabels: Record<ComposeFormat, string> = {
      note: this.labels.note,
      link: this.labels.link,
      quote: this.labels.quote,
    };
    const formats: ComposeFormat[] = ["note", "link", "quote"];
    const CLOSE_ICON = `<path d="M4.5 4.5 11.5 11.5M11.5 4.5 4.5 11.5"/>`;

    return html`
      <div class="compose-thread-post-header">
        <div class="compose-segmented compose-thread-segmented">
          <div
            class=${classMap({
              "compose-format-pill": true,
              "compose-format-pill-link": this.format === "link",
              "compose-format-pill-quote": this.format === "quote",
            })}
          ></div>
          ${formats.map(
            (f) => html`
              <button
                type="button"
                class=${classMap({
                  "compose-segmented-item": true,
                  "compose-segmented-item-active": this.format === f,
                })}
                @click=${() => {
                  if (this.format !== f) {
                    this.dispatchEvent(
                      new CustomEvent("jant:thread-format-change", {
                        bubbles: true,
                        detail: { format: f },
                      }),
                    );
                  }
                }}
              >
                ${formatLabels[f]}
              </button>
            `,
          )}
        </div>
        ${this.removable
          ? html`<button
              type="button"
              class="compose-thread-post-remove"
              title="Remove post"
              @click=${() => {
                this.dispatchEvent(
                  new CustomEvent("jant:thread-remove", { bubbles: true }),
                );
              }}
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
                ${unsafeSVG(CLOSE_ICON)}
              </svg>
            </button>`
          : nothing}
      </div>
    `;
  }

  openFullscreen() {
    if (this.format !== "note") return;
    const state = this.getEditorState();
    this.dispatchEvent(
      new CustomEvent<ComposeFullscreenOpenDetail>("jant:fullscreen-open", {
        bubbles: true,
        detail: { ...state, labels: this.labels },
      }),
    );
  }

  render() {
    return html`
      ${this.threadItem ? this._renderThreadPostHeader() : nothing}
      <section class="compose-body">
        ${this.format === "note"
          ? this._renderNoteFields()
          : this.format === "link"
            ? this._renderLinkFields()
            : this._renderQuoteFields()}
        ${this._renderStarRating()}
      </section>
      ${this._renderAttachmentDock()} ${this._renderToolsRow()}
    `;
  }
}

customElements.define("jant-compose-editor", JantComposeEditor);
