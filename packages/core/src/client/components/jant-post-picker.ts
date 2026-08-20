/**
 * Shared "find a post" dialog.
 *
 * Mounted once at the document body level and opened through `pickPost()`.
 * Searching for one of your own posts is a task that keeps coming up — linking
 * a translation today, and anything else that has to point at a post later —
 * and a popover is the wrong shape for it: results need room for a real title,
 * a line of context, and a keyboard.
 *
 * The dialog knows nothing about what it is picking *for*. The caller supplies
 * the copy and a `search` function, so the eligibility rules stay wherever they
 * belong instead of leaking in here.
 */

import { LitElement, html, nothing } from "lit";
import { classMap } from "lit/directives/class-map.js";

/** One row in the picker. */
export interface PostPickerItem {
  id: string;
  /** What to call it — a title, or something derived when there is none. */
  label: string;
  /** Short context on the right, e.g. the post's language. */
  meta?: string;
}

/**
 * What one round of searching produced.
 *
 * The note carries an answer the list cannot: an author who pasted a URL is
 * looking at a page they know exists, so "nothing matched" is the wrong thing
 * to tell them — "that post is a draft" is the right thing.
 */
export interface PostPickerResult {
  items: PostPickerItem[];
  /** Shown in place of the empty hint. */
  note?: string;
}

export interface PostPickerOptions {
  heading: string;
  /** One line under the heading saying what picking will do. */
  hint?: string;
  placeholder: string;
  /** Shown when a search comes back with nothing and has nothing to add. */
  emptyHint: string;
  /** Shortest query worth sending. Defaults to 2. */
  minQueryLength?: number;
  search(query: string): Promise<PostPickerResult>;
}

interface PickerRequest extends PostPickerOptions {
  resolve: (value: string | null) => void;
}

const SEARCH_DEBOUNCE_MS = 200;

export class JantPostPicker extends LitElement {
  static properties = {
    _open: { state: true },
    _query: { state: true },
    _items: { state: true },
    _note: { state: true },
    _loading: { state: true },
    _searched: { state: true },
  };

  declare _open: boolean;
  declare _query: string;
  declare _items: PostPickerItem[];
  declare _note: string;
  declare _loading: boolean;
  declare _searched: boolean;

  #current: PickerRequest | null = null;
  #searchTimer: ReturnType<typeof setTimeout> | null = null;
  /** Guards against a slow earlier search overwriting a newer one's results. */
  #searchToken = 0;

  createRenderRoot() {
    this.innerHTML = "";
    return this;
  }

  constructor() {
    super();
    this._open = false;
    this._query = "";
    this._items = [];
    this._note = "";
    this._loading = false;
    this._searched = false;
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    const pending = this.#current;
    this.#current = null;
    pending?.resolve(null);
  }

  /**
   * Open the picker and resolve to the chosen post.
   *
   * @param options - Copy, and the search that produces the candidates
   * @returns The picked post's ID, or null when dismissed
   */
  pick(options: PostPickerOptions): Promise<string | null> {
    // One picker at a time: a second request means the first is stale.
    this.#current?.resolve(null);

    this._query = "";
    this._items = [];
    this._note = "";
    this._loading = false;
    this._searched = false;
    this._open = true;

    return new Promise<string | null>((resolve) => {
      this.#current = { ...options, resolve };
      void this.updateComplete.then(() => {
        const dialog = this.querySelector<HTMLDialogElement>(".picker-dialog");
        if (dialog && !dialog.open) dialog.showModal();
        this.querySelector<HTMLInputElement>(".picker-dialog-input")?.focus();
      });
    });
  }

  #finish(value: string | null) {
    if (this.#searchTimer) clearTimeout(this.#searchTimer);
    this.#searchTimer = null;
    this.#searchToken += 1;

    const dialog = this.querySelector<HTMLDialogElement>(".picker-dialog");
    if (dialog?.open) dialog.close();

    const pending = this.#current;
    this.#current = null;
    this._open = false;
    pending?.resolve(value);
  }

  #onInput(event: Event) {
    const request = this.#current;
    if (!request) return;

    const query = (event.target as HTMLInputElement).value;
    this._query = query;

