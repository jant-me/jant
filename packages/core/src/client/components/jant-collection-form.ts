/**
 * Collection Quick-Create Form
 *
 * A title and an address, nothing else — the two things a collection cannot be
 * created without. It exists for the places where creating a collection is a
 * step inside another task: picking one while composing, or putting one in the
 * navigation. Everything a collection *can* have is decided in the collection
 * dialog, which is where an author who came to make a collection already is.
 *
 * Submitting dispatches `jant:collection-submit`; the surrounding dialog owns
 * the request and what happens after it.
 *
 * Light DOM only — BaseCoat and Tailwind classes apply directly.
 */

import { LitElement, html, nothing } from "lit";
import type { PropertyValueMap } from "lit";
import {
  MAX_COLLECTION_SLUG_LENGTH,
  MAX_COLLECTION_TITLE_LENGTH,
} from "../../types.js";
import { getCollectionPagePath } from "../../lib/collection-paths.js";
import { getSlugValidationIssue, truncateSlug } from "../../lib/slug-format.js";
import { slugify } from "../lazy-slugify.js";
import { publicPath } from "../runtime-paths.js";
import type {
  CollectionFormInitial,
  CollectionFormLabels,
  CollectionSubmitDetail,
} from "./collection-types.js";

export class JantCollectionForm extends LitElement {
  static properties = {
    labels: { type: Object },
    initial: { type: Object },
    action: { type: String },

    _title: { state: true },
    _slug: { state: true },
    _showSlugEditor: { state: true },
    _slugEdited: { state: true },
    _suggestedSlug: { state: true },
    _loading: { state: true },
  };

  declare labels: CollectionFormLabels;
  declare initial: CollectionFormInitial;
  declare action: string;

  declare _title: string;
  declare _slug: string;
  declare _showSlugEditor: boolean;
  declare _slugEdited: boolean;
  declare _suggestedSlug: string;
  declare _loading: boolean;

  #initialized = false;
  #boundKeydown: ((e: KeyboardEvent) => void) | null = null;

  createRenderRoot() {
    this.innerHTML = "";
    return this;
  }

  constructor() {
    super();
    this.labels = {} as CollectionFormLabels;
    this.initial = { title: "", slug: "" };
    this.action = "";

    this._title = "";
    this._slug = "";
    this._showSlugEditor = false;
    this._slugEdited = false;
    this._suggestedSlug = "";
    this._loading = false;
  }

