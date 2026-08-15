/**
 * Locale Picker Component
 *
 * A searchable language picker, shared by every surface that asks someone to
 * choose a language: first-run setup and the language settings page.
 *
 * A native `<select>` is the wrong control here. The list is ~50 curated BCP 47
 * tags, and the one a person wants is found by typing a few letters of a name
 * they know — in their own script or in English — not by scrolling. So the
 * trigger looks like a `.select` (that is what it stands in for) and opens a
 * filtered list instead of the browser's own.
 *
 * Two ways to use it:
 *
 * - **Property-driven** (lit-html hosts): bind `.locales` / `.value` and listen
 *   for `locale-select`.
 * - **`for`-driven** (server-rendered forms): point `for` at a form control's
 *   id. Selecting writes that control's value and fires `input`/`change`, so a
 *   Datastar `data-bind` on it keeps working without knowing this element
 *   exists. The control is hidden on upgrade — before that it is the form's
 *   real field.
 *
 * Light DOM only — BaseCoat and Tailwind classes apply directly.
 */

import { LitElement, html, nothing } from "lit";

export interface LocaleOption {
  /** Canonical BCP 47 tag stored in settings. */
  tag: string;
  /** Native display name (e.g. "简体中文"). */
  native: string;
  /** English display name, so the list is searchable either way. */
  english: string;
  /** Dashboard translation completeness in [0, 1]. */
  coverage: number;
}

export interface LocalePickerLabels {
  /** Placeholder in the search box. */
  search: string;
  /** Shown when the query matches nothing. */
  empty: string;
}

/**
 * Trigger styled to match a native `.select`, since that is what it stands in
 * for. BaseCoat has no combobox class, and `.select` alone would drop the
 * chevron affordance on a `<button>`.
 */
export const LOCALE_PICKER_TRIGGER_CLASS =
  "flex h-9 w-full cursor-pointer items-center rounded-md border border-input bg-transparent bg-[image:var(--chevron-down-icon-50)] bg-position-[center_right_0.75rem] bg-size-[1rem] bg-no-repeat py-2 pl-3 pr-9 text-left text-sm shadow-xs outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50";

/** Distinguishes the listboxes of several pickers on one page. */
let pickerSeq = 0;

export class JantLocalePicker extends LitElement {
  static properties = {
    locales: { type: Array },
    value: { type: String },
    exclude: { type: Array },
    labels: { type: Object },
    triggerLabel: { type: String, attribute: "trigger-label" },
    triggerClass: { type: String, attribute: "trigger-class" },
    labelledby: { type: String },
    htmlFor: { type: String, attribute: "for" },
    fullWidth: { type: Boolean, attribute: "full-width" },
    open: { type: Boolean, reflect: true },
    _query: { state: true },
    _active: { state: true },
  };

  declare locales: LocaleOption[];
  declare value: string;
  declare exclude: string[];
  declare labels: LocalePickerLabels;
  /** Overrides the trigger's text; defaults to the selected language's name. */
  declare triggerLabel: string;
  declare triggerClass: string;
  /** Id of the element labelling this picker, for the trigger's a11y name. */
  declare labelledby: string;
  /** Id of the form control this picker writes to, when there is one. */
  declare htmlFor: string;
  /**
   * Stretch to the container's width, for forms where every other field does.
   * Off by default: next to a chip row or a list, a trigger as wide as the page
   * reads as a text field rather than a choice.
   */
  declare fullWidth: boolean;
  declare open: boolean;
  declare _query: string;
  /** Index into the filtered list that Enter would select. */
  declare _active: number;

  #id = `locale-picker-${++pickerSeq}`;

  createRenderRoot() {
    // Drop the server-rendered trigger placeholder first. lit-html appends its
    // parts rather than replacing existing children, so leaving it would stack
    // the placeholder above the real control.
    this.innerHTML = "";
    return this;
  }

