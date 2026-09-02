/**
 * Compose Fullscreen (Zen Mode)
 *
 * Full-screen overlay editor with its own Tiptap instance.
 * Opens from compose editor via jant:fullscreen-open event,
 * returns content via jant:fullscreen-close event.
 *
 * Light DOM only — BaseCoat and Tailwind classes apply directly.
 */

import { LitElement, html, nothing } from "lit";
import { classMap } from "lit/directives/class-map.js";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
import type { Editor, JSONContent } from "@tiptap/core";
import type {
  ComposeEditorSelection,
  ComposeLabels,
  ComposeFullscreenCloseDetail,
  ComposeFullscreenOpenDetail,
  ComposeFullscreenReplyContext,
} from "./compose-types.js";
import { createTiptapEditor } from "../tiptap/create-editor.js";
import { uploadAndInsertInlineImage } from "../tiptap/inline-image-upload.js";
import { getInlineImageNodeLabels } from "./inline-image-issues.js";

const ESCAPE_OVERLAY_SELECTOR =
  ".tiptap-slash-menu, .tiptap-link-input, .tiptap-table-size-picker, .tiptap-table-options:not([hidden])";

export class JantComposeFullscreen extends LitElement {
  static properties = {
    labels: { type: Object },
    _open: { state: true },
    _title: { state: true },
    _showTitle: { state: true },
    _replyContext: { state: true },
    _replyExpanded: { state: true },
  };

  declare labels: ComposeLabels;
  declare _open: boolean;
  declare _title: string;
  declare _showTitle: boolean;
  declare _replyContext: ComposeFullscreenReplyContext | null;
  declare _replyExpanded: boolean;

  private _editor: Editor | null = null;
  private _content: JSONContent | null = null;
  private _selection: ComposeEditorSelection | null = null;
  private _editorIndex = 0;
  private _fileInput: HTMLInputElement | null = null;
  #inlineImageUploadPromises = new Set<Promise<void>>();

  createRenderRoot() {
    return this;
  }

  constructor() {
    super();
    this.labels = {} as ComposeLabels;
    this._open = false;
    this._title = "";
    this._showTitle = true;
    this._replyContext = null;
    this._replyExpanded = false;
  }

  connectedCallback() {
    super.connectedCallback();
    document.addEventListener(
      "jant:fullscreen-open",
      this._onOpen as EventListener,
    );
    document.addEventListener("jant:slash-image", this._onSlashImage);
    document.addEventListener("keydown", this._onDocumentKeydown, true);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    document.removeEventListener(
      "jant:fullscreen-open",
      this._onOpen as EventListener,
    );
    document.removeEventListener("jant:slash-image", this._onSlashImage);
    document.removeEventListener("keydown", this._onDocumentKeydown, true);
    this._fileInput?.remove();
    this._destroyEditor();
  }

  private _onSlashImage = () => {
    if (!this._open || !this._editor) return;
    this._triggerImagePicker();
  };

  private _triggerImagePicker() {
    if (!this._fileInput) {
      this._fileInput = document.createElement("input");
      this._fileInput.type = "file";
      this._fileInput.accept = "image/*";
      this._fileInput.style.display = "none";
      this._fileInput.addEventListener("change", () => {
        const file = this._fileInput?.files?.[0];
        if (file && this._editor) {
          this._uploadAndInsertImage(file);
        }
        if (this._fileInput) this._fileInput.value = "";
      });
      document.body.appendChild(this._fileInput);
    }
    this._fileInput.click();
  }

  private _uploadAndInsertImage(file: File) {
    const editor = this._editor;
    if (!editor) return Promise.resolve();

    const uploadPromise = uploadAndInsertInlineImage(editor, file).finally(
      () => {
        this.#inlineImageUploadPromises.delete(uploadPromise);
      },
    );
    this.#inlineImageUploadPromises.add(uploadPromise);
    return uploadPromise;
  }

