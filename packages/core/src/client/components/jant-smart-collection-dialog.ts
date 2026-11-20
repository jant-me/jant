/**
 * Smart Collection Dialog
 *
 * Creating and editing a smart collection are the same surface. There is no
 * editor page and no `/{path}/edit` route: a smart collection is a handful of
 * fields plus a set of conditions, and the live count is what makes it
 * possible to write conditions with confidence.
 *
 * Delete is not here. Every menu that opens this dialog offers it one item
 * away from Edit, and a destructive button sharing a row with Save is a
 * misclick waiting to happen.
 *
 * Conditions use a two-layer boolean model:
 * - Within a dimension row, multiple selected pills are OR'd.
 * - Across dimension rows, the always-visible `Match [All | Any]` segmented
 *   switch (and synced inline `and` / `or` row dividers) picks AND or OR.
 * Unused dimensions sit in a flat quick-add bar below the active rows so every
 * supported filter is visible at a glance and added in one click.
 *
 * Light DOM only — BaseCoat and the author stylesheet apply directly.
 */

import { LitElement, html, nothing } from "lit";
import { getCollectionPagePath } from "../../lib/collection-paths.js";
import type { FilterMatchMode } from "../../lib/filter-dimensions.js";
import { getSlugValidationIssue, truncateSlug } from "../../lib/slug-format.js";
import { MAX_COLLECTION_SLUG_LENGTH } from "../../types/constants.js";
import { slugify } from "../lazy-slugify.js";
import { publicPath } from "../runtime-paths.js";
import { showToast } from "../toast.js";
import type {
  SmartCollectionDialogLabels,
  SmartCollectionDialogState,
  SmartConditionRow,
} from "./smart-collection-dialog-types.js";
import {
  DIMENSION_CONTROLS,
  QUICK_ADD_DIMENSION_ORDER,
  emptySelection,
  listCollectionOptions,
  rowsToSelection,
  selectionToModel,
  type DimensionKey,
} from "./smart-collection-conditions.js";

/** How long to wait after an edit before asking the server to count. */
const PREVIEW_DEBOUNCE_MS = 250;

/** Lucide `plus`, inline. */
const PLUS_ICON = html`<svg
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"
>
  <path d="M5 12h14" />
  <path d="M12 5v14" />
</svg>`;

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

