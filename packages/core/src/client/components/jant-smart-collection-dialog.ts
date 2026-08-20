/**
 * Smart Collection Dialog
 *
 * Creating and editing a smart collection are the same surface. There is no
 * editor page and no `/{path}/edit` route: a smart collection is a handful of
 * fields plus a list of conditions, and the live count is what makes it
 * possible to write conditions at all — without it this is a blind form that
 * can be saved matching nothing.
 *
 * Delete is not here. Every menu that opens this dialog offers it one item
 * away from Edit, and a destructive button sharing a row with Save is a
 * misclick waiting to happen.
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
import { getCollectionPagePath } from "../../lib/collection-paths.js";
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
  emptySelection,
  selectionToRows,
  rowsToSelection,
  type DimensionKey,
} from "./smart-collection-conditions.js";

/** How long to wait after a keystroke before asking the server to count. */
const PREVIEW_DEBOUNCE_MS = 250;

/** Lucide `plus`, inline: the dialog is one component and owns its two icons. */
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

/** Lucide `x`. A glyph, not a `&times;` character, so it scales with the icon. */
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
  declare _slugOpen: boolean;
  declare _description: string;
  declare _rows: SmartConditionRow[];
  declare _sort: string;
  declare _layout: string;
  declare _preview: { count: number; baseline: number } | null;
  declare _addMenuOpen: boolean;
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
    this._slugOpen = false;
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

  // --- The add-condition menu ----------------------------------------------

  #toggleAddMenu() {
    this._addMenuOpen = !this._addMenuOpen;
    if (!this._addMenuOpen) return;
    void this.updateComplete.then(() => {
      // The menu opens inside a scrolling body; a menu the author cannot see
      // is the same as no menu.
      this.#addMenu()?.scrollIntoView?.({ block: "nearest" });
      this.#menuItems()[0]?.focus();
    });
  }

  /** Close the menu, and hand focus back to what opened it. */
  #closeAddMenu(returnFocus: boolean) {
    if (!this._addMenuOpen) return;
    this._addMenuOpen = false;
    if (!returnFocus) return;
    void this.updateComplete.then(() => {
      this.querySelector<HTMLButtonElement>("[data-add-trigger]")?.focus();
    });
  }

  #addMenu(): HTMLElement | null {
    return this.querySelector<HTMLElement>("[data-add-menu]");
  }

  #menuItems(): HTMLButtonElement[] {
    return [
      ...this.querySelectorAll<HTMLButtonElement>(
        "[data-add-menu] [role='menuitem']",
      ),
    ];
  }

  /** Arrow-key movement through the menu, wrapping at both ends. */
  #moveMenuFocus(delta: 1 | -1) {
    const items = this.#menuItems();
    if (items.length === 0) return;
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    const next =
      current < 0
        ? delta > 0
          ? 0
          : items.length - 1
        : (current + delta + items.length) % items.length;
    items[next]?.focus();
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
      this.#suggestedSlug = "";
      this._slug = "";
      this._slugState = "unknown";
      return;
    }
    // Local first so the field never lags behind typing; the server only
    // resolves collisions.
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
    // A link with bad characters is not "taken", and saying so sends the author
    // hunting for a collision that does not exist.
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
   * The same shape the quick-create collection dialog uses, because it is the
   * same decision: the title already answers it, and the whole URL says more
   * than a bare slug does.
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
            ? html`<p class="smart-collection-link-problem">${problem}</p>`
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
            <label class="label mb-0" for="smart-collection-slug"
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
          ${problem
            ? html`<p class="smart-collection-link-problem">${problem}</p>`
            : this._slug
              ? html`<p class="smart-collection-link-preview">
                  ${this.#linkPreview()}
                </p>`
              : html`<p class="smart-collection-link-help">
                  ${this.labels.linkHelp}
                </p>`}
          ${moved
            ? html`<p class="smart-collection-link-problem">
                ${this.labels.linkMovesWarning}
              </p>`
            : nothing}
        </div>
      </div>
    `;
  }

  // --- Save ------------------------------------------------------------------

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
    const title = this._title.trim();

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
        this.#closeAddMenu(true);
        return;
      }
      this.#close(false);
      return;
    }

    if (
      this._addMenuOpen &&
      (event.key === "ArrowDown" || event.key === "ArrowUp")
    ) {
      event.preventDefault();
      this.#moveMenuFocus(event.key === "ArrowDown" ? 1 : -1);
      return;
    }

    if (event.key === "Enter") {
      const target = event.target as HTMLElement | null;
      // Enter inside a textarea is a newline, not a submit.
      if (target?.tagName === "TEXTAREA") return;
      // Enter on a menu item picks that condition, and saving nothing yet is
      // the whole reason the menu was open.
      if (target?.getAttribute("role") === "menuitem") return;
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
          ${X_ICON}
        </button>
      </div>
    `;
  }

  #renderConditions() {
    const available = this.#availableDimensions();
    const hasRows = this._rows.length > 0;

    return html`
      <section class="smart-collection-section">
        <div class="smart-collection-section-head">
          <h3 class="smart-collection-section-title">
            ${this.labels.conditionsHeading}
          </h3>
          <!-- The count belongs to the whole section, not to the last row:
               it answers "what did that just do" from a fixed place. -->
          <p class="smart-collection-count" aria-live="polite">
            ${this._preview
              ? this.labels.countSummary
                  .replace("{count}", String(this._preview.count))
                  .replace("{total}", String(this._preview.baseline))
              : this.labels.counting}
          </p>
        </div>

        <p class="smart-collection-section-hint">
          ${hasRows ? this.labels.matchAllHint : this.labels.noConditions}
        </p>

        ${hasRows
          ? html`
              <div class="smart-condition-rows">
                ${this._rows.map((row) => this.#renderConditionRow(row))}
              </div>
            `
          : nothing}

        <div class="smart-condition-add">
          <button
            type="button"
            class="btn-sm-outline smart-condition-add-trigger"
            data-add-trigger
            ?disabled=${available.length === 0}
            aria-haspopup="menu"
            aria-expanded=${String(this._addMenuOpen)}
            @click=${(event: Event) => {
              event.stopPropagation();
              this.#toggleAddMenu();
            }}
          >
            ${PLUS_ICON}${this.labels.addCondition}
          </button>
          ${this._addMenuOpen
            ? html`
                <div
                  class="collections-page-menu smart-condition-menu"
                  data-add-menu
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
        class="dialog smart-collection-dialog"
        @cancel=${(event: Event) => {
          event.preventDefault();
          this.#close(false);
        }}
        @click=${(event: Event) => {
          if (event.target === event.currentTarget) this.#close(false);
          this.#closeAddMenu(false);
        }}
      >
        <div
          class="smart-collection-dialog-panel"
          role="dialog"
          aria-modal="true"
          aria-labelledby="smart-collection-dialog-title"
          @click=${(event: Event) => {
            event.stopPropagation();
            // The trigger and the menu stop their own clicks, so anything that
            // reaches here is a click elsewhere in the dialog — which dismisses.
            this.#closeAddMenu(false);
          }}
        >
          <header class="smart-collection-dialog-header">
            <h2
              id="smart-collection-dialog-title"
              class="smart-collection-dialog-title"
            >
              ${heading}
            </h2>
            <!-- Said once, where it is needed: by the time anyone edits one
                 they know what it is. -->
            ${this._mode === "create"
              ? html`<p class="smart-collection-dialog-note">
                  ${this.labels.whatItIs}
                </p>`
              : nothing}
          </header>

          <div
            class="smart-collection-dialog-body"
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

            ${this._error
              ? html`<div class="alert-destructive" role="alert">
                  ${ALERT_ICON}
                  <section><p>${this._error}</p></section>
                </div>`
              : nothing}
          </div>

          <footer class="smart-collection-dialog-actions">
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
                ?disabled=${this._saving || this.#blockingIssue() !== null}
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
