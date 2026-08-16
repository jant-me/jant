/**
 * Language Settings Component
 *
 * The single home for every language setting: the site's content language, the
 * dashboard's UI language, and multilingual content.
 *
 * Unlike the General settings page, this component talks to the server itself
 * rather than through the settings bridge. Its operations are not "save this
 * form" — turning multilingual on stamps every existing post, removing a
 * language can be refused, changing the primary language rewrites two settings
 * at once — so each needs its own endpoint, its own confirmation, and its own
 * error handling.
 *
 * Light DOM only — BaseCoat and Tailwind classes apply directly.
 */

import { LitElement, html, nothing } from "lit";
import { showConfirmDialog } from "../confirm.js";
import { queueToastForNextPage, showToast } from "../toast.js";
import { getJsonString, readJsonObject } from "../json.js";
import {
  LOCALE_PICKER_TRIGGER_CLASS,
  type LocaleOption,
  type LocalePickerLabels,
} from "./jant-locale-picker.js";

interface LanguageLabels {
  siteSection: string;
  dashboardSection: string;
  contentLanguage: string;
  contentLanguageHelp: string;
  primaryLanguage: string;
  primaryLanguageHelp: string;
  languagesLabel: string;
  primaryBadge: string;
  makePrimary: string;
  dashboardLanguage: string;
  dashboardLanguageHelp: string;
  followContent: string;
  multilingual: string;
  multilingualHelp: string;
  multilingualDocs: string;
  multilingualDocsHelp: string;
  statusOn: string;
  turnOn: string;
  addMissingLanguage: string;
  viewPosts: string;
  otherLanguages: string;
  addLanguage: string;
  removeLanguage: string;
  languageMenu: string;
  enableTitle: string;
  enableReassurance: string;
  enableMarkTitle: string;
  enableMarkWarning: string;
  enableFixHint: string;
  enableNeedsLanguage: string;
  changePrimaryTitle: string;
  changePrimaryBody: string;
  changePrimaryConfirm: string;
  disableTitle: string;
  disableBody: string;
  disableConfirm: string;
  cancel: string;
  save: string;
  saving: string;
  searchPlaceholder: string;
  noMatches: string;
}

interface LanguageInitialState {
  contentLanguage: string;
  dashboardLanguage: string;
  multilingualEnabled: boolean;
  additionalLanguages: string[];
  unmarkedPostCount: number;
  sitePathPrefix: string;
}

/** Catalog locales the dashboard is translated into. */
const DASHBOARD_LOCALES = ["", "en", "zh-Hans", "zh-Hant"] as const;

/**
 * The reference for everything this page cannot say in two lines: URL
 * structure, per-language feeds, and how translation groups work. Same shape
 * as the theming and API links elsewhere in settings.
 */
const MULTILINGUAL_DOCS_URL =
  "https://github.com/jant-me/jant/blob/main/docs/multilingual.md";

/**
 * Fill the `{name}` slots the server deliberately left intact.
 *
 * Plurals and every other value are already resolved by Lingui server-side —
 * only values that are not known until the author interacts (the language they
 * picked, the prefix it maps to) reach here.
 */
function interpolate(template: string, values: Record<string, string>): string {
  // An unknown placeholder is left as-is rather than blanked: a copy change
  // that renames a slot should read oddly, not silently drop a fact.
  return template.replace(
    /\{(\w+)\}/g,
    (match, key: string) => values[key] ?? match,
  );
}

export class JantSettingsLanguage extends LitElement {
  static properties = {
    labels: { type: Object },
    locales: { type: Array },
    _contentLanguage: { state: true },
    _dashboardLanguage: { state: true },
    _multilingualEnabled: { state: true },
    _additional: { state: true },
    _unmarkedPostCount: { state: true },
    _sitePathPrefix: { state: true },
    _savingSite: { state: true },
    _savingDashboard: { state: true },
    _removeError: { state: true },
    _rowMenuOpen: { state: true },
    _enableError: { state: true },
    _enableOpen: { state: true },
    _enableAdditional: { state: true },
    _enablePrimary: { state: true },
    _enableBusy: { state: true },
  };