  constructor() {
    super();
    this.locales = [];
    this.value = "";
    this.exclude = [];
    this.labels = { search: "Search…", empty: "No matches." };
    this.triggerLabel = "";
    this.triggerClass = LOCALE_PICKER_TRIGGER_CLASS;
    this.labelledby = "";
    this.htmlFor = "";
    this.fullWidth = false;
    this.open = false;
    this._query = "";
    this._active = 0;
  }

  connectedCallback() {
    super.connectedCallback();
    document.addEventListener("click", this.#onDocumentClick);
    // Capture phase: an open picker must answer Escape and the arrow keys
    // before anything around it does — a dialog holding the picker would
    // otherwise close on the same Escape that closes the list.
    document.addEventListener("keydown", this.#onDocumentKeydown, true);
    this.#hideTarget();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    document.removeEventListener("click", this.#onDocumentClick);
    document.removeEventListener("keydown", this.#onDocumentKeydown, true);
  }

  // ── Target form control ───────────────────────────────────────────

  #target(): (HTMLElement & { value: string }) | null {
    if (!this.htmlFor) return null;
    const node = document.getElementById(this.htmlFor);
    return node && "value" in node
      ? (node as HTMLElement & { value: string })
      : null;
  }

  /**
   * Take the plain form control out of the layout once this picker works.
   *
   * It stays in the DOM, and stays the field the form reads — hiding it only
   * removes the duplicate control, so whatever is bound to it (a Datastar
   * signal, a plain form submission) is untouched.
   */
  #hideTarget() {
    const target = this.#target();
    if (!target) return;
    target.hidden = true;
    if (!this.value) this.value = target.value;
  }

  /**
   * Write the choice back to the form control and announce it.
   *
   * Assigning `.value` in script fires nothing on its own, so both events are
   * dispatched by hand — `input` for anything watching keystroke-level changes,
   * `change` for anything watching committed ones.
   */
  #syncTarget(tag: string) {
    const target = this.#target();
    if (!target || target.value === tag) return;
    target.value = tag;
    target.dispatchEvent(new Event("input", { bubbles: true }));
    target.dispatchEvent(new Event("change", { bubbles: true }));
  }

  // ── Options ───────────────────────────────────────────────────────

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

