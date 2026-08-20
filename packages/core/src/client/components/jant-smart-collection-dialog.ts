/**
 * Smart Collection Dialog
 *
 * Creating and editing a smart collection are the same surface. There is no
 * editor page and no `/{path}/edit` route: a smart collection is a handful of
 * fields plus a list of conditions, and the live count is what makes it
 * possible to write conditions at all — without it this is a blind form that
 * can be saved matching nothing.
 *
 * The condition rows are deliberately *not* field-operator-value the way
 * Apple Notes and iTunes do it. That shape is built for an open condition
 * space, and here it would promise two things the model cannot deliver: a
 * second `Format is …` row (which would be an OR, and format is one column),
 * and a `Match [all|any]` switch (everything is AND). This keeps the shape and
 * drops the promises — one row per dimension, only the dimensions actually set,
 * and a menu that offers only the ones still unused.
 *
 * Light DOM only — BaseCoat and Tailwind classes apply directly.
 */

import { LitElement, html, nothing } from "lit";
import { getSlugValidationIssue, truncateSlug } from "../../lib/slug-format.js";
import { MAX_COLLECTION_SLUG_LENGTH } from "../../types/constants.js";
import { slugify } from "../lazy-slugify.js";
import { publicPath } from "../runtime-paths.js";
import { showConfirmDialog } from "../confirm.js";
import { showToast } from "../toast.js";
import type {
  SmartCollectionDialogLabels,
  SmartCollectionDialogState,
  SmartConditionRow,
} from "./smart-collection-dialog-types.js";
import {
  DIMENSION_CONTROLS,
  emptySelection,
  selectionToRows,
  rowsToSelection,
  type DimensionKey,
} from "./smart-collection-conditions.js";

/** How long to wait after a keystroke before asking the server to count. */
const PREVIEW_DEBOUNCE_MS = 250;

export class JantSmartCollectionDialog extends LitElement {
  static properties = {
    labels: { type: Object },

    _open: { state: true },
    _mode: { state: true },
    _id: { state: true },
    _title: { state: true },
    _slug: { state: true },
    _slugEdited: { state: true },
    _slugState: { state: true },
    _description: { state: true },
    _rows: { state: true },
    _sort: { state: true },
    _layout: { state: true },
    _preview: { state: true },
    _addMenuOpen: { state: true },
    _saving: { state: true },
    _error: { state: true },
  };

  declare labels: SmartCollectionDialogLabels;

  declare _open: boolean;
  declare _mode: "create" | "edit";
  declare _id: string | null;
  declare _title: string;
  declare _slug: string;
  declare _slugEdited: boolean;
  declare _slugState: "unknown" | "checking" | "available" | "taken";
  declare _description: string;
  declare _rows: SmartConditionRow[];
  declare _sort: string;
  declare _layout: string;
  declare _preview: { count: number; baseline: number } | null;
  declare _addMenuOpen: boolean;
  declare _saving: boolean;
  declare _error: string;

  /** Set when the dialog was opened on an existing address that must not move. */
  #originalSlug = "";
  #resolve: ((changed: boolean) => void) | null = null;
  #previewTimer: ReturnType<typeof setTimeout> | null = null;
  #slugTimer: ReturnType<typeof setTimeout> | null = null;
  #requestSeq = 0;

  createRenderRoot() {
    this.innerHTML = "";
    return this;
  }

  constructor() {
    super();
    this.labels = {} as SmartCollectionDialogLabels;
    this._open = false;
    this._mode = "create";
    this._id = null;
    this._title = "";
    this._slug = "";
    this._slugEdited = false;
    this._slugState = "unknown";
    this._description = "";
    this._rows = [];
    this._sort = "newest";
    this._layout = "";
    this._preview = null;
    this._addMenuOpen = false;
    this._saving = false;
    this._error = "";
  }

