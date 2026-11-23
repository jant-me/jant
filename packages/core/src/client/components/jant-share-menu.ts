/**
 * Share Menu
 *
 * A reader's post menu: the "More" button in a post's footer on a page
 * nobody is signed in to, with what a reader can do with a post — copy its
 * link, or share it as an image. One element per page (`SiteLayout` mounts
 * it), opened from any post's `[data-share-menu-trigger]`; the author's menu
 * is `jant-post-menu`, and this one wears its classes so the two read as one
 * control. Light DOM.
 */

import { LitElement, html, nothing } from "lit";
import {
  computePostMenuPlacement,
  copyPostLink,
  copyPostMarkdown,
  iconImage,
  iconLink,
  iconMarkdown,
  isPostMenuSheetViewport,
  postMenuSurfaceStyle,
  type PostMenuPlacement,
} from "../post-menu-shared.js";
import { openShareImage, warmShareImage } from "../share-launch.js";

/** Three items, about 52 px each, inside the panel's padding. */
const ESTIMATED_MENU_HEIGHT = 180;

/** The post a menu is open for, from its article. */
interface SharedPost {
  id: string;
  permalink: string;
}

export class JantShareMenu extends LitElement {
  static properties = {
    _post: { state: true },
    _isSheet: { state: true },
  };

  declare _post: SharedPost | null;
  declare _isSheet: boolean;

  #trigger: HTMLElement | null = null;
  #placement: PostMenuPlacement = {
    x: 0,
    y: 0,
    anchorBottom: false,
    maxHeight: ESTIMATED_MENU_HEIGHT,
  };

  constructor() {
    super();
    this._post = null;
    this._isSheet = false;
  }

  createRenderRoot() {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    document.addEventListener("click", this.#handleDocumentClick);
    document.addEventListener("keydown", this.#handleKeydown);
    window.addEventListener("resize", this.#handleViewportChange);
    globalThis.visualViewport?.addEventListener(
      "resize",
      this.#handleViewportChange,
    );
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    document.removeEventListener("click", this.#handleDocumentClick);
    document.removeEventListener("keydown", this.#handleKeydown);
    window.removeEventListener("resize", this.#handleViewportChange);
    globalThis.visualViewport?.removeEventListener(
      "resize",
      this.#handleViewportChange,
    );
  }

  updated() {
    if (this._post && !this._isSheet) {
      this.#place(true);
    }
  }

  #handleDocumentClick = (event: Event) => {
    const trigger = (event.target as globalThis.Element).closest?.<HTMLElement>(
      "[data-share-menu-trigger]",
    );
    if (!trigger) return;
    event.preventDefault();

    if (this._post && trigger === this.#trigger) {
      this.#close();
      return;
    }

    const article = trigger.closest<HTMLElement>("article[data-post-id]");
    const id = article?.dataset.postId;
    const permalink = article?.dataset.postPermalink;
    if (!id || !permalink) return;

    this.#trigger?.setAttribute("aria-expanded", "false");
    this.#trigger = trigger;
    trigger.setAttribute("aria-expanded", "true");
    this._post = { id, permalink };
    this.#place(false);
    warmShareImage();
    void this.updateComplete.then(() => {
      this.querySelector<HTMLElement>("[role='menuitem']")?.focus({
        preventScroll: true,
      });
    });
  };

  #handleKeydown = (event: Event) => {
    const key = event as globalThis.KeyboardEvent;
    if (key.key !== "Escape" || !this._post) return;
    key.preventDefault();
    this.#close();
  };

  #handleViewportChange = () => {
    this.#place(true);
  };

  /** Right-aligned to the trigger on desktop, clamped inside the viewport; sheet on phones. */
  #place(measure = false) {
    const trigger = this.#trigger;
    if (!this._post || !trigger) return;
    if (!trigger.isConnected) {
      this.#close({ restoreFocus: false });
      return;
    }
    const nextSheet = isPostMenuSheetViewport();
    const sheetChanged = nextSheet !== this._isSheet;
    this._isSheet = nextSheet;
    if (nextSheet) return;

    const panel = measure
      ? this.querySelector<HTMLElement>(".post-menu-panel")
      : null;
    const panelRect = panel?.getBoundingClientRect();
    const placement = computePostMenuPlacement(
      trigger.getBoundingClientRect(),
      {
        panelHeight: panelRect?.height ?? 0,
        panelWidth: panelRect?.width ?? 0,
        estimatedHeight: ESTIMATED_MENU_HEIGHT,
      },
    );
    this.#placement = placement;

    if (!sheetChanged) {
      const wrapper = this.querySelector<HTMLElement>(".post-menu-surface");
      if (wrapper) {
        wrapper.setAttribute("style", postMenuSurfaceStyle(placement));
      }
    }
  }

  #close({ restoreFocus = true }: { restoreFocus?: boolean } = {}) {
    const trigger = this.#trigger;
    trigger?.setAttribute("aria-expanded", "false");
    this.#trigger = null;
    this._post = null;
    if (restoreFocus) trigger?.focus();
  }

  #copyLink() {
    const permalink = this._post?.permalink;
    this.#close();
    if (permalink) void copyPostLink(permalink);
  }

  #copyMarkdown() {
    const permalink = this._post?.permalink;
    this.#close();
    if (permalink) void copyPostMarkdown(permalink);
  }

  #shareImage() {
    const id = this._post?.id;
    const trigger = this.#trigger;
    // The dialog takes focus, and gives it back to the trigger on close.
    this.#close({ restoreFocus: false });
    if (id) void openShareImage(id, trigger);
  }

  render() {
    if (!this._post) return nothing;
    return html`
      <div
        class="post-menu-backdrop"
        @click=${() => this.#close({ restoreFocus: false })}
      ></div>
      <div
        class="dropdown-menu post-menu-surface"
        ?data-post-menu-sheet=${this._isSheet}
        style=${this._isSheet ? nothing : postMenuSurfaceStyle(this.#placement)}
      >
        <div data-popover aria-hidden="false" class="!static post-menu-panel">
          <div class="post-menu-view post-menu-main">
            <div role="menu" class="post-menu-list">
              <div class="post-menu-section">
                <button
                  type="button"
                  role="menuitem"
                  class="post-menu-item"
                  data-share-menu-copy-link
                  @click=${() => this.#copyLink()}
                >
                  <span class="post-menu-item-label">Copy link</span>
                  <span class="post-menu-item-trailing">${iconLink()}</span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  class="post-menu-item"
                  data-share-menu-copy-markdown
                  @click=${() => this.#copyMarkdown()}
                >
                  <span class="post-menu-item-label">Copy as Markdown</span>
                  <span class="post-menu-item-trailing">${iconMarkdown()}</span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  class="post-menu-item"
                  data-share-menu-share-image
                  @click=${() => this.#shareImage()}
                >
                  <span class="post-menu-item-label">Share as image</span>
                  <span class="post-menu-item-trailing">${iconImage()}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
  }
}

customElements.define("jant-share-menu", JantShareMenu);
