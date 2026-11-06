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
  copyPostLink,
  iconImage,
  iconLink,
  menuOpensAbove,
} from "../post-menu-shared.js";
import { openShareImage, warmShareImage } from "../share-launch.js";

/** Two items, about 52 px each, inside the panel's padding. */
const ESTIMATED_MENU_HEIGHT = 130;

/** The post a menu is open for, from its article. */
interface SharedPost {
  id: string;
  permalink: string;
}

export class JantShareMenu extends LitElement {
  static properties = {
    _post: { state: true },
    _x: { state: true },
    _y: { state: true },
    _openAbove: { state: true },
  };

  declare _post: SharedPost | null;
  declare _x: number;
  declare _y: number;
  declare _openAbove: boolean;

  #trigger: HTMLElement | null = null;

  constructor() {
    super();
    this._post = null;
    this._x = 0;
    this._y = 0;
    this._openAbove = false;
  }

  createRenderRoot() {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    document.addEventListener("click", this.#handleDocumentClick);
    document.addEventListener("keydown", this.#handleKeydown);
    window.addEventListener("resize", this.#place);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    document.removeEventListener("click", this.#handleDocumentClick);
    document.removeEventListener("keydown", this.#handleKeydown);
    window.removeEventListener("resize", this.#place);
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
    this.#place();
    warmShareImage();
    void this.updateComplete.then(() => {
      this.querySelector<HTMLElement>("[role='menuitem']")?.focus();
    });
  };

  #handleKeydown = (event: Event) => {
    const key = event as globalThis.KeyboardEvent;
    if (key.key !== "Escape" || !this._post) return;
    key.preventDefault();
    this.#close();
  };

  /** Right-aligned to the trigger, above it when there is no room below. */
  #place = () => {
    const trigger = this.#trigger;
    if (!this._post || !trigger) return;
    if (!trigger.isConnected) {
      this.#close({ restoreFocus: false });
      return;
    }
    const rect = trigger.getBoundingClientRect();
    this._openAbove = menuOpensAbove(rect, ESTIMATED_MENU_HEIGHT);
    this._x = window.scrollX + rect.right;
    this._y =
      window.scrollY + (this._openAbove ? rect.top - 6 : rect.bottom + 6);
  };

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

  #shareImage() {
    const id = this._post?.id;
    const trigger = this.#trigger;
    // The dialog takes focus, and gives it back to the trigger on close.
    this.#close({ restoreFocus: false });
    if (id) void openShareImage(id, trigger);
  }

  render() {
    if (!this._post) return nothing;
    const transform = this._openAbove
      ? "transform:translate(-100%, -100%);"
      : "transform:translateX(-100%);";
    const style = `position:absolute;z-index:100;left:${Math.round(this._x)}px;top:${Math.round(this._y)}px;${transform}`;
    return html`
      <div
        class="post-menu-backdrop"
        @click=${() => this.#close({ restoreFocus: false })}
      ></div>
      <div class="dropdown-menu" style=${style}>
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