  /**
   * Open the dialog, and resolve once it closes.
   *
   * @param options.smartCollectionId - Edit this one; omit to create
   * @param options.prefill - Starting values, for the "turn this into a smart
   *   collection" flows. Never saved without the author seeing them first.
   * @returns Whether anything was created, changed, or deleted
   */
  async open(options: {
    smartCollectionId?: string;
    prefill?: SmartCollectionDialogState;
  }): Promise<boolean> {
    this.#reset();

    if (options.smartCollectionId) {
      const loaded = await this.#load(options.smartCollectionId);
      if (!loaded) return false;
    } else if (options.prefill) {
      this._title = options.prefill.title ?? "";
      this._description = options.prefill.description ?? "";
      this._rows = selectionToRows(options.prefill.selection ?? {});
      this._sort = options.prefill.sort ?? "newest";
      this._layout = options.prefill.layout ?? "";
      if (this._title) await this.#suggestSlug();
    }

    this._open = true;
    await this.updateComplete;
    this.#showDialog();
    this.#schedulePreview();

    return new Promise<boolean>((resolve) => {
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
    this._description = "";
    this._rows = [];
    this._sort = "newest";
    this._layout = "";
    this._preview = null;
    this._addMenuOpen = false;
    this._saving = false;
    this._error = "";
    this.#originalSlug = "";
  }

  async #load(id: string): Promise<boolean> {
    try {
      const res = await fetch(publicPath(`/api/smart-collections/${id}`));
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as {
        smartCollection: SmartCollectionDialogState & {
          id: string;
          slug: string;
        };
      };
      const loaded = json.smartCollection;
      this._mode = "edit";
      this._id = loaded.id;
      this._title = loaded.title ?? "";
      this._slug = loaded.slug ?? "";
      this.#originalSlug = loaded.slug ?? "";
      this._slugEdited = true;
      this._description = loaded.description ?? "";
      this._rows = selectionToRows(loaded.selection ?? {});
      this._sort = loaded.sort ?? "newest";
      this._layout = loaded.layout ?? "";
      return true;
    } catch {
      showToast(this.labels.loadFailed, "error");
      return false;
    }
  }

  #showDialog() {
    const dialog = this.querySelector<HTMLDialogElement>(
      ".smart-collection-dialog",
    );
    if (!dialog) return;
    if (!dialog.open) dialog.showModal();
    // Initial focus lands on the first thing the author types into, not on the
    // dialog shell.
    this.querySelector<HTMLInputElement>("[data-field='title']")?.focus();
  }

  #close(changed: boolean) {
    const dialog = this.querySelector<HTMLDialogElement>(
      ".smart-collection-dialog",
    );
    if (dialog?.open) dialog.close();
    this._open = false;
    this._addMenuOpen = false;
    if (this.#previewTimer) clearTimeout(this.#previewTimer);
    if (this.#slugTimer) clearTimeout(this.#slugTimer);
    const resolve = this.#resolve;
    this.#resolve = null;
    resolve?.(changed);
  }

  // --- Conditions ----------------------------------------------------------

  /** Dimensions not yet used. A dimension appears at most once, always. */
  #availableDimensions(): DimensionKey[] {
    const used = new Set(this._rows.map((row) => row.key));
    return (Object.keys(DIMENSION_CONTROLS) as DimensionKey[]).filter(
      (key) => !used.has(key),
    );
  }

