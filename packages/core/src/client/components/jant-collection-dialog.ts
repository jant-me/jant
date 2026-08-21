/**
 * Collection Dialog
 *
 * Creating and editing a collection are the same surface, the way they already
 * are for a smart collection. There is no editor page: a collection is a
 * title, an address, a description and an ordering, and sending the author to
 * a separate page — and back again — to decide four things was the whole cost
 * of the old flow.
 *
 * Delete is not here. Every menu that opens this dialog offers it one item
 * away from Edit, and a destructive button sharing a row with Save is a
 * misclick waiting to happen.
 *
 * Light DOM only — BaseCoat and Tailwind classes apply directly.
 */

import { LitElement, html, nothing } from "lit";
import type { Editor } from "@tiptap/core";
import { getCollectionPagePath } from "../../lib/collection-paths.js";
import { getSlugValidationIssue, truncateSlug } from "../../lib/slug-format.js";
import {
  COLLECTION_SORT_ORDERS,
  MAX_COLLECTION_SLUG_LENGTH,
  MAX_COLLECTION_TITLE_LENGTH,
} from "../../types/constants.js";
import type { Collection, CollectionSortOrder } from "../../types.js";
import { slugify } from "../lazy-slugify.js";
import { publicPath } from "../runtime-paths.js";
import { showToast } from "../toast.js";
import {
  createSettingsEditor,
  jsonToMarkdown,
} from "../tiptap/create-editor.js";
import type {
  CollectionDialogLabels,
  CollectionDialogResult,
} from "./collection-dialog-types.js";

/** How long to wait after a keystroke before asking whether an address is free. */
const SLUG_DEBOUNCE_MS = 250;

/**
 * Lucide `circle-alert`.
 *
 * Not decoration: `.alert` lays its text out in the second grid column, and the
 * first column only has a width when there is an icon in it.
 */
const ALERT_ICON = html`<svg
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"
>
  <circle cx="12" cy="12" r="10" />
  <line x1="12" x2="12" y1="8" y2="12" />
  <line x1="12" x2="12.01" y1="16" y2="16" />
</svg>`;

export class JantCollectionDialog extends LitElement {
  static properties = {
    labels: { type: Object },

    _open: { state: true },
    _mode: { state: true },
    _id: { state: true },
    _title: { state: true },
    _slug: { state: true },
    _slugEdited: { state: true },
    _slugState: { state: true },
    _slugOpen: { state: true },
    _sortOrder: { state: true },
    _saving: { state: true },
    _error: { state: true },
  };

  declare labels: CollectionDialogLabels;

  declare _open: boolean;
  declare _mode: "create" | "edit";
  declare _id: string | null;
  declare _title: string;
  declare _slug: string;
  declare _slugEdited: boolean;
  declare _slugState: "unknown" | "checking" | "available" | "taken";
  declare _slugOpen: boolean;
  declare _sortOrder: CollectionSortOrder;
  declare _saving: boolean;
  declare _error: string;

  /**
   * The description, in markdown.
   *
   * Not reactive state: the editor owns the text once it is mounted, and a
   * re-render on every keystroke would fight it for the DOM.
   */
  #description = "";
  /** Set when the dialog was opened on an existing link that must not move. */
  #originalSlug = "";
  /** The link the current title would produce, for "Reset link". */
  #suggestedSlug = "";
  #resolve: ((result: CollectionDialogResult) => void) | null = null;
  #slugTimer: ReturnType<typeof setTimeout> | null = null;
  #editor: Editor | null = null;

  createRenderRoot() {
    this.innerHTML = "";
    return this;
  }

  constructor() {
    super();
    this.labels = {} as CollectionDialogLabels;
    this._open = false;
    this._mode = "create";
    this._id = null;
    this._title = "";
    this._slug = "";
    this._slugEdited = false;
    this._slugState = "unknown";
    this._slugOpen = false;
    this._sortOrder = "newest";
    this._saving = false;
    this._error = "";
  }