    if (this.#searchTimer) clearTimeout(this.#searchTimer);
    const minLength = request.minQueryLength ?? 2;
    if (query.trim().length < minLength) {
      this.#searchToken += 1;
      this._items = [];
      this._note = "";
      this._loading = false;
      this._searched = false;
      return;
    }

    this._loading = true;
    // Debounced: the author is typing a phrase, not one query per keystroke.
    this.#searchTimer = setTimeout(() => {
      void this.#runSearch(query, request);
    }, SEARCH_DEBOUNCE_MS);
  }

  async #runSearch(query: string, request: PickerRequest) {
    const token = ++this.#searchToken;
    try {
      const result = await request.search(query);
      if (token !== this.#searchToken) return;
      this._items = result.items;
      this._note = result.note ?? "";
    } catch {
      if (token !== this.#searchToken) return;
      this._items = [];
      this._note = "";
    } finally {
      if (token === this.#searchToken) {
        this._loading = false;
        this._searched = true;
      }
    }
  }

  /** Arrow keys walk the results; Escape backs out. */
  #onKeydown(event: KeyboardEvent) {
    if (event.key === "Escape") {
      event.preventDefault();
      this.#finish(null);
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;

    const options = Array.from(
      this.querySelectorAll<HTMLButtonElement>(".picker-dialog-option"),
    );
    if (options.length === 0) return;
    event.preventDefault();

    const active = document.activeElement;
    const index = options.findIndex((option) => option === active);
    const next =
      event.key === "ArrowDown"
        ? index < 0
          ? 0
          : Math.min(index + 1, options.length - 1)
        : index <= 0
          ? -1
          : index - 1;

    if (next < 0) {
      this.querySelector<HTMLInputElement>(".picker-dialog-input")?.focus();
      return;
    }
    options[next]?.focus();
  }

  #onBackdropClick(event: MouseEvent) {
    if (event.target === event.currentTarget) this.#finish(null);
  }

  render() {
    const request = this.#current;
    if (!this._open || !request) return nothing;

    const minLength = request.minQueryLength ?? 2;
    const tooShort = this._query.trim().length < minLength;

    return html`
      <dialog
        class="dialog picker-dialog"
        @cancel=${(e: Event) => {
          e.preventDefault();
          this.#finish(null);
        }}
        @click=${this.#onBackdropClick}
        @keydown=${this.#onKeydown}
      >
        <div
          class="picker-dialog-panel"
          role="document"
          aria-labelledby="picker-dialog-title"
        >
          <header class="picker-dialog-header">
            <h2 id="picker-dialog-title" class="picker-dialog-title">
              ${request.heading}
            </h2>
            ${request.hint
              ? html`<p class="picker-dialog-hint">${request.hint}</p>`
              : nothing}
          </header>

          <input
            type="search"
            class="input picker-dialog-input"
            placeholder=${request.placeholder}
            aria-label=${request.heading}
            autocomplete="off"
            .value=${this._query}
            @input=${this.#onInput}
          />

          <div class="picker-dialog-results" role="listbox">
            ${this._items.map(
              (item) => html`
                <button
                  type="button"
                  role="option"
                  aria-selected="false"
                  class="picker-dialog-option"
                  @click=${() => this.#finish(item.id)}
                >
                  <span class="picker-dialog-option-label">${item.label}</span>
                  ${item.meta
                    ? html`<span class="picker-dialog-option-meta"
                        >${item.meta}</span
                      >`
                    : nothing}
                </button>
              `,
            )}
            ${this._loading
              ? html`<p class="picker-dialog-status">Searching…</p>`
              : nothing}
            ${!this._loading && this._searched && this._items.length === 0
              ? html`<p class="picker-dialog-status">
                  ${this._note || request.emptyHint}
                </p>`
              : nothing}
          </div>

          <footer
            class=${classMap({
              "picker-dialog-actions": true,
              "picker-dialog-actions-quiet": tooShort,
            })}
          >
            <button
              type="button"
              class="btn-outline"
              @click=${() => this.#finish(null)}
            >
              Cancel
            </button>
          </footer>
        </div>
      </dialog>
    `;
  }
}

if (!customElements.get("jant-post-picker")) {
  customElements.define("jant-post-picker", JantPostPicker);
}