  #addRow(key: DimensionKey) {
    this._addMenuOpen = false;
    this._rows = [
      ...this._rows,
      { key, value: DIMENSION_CONTROLS[key].defaultValue },
    ];
    this.#schedulePreview();
  }

  #removeRow(key: DimensionKey) {
    this._rows = this._rows.filter((row) => row.key !== key);
    this.#schedulePreview();
  }

  #setRowValue(key: DimensionKey, value: string) {
    this._rows = this._rows.map((row) =>
      row.key === key ? { ...row, value } : row,
    );
    this.#schedulePreview();
  }

  // --- Live count ----------------------------------------------------------

  #schedulePreview() {
    if (this.#previewTimer) clearTimeout(this.#previewTimer);
    this.#previewTimer = setTimeout(
      () => void this.#preview(),
      PREVIEW_DEBOUNCE_MS,
    );
  }

  async #preview() {
    const seq = ++this.#requestSeq;
    try {
      const res = await fetch(publicPath("/api/smart-collections/preview"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ selection: rowsToSelection(this._rows) }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as { count: number; baseline: number };
      // A slower earlier request must not overwrite a newer answer.
      if (seq !== this.#requestSeq) return;
      this._preview = json;
    } catch {
      if (seq !== this.#requestSeq) return;
      this._preview = null;
    }
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
      this._slug = "";
      this._slugState = "unknown";
      return;
    }
    // Local first so the field never lags behind typing; the server only
    // resolves collisions.
    this._slug = truncateSlug(await slugify(title), MAX_COLLECTION_SLUG_LENGTH);
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
      PREVIEW_DEBOUNCE_MS,
    );
  }

  async #checkSlug() {
    const slug = this._slug;
    if (!slug) {
      this._slugState = "unknown";
      return;
    }
    if (getSlugValidationIssue(slug) !== null) {
      this._slugState = "taken";
      return;
    }
    try {
      const params = new URLSearchParams({ mode: "check", slug });
      if (this._id) params.set("smartCollectionId", this._id);
      const res = await fetch(
        publicPath(`/api/smart-collections/slug?${params.toString()}`),
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

  // --- Save and delete -----------------------------------------------------

  async #save() {
    if (this._saving) return;
    const title = this._title.trim();
    if (!title || !this._slug) {
      this._error = this.labels.titleAndAddressRequired;
      return;
    }

    this._saving = true;
    this._error = "";

    const body = {
      slug: this._slug,
      title,
      description: this._description.trim() || null,
      selection: rowsToSelection(this._rows),
      sort: this._sort,
      layout: this._layout || null,
    };

    try {
      const res = await fetch(
        publicPath(
          this._id
            ? `/api/smart-collections/${this._id}`
            : "/api/smart-collections",
        ),
        {
          method: this._id ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      if (!res.ok) {
        const json = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        this._error = json?.error ?? this.labels.saveFailed;
        return;
      }
      showToast(this.labels.saved);
      this.#close(true);
    } catch {
      this._error = this.labels.saveFailed;
    } finally {
      this._saving = false;
    }
  }

  async #delete() {
    if (!this._id) return;
    const confirmed = await showConfirmDialog({
      message: this.labels.confirmDelete,
      confirmLabel: this.labels.deleteSmartCollection,
      cancelLabel: this.labels.cancel,
      tone: "danger",
    });
    if (!confirmed) return;

    try {
      const res = await fetch(
        publicPath(`/api/smart-collections/${this._id}`),
        { method: "DELETE" },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      showToast(this.labels.deleted);
      this.#close(true);
    } catch {
      this._error = this.labels.saveFailed;
    }
  }

  // --- Keyboard ------------------------------------------------------------

  /**
   * Escape and Enter, handled on the component rather than only on the
   * `<dialog>`.
   *
   * A native `cancel` event is not reliable here: an inner element that
   * intercepts `keydown` swallows Escape before the dialog ever sees it. The
   * component-level handler is what actually holds.
   */
  #onKeydown = (event: KeyboardEvent) => {
    if (!this._open) return;

    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      if (this._addMenuOpen) {
        this._addMenuOpen = false;
        return;
      }
      this.#close(false);
      return;
    }

    if (event.key === "Enter") {
      const target = event.target as HTMLElement | null;
      // Enter inside a textarea is a newline, not a submit.
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
    if (this.#previewTimer) clearTimeout(this.#previewTimer);
    if (this.#slugTimer) clearTimeout(this.#slugTimer);
  }

  // --- Render --------------------------------------------------------------

  #renderConditionRow(row: SmartConditionRow) {
    const control = DIMENSION_CONTROLS[row.key];
    const labelText = this.labels.dimensions[row.key] ?? row.key;

    return html`
      <div class="smart-condition-row" data-condition=${row.key}>
        <span class="smart-condition-label">${labelText}</span>
        <div class="smart-condition-control">
          ${control.render(
            row.value,
            (value: string) => this.#setRowValue(row.key, value),
            this.labels,
          )}
        </div>
        <button
          type="button"
          class="btn-sm-icon-ghost smart-condition-remove"
          aria-label=${this.labels.removeCondition}
          title=${this.labels.removeCondition}
          @click=${() => this.#removeRow(row.key)}
        >
          &times;
        </button>
      </div>
    `;
  }

  #renderConditions() {
    const available = this.#availableDimensions();

    return html`
      <section class="smart-collection-section">
        <h3 class="smart-collection-section-title">
          ${this.labels.conditionsHeading}
        </h3>
        ${this._rows.length > 0
          ? html`
              <p class="smart-collection-section-hint">
                ${this.labels.matchAllHint}
              </p>
              <div class="smart-condition-rows">
                ${this._rows.map((row) => this.#renderConditionRow(row))}
              </div>
            `
          : html`
              <p class="smart-collection-section-hint">
                ${this.labels.noConditions}
              </p>
            `}

        <div class="smart-condition-footer">
          <div class="relative">
            <button
              type="button"
              class="btn-outline btn-sm"
              ?disabled=${available.length === 0}
              aria-haspopup="menu"
              aria-expanded=${String(this._addMenuOpen)}
              @click=${(event: Event) => {
                event.stopPropagation();
                this._addMenuOpen = !this._addMenuOpen;
              }}
            >
              ${this.labels.addCondition}
            </button>
            ${this._addMenuOpen
              ? html`
                  <div
                    class="collections-page-menu"
                    role="menu"
                    @click=${(event: Event) => event.stopPropagation()}
                  >
                    ${available.map(
                      (key) => html`
                        <button
                          type="button"
                          class="collections-page-menu-item"
                          role="menuitem"
                          @click=${() => this.#addRow(key)}
                        >
                          ${this.labels.dimensions[key] ?? key}
                        </button>
                      `,
                    )}
                  </div>
                `
              : nothing}
          </div>
          <p class="smart-collection-count" aria-live="polite">
            ${this._preview
              ? this.labels.countSummary
                  .replace("{count}", String(this._preview.count))
                  .replace("{total}", String(this._preview.baseline))
              : this.labels.counting}
          </p>
        </div>
      </section>
    `;
  }

  render() {
    if (!this._open) return nothing;

    const heading =
      this._mode === "edit"
        ? this.labels.editHeading
        : this.labels.createHeading;
    const slugMoved =
      this._mode === "edit" && this._slug !== this.#originalSlug;

    return html`
      <dialog
        class="dialog smart-collection-dialog"
        @cancel=${(event: Event) => {
          event.preventDefault();
          this.#close(false);
        }}
        @click=${(event: Event) => {
          if (event.target === event.currentTarget) this.#close(false);
          this._addMenuOpen = false;
        }}
      >
        <div
          class="smart-collection-dialog-panel card"
          role="dialog"
          aria-modal="true"
          aria-labelledby="smart-collection-dialog-title"
          @click=${(event: Event) => event.stopPropagation()}
        >
          <header class="smart-collection-dialog-header">
            <h2
              id="smart-collection-dialog-title"
              class="smart-collection-dialog-title"
            >
              ${heading}
            </h2>
          </header>

          <div class="smart-collection-dialog-body">
            <div class="field">
              <label for="smart-collection-title">${this.labels.title}</label>
              <input
                id="smart-collection-title"
                class="input"
                type="text"
                data-field="title"
                .value=${this._title}
                @input=${(event: Event) =>
                  this.#onTitleInput((event.target as HTMLInputElement).value)}
              />
            </div>

            <div class="field">
              <label for="smart-collection-slug">${this.labels.address}</label>
              <input
                id="smart-collection-slug"
                class="input"
                type="text"
                .value=${this._slug}
                @input=${(event: Event) =>
                  this.#onSlugInput((event.target as HTMLInputElement).value)}
              />
              <p class="field-hint">
                ${this._slugState === "taken"
                  ? this.labels.addressTaken
                  : `/${this._slug}`}
              </p>
              ${slugMoved
                ? html`<p class="field-hint smart-collection-warning">
                    ${this.labels.addressMovesWarning}
                  </p>`
                : nothing}
            </div>

            <div class="field">
              <label for="smart-collection-description"
                >${this.labels.description}</label
              >
              <textarea
                id="smart-collection-description"
                class="input"
                rows="2"
                .value=${this._description}
                @input=${(event: Event) => {
                  this._description = (
                    event.target as HTMLTextAreaElement
                  ).value;
                }}
              ></textarea>
            </div>

            ${this.#renderConditions()}

            <section class="smart-collection-section">
              <h3 class="smart-collection-section-title">
                ${this.labels.displayHeading}
              </h3>
              <div class="field">
                <label for="smart-collection-sort"
                  >${this.labels.orderBy}</label
                >
                <select
                  id="smart-collection-sort"
                  class="input"
                  .value=${this._sort}
                  @change=${(event: Event) => {
                    this._sort = (event.target as HTMLSelectElement).value;
                  }}
                >
                  ${Object.entries(this.labels.sortOptions).map(
                    ([value, label]) =>
                      html`<option
                        value=${value}
                        ?selected=${value === this._sort}
                      >
                        ${label}
                      </option>`,
                  )}
                </select>
              </div>
              <div class="field">
                <label for="smart-collection-layout"
                  >${this.labels.layout}</label
                >
                <select
                  id="smart-collection-layout"
                  class="input"
                  .value=${this._layout}
                  @change=${(event: Event) => {
                    this._layout = (event.target as HTMLSelectElement).value;
                  }}
                >
                  ${Object.entries(this.labels.layoutOptions).map(
                    ([value, label]) =>
                      html`<option
                        value=${value}
                        ?selected=${value === this._layout}
                      >
                        ${label}
                      </option>`,
                  )}
                </select>
              </div>
            </section>

            ${this._error
              ? html`<p class="alert alert-destructive" role="alert">
                  ${this._error}
                </p>`
              : nothing}
          </div>

          <footer class="smart-collection-dialog-actions">
            ${this._mode === "edit"
              ? html`
                  <button
                    type="button"
                    class="btn-ghost smart-collection-delete"
                    @click=${() => void this.#delete()}
                  >
                    ${this.labels.deleteSmartCollection}
                  </button>
                `
              : nothing}
            <div class="smart-collection-dialog-actions-end">
              <button
                type="button"
                class="btn-outline"
                @click=${() => this.#close(false)}
              >
                ${this.labels.cancel}
              </button>
              <button
                type="button"
                class="btn"
                ?disabled=${this._saving}
                @click=${() => void this.#save()}
              >
                ${this.labels.save}
              </button>
            </div>
          </footer>
        </div>
      </dialog>
    `;
  }
}

if (!customElements.get("jant-smart-collection-dialog")) {
  customElements.define(
    "jant-smart-collection-dialog",
    JantSmartCollectionDialog,
  );
}

export { emptySelection };
