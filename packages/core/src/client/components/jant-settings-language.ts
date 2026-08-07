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
import { showToast } from "../toast.js";
import { getJsonString, readJsonObject } from "../json.js";

interface LanguageLabels {
  siteSection: string;
  dashboardSection: string;
  contentLanguage: string;
  contentLanguageHelp: string;
  primaryLanguage: string;
  primaryLanguageHelp: string;
  dashboardLanguage: string;
  dashboardLanguageHelp: string;
  followContent: string;
  multilingual: string;
  multilingualHelp: string;
  otherLanguages: string;
  addLanguage: string;
  removeLanguage: string;
  enableTitle: string;
  enableWhatHappensTitle: string;
  enableEffectViews: string;
  enableEffectCompose: string;
  enableEffectUrls: string;
  enableEffectReversible: string;
  enableMarkTitle: string;
  enableMarkWarning: string;
  enableMarkWarningEmpty: string;
  enableFixHint: string;
  enableNeedsLanguage: string;
  enableConfirm: string;
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
  urlPreview: string;
}

interface LocaleOption {
  tag: string;
  native: string;
  english: string;
  coverage: number;
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
 * Combobox trigger styled to match a native `.select`, since that is what it
 * stands in for. BaseCoat has no combobox class, and `.select` alone would drop
 * the chevron affordance on a `<button>`.
 */
const PICKER_TRIGGER_CLASS =
  "flex h-9 w-full cursor-pointer items-center rounded-md border border-input bg-transparent bg-[image:var(--chevron-down-icon-50)] bg-position-[center_right_0.75rem] bg-size-[1rem] bg-no-repeat py-2 pl-3 pr-9 text-left text-sm shadow-xs outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50";

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
    _pickerOpen: { state: true },
    _pickerQuery: { state: true },
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
  declare _pickerOpen:
    | "primary"
    | "add"
    | "enable-primary"
    | "enable-add"
    | null;
  declare _pickerQuery: string;
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
    this._pickerOpen = null;
    this._pickerQuery = "";
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