  connectedCallback() {
    super.connectedCallback();
    this.#boundKeydown = (e: KeyboardEvent) => {
      if (e.isComposing || e.keyCode === 229) return;
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        void this.#handleSubmit(e);
      }
    };
    this.addEventListener("keydown", this.#boundKeydown);
  }

  disconnectedCallback() {
    if (this.#boundKeydown) {
      this.removeEventListener("keydown", this.#boundKeydown);
      this.#boundKeydown = null;
    }
    super.disconnectedCallback();
  }

  protected update(
    changedProperties: PropertyValueMap<JantCollectionForm>,
  ): void {
    if (!this.#initialized || changedProperties.has("initial")) {
      this.#applyInitialData();
    }
    super.update(changedProperties);
  }

  set loading(value: boolean) {
    this._loading = value;
  }

  get loading(): boolean {
    return this._loading;
  }

  #applyInitialData() {
    if (!this.initial) return;
    this.#initialized = true;
    this._title = this.initial.title ?? "";
    this._slug = this.initial.slug ?? "";
    this._suggestedSlug = this.initial.slug ?? "";
    this._slugEdited = Boolean(this._slug.trim());
    this._showSlugEditor = false;
  }

  async #handleTitleInput(event: Event) {
    const target = event.target as HTMLInputElement;
    this._title = target.value;

    if (this._slugEdited) {
      return;
    }

    const currentTitle = target.value;
    const slug = truncateSlug(
      await slugify(currentTitle),
      MAX_COLLECTION_SLUG_LENGTH,
    );
    if (this._title === currentTitle) {
      this._suggestedSlug = slug;
      if (!this._slugEdited) {
        this._slug = slug;
      }
    }
  }

  #handleSlugInput(event: Event) {
    const target = event.target as HTMLInputElement;
    this._slug = target.value.toLowerCase();
    this._slugEdited = true;
  }

  #getSlugValidationMessage(): string | null {
    const issue = getSlugValidationIssue(this._slug, {
      maxLength: MAX_COLLECTION_SLUG_LENGTH,
    });
    if (issue === "too_long") {
      return (
        this.labels.slugTooLongHelp ??
        `Keep this link under ${MAX_COLLECTION_SLUG_LENGTH} characters.`
      );
    }
    if (issue === "invalid") return this.labels.slugInvalidHelp;
    if (issue === "reserved") return this.labels.slugReservedHelp;
    return null;
  }

  #showSlugEditor() {
    if (this._showSlugEditor) return;
    this._showSlugEditor = true;
    this.updateComplete.then(() => {
      const slugInput = this.querySelector<HTMLInputElement>(
        "[data-collection-slug-input]",
      );
      slugInput?.focus();
      slugInput?.select();
    });
  }

  #resetSlugToSuggested() {
    if (!this._suggestedSlug) return;
    this._slug = this._suggestedSlug;
    this._slugEdited = false;
    this._showSlugEditor = false;
  }

  #getCollectionLinkPreview(): string {
    const slug = this._slug.trim();
    const path = publicPath(
      slug ? getCollectionPagePath(slug) : getCollectionPagePath("example"),
    );
    const origin =
      globalThis.location?.origin && globalThis.location.origin !== "null"
        ? globalThis.location.origin
        : "http://localhost";
    return new URL(path, `${origin}/`).toString();
  }

  #renderSlugHelper() {
    const slugError = this.#getSlugValidationMessage();
    if (slugError) {
      return html`<p
        class="text-xs text-destructive mt-1"
        data-collection-slug-error
      >
        ${slugError}
      </p>`;
    }

    if (!this._slug.trim()) {
      return html`<p class="text-xs text-muted-foreground mt-1">
        ${this.labels.slugHelp}
      </p>`;
    }

    return html`<p class="text-xs text-muted-foreground mt-1 break-all">
      ${this.#getCollectionLinkPreview()}
    </p>`;
  }

  #renderSlugControls() {
    const hasPreview = Boolean(this._slug.trim());
    const canResetToTitle =
      this._showSlugEditor &&
      Boolean(this._suggestedSlug) &&
      this._slug.trim() !== this._suggestedSlug;

    if (!hasPreview && !this._showSlugEditor) {
      return nothing;
    }

    if (this._showSlugEditor) {
      return html`
        <div class="collection-quick-link-editor">
          <div class="field">
            <div class="collection-quick-link-row">
              <label class="label mb-0">${this.labels.slugLabel}</label>
              ${canResetToTitle
                ? html`
                    <button
                      type="button"
                      class="collection-quick-link-action"
                      @click=${() => this.#resetSlugToSuggested()}
                    >
                      ${this.labels.resetSlugLabel}
                    </button>
                  `
                : nothing}
            </div>
            <input
              type="text"
              class="input"
              data-collection-slug-input
              required
              pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
              maxlength=${MAX_COLLECTION_SLUG_LENGTH}
              .value=${this._slug}
              aria-invalid=${this.#getSlugValidationMessage()
                ? "true"
                : "false"}
              placeholder="my-collection"
              @input=${(event: Event) => this.#handleSlugInput(event)}
            />
            ${this.#renderSlugHelper()}
          </div>
        </div>
      `;
    }

    return html`
      <div class="collection-quick-link-box">
        <div class="collection-quick-link-row">
          <p
            class="collection-quick-link-preview text-xs text-muted-foreground"
            aria-live="polite"
          >
            ${this.#getCollectionLinkPreview()}
          </p>
          <button
            type="button"
            class="collection-quick-link-action"
            @click=${() => this.#showSlugEditor()}
          >
            ${this.labels.editSlugLabel}
          </button>
        </div>
      </div>
    `;
  }

  async #handleSubmit(e: Event) {
    e.preventDefault();
    if (this._loading) {
      return;
    }

    const title = this._title.trim();
    let slug = this._slug.trim();

    if (!title) {
      this.querySelector<HTMLInputElement>(
        "[data-collection-title-input]",
      )?.focus();
      return;
    }

    if (!slug && !this._slugEdited) {
      slug = truncateSlug(await slugify(title), MAX_COLLECTION_SLUG_LENGTH);
      this._slug = slug;
      this._suggestedSlug = slug;
    }

    if (!slug || this.#getSlugValidationMessage()) {
      this.#showSlugEditor();
      this.updateComplete.then(() => {
        this.querySelector<HTMLInputElement>(
          "[data-collection-slug-input]",
        )?.focus();
      });
      return;
    }

    const detail: CollectionSubmitDetail = {
      endpoint: this.action,
      data: { title, slug },
    };

    this.dispatchEvent(
      new CustomEvent<CollectionSubmitDetail>("jant:collection-submit", {
        bubbles: true,
        detail,
      }),
    );
  }

  render() {
    return html`
      <form
        class="flex flex-col gap-4"
        @submit=${(event: Event) => void this.#handleSubmit(event)}
      >
        <div class="field">
          <label class="label">${this.labels.titleLabel}</label>
          <input
            type="text"
            class="input"
            data-collection-title-input
            required
            maxlength=${MAX_COLLECTION_TITLE_LENGTH}
            .value=${this._title}
            placeholder=${this.labels.titlePlaceholder}
            @input=${(event: Event) => void this.#handleTitleInput(event)}
          />
        </div>

        ${this.#renderSlugControls()}

        <button type="submit" class="sr-only">
          ${this.labels.quickSubmitLabel}
        </button>
      </form>
    `;
  }
}

customElements.define("jant-collection-form", JantCollectionForm);