  private _onOpen = (e: CustomEvent<ComposeFullscreenOpenDetail>) => {
    this._content = e.detail.json;
    this._selection = e.detail.selection ?? null;
    this._title = e.detail.title;
    if (e.detail.labels) {
      this.labels = e.detail.labels;
    }
    this._showTitle = e.detail.showTitle || e.detail.title.trim().length > 0;
    this._replyContext = e.detail.replyContext ?? null;
    this._replyExpanded = e.detail.replyContext?.expanded ?? false;
    this._editorIndex = e.detail.editorIndex ?? 0;
    this._open = true;
    this.updateComplete.then(() => {
      const dialog = this.querySelector<HTMLDialogElement>(
        ".compose-fullscreen-dialog",
      );
      if (dialog && !dialog.open) {
        dialog.showModal();
      }
      this._initEditor();
    });
  };

  private _initEditor() {
    const container = this.querySelector<HTMLElement>(
      ".compose-fullscreen .compose-tiptap-body",
    );
    if (!container || this._editor) return;

    this._editor = createTiptapEditor({
      element: container,
      placeholder: this.labels.bodyPlaceholder ?? "Write something…",
      content: this._content,
      toolbarMode: "compose",
      onUpdate: (json) => {
        this._content = json;
      },
      pasteMedia: {
        shouldInsertInline: (file) => file.type.startsWith("image/"),
        uploadInlineImage: (file) => this._uploadAndInsertImage(file),
      },
      imageNodeLabels: getInlineImageNodeLabels(this.labels),
      tableControlLabels: this.labels.tableControls,
    });

    const selection = this._selection;
    if (selection) {
      const max = this._editor.state.doc.content.size;
      const from = Math.max(1, Math.min(selection.from, max));
      const to = Math.max(from, Math.min(selection.to, max));
      this._selection = { from, to };
      this._editor.chain().focus().setTextSelection({ from, to }).run();
      return;
    }

    this._editor.commands.focus();
  }

  private _destroyEditor() {
    this.#inlineImageUploadPromises.clear();
    this._editor?.destroy();
    this._editor = null;
  }

  private _onDialogCancel = (e: Event) => {
    // Intercept Escape key to save content back instead of just closing
    e.preventDefault();
    void this._close();
  };

  private _onDocumentKeydown = (e: globalThis.KeyboardEvent) => {
    if (!this._open) return;
    // Let IME consume keys during composition (e.g. CJK candidate selection).
    if (e.isComposing || e.keyCode === 229) return;

    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      e.stopPropagation();
      this._publish();
      return;
    }

    if (e.key !== "Escape") return;
    if (this._hasActiveEscapeOverlay()) return;