  #onDocumentClick = (event: Event) => {
    if (!this._pickerOpen) return;
    const target = event.target as globalThis.Element | null;
    if (target && this.contains(target)) {
      if (target.closest?.("[data-language-picker]")) return;
    }
    this._pickerOpen = null;
    this._pickerQuery = "";
  };

  #onDocumentKeydown = (event: globalThis.KeyboardEvent) => {
    if (event.key !== "Escape") return;
    if (this._pickerOpen) {
      event.stopPropagation();
      this._pickerOpen = null;
      this._pickerQuery = "";
      return;
    }
    if (this._enableOpen) {
      event.stopPropagation();
      this.#closeEnableDialog();
    }
  };

  #openPicker(which: NonNullable<JantSettingsLanguage["_pickerOpen"]>) {
    this._pickerOpen = this._pickerOpen === which ? null : which;
    this._pickerQuery = "";
    if (this._pickerOpen) {
      void this.updateComplete.then(() => {
        this.querySelector<HTMLInputElement>("[data-language-search]")?.focus();
      });
    }
  }

  #filteredLocales(exclude: readonly string[]): LocaleOption[] {
    const query = this._pickerQuery.trim().toLowerCase();
    return this.locales.filter((locale) => {
      if (exclude.includes(locale.tag)) return false;
      if (!query) return true;
      return (
        locale.tag.toLowerCase().includes(query) ||
        locale.native.toLowerCase().includes(query) ||
        locale.english.toLowerCase().includes(query)
      );
    });
  }

  // ── Server calls ──────────────────────────────────────────────────

  async #post(
    path: string,
    body: Record<string, unknown>,
  ): Promise<{ ok: boolean; message?: string }> {
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
        };
      }
      return { ok: true, message: getJsonString(json, "toast") };
    } catch {
      return { ok: false, message: "Couldn't reach the server. Try again." };
    }
  }

  async #selectPrimary(tag: string) {
    this._pickerOpen = null;
    this._pickerQuery = "";
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
    this._pickerOpen = null;
    this._pickerQuery = "";
    const result = await this.#post("/add", { language: tag });
    if (!result.ok) {
      showToast(result.message ?? "", "error");
      return;
    }
    this._additional = [...this._additional, tag];
    if (result.message) showToast(result.message);
  }

  async #removeLanguage(tag: string) {
    const result = await this.#post("/remove", { language: tag });
    if (!result.ok) {
      showToast(result.message ?? "", "error");
      return;
    }
    this._additional = this._additional.filter((entry) => entry !== tag);
    if (result.message) showToast(result.message);
  }

  /**
   * Put the checkbox back in step with the stored setting.
   *
   * The browser flips a checkbox the moment it is clicked, but this one only
   * takes effect once a confirmation is accepted and the server agrees. Lit
   * will not undo that on its own — the bound property never changed, so it
   * has nothing to re-commit — which would leave a cancelled toggle showing
   * the opposite of the truth.
   */
  #syncMultilingualCheckbox() {
    const checkbox = this.querySelector(
      "[data-multilingual-toggle]",
    ) as globalThis.HTMLInputElement | null;
    if (checkbox) checkbox.checked = this._multilingualEnabled;
  }

  async #toggleMultilingual(next: boolean) {
    if (next) {
      this.#openEnableDialog();
      return;
    }

    const confirmed = await showConfirmDialog({
      title: this.labels.disableTitle,
      message: interpolate(this.labels.disableBody, {
        prefix: this.#prefixFor(this._additional[0] ?? "en"),
      }),
      confirmLabel: this.labels.disableConfirm,
      cancelLabel: this.labels.cancel,
    });
    if (!confirmed) {
      this.#syncMultilingualCheckbox();
      return;
    }

    const result = await this.#post("/disable", {});
    if (!result.ok) {
      this.#syncMultilingualCheckbox();
      showToast(result.message ?? "", "error");
      return;
    }
    this._multilingualEnabled = false;
    if (result.message) showToast(result.message);
  }

  // ── Enable dialog ─────────────────────────────────────────────────

  #openEnableDialog() {
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
    // Runs after `#confirmEnable` has committed the new state, so this reads
    // the truth in both the accepted and the cancelled case.
    this.#syncMultilingualCheckbox();
    const dialog = this.querySelector<HTMLDialogElement>(
      "[data-enable-dialog]",
    );
    if (dialog?.open) dialog.close();
    this._enableOpen = false;
    this._pickerOpen = null;
    this._pickerQuery = "";
  }

  async #confirmEnable() {
    if (this._enableAdditional.length === 0 || this._enableBusy) return;

    this._enableBusy = true;
    const result = await this.#post("/enable", {
      primary: this._enablePrimary,
      additional: this._enableAdditional,
    });
    this._enableBusy = false;
    if (!result.ok) {
      showToast(result.message ?? "", "error");
      return;
    }

    this._contentLanguage = this._enablePrimary;
    this._additional = [...this._enableAdditional];
    this._multilingualEnabled = true;
    this._unmarkedPostCount = 0;
    this.#closeEnableDialog();
    if (result.message) showToast(result.message);
  }

  // ── Render ────────────────────────────────────────────────────────

  #renderLanguagePicker(options: {
    which: NonNullable<JantSettingsLanguage["_pickerOpen"]>;
    labelId: string;
    current?: string;
    exclude: readonly string[];
    triggerLabel: string;
    triggerClass: string;
    onSelect: (tag: string) => void;
  }) {
    const open = this._pickerOpen === options.which;
    const filtered = open ? this.#filteredLocales(options.exclude) : [];

    return html`
      <div class="relative w-fit max-w-full" data-language-picker>
        <button
          type="button"
          class=${options.triggerClass}
          aria-expanded=${open ? "true" : "false"}
          aria-haspopup="listbox"
          aria-labelledby=${options.labelId}
          @click=${() => this.#openPicker(options.which)}
        >
          <span class="min-w-0 truncate">${options.triggerLabel}</span>
        </button>
        ${open
          ? html`
              <div
                class="absolute left-0 top-full z-20 mt-1 w-80 min-w-full max-w-[calc(100vw-2rem)] max-h-72 overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-md"
              >
                <div class="border-b p-2">
                  <input
                    type="text"
                    class="input w-full"
                    data-language-search
                    placeholder=${this.labels.searchPlaceholder}
                    autocomplete="off"
                    spellcheck="false"
                    .value=${this._pickerQuery}
                    @input=${(e: Event) => {
                      this._pickerQuery = (e.target as HTMLInputElement).value;
                    }}
                  />
                </div>
                <div role="listbox" class="max-h-56 overflow-auto py-1">
                  ${filtered.length === 0
                    ? html`<div class="px-3 py-2 text-sm text-muted-foreground">
                        ${this.labels.noMatches}
                      </div>`
                    : filtered.map(
                        (locale) => html`
                          <button
                            type="button"
                            role="option"
                            aria-selected=${locale.tag === options.current
                              ? "true"
                              : "false"}
                            class=${[
                              "flex w-full cursor-pointer flex-col px-3 py-2 text-left text-sm hover:bg-accent",
                              locale.tag === options.current
                                ? "bg-accent/60"
                                : "",
                            ].join(" ")}
                            @click=${() => options.onSelect(locale.tag)}
                          >
                            <span>${locale.native}</span>
                            <span class="text-xs text-muted-foreground"
                              >${locale.english} · ${locale.tag}</span
                            >
                          </button>
                        `,
                      )}
                </div>
              </div>
            `
          : nothing}
      </div>
    `;
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

    const warning =
      this._unmarkedPostCount > 0
        ? interpolate(this.labels.enableMarkWarning, {
            language: this.#displayName(this._enablePrimary),
          })
        : this.labels.enableMarkWarningEmpty;

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
          if (e.key === "Enter" && !e.shiftKey && this._pickerOpen === null) {
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
                which: "enable-primary",
                labelId: "language-enable-primary-label",
                current: this._enablePrimary,
                exclude: this._enableAdditional,
                triggerLabel: this.#displayName(this._enablePrimary),
                triggerClass: PICKER_TRIGGER_CLASS,
                onSelect: (tag) => {
                  this._enablePrimary = tag;
                  this._enableAdditional = this._enableAdditional.filter(
                    (entry) => entry !== tag,
                  );
                  this._pickerOpen = null;
                  this._pickerQuery = "";
                },
              })}
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
                  which: "enable-add",
                  labelId: "language-enable-add-label",
                  exclude: [this._enablePrimary, ...this._enableAdditional],
                  triggerLabel: `+ ${this.labels.addLanguage}`,
                  triggerClass: "btn-sm-outline",
                  onSelect: (tag) => {
                    this._enableAdditional = [...this._enableAdditional, tag];
                    this._pickerOpen = null;
                    this._pickerQuery = "";
                  },
                })}
              </div>
            </div>

            <div class="flex flex-col gap-2">
              <span class="label">${this.labels.enableWhatHappensTitle}</span>
              <ul
                class="list-disc pl-5 text-sm text-muted-foreground flex flex-col gap-1"
              >
                <li>${this.labels.enableEffectViews}</li>
                <li>${this.labels.enableEffectCompose}</li>
                <li>${this.labels.enableEffectUrls}</li>
                <li>${this.labels.enableEffectReversible}</li>
              </ul>
            </div>

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
                ${this._unmarkedPostCount > 0
                  ? html`<p>${this.labels.enableFixHint}</p>`
                  : nothing}
              </section>
            </div>

            ${this._enableAdditional.length === 0
              ? html`<p class="text-sm text-muted-foreground">
                  ${this.labels.enableNeedsLanguage}
                </p>`
              : nothing}
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
              ?disabled=${this._enableAdditional.length === 0 ||
              this._enableBusy}
              @click=${() => void this.#confirmEnable()}
            >
              ${this._enableBusy
                ? this.labels.saving
                : this.labels.enableConfirm}
            </button>
          </footer>
        </div>
      </dialog>
    `;
  }

  render() {
    if (!this.labels.contentLanguage) return nothing;

    const primaryLabel = this._multilingualEnabled
      ? this.labels.primaryLanguage
      : this.labels.contentLanguage;
    const primaryHelp = this._multilingualEnabled
      ? this.labels.primaryLanguageHelp
      : this.labels.contentLanguageHelp;

    return html`
      <div class="flex flex-col gap-8">
        <section class="flex flex-col gap-4">
          <h2 class="text-lg font-medium">${this.labels.siteSection}</h2>

          <div class="field">
            <span id="language-primary-label" class="label"
              >${primaryLabel}</span
            >
            ${this.#renderLanguagePicker({
              which: "primary",
              labelId: "language-primary-label",
              current: this._contentLanguage,
              exclude: [],
              triggerLabel: this.#displayName(this._contentLanguage),
              triggerClass: PICKER_TRIGGER_CLASS,
              onSelect: (tag) => void this.#selectPrimary(tag),
            })}
            <p class="text-sm text-muted-foreground mt-1">
              ${primaryHelp}${this._savingSite ? ` ${this.labels.saving}` : ""}
            </p>
          </div>

          <div class="field">
            <label class="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                class="input mt-1 size-4"
                data-multilingual-toggle
                .checked=${this._multilingualEnabled}
                @change=${(e: Event) =>
                  void this.#toggleMultilingual(
                    (e.target as HTMLInputElement).checked,
                  )}
              />
              <span class="flex flex-col">
                <span class="label">${this.labels.multilingual}</span>
                <span class="text-sm text-muted-foreground"
                  >${this.labels.multilingualHelp}</span
                >
              </span>
            </label>
          </div>

          ${this._multilingualEnabled
            ? html`
                <div class="field pl-7">
                  <span id="language-add-label" class="label"
                    >${this.labels.otherLanguages}</span
                  >
                  <div class="flex flex-wrap items-center gap-2">
                    ${this._additional.map(
                      (tag) => html`
                        <span class="badge-secondary gap-1">
                          ${this.#displayName(tag)}
                          <button
                            type="button"
                            class="cursor-pointer opacity-70 hover:opacity-100"
                            aria-label=${interpolate(
                              this.labels.removeLanguage,
                              { language: this.#displayName(tag) },
                            )}
                            @click=${() => void this.#removeLanguage(tag)}
                          >
                            ×
                          </button>
                        </span>
                      `,
                    )}
                    ${this.#renderLanguagePicker({
                      which: "add",
                      labelId: "language-add-label",
                      exclude: [this._contentLanguage, ...this._additional],
                      triggerLabel: `+ ${this.labels.addLanguage}`,
                      triggerClass: "btn-sm-outline",
                      onSelect: (tag) => void this.#addLanguage(tag),
                    })}
                  </div>
                  <p class="text-sm text-muted-foreground mt-2">
                    ${this.labels.urlPreview}
                    ${[this._contentLanguage, ...this._additional].map(
                      (tag, index) =>
                        html`${index > 0 ? " · " : " "}
                          <code class="rounded bg-muted px-1.5 py-0.5 text-xs"
                            >${tag === this._contentLanguage
                              ? `${this._sitePathPrefix}/`
                              : this.#prefixFor(tag)}</code
                          >`,
                    )}
                  </p>
                </div>
              `
            : nothing}
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
                    ${tag === ""
                      ? this.labels.followContent
                      : this.#displayName(tag)}
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