  declare labels: LanguageLabels;
  declare locales: LocaleOption[];
  declare _contentLanguage: string;
  declare _dashboardLanguage: string;
  declare _multilingualEnabled: boolean;
  declare _additional: string[];
  declare _unmarkedPostCount: number;
  declare _sitePathPrefix: string;
  declare _savingSite: boolean;
  declare _savingDashboard: boolean;
  /**
   * The refusal to remove a language, shown under that language's own row.
   * Inline rather than a toast: the way out is a link to the posts, and a
   * link belongs where the refusal happened.
   */
  declare _removeError: { tag: string; message: string } | null;
  /** Language tag whose row menu (make primary / remove) is open. */
  declare _rowMenuOpen: string | null;
  /**
   * Refusal from the enable dialog's save, shown inside the dialog. When the
   * server names the language whose posts blocked the save, putting it back
   * on the list is offered as one click.
   */
  declare _enableError: { message: string; language?: string } | null;
  declare _enableOpen: boolean;
  declare _enableAdditional: string[];
  declare _enablePrimary: string;
  declare _enableBusy: boolean;

  createRenderRoot() {
    // Drop the server-rendered skeleton first. lit-html appends its parts
    // rather than replacing existing children, so leaving it would stack the
    // placeholder block above the real form.
    this.innerHTML = "";
    return this;
  }

  constructor() {
    super();
    this.labels = {} as LanguageLabels;
    this.locales = [];
    this._contentLanguage = "en";
    this._dashboardLanguage = "";
    this._multilingualEnabled = false;
    this._additional = [];
    this._unmarkedPostCount = 0;
    this._sitePathPrefix = "";
    this._savingSite = false;
    this._savingDashboard = false;
    this._removeError = null;
    this._rowMenuOpen = null;
    this._enableError = null;
    this._enableOpen = false;
    this._enableAdditional = [];
    this._enablePrimary = "en";
    this._enableBusy = false;
  }

  connectedCallback() {
    super.connectedCallback();
    this.#loadInitialState();
    document.addEventListener("click", this.#onDocumentClick);
    document.addEventListener("keydown", this.#onDocumentKeydown);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    document.removeEventListener("click", this.#onDocumentClick);
    document.removeEventListener("keydown", this.#onDocumentKeydown);
  }

  #loadInitialState() {
    const node = document.getElementById("language-settings-initial-data");
    if (!node?.textContent) return;

    let parsed: unknown;
    try {
      parsed = JSON.parse(node.textContent);
    } catch {
      return;
    }
    const state = parsed as Partial<LanguageInitialState>;

    this._contentLanguage = state.contentLanguage ?? "en";
    this._dashboardLanguage = state.dashboardLanguage ?? "";
    this._multilingualEnabled = state.multilingualEnabled ?? false;
    this._additional = Array.isArray(state.additionalLanguages)
      ? [...state.additionalLanguages]
      : [];
    this._unmarkedPostCount = state.unmarkedPostCount ?? 0;
    this._sitePathPrefix = state.sitePathPrefix ?? "";
  }

  // ── Presentation helpers ──────────────────────────────────────────

  #entry(tag: string): LocaleOption {
    return (
      this.locales.find((locale) => locale.tag === tag) ?? {
        tag,
        native: tag,
        english: tag,
        coverage: 0,
      }
    );
  }

  #displayName(tag: string): string {
    const entry = this.#entry(tag);
    return entry.native || entry.tag;
  }