    e.preventDefault();
    e.stopPropagation();
    void this._close();
  };

  private _hasActiveEscapeOverlay(): boolean {
    const dialog = this.querySelector<HTMLDialogElement>(
      ".compose-fullscreen-dialog[open]",
    );
    if (!dialog) return false;

    return Array.from(
      dialog.querySelectorAll<HTMLElement>(ESCAPE_OVERLAY_SELECTOR),
    ).some((el) => getComputedStyle(el).display !== "none");
  }

  private _finishClose(intent?: "publish") {
    const json = this._editor?.getJSON() ?? this._content;
    const selection = this._editor
      ? {
          from: this._editor.state.selection.from,
          to: this._editor.state.selection.to,
        }
      : this._selection;
    this._destroyEditor();

    // Close the modal dialog before Lit removes it from DOM
    const dialog = this.querySelector<HTMLDialogElement>(
      ".compose-fullscreen-dialog",
    );
    dialog?.close();
    this._open = false;
    this._replyContext = null;

    // Dispatch on document so the compose dialog (a separate subtree) receives it
    document.dispatchEvent(
      new CustomEvent<ComposeFullscreenCloseDetail>("jant:fullscreen-close", {
        bubbles: true,
        detail: {
          json,
          title: this._title,
          showTitle: this._showTitle || this._title.trim().length > 0,
          selection,
          replyExpanded: this._replyExpanded,
          intent,
          editorIndex: this._editorIndex,
        },
      }),
    );
  }

  private _close() {
    if (!this._open) return;
    this._finishClose();
  }

  private _publish() {
    if (!this._open) return;
    this._finishClose("publish");
  }

  private _revealTitle() {
    this._showTitle = true;
    this.updateComplete.then(() => {
      this.querySelector<HTMLInputElement>(
        ".compose-fullscreen-title",
      )?.focus();
    });
  }

  private _renderTitleField(variant: "note" | "reply") {
    const titleClasses = classMap({
      "compose-fullscreen-title": true,
      "compose-fullscreen-title-reply": variant === "reply",
    });
    const placeholderClasses = classMap({
      "compose-fullscreen-title-placeholder": true,
      "compose-fullscreen-title-placeholder-reply": variant === "reply",
    });

    return this._showTitle
      ? html`
          <div class="compose-fullscreen-title-shell">
            <input
              type="text"
              .value=${this._title}
              @input=${(e: Event) => {
                this._title = (e.target as HTMLInputElement).value;
              }}
              @keydown=${(e: globalThis.KeyboardEvent) => {
                if (e.isComposing || e.keyCode === 229) return;
                if (e.key === "Enter") {
                  e.preventDefault();
                  this._editor?.commands.focus("start");
                }
              }}
              class=${titleClasses}
              placeholder=${this.labels.titlePlaceholder ?? "Title"}
            />
          </div>
        `
      : html`
          <button
            type="button"
            class=${placeholderClasses}
            @click=${() => this._revealTitle()}
          >
            ${this.labels.titlePlaceholder || this.labels.title || "Title"}
          </button>
        `;
  }

  render() {
    if (!this._open) return nothing;

    const replyContext = this._replyContext;
    const editorSurface = (variant: "note" | "reply") => html`
      <div
        class=${classMap({
          "compose-fullscreen-editor-surface": true,
          "compose-fullscreen-editor-surface-reply": variant === "reply",
        })}
      >
        ${this._renderTitleField(variant)}
        <div class="compose-tiptap-body"></div>
      </div>
    `;

    return html`
      <dialog
        class="compose-fullscreen-dialog"
        aria-label=${this.labels.fullscreen || this.labels.note || "Fullscreen"}
        @cancel=${this._onDialogCancel}
      >
        <div class="compose-fullscreen">
          <header class="compose-fullscreen-toolbar">
            <div class="compose-fullscreen-toolbar-inner">
              <button
                type="button"
                class="compose-fullscreen-done"
                title=${this.labels.exitFullscreen || "Exit fullscreen"}
                aria-label=${this.labels.exitFullscreen || "Exit fullscreen"}
                @click=${() => void this._close()}
              >
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 18 18"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.48"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <path d="M3 6.85h2.85V4" />
                  <path d="M15 6.85h-2.85V4" />
                  <path d="M6.85 15V12.15H4" />
                  <path d="M11.15 15V12.15H14" />
                </svg>
              </button>
            </div>
          </header>
          <div class="compose-fullscreen-content">
            <div class="compose-fullscreen-inner">
              ${
                replyContext
                  ? html`
                      <div
                        class="compose-thread-layout compose-fullscreen-thread-layout"
                      >
                        <div class="compose-reply-row">
                          <div class="compose-thread-dot"></div>
                          <div
                            class=${classMap({
                              "compose-reply-context": true,
                              expanded: this._replyExpanded,
                            })}
                          >
                            <div class="compose-reply-context-body">
                              ${unsafeHTML(replyContext.contentHtml)}
                            </div>
                            ${
                              !this._replyExpanded
                                ? html`<div class="compose-reply-fade"></div>`
                                : nothing
                            }
                          </div>
                        </div>
                        <div class="compose-reply-meta">
                          ${
                            replyContext.dateText
                              ? html`<span>${replyContext.dateText}</span
                                  ><span>·</span>`
                              : nothing
                          }
                          <button
                            type="button"
                            class="compose-reply-toggle"
                            @click=${() => {
                              this._replyExpanded = !this._replyExpanded;
                            }}
                          >
                            ${
                              this._replyExpanded
                                ? this.labels.showLess
                                : this.labels.showMore
                            }
                          </button>
                        </div>
                        <div
                          class="compose-editor-row compose-fullscreen-editor-row is-current"
                        >
                          <div class="compose-thread-dot"></div>
                          ${editorSurface("reply")}
                        </div>
                      </div>
                    `
                  : editorSurface("note")
              }
            </div>
          </div>
        </div>
      </dialog>
    `;
  }
}

customElements.define("jant-compose-fullscreen", JantComposeFullscreen);