  #filtered(): LocaleOption[] {
    const query = this._query.trim().toLowerCase();
    return this.locales.filter((locale) => {
      if (this.exclude.includes(locale.tag)) return false;
      if (!query) return true;
      return (
        locale.tag.toLowerCase().includes(query) ||
        locale.native.toLowerCase().includes(query) ||
        locale.english.toLowerCase().includes(query)
      );
    });
  }

  // ── Open / close ──────────────────────────────────────────────────

  #toggle() {
    if (this.open) {
      this.#close();
      return;
    }
    this.open = true;
    this._query = "";
    const filtered = this.#filtered();
    const current = filtered.findIndex((locale) => locale.tag === this.value);
    this._active = current >= 0 ? current : 0;
    void this.updateComplete.then(() => {
      this.querySelector<HTMLInputElement>("[data-language-search]")?.focus();
    });
  }

  #close(options?: { focusTrigger?: boolean }) {
    if (!this.open) return;
    this.open = false;
    this._query = "";
    this._active = 0;
    if (options?.focusTrigger) {
      void this.updateComplete.then(() => {
        this.querySelector<HTMLButtonElement>(
          "[data-language-trigger]",
        )?.focus();
      });
    }
  }

  #select(tag: string) {
    this.value = tag;
    this.#syncTarget(tag);
    this.dispatchEvent(
      new CustomEvent("locale-select", {
        detail: { tag },
        bubbles: true,
        composed: true,
      }),
    );
    this.#close({ focusTrigger: true });
  }

  #onDocumentClick = (event: Event) => {
    if (!this.open) return;
    const target = event.target as globalThis.Element | null;
    if (target && this.contains(target)) return;
    this.#close();
  };

  /**
   * Keyboard handling, from the document so the list answers wherever focus
   * sits.
   *
   * Every key this owns stops propagating: a picker inside a dialog must not
   * let Enter confirm that dialog or Escape close it, and `preventDefault`
   * keeps Escape from reaching the browser's own dialog close request.
   */
  #onDocumentKeydown = (event: globalThis.KeyboardEvent) => {
    const target = event.target as globalThis.Node | null;
    const inside = target !== null && this.contains(target);

    if (!this.open) {
      // Enter on the closed trigger opens this picker; it is not a submit for
      // whatever form or dialog encloses it.
      if (inside && event.key === "Enter") event.stopPropagation();
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      this.#close({ focusTrigger: true });
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      event.stopPropagation();
      const filtered = this.#filtered();
      const choice = filtered[this._active] ?? filtered[0];
      if (choice) this.#select(choice.tag);
      return;
    }

    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;

    const filtered = this.#filtered();
    if (filtered.length === 0) return;

    event.preventDefault();
    event.stopPropagation();
    const step = event.key === "ArrowDown" ? 1 : -1;
    this._active = (this._active + step + filtered.length) % filtered.length;
    void this.updateComplete.then(() => {
      this.querySelector("[data-language-option][data-active]")?.scrollIntoView(
        {
          block: "nearest",
        },
      );
    });
  };

  render() {
    const filtered = this.open ? this.#filtered() : [];
    const listId = `${this.#id}-list`;
    const label = this.triggerLabel || this.#displayName(this.value);

    return html`
      <div
        class=${
          this.fullWidth ? "relative w-full" : "relative w-fit max-w-full"
        }
        data-language-picker
      >
        <button
          type="button"
          class=${this.triggerClass}
          data-language-trigger
          aria-expanded=${this.open ? "true" : "false"}
          aria-haspopup="listbox"
          aria-labelledby=${this.labelledby || nothing}
          @click=${() => this.#toggle()}
        >
          <span class="min-w-0 truncate">${label}</span>
        </button>
        ${
          this.open
            ? html`
                <div
                  class="absolute left-0 top-full z-20 mt-1 w-80 min-w-full max-w-[calc(100vw-2rem)] max-h-72 overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-md"
                >
                  <div class="border-b p-2">
                    <input
                      type="text"
                      class="input w-full"
                      data-language-search
                      role="combobox"
                      aria-expanded="true"
                      aria-controls=${listId}
                      aria-autocomplete="list"
                      aria-activedescendant=${
                        filtered[this._active]
                          ? `${this.#id}-option-${this._active}`
                          : nothing
                      }
                      placeholder=${this.labels.search}
                      autocomplete="off"
                      spellcheck="false"
                      .value=${this._query}
                      @input=${(e: Event) => {
                        this._query = (e.target as HTMLInputElement).value;
                        this._active = 0;
                      }}
                    />
                  </div>
                  <div
                    role="listbox"
                    id=${listId}
                    class="max-h-56 overflow-auto py-1"
                  >
                    ${
                      filtered.length === 0
                        ? html`<div
                            class="px-3 py-2 text-sm text-muted-foreground"
                          >
                            ${this.labels.empty}
                          </div>`
                        : filtered.map((locale, index) => {
                            const active = index === this._active;
                            return html`
                              <button
                                type="button"
                                role="option"
                                id=${`${this.#id}-option-${index}`}
                                data-language-option
                                ?data-active=${active}
                                aria-selected=${
                                  locale.tag === this.value ? "true" : "false"
                                }
                                class=${[
                                  "flex w-full cursor-pointer flex-col px-3 py-2 text-left text-sm hover:bg-accent",
                                  active ? "bg-accent" : "",
                                  locale.tag === this.value && !active
                                    ? "bg-accent/60"
                                    : "",
                                ].join(" ")}
                                @mousemove=${() => {
                                  this._active = index;
                                }}
                                @click=${() => this.#select(locale.tag)}
                              >
                                <span lang=${locale.tag}>${locale.native}</span>
                                <span class="text-xs text-muted-foreground"
                                  >${locale.english} · ${locale.tag}</span
                                >
                              </button>
                            `;
                          })
                    }
                  </div>
                </div>
              `
            : nothing
        }
      </div>
    `;
  }
}

customElements.define("jant-locale-picker", JantLocalePicker);