/** Lucide `x`. */
const X_ICON = html`<svg
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"
>
  <path d="M18 6 6 18" />
  <path d="m6 6 12 12" />
</svg>`;

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
    _slugOpen: { state: true },
    _description: { state: true },
    _match: { state: true },
    _rows: { state: true },
    _availableYears: { state: true },
    _yearInputOpen: { state: true },
    _collectionMenuOpen: { state: true },
    _collectionFilter: { state: true },
    _sort: { state: true },
    _layout: { state: true },
    _preview: { state: true },
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
  declare _slugOpen: boolean;
  declare _description: string;
  declare _match: FilterMatchMode;
  declare _rows: SmartConditionRow[];
  declare _availableYears: number[];
  declare _yearInputOpen: boolean;
  declare _collectionMenuOpen: boolean;
  declare _collectionFilter: string;
  declare _sort: string;
  declare _layout: string;
  declare _preview: { count: number; baseline: number } | null;
  declare _saving: boolean;
  declare _error: string;

  /** Set when the dialog was opened on an existing link that must not move. */
  #originalSlug = "";
  /** The link the current title would produce, for "Reset link". */
  #suggestedSlug = "";
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
    this._slugOpen = false;
    this._description = "";
    this._match = "all";
    this._rows = [];
    this._availableYears = [];
    this._yearInputOpen = false;
    this._collectionMenuOpen = false;
    this._collectionFilter = "";
    this._sort = "newest";
    this._layout = "";
    this._preview = null;
    this._saving = false;
    this._error = "";
  }

  /**
   * Open the dialog, and resolve once it closes.
   *
   * @param options.smartCollectionId - Edit this one; omit to create
   * @param options.prefill - Starting values, for the "turn this into a smart
   *   collection" flows. Never saved without the author seeing them first.
   * @returns Whether anything was created or changed
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
      const model = selectionToModel(options.prefill.selection ?? {});
      this._match = model.match;
      this._rows = model.rows;
      this._sort = options.prefill.sortOrder ?? "newest";
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
    this._slugOpen = false;
    this._description = "";
    this._match = "all";
    this._rows = [];
    this._yearInputOpen = false;
    this._collectionMenuOpen = false;
    this._collectionFilter = "";
    this._sort = "newest";
    this._layout = "";
    this._preview = null;
    this._saving = false;
    this._error = "";
    this.#originalSlug = "";
  }

  async #load(id: string): Promise<boolean> {
    try {
      const res = await fetch(publicPath(`/api/smart-collections/${id}`));
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const loaded = (await res.json()) as SmartCollectionDialogState & {
        id: string;
        slug: string;
      };
      this._mode = "edit";
      this._id = loaded.id;
      this._title = loaded.title ?? "";
      this._slug = loaded.slug ?? "";
      this.#originalSlug = loaded.slug ?? "";
      this._slugEdited = true;
      this._description = loaded.description ?? "";
      const model = selectionToModel(loaded.selection ?? {});
      this._match = model.match;
      this._rows = model.rows;
      this._sort = loaded.sortOrder ?? "newest";
      this._layout = loaded.layout ?? "";
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
    this.querySelector<HTMLInputElement>("[data-field='title']")?.focus();
  }

  #close(changed: boolean) {
    const dialog = this.querySelector<HTMLDialogElement>(".collection-dialog");
    if (dialog?.open) dialog.close();
    this._open = false;
    this._yearInputOpen = false;
    this._collectionMenuOpen = false;
    if (this.#previewTimer) clearTimeout(this.#previewTimer);
    if (this.#slugTimer) clearTimeout(this.#slugTimer);
    const resolve = this.#resolve;
    this.#resolve = null;
    resolve?.(changed);
  }

  // --- Conditions ----------------------------------------------------------

  #availableDimensions(): DimensionKey[] {
    const used = new Set(this._rows.map((row) => row.key));
    return QUICK_ADD_DIMENSION_ORDER.filter((key) => !used.has(key));
  }

  #setMatch(match: FilterMatchMode) {
    if (this._match === match) return;
    this._match = match;
    this.#schedulePreview();
  }

  #addRow(key: DimensionKey) {
    if (
      key === "collection" &&
      listCollectionOptions(this.labels).length === 0
    ) {
      return;
    }
    this._collectionMenuOpen = false;
    this._yearInputOpen = false;
    const defaultValue = DIMENSION_CONTROLS[key].defaultValue({
      availableYears: this._availableYears,
    });
    this._rows = [...this._rows, { key, value: defaultValue }];
    this.#schedulePreview();
  }

  #removeRow(key: DimensionKey) {
    if (key === "year") this._yearInputOpen = false;
    if (key === "collection") {
      this._collectionMenuOpen = false;
      this._collectionFilter = "";
    }
    this._rows = this._rows.filter((row) => row.key !== key);
    this.#schedulePreview();
  }

  #setRowValue(key: DimensionKey, value: string) {
    this._rows = this._rows.map((row) =>
      row.key === key ? { ...row, value } : row,
    );
    this.#schedulePreview();
  }

  #setYearInputOpen(open: boolean) {
    this._yearInputOpen = open;
    if (!open) return;
    void this.updateComplete.then(() => {
      this.querySelector<HTMLInputElement>("[data-year-input]")?.focus();
    });
  }

  #setCollectionMenuOpen(open: boolean, returnFocus = false) {
    if (this._collectionMenuOpen === open) return;
    this._collectionMenuOpen = open;
    if (open) {
      this._collectionFilter = "";
      void this.updateComplete.then(() => {
        this.querySelector<HTMLElement>(
          "[data-collection-popover]",
        )?.scrollIntoView?.({ block: "nearest" });
        this.querySelector<HTMLInputElement>(
          "[data-collection-search]",
        )?.focus();
      });
    } else if (returnFocus) {
      void this.updateComplete.then(() => {
        this.querySelector<HTMLButtonElement>(
          "[data-collection-trigger]",
        )?.focus();
      });
    }
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
        body: JSON.stringify({
          selection: rowsToSelection(this._rows, this._match),
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as {
        count: number;
        baseline: number;
        years?: number[];
      };
      if (seq !== this.#requestSeq) return;
      this._preview = { count: json.count, baseline: json.baseline };
      if (Array.isArray(json.years) && json.years.length > 0) {
        this._availableYears = json.years;
      }
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
      this.#suggestedSlug = "";
      this._slug = "";
      this._slugState = "unknown";
      return;
    }
    this.#suggestedSlug = truncateSlug(
      await slugify(title),
      MAX_COLLECTION_SLUG_LENGTH,
    );
    this._slug = this.#suggestedSlug;
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
    if (this.#slugFormatIssue() !== null) {
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

  // --- The collection link -------------------------------------------------

  #slugFormatIssue(): "invalid" | "reserved" | "too_long" | null {
    return getSlugValidationIssue(this._slug, {
      maxLength: MAX_COLLECTION_SLUG_LENGTH,
    });
  }

  #slugProblem(): string | null {
    const issue = this.#slugFormatIssue();
    if (issue === "invalid") return this.labels.linkInvalid;
    if (issue === "reserved") return this.labels.linkReserved;
    if (issue === "too_long") return this.labels.linkTooLong;
    if (this._slugState === "taken") return this.labels.linkTaken;
    return null;
  }

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
          ${
            problem
              ? html`<p class="collection-dialog-link-problem">${problem}</p>`
              : nothing
          }
        </div>
      `;
    }

    const canReset =
      Boolean(this.#suggestedSlug) && this._slug !== this.#suggestedSlug;

    return html`
      <div class="collection-quick-link-editor">
        <div class="field">
          <div class="collection-quick-link-row">
            <label class="label mb-0" for="smart-collection-slug"
              >${this.labels.link}</label
            >
            ${
              canReset
                ? html`
                    <button
                      type="button"
                      class="collection-quick-link-action"
                      @click=${() => this.#resetSlug()}
                    >
                      ${this.labels.resetLink}
                    </button>
                  `
                : nothing
            }
          </div>
          <input
            id="smart-collection-slug"
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
          ${
            problem
              ? html`<p class="collection-dialog-link-problem">${problem}</p>`
              : this._slug
                ? html`<p class="collection-dialog-link-preview">
                    ${this.#linkPreview()}
                  </p>`
                : html`<p class="collection-dialog-link-help">
                    ${this.labels.linkHelp}
                  </p>`
          }
          ${
            moved
              ? html`<p class="collection-dialog-link-problem">
                  ${this.labels.linkMovesWarning}
                </p>`
              : nothing
          }
        </div>
      </div>
    `;
  }

  // --- Save ------------------------------------------------------------------

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
    const title = this._title.trim();

    this._saving = true;
    this._error = "";

    const body = {
      slug: this._slug,
      title,
      description: this._description.trim() || null,
      selection: rowsToSelection(this._rows, this._match),
      sortOrder: this._sort,
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

  // --- Keyboard ------------------------------------------------------------

  #onKeydown = (event: KeyboardEvent) => {
    if (!this._open) return;

    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      if (this._collectionMenuOpen) {
        this.#setCollectionMenuOpen(false, true);
        return;
      }
      if (this._yearInputOpen) {
        this._yearInputOpen = false;
        void this.updateComplete.then(() => {
          this.querySelector<HTMLButtonElement>("[data-year-add]")?.focus();
        });
        return;
      }
      this.#close(false);
      return;
    }

    if (event.key === "Enter") {
      const target = event.target as HTMLElement | null;
      if (target?.tagName === "TEXTAREA") return;
      if (target?.hasAttribute("data-year-input")) return;
      if (target?.hasAttribute("data-collection-search")) return;
      if (
        target?.tagName === "BUTTON" &&
        !target.hasAttribute("data-save-btn")
      ) {
        return;
      }
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

  #renderConnector() {
    const connectorWord =
      this._match === "any"
        ? this.labels.connectorOr
        : this.labels.connectorAnd;

    return html`
      <div class="smart-condition-connector">
        <span class="smart-condition-connector-line" aria-hidden="true"></span>
        <button
          type="button"
          class="smart-condition-connector-btn"
          data-condition-connector
          aria-label=${this.labels.toggleMatchMode}
          title=${this.labels.toggleMatchMode}
          @click=${() => this.#setMatch(this._match === "all" ? "any" : "all")}
        >
          ${connectorWord}
        </button>
        <span class="smart-condition-connector-line" aria-hidden="true"></span>
      </div>
    `;
  }

  #renderConditionRow(row: SmartConditionRow, index: number) {
    const control = DIMENSION_CONTROLS[row.key];
    const labelText = this.labels.dimensions[row.key] ?? row.key;

    return html`
      ${index > 0 ? this.#renderConnector() : nothing}
      <div class="smart-condition-row" data-condition=${row.key}>
        <span class="smart-condition-label">${labelText}</span>
        <div class="smart-condition-control">
          ${control.render(
            row.value,
            (value) => this.#setRowValue(row.key, value),
            {
              labels: this.labels,
              availableYears: this._availableYears,
              yearInputOpen: this._yearInputOpen,
              onToggleYearInput: (open) => this.#setYearInputOpen(open),
              collectionMenuOpen: this._collectionMenuOpen,
              collectionFilter: this._collectionFilter,
              onToggleCollectionMenu: (open) =>
                this.#setCollectionMenuOpen(open),
              onCollectionFilterInput: (query) => {
                this._collectionFilter = query;
              },
            },
          )}
        </div>
        <button
          type="button"
          class="btn-sm-icon-ghost smart-condition-remove"
          data-condition-remove=${row.key}
          aria-label=${this.labels.removeCondition}
          title=${this.labels.removeCondition}
          @click=${() => this.#removeRow(row.key)}
        >
          ${X_ICON}
        </button>
      </div>
    `;
  }

  #renderConditions() {
    const available = this.#availableDimensions();
    const hasRows = this._rows.length > 0;
    const hasCollections = listCollectionOptions(this.labels).length > 0;

    return html`
      <section class="smart-collection-section">
        <div class="smart-condition-toolbar">
          <div class="smart-condition-toolbar-left">
            <h3 class="smart-collection-section-title">
              ${this.labels.conditionsHeading}
            </h3>
            <div
              class="smart-condition-match"
              role="group"
              aria-label=${this.labels.matchPrefix}
            >
              <span class="smart-condition-match-prefix">
                ${this.labels.matchPrefix}
              </span>
              <div class="smart-condition-seg">
                <button
                  type="button"
                  class="smart-condition-seg-btn"
                  data-match-mode="all"
                  aria-pressed=${String(this._match === "all")}
                  @click=${() => this.#setMatch("all")}
                >
                  ${this.labels.matchAll}
                </button>
                <button
                  type="button"
                  class="smart-condition-seg-btn"
                  data-match-mode="any"
                  aria-pressed=${String(this._match === "any")}
                  @click=${() => this.#setMatch("any")}
                >
                  ${this.labels.matchAny}
                </button>
              </div>
            </div>
          </div>

          <p class="smart-collection-count" aria-live="polite">
            ${
              this._preview
                ? this.labels.countSummary
                    .replace("{count}", String(this._preview.count))
                    .replace("{total}", String(this._preview.baseline))
                : this.labels.counting
            }
          </p>
        </div>

        ${
          hasRows
            ? html`
                <div class="smart-condition-rows">
                  ${this._rows.map((row, idx) =>
                    this.#renderConditionRow(row, idx),
                  )}
                </div>
              `
            : html`
                <div class="smart-condition-empty">
                  <p class="smart-collection-section-hint">
                    ${this.labels.noConditions}
                  </p>
                </div>
              `
        }
        ${
          available.length > 0
            ? html`
                <div class="smart-condition-quick-add">
                  <span class="smart-condition-quick-add-label">
                    ${this.labels.quickAddPrefix}
                  </span>
                  ${available.map((key) => {
                    const disabled = key === "collection" && !hasCollections;
                    return html`
                      <button
                        type="button"
                        class="smart-condition-pill-dashed"
                        data-add-condition=${key}
                        ?disabled=${disabled}
                        title=${
                          disabled
                            ? this.labels.noCollectionsAvailable
                            : nothing
                        }
                        @click=${() => this.#addRow(key)}
                      >
                        ${PLUS_ICON}
                        <span>${this.labels.dimensions[key] ?? key}</span>
                      </button>
                    `;
                  })}
                </div>
              `
            : nothing
        }
      </section>
    `;
  }

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
          this.#close(false);
        }}
        @click=${(event: Event) => {
          if (event.target === event.currentTarget) this.#close(false);
          this.#setCollectionMenuOpen(false);
        }}
      >
        <div
          class="collection-dialog-panel"
          role="dialog"
          aria-modal="true"
          aria-labelledby="collection-dialog-title"
          @click=${(event: Event) => {
            event.stopPropagation();
            this.#setCollectionMenuOpen(false);
          }}
        >
          <header class="collection-dialog-header">
            <h2 id="collection-dialog-title" class="collection-dialog-title">
              ${heading}
            </h2>
            ${
              this._mode === "create"
                ? html`<p class="collection-dialog-note">
                    ${this.labels.whatItIs}
                  </p>`
                : nothing
            }
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
              <label for="smart-collection-title">${this.labels.title}</label>
              <input
                id="smart-collection-title"
                class="input"
                type="text"
                data-field="title"
                required
                .value=${this._title}
                @input=${(event: Event) =>
                  this.#onTitleInput((event.target as HTMLInputElement).value)}
              />
            </div>

            ${this.#renderLink()}

            <div class="field">
              <label for="smart-collection-description"
                >${this.labels.description}</label
              >
              <textarea
                id="smart-collection-description"
                class="textarea"
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
              <div class="smart-collection-section-head">
                <h3 class="smart-collection-section-title">
                  ${this.labels.displayHeading}
                </h3>
              </div>
              <div class="smart-collection-display">
                <div class="field">
                  <label for="smart-collection-sort"
                    >${this.labels.orderBy}</label
                  >
                  <select
                    id="smart-collection-sort"
                    class="select"
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
                    class="select"
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
              </div>
            </section>

            ${
              this._error
                ? html`<div class="alert-destructive" role="alert">
                    ${ALERT_ICON}
                    <section><p>${this._error}</p></section>
                  </div>`
                : nothing
            }
          </div>

          <footer class="collection-dialog-actions">
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
              data-save-btn
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

if (!customElements.get("jant-smart-collection-dialog")) {
  customElements.define(
    "jant-smart-collection-dialog",
    JantSmartCollectionDialog,
  );
}

export { emptySelection };