  /**
   * Open the dialog, and resolve once it closes.
   *
   * @param options.collectionId - Edit this one; omit to create
   * @returns What happened, and the collection when one was saved
   */
  async open(options: {
    collectionId?: string;
  }): Promise<CollectionDialogResult> {
    this.#reset();

    if (options.collectionId) {
      const loaded = await this.#load(options.collectionId);
      if (!loaded) return { changed: false };
    }

    this._open = true;
    await this.updateComplete;
    this.#mountEditor();
    this.#showDialog();

    return new Promise<CollectionDialogResult>((resolve) => {
      this.#resolve = resolve;
    });
  }

  #reset() {
    this._mode = "create";
    this._id = null;
    this._title = "";
    this._slug = "";
    this._slugEdited = false;
    this._slugState = "unknown";
    this._slugOpen = false;
    this._sortOrder = "newest";
    this._saving = false;
    this._error = "";
    this.#description = "";
    this.#originalSlug = "";
    this.#suggestedSlug = "";
  }

  async #load(id: string): Promise<boolean> {
    try {
      const res = await fetch(publicPath(`/api/collections/${id}`));
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const loaded = (await res.json()) as Collection;
      this._mode = "edit";
      this._id = loaded.id;
      this._title = loaded.title ?? "";
      this._slug = loaded.slug ?? "";
      this.#originalSlug = loaded.slug ?? "";
      this._slugEdited = true;
      this.#description = loaded.description ?? "";
      this._sortOrder = loaded.sortOrder ?? "newest";
      return true;
    } catch {
      showToast(this.labels.loadFailed, "error");
      return false;
    }
  }

  #showDialog() {
    const dialog = this.querySelector<HTMLDialogElement>(".collection-dialog");
    if (!dialog) return;
    if (!dialog.open) dialog.showModal();
    // Initial focus lands on the first thing the author types into, not on the
    // dialog shell.
    this.querySelector<HTMLInputElement>("[data-field='title']")?.focus();
  }

  #close(result: CollectionDialogResult) {
    const dialog = this.querySelector<HTMLDialogElement>(".collection-dialog");
    if (dialog?.open) dialog.close();
    this._open = false;
    if (this.#slugTimer) clearTimeout(this.#slugTimer);
    this.#destroyEditor();
    const resolve = this.#resolve;
    this.#resolve = null;
    resolve?.(result);
  }

  // --- Description ---------------------------------------------------------

  /**
   * Mount the rich-text editor into the opened dialog.
   *
   * Built on open and destroyed on close rather than kept alive: the dialog is
   * reused across collections, and an editor holding the previous one's text
   * would need clearing anyway.
   */
  #mountEditor() {
    const container = this.querySelector<HTMLElement>(
      "[data-collection-description]",
    );
    if (!container || this.#editor) return;

    this.#editor = createSettingsEditor({
      element: container,
      placeholder: this.labels.descriptionPlaceholder,
      content: this.#description || undefined,
      onUpdate: (markdown) => {
        this.#description = markdown;
        if (this._error) this._error = "";
      },
    });

    // Normalize the loaded markdown through the same round trip a keystroke
    // would take, so saving without touching it is not an edit.
    this.#description = jsonToMarkdown(this.#editor.getJSON());
  }

  #destroyEditor() {
    this.#editor?.destroy();
    this.#editor = null;
  }

  // --- Address -------------------------------------------------------------

  #onTitleInput(value: string) {
    this._title = value;
    if (this._slugEdited) return;
    void this.#suggestSlug();
  }

  async #suggestSlug() {
    const title = this._title.trim();
    if (!title) {
      this.#suggestedSlug = "";
      this._slug = "";
      this._slugState = "unknown";
      return;
    }
    // Local first so the field never lags behind typing; the server only
    // resolves collisions.
    const suggested = truncateSlug(
      await slugify(title),
      MAX_COLLECTION_SLUG_LENGTH,
    );
    // Typing carried on while `slugify` loaded its dictionary; that later
    // keystroke owns the address now.
    if (this._slugEdited || this._title.trim() !== title) return;
    this.#suggestedSlug = suggested;
    this._slug = suggested;
    this.#scheduleSlugCheck();
  }

  #onSlugInput(value: string) {
    this._slugEdited = true;
    this._slug = value.trim().toLowerCase();
    this.#scheduleSlugCheck();
  }

  #scheduleSlugCheck() {
    if (this.#slugTimer) clearTimeout(this.#slugTimer);
    this._slugState = "checking";
    this.#slugTimer = setTimeout(
      () => void this.#checkSlug(),
      SLUG_DEBOUNCE_MS,
    );
  }

  async #checkSlug() {
    const slug = this._slug;
    if (!slug) {
      this._slugState = "unknown";
      return;
    }
    // A link with bad characters is not "taken", and saying so sends the author
    // hunting for a collision that does not exist.
    if (this.#slugFormatIssue() !== null) {
      this._slugState = "taken";
      return;
    }
    try {
      const params = new URLSearchParams({ mode: "check", slug });
      if (this._id) params.set("collectionId", this._id);
      const res = await fetch(
        publicPath(`/api/collections/slug?${params.toString()}`),
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as { available: boolean };
      if (slug !== this._slug) return;
      this._slugState = json.available ? "available" : "taken";
    } catch {
      if (slug !== this._slug) return;
      this._slugState = "unknown";
    }
  }

  #slugFormatIssue(): "invalid" | "reserved" | "too_long" | null {
    return getSlugValidationIssue(this._slug, {
      maxLength: MAX_COLLECTION_SLUG_LENGTH,
    });
  }

  /** Why this link is refused, or null when it is fine. */
  #slugProblem(): string | null {
    const issue = this.#slugFormatIssue();
    if (issue === "invalid") return this.labels.linkInvalid;
    if (issue === "reserved") return this.labels.linkReserved;
    if (issue === "too_long") return this.labels.linkTooLong;
    if (this._slugState === "taken") return this.labels.linkTaken;
    return null;
  }

  /** The whole URL, because that is the thing being decided. */
  #linkPreview(): string {
    const path = publicPath(getCollectionPagePath(this._slug));
    const origin =
      globalThis.location?.origin && globalThis.location.origin !== "null"
        ? globalThis.location.origin
        : "http://localhost";
    return new URL(path, `${origin}/`).toString();
  }

  #openSlugEditor() {
    if (this._slugOpen) return;
    this._slugOpen = true;
    void this.updateComplete.then(() => {
      const input = this.querySelector<HTMLInputElement>("[data-field='slug']");
      input?.focus();
      input?.select();
    });
  }

  #resetSlug() {
    if (!this.#suggestedSlug) return;
    this._slug = this.#suggestedSlug;
    this._slugEdited = false;
    this.#scheduleSlugCheck();
  }

  /**
   * The link, folded away until the author wants it.
   *
   * The title already answers it, and the whole URL says more than a bare slug
   * does — the same shape the smart collection dialog uses.
   */
  #renderLink() {
    if (!this._slug && !this._slugOpen) return nothing;

    const problem = this.#slugProblem();
    const moved = this._mode === "edit" && this._slug !== this.#originalSlug;

    if (!this._slugOpen) {
      return html`
        <div class="collection-quick-link-box">
          <div class="collection-quick-link-row">
            <p
              class="collection-quick-link-preview text-xs text-muted-foreground"
              aria-live="polite"
            >
              ${this.#linkPreview()}
            </p>
            <button
              type="button"
              class="collection-quick-link-action"
              @click=${() => this.#openSlugEditor()}
            >
              ${this.labels.editLink}
            </button>
          </div>
          ${problem
            ? html`<p class="collection-dialog-link-problem">${problem}</p>`
            : nothing}
          ${moved
            ? html`<p class="collection-dialog-link-problem">
                ${this.labels.linkMovesWarning}
              </p>`
            : nothing}
        </div>
      `;
    }

    const canReset =
      Boolean(this.#suggestedSlug) && this._slug !== this.#suggestedSlug;

    return html`
      <div class="collection-quick-link-editor">
        <div class="field">
          <div class="collection-quick-link-row">
            <label class="label mb-0" for="collection-dialog-slug"
              >${this.labels.link}</label
            >
            ${canReset
              ? html`
                  <button
                    type="button"
                    class="collection-quick-link-action"
                    @click=${() => this.#resetSlug()}
                  >
                    ${this.labels.resetLink}
                  </button>
                `
              : nothing}
          </div>
          <input
            id="collection-dialog-slug"
            class="input"
            type="text"
            data-field="slug"
            required
            maxlength=${MAX_COLLECTION_SLUG_LENGTH}
            autocomplete="off"
            autocapitalize="off"
            spellcheck="false"
            aria-invalid=${problem ? "true" : "false"}
            .value=${this._slug}
            @input=${(event: Event) =>
              this.#onSlugInput((event.target as HTMLInputElement).value)}
          />
          ${problem
            ? html`<p class="collection-dialog-link-problem">${problem}</p>`
            : this._slug
              ? html`<p class="collection-dialog-link-preview">
                  ${this.#linkPreview()}
                </p>`
              : html`<p class="collection-dialog-link-help">
                  ${this.labels.linkHelp}
                </p>`}
          ${moved
            ? html`<p class="collection-dialog-link-problem">
                ${this.labels.linkMovesWarning}
              </p>`
            : nothing}
        </div>
      </div>
    `;
  }

  // --- Save ----------------------------------------------------------------

  /**
   * Why this cannot be saved yet, or null when it can.
   *
   * One answer for the Save button, the Enter key, and the error line: a button
   * greyed out for a reason the author is never told is the usual way this
   * goes wrong, so the reason is always the message they would have got.
   */
  #blockingIssue(): string | null {
    if (!this._title.trim() || !this._slug) {
      return this.labels.titleAndLinkRequired;
    }
    return this.#slugProblem();
  }

  async #save() {
    if (this._saving) return;
    const issue = this.#blockingIssue();
    if (issue) {
      this._error = issue;
      return;
    }

    this._saving = true;
    this._error = "";

    const title = this._title.trim();
    const description = this.#description.trim();
    const body: Record<string, unknown> = {
      slug: this._slug,
      title,
      sortOrder: this._sortOrder,
    };
    // Creating refuses an explicit null, and only an edit can be clearing a
    // description that used to be there.
    if (description) body.description = description;
    else if (this._id) body.description = null;

    try {
      const res = await fetch(
        publicPath(
          this._id ? `/api/collections/${this._id}` : "/api/collections",
        ),
        {
          method: this._id ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      const json = (await res.json().catch(() => null)) as
        | (Partial<Collection> & { error?: string })
        | null;

      if (!res.ok) {
        this._error = json?.error ?? this.labels.saveFailed;
        return;
      }

      showToast(this.labels.saved);
      this.#close({
        changed: true,
        collection: {
          id: json?.id ?? this._id ?? "",
          slug: json?.slug ?? this._slug,
          title: json?.title ?? title,
        },
      });
    } catch {
      this._error = this.labels.saveFailed;
    } finally {
      this._saving = false;
    }
  }

  // --- Keyboard ------------------------------------------------------------

  /**
   * Escape and Enter, handled on the component rather than only on the
   * `<dialog>`.
   *
   * A native `cancel` event is not reliable here: the description editor
   * intercepts `keydown`, so Escape inside it never reaches the dialog. The
   * component-level handler is what actually holds.
   */
  #onKeydown = (event: KeyboardEvent) => {
    if (!this._open) return;

    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      this.#close({ changed: false });
      return;
    }

    if (event.key === "Enter") {
      const target = event.target as HTMLElement | null;
      // Enter inside the description is a new paragraph, not a submit.
      if (target?.isContentEditable) return;
      if (target?.tagName === "TEXTAREA") return;
      event.preventDefault();
      void this.#save();
    }
  };

  connectedCallback() {
    super.connectedCallback();
    this.addEventListener("keydown", this.#onKeydown);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.removeEventListener("keydown", this.#onKeydown);
    if (this.#slugTimer) clearTimeout(this.#slugTimer);
    this.#destroyEditor();
  }

  // --- Render --------------------------------------------------------------

  render() {
    if (!this._open) return nothing;

    const heading =
      this._mode === "edit"
        ? this.labels.editHeading
        : this.labels.createHeading;

    return html`
      <dialog
        class="dialog collection-dialog"
        @cancel=${(event: Event) => {
          event.preventDefault();
          this.#close({ changed: false });
        }}
        @click=${(event: Event) => {
          if (event.target === event.currentTarget) {
            this.#close({ changed: false });
          }
        }}
      >
        <div
          class="collection-dialog-panel"
          role="dialog"
          aria-modal="true"
          aria-labelledby="collection-dialog-title"
          @click=${(event: Event) => event.stopPropagation()}
        >
          <header class="collection-dialog-header">
            <h2 id="collection-dialog-title" class="collection-dialog-title">
              ${heading}
            </h2>
          </header>

          <div
            class="collection-dialog-body"
            @input=${() => {
              this._error = "";
            }}
            @change=${() => {
              this._error = "";
            }}
          >
            <div class="field">
              <label for="collection-dialog-title-field"
                >${this.labels.title}</label
              >
              <input
                id="collection-dialog-title-field"
                class="input"
                type="text"
                data-field="title"
                required
                maxlength=${MAX_COLLECTION_TITLE_LENGTH}
                placeholder=${this._mode === "edit"
                  ? nothing
                  : this.labels.titlePlaceholder}
                .value=${this._title}
                @input=${(event: Event) =>
                  this.#onTitleInput((event.target as HTMLInputElement).value)}
              />
            </div>

            ${this.#renderLink()}

            <div class="field">
              <!-- The label carries no "for": the editor is a contenteditable
                   region, not a labelable control. -->
              <label>${this.labels.description}</label>
              <div
                class="settings-tiptap-editor"
                data-collection-description
              ></div>
            </div>

            <div class="field">
              <label for="collection-dialog-sort">${this.labels.orderBy}</label>
              <select
                id="collection-dialog-sort"
                class="select"
                data-field="sort"
                .value=${this._sortOrder}
                @change=${(event: Event) => {
                  this._sortOrder = (event.target as HTMLSelectElement)
                    .value as CollectionSortOrder;
                }}
              >
                ${COLLECTION_SORT_ORDERS.map(
                  (value) =>
                    html`<option
                      value=${value}
                      ?selected=${value === this._sortOrder}
                    >
                      ${this.labels.sortOptions[value]}
                    </option>`,
                )}
              </select>
            </div>

            ${this._error
              ? html`<div class="alert-destructive" role="alert">
                  ${ALERT_ICON}
                  <section><p>${this._error}</p></section>
                </div>`
              : nothing}
          </div>

          <footer class="collection-dialog-actions">
            <button
              type="button"
              class="btn-outline"
              @click=${() => this.#close({ changed: false })}
            >
              ${this.labels.cancel}
            </button>
            <button
              type="button"
              class="btn"
              ?disabled=${this._saving || this.#blockingIssue() !== null}
              @click=${() => void this.#save()}
            >
              ${this.labels.save}
            </button>
          </footer>
        </div>
      </dialog>
    `;
  }
}

if (!customElements.get("jant-collection-dialog")) {
  customElements.define("jant-collection-dialog", JantCollectionDialog);
}