  #prefixFor(tag: string): string {
    return `${this._sitePathPrefix}/${tag.toLowerCase()}`;
  }

  #endpoint(path: string): string {
    return `${this._sitePathPrefix}/settings/language${path}`;
  }

  // ── Dismissal ─────────────────────────────────────────────────────

  /** True while any locale picker on this page is showing its list. */
  #pickerIsOpen(): boolean {
    return this.querySelector("jant-locale-picker[open]") !== null;
  }

  #onDocumentClick = (event: Event) => {
    if (!this._rowMenuOpen) return;
    const target = event.target as globalThis.Element | null;
    const inMenu =
      target && this.contains(target) && target.closest?.("[data-row-menu]");
    if (!inMenu) this._rowMenuOpen = null;
  };

  #onDocumentKeydown = (event: globalThis.KeyboardEvent) => {
    if (event.key !== "Escape") return;
    // An open picker handles its own Escape and stops the event there, so
    // reaching this handler means no picker consumed it.
    if (this._rowMenuOpen) {
      event.stopPropagation();
      this._rowMenuOpen = null;
      return;
    }
    if (this._enableOpen) {
      event.stopPropagation();
      this.#closeEnableDialog();
    }
  };

  #toggleRowMenu(tag: string) {
    this._rowMenuOpen = this._rowMenuOpen === tag ? null : tag;
  }

  // ── Server calls ──────────────────────────────────────────────────

  async #post(
    path: string,
    body: Record<string, unknown>,
  ): Promise<{ ok: boolean; message?: string; language?: string }> {
    try {
      const res = await fetch(this.#endpoint(path), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(body),
      });
      const json = await readJsonObject(res);
      if (!res.ok) {
        return {
          ok: false,
          message: getJsonString(json, "error") ?? `HTTP ${res.status}`,
          // A language-in-use refusal names the language, so the dialog can
          // offer putting it back as one click.
          language: getJsonString(json, "language"),
        };
      }
      return { ok: true, message: getJsonString(json, "toast") };
    } catch {
      return { ok: false, message: "Couldn't reach the server. Try again." };
    }
  }

  async #selectPrimary(tag: string) {
    this._removeError = null;
    if (tag === this._contentLanguage) return;

    // With multilingual off this is just "what language is this site in". With
    // it on, the root URLs change hands, which subscribers notice — so say so.
    if (this._multilingualEnabled) {
      const previous = this._contentLanguage;
      const confirmed = await showConfirmDialog({
        title: this.labels.changePrimaryTitle,
        message: interpolate(this.labels.changePrimaryBody, {
          next: this.#displayName(tag),
          previous: this.#displayName(previous),
          prefix: this.#prefixFor(previous),
        }),
        confirmLabel: this.labels.changePrimaryConfirm,
        cancelLabel: this.labels.cancel,
      });
      if (!confirmed) return;

      this._savingSite = true;
      const result = await this.#post("/primary", { language: tag });
      this._savingSite = false;
      if (!result.ok) {
        showToast(result.message ?? "", "error");
        return;
      }
      // The two lists swap in one server-side step; mirror that here so the
      // page reads correctly without a reload.
      this._additional = [
        ...this._additional.filter((entry) => entry !== tag),
        previous,
      ];
      this._contentLanguage = tag;
      if (result.message) showToast(result.message);
      return;
    }

    this._savingSite = true;
    const previous = this._contentLanguage;
    this._contentLanguage = tag;
    const result = await this.#post("", { contentLanguage: tag });
    this._savingSite = false;
    if (!result.ok) {
      this._contentLanguage = previous;
      showToast(result.message ?? "", "error");
      return;
    }
    if (result.message) showToast(result.message);
  }

  async #selectDashboardLanguage(value: string) {
    const previous = this._dashboardLanguage;
    this._dashboardLanguage = value;
    this._savingDashboard = true;
    const result = await this.#post("", { dashboardLanguage: value });
    this._savingDashboard = false;
    if (!result.ok) {
      this._dashboardLanguage = previous;
      showToast(result.message ?? "", "error");
      return;
    }
    // The dashboard renders in the catalog that was active when the page
    // loaded, so a reload is what actually applies the change.
    window.location.reload();
  }

  async #addLanguage(tag: string) {
    this._removeError = null;
    const result = await this.#post("/add", { language: tag });
    if (!result.ok) {
      showToast(result.message ?? "", "error");
      return;
    }
    this._additional = [...this._additional, tag];
    if (result.message) showToast(result.message);
  }

  async #removeLanguage(tag: string) {
    this._removeError = null;
    const result = await this.#post("/remove", { language: tag });
    if (!result.ok) {
      this._removeError = { tag, message: result.message ?? "" };
      return;
    }
    this._additional = this._additional.filter((entry) => entry !== tag);
    if (result.message) showToast(result.message);
  }

  async #turnOffMultilingual() {
    this._removeError = null;
    const confirmed = await showConfirmDialog({
      title: this.labels.disableTitle,
      message: interpolate(this.labels.disableBody, {
        prefix: this.#prefixFor(this._additional[0] ?? "en"),
      }),
      confirmLabel: this.labels.disableConfirm,
      cancelLabel: this.labels.cancel,
    });
    if (!confirmed) return;

    const result = await this.#post("/disable", {});
    if (!result.ok) {
      showToast(result.message ?? "", "error");
      return;
    }
    this._multilingualEnabled = false;
    // Queued for the same reason as the enable path: the reload below happens
    // before a toast raised here could be read.
    if (result.message) queueToastForNextPage(result.message);
    // The header's language switcher has to go away with the views.
    window.location.reload();
  }

  // ── Enable dialog ─────────────────────────────────────────────────

  #openEnableDialog() {
    this._removeError = null;
    this._enableError = null;
    this._enablePrimary = this._contentLanguage;
    this._enableAdditional = [...this._additional];
    this._enableOpen = true;
    void this.updateComplete.then(() => {
      const dialog = this.querySelector<HTMLDialogElement>(
        "[data-enable-dialog]",
      );
      if (dialog && !dialog.open) dialog.showModal();
      dialog?.querySelector<HTMLElement>("[data-enable-panel]")?.focus();
    });
  }

  #closeEnableDialog() {
    const dialog = this.querySelector<HTMLDialogElement>(
      "[data-enable-dialog]",
    );
    if (dialog?.open) dialog.close();
    this._enableOpen = false;
  }

  async #confirmEnable() {
    if (this._enableAdditional.length === 0 || this._enableBusy) return;

    this._enableBusy = true;
    this._enableError = null;
    const result = await this.#post("/enable", {
      primary: this._enablePrimary,
      additional: this._enableAdditional,
    });
    this._enableBusy = false;
    if (!result.ok) {
      // Inside the dialog, where the refusal happened — a toast would sit
      // beneath the modal's top layer and never be seen.
      this._enableError = {
        message: result.message ?? "",
        ...(result.language ? { language: result.language } : {}),
      };
      return;
    }

    this._contentLanguage = this._enablePrimary;
    this._additional = [...this._enableAdditional];
    this._multilingualEnabled = true;
    this._unmarkedPostCount = 0;
    this.#closeEnableDialog();
    // Queued rather than shown: the reload below would wipe a toast raised
    // here, and this is the one confirmation that says how many posts were
    // stamped — the number is gone from the page by the time it lands.
    if (result.message) queueToastForNextPage(result.message);
    // The page's own chrome changed with the setting — the language switcher
    // exists now — and only the server can render it. Same pattern as the
    // dashboard-language change above.
    window.location.reload();
  }

  // ── Render ────────────────────────────────────────────────────────

  /**
   * Labels handed to every picker on the page.
   *
   * Built once: the picker takes them as a property, and a fresh object each
   * render would make Lit see a changed property on every keystroke elsewhere
   * in the form.
   */
  get #pickerLabels(): LocalePickerLabels {
    this.#pickerLabelsCache ??= {
      search: this.labels.searchPlaceholder,
      empty: this.labels.noMatches,
    };
    return this.#pickerLabelsCache;
  }

  #pickerLabelsCache: LocalePickerLabels | null = null;

  #renderLanguagePicker(options: {
    labelId: string;
    current?: string;
    exclude: readonly string[];
    triggerLabel?: string;
    triggerClass: string;
    onSelect: (tag: string) => void;
  }) {
    return html`
      <jant-locale-picker
        .locales=${this.locales}
        .labels=${this.#pickerLabels}
        .value=${options.current ?? ""}
        .exclude=${[...options.exclude]}
        .triggerLabel=${options.triggerLabel ?? ""}
        .triggerClass=${options.triggerClass}
        .labelledby=${options.labelId}
        @locale-select=${(e: CustomEvent<{ tag: string }>) =>
          options.onSelect(e.detail.tag)}
      ></jant-locale-picker>
    `;
  }

  /**
   * The save refusal, rendered inside the dialog with its one-click fix.
   *
   * When the server names the language whose posts blocked the save, an
   * "Add {language}" button puts it straight back on the list — the reader
   * of the error should not have to find that language in a picker.
   */
  #renderEnableError(error: { message: string; language?: string }) {
    return html`
      <div class="flex flex-wrap items-center gap-2" role="alert">
        <p class="text-sm text-destructive">${error.message}</p>
        ${
          error.language
            ? html`
                <button
                  type="button"
                  class="btn-sm-outline"
                  data-enable-add-back
                  @click=${() => this.#addBackLanguage(error.language ?? "")}
                >
                  ${interpolate(this.labels.addMissingLanguage, {
                    language: this.#displayName(error.language),
                  })}
                </button>
              `
            : nothing
        }
      </div>
    `;
  }

  /** Put the language the refusal named back on the dialog's list. */
  #addBackLanguage(tag: string) {
    if (!tag) return;
    this._enableError = null;
    if (tag === this._enablePrimary || this._enableAdditional.includes(tag)) {
      return;
    }
    this._enableAdditional = [...this._enableAdditional, tag];
  }

  /**
   * The confirmation shown before multilingual content is switched on.
   *
   * BaseCoat's `.alert` is a two-column grid where only a title element and a
   * `<section>` are placed in the readable column, so the warning uses that
   * structure rather than bare paragraphs.
   */
  #renderEnableDialog() {
    if (!this._enableOpen) return nothing;

    // With nothing to stamp there is nothing to warn about — the alert only
    // exists for the one-time marking of posts that predate the feature.
    const warning =
      this._unmarkedPostCount > 0
        ? interpolate(this.labels.enableMarkWarning, {
            language: this.#displayName(this._enablePrimary),
          })
        : null;

    return html`
      <dialog
        class="dialog confirm-dialog"
        data-enable-dialog
        @cancel=${(e: Event) => {
          e.preventDefault();
          this.#closeEnableDialog();
        }}
        @click=${(e: Event) => {
          if (e.target === e.currentTarget) this.#closeEnableDialog();
        }}
        @keydown=${(e: globalThis.KeyboardEvent) => {
          if (e.key === "Enter" && !e.shiftKey && !this.#pickerIsOpen()) {
            e.preventDefault();
            void this.#confirmEnable();
          }
        }}
      >
        <div
          class="confirm-dialog-panel"
          data-enable-panel
          tabindex="-1"
          role="document"
          aria-labelledby="language-enable-title"
        >
          <header class="confirm-dialog-header">
            <h2 id="language-enable-title" class="confirm-dialog-title">
              ${this.labels.enableTitle}
            </h2>
          </header>

          <div class="flex flex-col gap-4 py-2">
            <div class="field">
              <span id="language-enable-primary-label" class="label"
                >${this.labels.primaryLanguage}</span
              >
              ${this.#renderLanguagePicker({
                labelId: "language-enable-primary-label",
                current: this._enablePrimary,
                exclude: this._enableAdditional,
                triggerLabel: this.#displayName(this._enablePrimary),
                triggerClass: LOCALE_PICKER_TRIGGER_CLASS,
                onSelect: (tag) => {
                  this._enablePrimary = tag;
                  this._enableAdditional = this._enableAdditional.filter(
                    (entry) => entry !== tag,
                  );
                },
              })}
              <p class="text-sm text-muted-foreground mt-1">
                ${this.labels.primaryLanguageHelp}
              </p>
            </div>

            <div class="field">
              <span id="language-enable-add-label" class="label"
                >${this.labels.otherLanguages}</span
              >
              <div class="flex flex-wrap items-center gap-2">
                ${this._enableAdditional.map(
                  (tag) => html`
                    <span class="badge-secondary gap-1">
                      ${this.#displayName(tag)}
                      <button
                        type="button"
                        class="cursor-pointer opacity-70 hover:opacity-100"
                        aria-label=${interpolate(this.labels.removeLanguage, {
                          language: this.#displayName(tag),
                        })}
                        @click=${() => {
                          this._enableAdditional =
                            this._enableAdditional.filter(
                              (entry) => entry !== tag,
                            );
                        }}
                      >
                        ×
                      </button>
                    </span>
                  `,
                )}
                ${this.#renderLanguagePicker({
                  labelId: "language-enable-add-label",
                  exclude: [this._enablePrimary, ...this._enableAdditional],
                  triggerLabel: `+ ${this.labels.addLanguage}`,
                  triggerClass: "btn-sm-outline",
                  onSelect: (tag) => {
                    this._enableAdditional = [...this._enableAdditional, tag];
                  },
                })}
              </div>
            </div>

            ${
              warning
                ? html`
                    <div class="alert">
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        aria-hidden="true"
                      >
                        <path
                          d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"
                        />
                        <path d="M12 9v4" />
                        <path d="M12 17h.01" />
                      </svg>
                      <strong>${this.labels.enableMarkTitle}</strong>
                      <section>
                        <p>${warning}</p>
                        <p>${this.labels.enableFixHint}</p>
                      </section>
                    </div>
                  `
                : nothing
            }

            <p class="text-sm text-muted-foreground">
              ${this.labels.enableReassurance}
            </p>

            ${
              this._enableAdditional.length === 0
                ? html`<p class="text-sm text-muted-foreground">
                    ${this.labels.enableNeedsLanguage}
                  </p>`
                : nothing
            }
            ${
              this._enableError
                ? this.#renderEnableError(this._enableError)
                : nothing
            }
          </div>

          <footer class="confirm-dialog-actions">
            <button
              type="button"
              class="btn-outline"
              @click=${() => this.#closeEnableDialog()}
            >
              ${this.labels.cancel}
            </button>
            <button
              type="button"
              class="btn"
              data-enable-confirm
              ?disabled=${
                this._enableAdditional.length === 0 || this._enableBusy
              }
              @click=${() => void this.#confirmEnable()}
            >
              ${this._enableBusy ? this.labels.saving : this.labels.save}
            </button>
          </footer>
        </div>
      </dialog>
    `;
  }

  /**
   * The folded actions of one non-primary language row.
   *
   * Making a language primary or removing it are once-a-year moves; a row of
   * always-visible buttons would give them daily-driver prominence. A "⋯"
   * menu keeps the list to what matters — language and address — and follows
   * the dismissal rules every popover here follows.
   */
  #renderRowMenu(tag: string) {
    const open = this._rowMenuOpen === tag;
    const name = this.#displayName(tag);

    return html`
      <span class="relative ml-auto flex items-center" data-row-menu>
        <button
          type="button"
          class="btn-sm-ghost text-muted-foreground"
          aria-haspopup="menu"
          aria-expanded=${open ? "true" : "false"}
          aria-label=${interpolate(this.labels.languageMenu, {
            language: name,
          })}
          data-language-menu
          @click=${() => this.#toggleRowMenu(tag)}
        >
          ⋯
        </button>
        ${
          open
            ? html`
                <div
                  role="menu"
                  class="absolute right-0 top-full z-20 mt-1 min-w-40 rounded-md border bg-popover py-1 text-popover-foreground shadow-md"
                >
                  <button
                    type="button"
                    role="menuitem"
                    class="block w-full cursor-pointer px-3 py-2 text-left text-sm hover:bg-accent"
                    ?disabled=${this._savingSite}
                    @click=${() => {
                      this._rowMenuOpen = null;
                      void this.#selectPrimary(tag);
                    }}
                  >
                    ${this.labels.makePrimary}
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    class="block w-full cursor-pointer px-3 py-2 text-left text-sm text-destructive hover:bg-accent"
                    @click=${() => {
                      this._rowMenuOpen = null;
                      void this.#removeLanguage(tag);
                    }}
                  >
                    ${interpolate(this.labels.removeLanguage, {
                      language: name,
                    })}
                  </button>
                </div>
              `
            : nothing
        }
      </span>
    `;
  }

  /**
   * The site's languages as one list, each with the address it is served at.
   *
   * One row per language keeps every fact and action in the same place —
   * which language, which URL, which one owns the root, make another primary,
   * remove one — instead of a picker, a chip row and a URL legend apart.
   */
  #renderLanguagesList() {
    const languages = [this._contentLanguage, ...this._additional];

    return html`
      <div class="field">
        <span id="language-list-label" class="label"
          >${this.labels.languagesLabel}${
            this._savingSite ? ` ${this.labels.saving}` : ""
          }</span
        >
        <ul
          class="flex flex-col rounded-md border divide-y"
          aria-labelledby="language-list-label"
        >
          ${languages.map((tag) => {
            const isPrimary = tag === this._contentLanguage;
            const url = isPrimary
              ? `${this._sitePathPrefix}/`
              : this.#prefixFor(tag);
            return html`
              <li class="flex flex-col px-3 py-1.5 text-sm">
                <div class="flex min-h-8 items-center gap-3">
                  <span class="min-w-0 truncate" lang=${tag}
                    >${this.#displayName(tag)}</span
                  >
                  <a
                    href=${url}
                    target="_blank"
                    rel="noopener noreferrer"
                    class="shrink-0"
                  >
                    <code
                      class="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                      >${url}</code
                    >
                  </a>
                  ${
                    isPrimary
                      ? html`<span class="badge-secondary ml-auto"
                          >${this.labels.primaryBadge}</span
                        >`
                      : this.#renderRowMenu(tag)
                  }
                </div>
                ${
                  this._removeError?.tag === tag
                    ? html`
                        <p class="pb-1 text-sm text-destructive" role="alert">
                          ${this._removeError.message}${
                            this._multilingualEnabled
                              ? html`
                                  <a
                                    class="underline underline-offset-2"
                                    href=${`${this.#prefixFor(tag)}/archive`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    >${this.labels.viewPosts}</a
                                  >
                                `
                              : nothing
                          }
                        </p>
                      `
                    : nothing
                }
              </li>
            `;
          })}
        </ul>
        <div class="mt-2">
          ${this.#renderLanguagePicker({
            labelId: "language-list-label",
            exclude: [this._contentLanguage, ...this._additional],
            triggerLabel: `+ ${this.labels.addLanguage}`,
            triggerClass: "btn-sm-outline",
            onSelect: (tag) => void this.#addLanguage(tag),
          })}
        </div>
      </div>
    `;
  }

  render() {
    if (!this.labels.contentLanguage) return nothing;

    return html`
      <div class="flex flex-col gap-8">
        <section class="flex flex-col gap-4">
          <h2 class="text-lg font-medium">${this.labels.siteSection}</h2>

          ${
            this._multilingualEnabled
              ? this.#renderLanguagesList()
              : html`
                  <div class="field">
                    <span id="language-primary-label" class="label"
                      >${this.labels.contentLanguage}</span
                    >
                    ${this.#renderLanguagePicker({
                      labelId: "language-primary-label",
                      current: this._contentLanguage,
                      exclude: [],
                      triggerLabel: this.#displayName(this._contentLanguage),
                      triggerClass: LOCALE_PICKER_TRIGGER_CLASS,
                      onSelect: (tag) => void this.#selectPrimary(tag),
                    })}
                    <p class="text-sm text-muted-foreground mt-1">
                      ${this.labels.contentLanguageHelp}${
                        this._savingSite ? ` ${this.labels.saving}` : ""
                      }
                    </p>
                  </div>
                `
          }
        </section>

        <section class="flex flex-col gap-3 border-t pt-8">
          <h2 class="text-lg font-medium">${this.labels.multilingual}</h2>
          <p class="text-sm text-muted-foreground">
            ${this.labels.multilingualHelp}
          </p>
          <p class="text-sm text-muted-foreground">
            <a
              href=${MULTILINGUAL_DOCS_URL}
              target="_blank"
              rel="noopener noreferrer"
              class="underline hover:text-foreground transition-colors"
              >${this.labels.multilingualDocs}</a
            >
            — ${this.labels.multilingualDocsHelp}
          </p>
          <div class="flex items-center gap-3">
            ${
              this._multilingualEnabled
                ? html`
                    <span class="badge-secondary">${this.labels.statusOn}</span>
                    <button
                      type="button"
                      class="btn-link h-auto p-0 text-sm text-muted-foreground"
                      data-multilingual-off
                      @click=${() => void this.#turnOffMultilingual()}
                    >
                      ${this.labels.disableConfirm}
                    </button>
                  `
                : html`
                    <button
                      type="button"
                      class="btn-sm-outline"
                      data-multilingual-setup
                      @click=${() => this.#openEnableDialog()}
                    >
                      ${this.labels.turnOn}
                    </button>
                  `
            }
          </div>
        </section>

        <section class="flex flex-col gap-4 border-t pt-8">
          <h2 class="text-lg font-medium">${this.labels.dashboardSection}</h2>

          <div class="field">
            <label id="dashboard-language-label" class="label"
              >${this.labels.dashboardLanguage}</label
            >
            <select
              class="select"
              aria-labelledby="dashboard-language-label"
              ?disabled=${this._savingDashboard}
              @change=${(e: Event) =>
                void this.#selectDashboardLanguage(
                  (e.target as HTMLSelectElement).value,
                )}
            >
              ${DASHBOARD_LOCALES.map(
                (tag) => html`
                  <option
                    value=${tag}
                    ?selected=${this._dashboardLanguage === tag}
                  >
                    ${
                      tag === ""
                        ? this.labels.followContent
                        : this.#displayName(tag)
                    }
                  </option>
                `,
              )}
            </select>
            <p class="text-sm text-muted-foreground mt-1">
              ${this.labels.dashboardLanguageHelp}
            </p>
          </div>
        </section>
      </div>

      ${this.#renderEnableDialog()}
    `;
  }
}

customElements.define("jant-settings-language", JantSettingsLanguage);
