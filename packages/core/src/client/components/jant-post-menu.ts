/**
 * Post Menu
 *
 * Global singleton dropdown that appears on any post's [...] trigger button.
 * Reads post metadata from `data-*` attributes on the closest `article[data-post]`.
 * Uses BaseCoat dropdown-menu component structure for styling.
 * Light DOM only — BaseCoat and Tailwind classes apply directly.
 *
 * Includes a collection picker sub-view that replaces the menu content
 * when "Add to collection" is clicked (multi-select with search).
 */

import { LitElement, html, nothing } from "lit";
import {
  FEATURED_SPARKLE_OFF_SLASH_PATH,
  FEATURED_SPARKLE_PATH,
} from "../../lib/featured-icons.js";
import { showConfirmDialog } from "../confirm.js";
import { refreshArticleView } from "../post-refresh.js";
import { showToast } from "../toast.js";
import { readErrorMessage } from "../json.js";
import { publicPath } from "../runtime-paths.js";
import { pickPost } from "../post-picker.js";
import {
  applyItemOrder,
  filterCollectionsBySearch,
  getSelectedFirstOrder,
} from "../collection-picker-order.js";
import type { CollectionSubmitDetail } from "./collection-types.js";

interface PostMenuData {
  id: string;
  threadId: string;
  pinned: boolean;
  pinnedInCollection: boolean;
  featured: boolean;
  visibility: string;
  isReply: boolean;
  isDraft: boolean;
  /** Content language of the Thread, when the site publishes more than one. */
  language: string | null;
}

/** One language the site publishes. */
interface MenuLanguage {
  tag: string;
  label: string;
}

/** A Thread already linked to this one as a translation. */
interface TranslationItem {
  id: string;
  slug: string;
  /** What to call it — its title, or something derived when it has none. */
  label: string;
  language: string | null;
}

interface CollectionItem {
  id: string;
  title: string;
  slug: string;
}

interface CollectionsResponse {
  collections?: CollectionItem[];
}

interface ThreadCollectionsResponse {
  collectionIds?: string[];
}

type PostMenuView =
  | "menu"
  | "collections"
  | "visibility"
  | "language"
  | "language-switch";

/**
 * Where the language panel puts focus, in document order rather than in the
 * order written here — `querySelector` picks the first match on the page, so
 * this reads as "the topmost real action in the panel", whichever it is.
 */
const LANGUAGE_PANEL_FOCUS =
  "[data-post-menu-translation] a, [data-post-menu-translation-first], [data-post-menu-open-language-switch]";

interface MenuTriggerRect {
  top: number;
  bottom: number;
}

const ESTIMATED_MENU_HEIGHT = 360;
const MENU_VIEWPORT_MARGIN = 12;

function getMenuPlacement(rect: MenuTriggerRect) {
  const spaceBelow = window.innerHeight - rect.bottom - MENU_VIEWPORT_MARGIN;
  const spaceAbove = rect.top - MENU_VIEWPORT_MARGIN;
  return spaceBelow < ESTIMATED_MENU_HEIGHT && spaceAbove > spaceBelow;
}

export function removeLeadingFeedDivider(
  feedContainer: HTMLElement | null | undefined,
) {
  const firstFeedItem = Array.from(feedContainer?.children ?? []).find(
    (child): child is HTMLElement =>
      child instanceof HTMLElement && child.classList.contains("feed-item"),
  );
  const firstDivider = Array.from(firstFeedItem?.children ?? []).find(
    (child): child is HTMLElement =>
      child instanceof HTMLElement && child.classList.contains("feed-divider"),
  );
  firstDivider?.remove();
}

function findThreadRootArticle(threadId: string): HTMLElement | null {
  return (
    Array.from(
      document.querySelectorAll<HTMLElement>("article[data-post-id]"),
    ).find((article) => article.dataset.postId === threadId) ?? null
  );
}

function readPostMenuData(article: HTMLElement): PostMenuData | null {
  const id = article.dataset.postId;
  if (!id) return null;

  const threadId = article.dataset.threadRootId ?? id;
  const threadRootArticle = findThreadRootArticle(threadId) ?? article;

  return {
    id,
    threadId,
    pinned: article.hasAttribute("data-post-pinned"),
    pinnedInCollection: threadRootArticle.hasAttribute(
      "data-post-pinned-in-collection",
    ),
    featured: article.hasAttribute("data-post-featured"),
    visibility: article.dataset.postVisibility ?? "public",
    isReply: threadId !== id || article.hasAttribute("data-post-reply"),
    isDraft: article.hasAttribute("data-post-draft"),
    // Carried on the Thread root, so a reply reads it from there.
    language: threadRootArticle.dataset.postLanguage ?? null,
  };
}

export class JantPostMenu extends LitElement {
  static properties = {
    languages: { type: Array },
    _open: { state: true },
    _data: { state: true },
    _x: { state: true },
    _y: { state: true },
    _openAbove: { state: true },
    _view: { state: true },
    _collections: { state: true },
    _collectionsLoading: { state: true },
    _collectionSearch: { state: true },
    _threadCollectionIds: { state: true },
    _addCollectionPanelOpen: { state: true },
    _translations: { state: true },
    _translationsLoading: { state: true },
    _translationBusy: { state: true },
  };

  declare languages: MenuLanguage[];
  declare _open: boolean;
  declare _data: PostMenuData | null;
  declare _x: number;
  declare _y: number;
  declare _openAbove: boolean;
  declare _view: PostMenuView;
  declare _collections: CollectionItem[] | null;
  declare _collectionsLoading: boolean;
  declare _collectionSearch: string;
  declare _threadCollectionIds: string[];
  declare _addCollectionPanelOpen: boolean;
  declare _translations: TranslationItem[] | null;
  declare _translationsLoading: boolean;
  declare _translationBusy: boolean;
  declare _triggerEl: HTMLElement | null;

  /** Whether collections were modified during this session (triggers page reload on close) */
  #collectionsDirty = false;
  #collectionPickerOrder: string[] = [];
  #restoreTriggerFocusOnClose = true;

  createRenderRoot() {
    this.innerHTML = "";
    return this;
  }

  constructor() {
    super();
    this.languages = [];
    this._open = false;
    this._data = null;
    this._x = 0;
    this._y = 0;
    this._openAbove = true;
    this._view = "menu";
    this._collections = null;
    this._collectionsLoading = false;
    this._collectionSearch = "";
    this._threadCollectionIds = [];
    this._addCollectionPanelOpen = false;
    this._translations = null;
    this._translationsLoading = false;
    this._translationBusy = false;
    this._triggerEl = null;
  }

  connectedCallback() {
    super.connectedCallback();
    document.addEventListener("click", this.#handleDocumentClick);
    document.addEventListener("keydown", this.#handleKeydown);
    window.addEventListener("resize", this.#handleViewportChange);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    document.removeEventListener("click", this.#handleDocumentClick);
    document.removeEventListener("keydown", this.#handleKeydown);
    window.removeEventListener("resize", this.#handleViewportChange);
  }

  #syncPositionFromTrigger() {
    const trigger = this._triggerEl;
    if (!trigger?.isConnected) {
      if (this._open) {
        this.#close({ restoreFocus: false });
      }
      return;
    }

    const rect = trigger.getBoundingClientRect();
    this._openAbove = getMenuPlacement(rect);
    this._x = window.scrollX + rect.right;
    this._y =
      window.scrollY + (this._openAbove ? rect.top - 6 : rect.bottom + 6);
  }

  #handleViewportChange = () => {
    if (!this._open || this._addCollectionPanelOpen) return;
    this.#syncPositionFromTrigger();
  };

  #handleKeydown = (e: Event) => {
    const ke = e as globalThis.KeyboardEvent;
    // Let IME consume Escape during composition (e.g. dismissing the CJK
    // candidate popup in the collection search input).
    if (ke.isComposing || ke.keyCode === 229) return;
    if (ke.key === "Escape") {
      if (this._addCollectionPanelOpen) {
        this.#closeAddCollectionPanel();
        return;
      }
      // Close collection popovers first
      const openPopover = document.querySelector(
        "[data-collection-popover].open",
      );
      if (openPopover) {
        openPopover.classList.remove("open");
        return;
      }
      if (this._open) {
        // One step back per press, not one step out: the language picker is a
        // level deeper than the panel that opens it.
        if (this._view === "language-switch") {
          this.#showLanguagePanel();
          return;
        }
        if (this._view !== "menu") {
          this.#showMainMenu();
          return;
        }
        this.#close();
      }
    }
  };

  #handleDocumentClick = (e: Event) => {
    const target = e.target as HTMLElement;

    // Collection popover toggle
    const popoverTrigger = target.closest<HTMLElement>(
      "[data-collection-popover-trigger]",
    );
    if (popoverTrigger) {
      e.preventDefault();
      e.stopPropagation();
      const popover = popoverTrigger.parentElement?.querySelector<HTMLElement>(
        "[data-collection-popover]",
      );
      if (popover) {
        popover.classList.toggle("open");
      }
      return;
    }

    // Click inside a collection popover — don't close it
    if (target.closest("[data-collection-popover]")) {
      return;
    }

    // Click inside the quick-create dialog — don't close the menu session
    if (
      target.closest("[data-collection-quick-dialog]") ||
      target.classList.contains("collection-quick-dialog-backdrop")
    ) {
      return;
    }

    // Close any open collection popovers on outside click
    const openPopover = document.querySelector(
      "[data-collection-popover].open",
    );
    if (openPopover) {
      openPopover.classList.remove("open");
    }

    // Clicking a trigger button
    const trigger = target.closest<HTMLButtonElement>(
      "[data-post-menu-trigger]",
    );
    if (trigger) {
      e.preventDefault();
      e.stopPropagation();

      const article = trigger.closest<HTMLElement>("article[data-post]");
      if (!article) return;

      const menuData = readPostMenuData(article);
      if (!menuData) return;

      // Toggle: close if same post, open if different
      if (this._open && this._data?.id === menuData.id) {
        this.#close();
        return;
      }

      this._data = menuData;

      // Position relative to trigger
      this._triggerEl = trigger;
      this.#restoreTriggerFocusOnClose = true;
      this.#syncPositionFromTrigger();
      trigger.setAttribute("aria-expanded", "true");
      this._view = "menu";
      this._open = true;
      this.#focusAfterUpdate("[data-post-menu-item-primary]");
      return;
    }

    // Clicking inside the dropdown — don't close (menu or any of its panels).
    //
    // `.post-menu-view` — the root of whichever panel is on screen — and not
    // the two obvious alternatives, for two different reasons.
    //
    // Not `[role="menu"]`: that is on the *list*, and a panel's header sits
    // outside it, so every back button read as a click outside the menu and
    // closed the whole thing.
    //
    // Not `.post-menu-panel`, the container the views render into, even though
    // it reads as the more honest "anywhere in the dropdown". On a *real*
    // click the browser runs a microtask checkpoint between event listeners,
    // so a menu item that switches panels has already re-rendered by the time
    // this handler runs: `target` is a detached node whose subtree ends at the
    // view root, and `closest` can no longer reach the container. Clicking
    // Language would open the panel and close the menu in the same event.
    // (`el.click()` from a script never shows this — the stack never empties,
    // so nothing re-renders mid-dispatch. Hence the `performUpdate()` in the
    // test that covers it.)
    if (this._open) {
      const inside = target.closest?.(".post-menu-view, .post-menu-panel");
      if (inside) return;
    }

    // Clicking outside — close
    if (this._open) {
      this.#close({ restoreFocus: false });
    }
  };

  #focusAfterUpdate(selector: string) {
    this.updateComplete.then(() => {
      this.querySelector<HTMLElement>(selector)?.focus();
    });
  }

  #getCollectionOptionElements() {
    return Array.from(
      this.querySelectorAll<HTMLButtonElement>(".post-menu-picker-option"),
    );
  }

  #handleCollectionSearchKeydown = (event: globalThis.KeyboardEvent) => {
    if (
      event.defaultPrevented ||
      event.isComposing ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey
    ) {
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      this.#close();
      return;
    }

    if (event.key !== "ArrowDown") {
      return;
    }

    const [firstOption] = this.#getCollectionOptionElements();
    const addAction = this.querySelector<HTMLButtonElement>(
      "[data-post-menu-add-collection]",
    );
    const nextTarget = firstOption ?? addAction;
    if (!nextTarget) return;

    event.preventDefault();
    nextTarget.focus();
  };

  #handleCollectionOptionKeydown = (
    event: globalThis.KeyboardEvent,
    collectionId: string,
  ) => {
    if (
      event.defaultPrevented ||
      event.isComposing ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey
    ) {
      return;
    }

    const options = this.#getCollectionOptionElements();
    const currentTarget = event.currentTarget as HTMLButtonElement | null;
    const currentIndex = currentTarget ? options.indexOf(currentTarget) : -1;

    if (event.key === "ArrowDown") {
      const addAction = this.querySelector<HTMLButtonElement>(
        "[data-post-menu-add-collection]",
      );
      const nextTarget =
        currentIndex >= 0
          ? (options[currentIndex + 1] ?? addAction)
          : options[0];
      if (!nextTarget) return;

      event.preventDefault();
      nextTarget.focus();
      return;
    }

    if (event.key === "ArrowUp") {
      const searchInput = this.querySelector<HTMLInputElement>(
        ".post-menu-picker-search input",
      );
      const previousTarget =
        currentIndex > 0 ? options[currentIndex - 1] : searchInput;
      if (!previousTarget) return;

      event.preventDefault();
      previousTarget.focus();
      return;
    }

    if (event.key === " " || event.key === "Spacebar") {
      event.preventDefault();
      this.#toggleCollection(collectionId);
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      this.#close();
    }
  };

  #handleCollectionOptionClick = (
    event: globalThis.MouseEvent,
    collectionId: string,
  ) => {
    // Keyboard shortcuts are handled on keydown; ignore the synthetic click that
    // browsers dispatch for button activation so Enter/Space keep their custom meaning.
    if (event.detail === 0) {
      return;
    }

    this.#toggleCollection(collectionId);
  };

  #handleCollectionAddActionKeydown = (event: globalThis.KeyboardEvent) => {
    if (
      event.defaultPrevented ||
      event.isComposing ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      event.key !== "ArrowUp"
    ) {
      return;
    }

    const options = this.#getCollectionOptionElements();
    const searchInput = this.querySelector<HTMLInputElement>(
      ".post-menu-picker-search input",
    );
    const previousTarget = options.at(-1) ?? searchInput;
    if (!previousTarget) return;

    event.preventDefault();
    previousTarget.focus();
  };

  #showMainMenu(focusSelector = "[data-post-menu-item-primary]") {
    this._view = "menu";
    this.#focusAfterUpdate(focusSelector);
  }

  #openVisibilityPanel() {
    if (this._data?.isReply) return;
    this._view = "visibility";
    this.#focusAfterUpdate(
      "[data-post-menu-visibility-current='true'], [data-post-menu-visibility-option]",
    );
  }

  // --- Language and translations ---

  /** Whether this site publishes enough languages for any of this to matter. */
  get #multilingual(): boolean {
    return this.languages.length > 1;
  }

  #languageLabel(tag: string | null): string {
    if (!tag) return "Not set";
    return this.languages.find((l) => l.tag === tag)?.label ?? tag;
  }

  async #openLanguagePanel() {
    if (this._data?.isReply) return;
    this._view = "language";
    this.#focusAfterUpdate(LANGUAGE_PANEL_FOCUS);
    // The panel is mostly about them, and the picker one level down needs them
    // too: a language is unavailable exactly when another post in the group
    // already holds it.
    await this.#loadTranslations();
    // A Thread whose every other language is already spoken for has nothing to
    // put on screen until this resolves, so the first attempt found nothing to
    // land on. Anywhere else, focus is already inside and must stay put.
    if (!this.contains(document.activeElement)) {
      this.#focusAfterUpdate(LANGUAGE_PANEL_FOCUS);
    }
  }

  #showLanguagePanel(focusSelector = "[data-post-menu-open-language-switch]") {
    this._view = "language";
    this.#focusAfterUpdate(focusSelector);
  }

  /**
   * The one place the language picker lives.
   *
   * Behind a row of its own rather than at the top of the language panel:
   * switching a Thread's language is a correction, made once if ever, while
   * reading and adding other versions is the daily work. Left inline it also
   * degenerated — on a two-language site whose other version is already linked,
   * the radio group rendered a single unclickable row for the current language.
   */
  #openLanguageSwitch() {
    if (this._data?.isReply) return;
    this._view = "language-switch";
    this.#focusAfterUpdate(
      "[data-post-menu-language-current='true'], [data-post-menu-language-option]",
    );
  }

  /**
   * Split the site's languages by what this Thread can do with each.
   *
   * A language another version already holds is neither selectable nor free:
   * the group allows one post per language, so it is spoken for either way.
   */
  #languageChoices() {
    const current = this._data?.language ?? null;
    const linked = this._translations ?? [];
    const held = new Set(
      linked.flatMap((translation) =>
        translation.language ? [translation.language] : [],
      ),
    );
    return {
      current,
      linked,
      selectable: this.languages.filter(
        (language) => language.tag === current || !held.has(language.tag),
      ),
      free: this.languages.filter(
        (language) => language.tag !== current && !held.has(language.tag),
      ),
    };
  }

  /**
   * Set the language of this whole Thread.
   *
   * Not optimistic: unlike visibility, this can be refused server-side — the
   * Thread's translation group may already hold that language — and showing the
   * new language before the server agrees would be a lie the author acts on.
   */
  async #setLanguage(tag: string) {
    const data = this._data;
    if (!data || this._translationBusy) return;
    this._translationBusy = true;

    try {
      const response = await fetch(
        publicPath(`/api/posts/${data.threadId}/language`),
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({ language: tag }),
        },
      );
      if (!response.ok) {
        showToast(
          await readErrorMessage(
            response,
            "Could not change the language. Try again.",
          ),
          "error",
        );
        return;
      }

      const article = document.querySelector<HTMLElement>(
        `article[data-post-id="${data.threadId}"]`,
      );
      if (article) article.dataset.postLanguage = tag;
      this._data = { ...data, language: tag };
      showToast(`Thread is now in ${this.#languageLabel(tag)}.`);
      this.#close();
    } catch {
      showToast("Could not change the language. Try again.", "error");
    } finally {
      this._translationBusy = false;
    }
  }

  async #loadTranslations() {
    const data = this._data;
    if (!data) return;
    this._translationsLoading = true;
    try {
      const response = await fetch(
        publicPath(`/api/posts/${data.threadId}/translations`),
        { credentials: "same-origin" },
      );
      if (!response.ok) return;
      const body = (await response.json()) as {
        translations?: TranslationItem[];
      };
      this._translations = body.translations ?? [];
    } catch {
      this._translations = [];
    } finally {
      this._translationsLoading = false;
    }
  }

  /**
   * Open the composer on a new post that translates this one.
   *
   * Prefers the dialog, so the author writes the translation without leaving
   * the post they are translating — navigating away to a blank page loses that
   * context exactly when it is most useful. Pages that render no dialog (the
   * standalone composer among them) fall back to the URL, which carries the
   * same two values.
   */
  async #writeTranslation(tag: string) {
    const data = this._data;
    if (!data) return;
    this.#close({ restoreFocus: false });

    const composeEl = document.querySelector("jant-compose-dialog") as
      | import("./jant-compose-dialog.js").JantComposeDialog
      | null;
    if (composeEl) {
      await composeEl.openTranslation(data.threadId, tag);
      return;
    }

    const params = new URLSearchParams({
      translationOf: data.threadId,
      lang: tag,
    });
    window.location.assign(publicPath(`/new?${params.toString()}`));
  }

  /**
   * Ask the author which post to link, in a dialog rather than in this popover.
   *
   * The menu is the wrong shape for a search: results need room for a real
   * title and a keyboard. The picker is generic — the eligibility rules stay on
   * the server, and this only supplies the copy and the request.
   */
  async #openLinkPicker() {
    const data = this._data;
    if (!data) return;
    this.#close({ restoreFocus: false });

    const picked = await pickPost({
      heading: "Link a translation",
      hint: "Only posts you could actually link are listed: published, and in a language this one's group does not already have.",
      placeholder: "Search your posts…",
      emptyHint: "Nothing matched that you could link.",
      search: async (query) => {
        const response = await fetch(
          publicPath(
            `/api/posts/${data.threadId}/translations/candidates?q=${encodeURIComponent(query)}`,
          ),
          { credentials: "same-origin" },
        );
        if (!response.ok) return [];
        const body = (await response.json()) as {
          candidates?: Array<{
            id: string;
            label: string;
            language: string | null;
          }>;
        };
        return (body.candidates ?? []).map((candidate) => ({
          id: candidate.id,
          label: candidate.label,
          meta: this.#languageLabel(candidate.language),
        }));
      },
    });

    if (!picked) return;
    this._data = data;
    await this.#linkTranslation(picked);
    // The page renders the link too ("Also available in …"), so it has to catch
    // up with the change the author just made.
    window.location.reload();
  }

  async #linkTranslation(otherId: string) {
    const data = this._data;
    if (!data || this._translationBusy) return;
    this._translationBusy = true;

    try {
      const response = await fetch(
        publicPath(`/api/posts/${data.threadId}/translations`),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({ postId: otherId }),
        },
      );
      if (!response.ok) {
        showToast(
          await readErrorMessage(
            response,
            "Could not link those posts. Try again.",
          ),
          "error",
        );
        return;
      }
      await this.#loadTranslations();
      showToast("Posts linked as translations.");
    } catch {
      showToast("Could not link those posts. Try again.", "error");
    } finally {
      this._translationBusy = false;
    }
  }

  /**
   * Take one other version out of this Thread's translation group.
   *
   * Unlinking is per-version rather than "leave the group": from the author's
   * seat the group *is* the list of other versions, so removing the row they
   * are looking at is the action they mean. A group left with a single member
   * collapses server-side, which makes the two-post case do the obvious thing.
   *
   * The confirm runs after the menu closes, the way deleting a post does — a
   * modal opened underneath a popover fights it for focus and for the backdrop
   * click.
   */
  async #unlinkTranslation(target: TranslationItem) {
    const data = this._data;
    if (!data || this._translationBusy) return;

    const trigger = this._triggerEl;
    this.#close({ restoreFocus: false });

    const languageLabel = this.#languageLabel(target.language);
    const confirmed = await showConfirmDialog({
      message: `Unlink the ${languageLabel} version, “${target.label}”? Both posts stay published — they just stop pointing at each other.`,
      confirmLabel: "Unlink",
      cancelLabel: "Cancel",
      tone: "danger",
    });
    if (!confirmed) {
      trigger?.focus();
      return;
    }

    this._translationBusy = true;
    try {
      const response = await fetch(
        publicPath(`/api/posts/${target.id}/translations`),
        { method: "DELETE", credentials: "same-origin" },
      );
      if (!response.ok) {
        showToast(
          await readErrorMessage(response, "Could not unlink. Try again."),
          "error",
        );
        trigger?.focus();
        return;
      }
      showToast("Translation link removed.");
      // The page renders the link too ("Also available in …"), so it has to
      // catch up with the change the author just made.
      window.location.reload();
    } catch {
      showToast("Could not unlink. Try again.", "error");
      trigger?.focus();
    } finally {
      this._translationBusy = false;
    }
  }

  #close(options: { restoreFocus?: boolean } = {}) {
    const restoreFocus =
      options.restoreFocus ?? this.#restoreTriggerFocusOnClose;
    const trigger = this._triggerEl;
    trigger?.setAttribute("aria-expanded", "false");
    this._triggerEl = null;
    this.#restoreTriggerFocusOnClose = true;
    this._open = false;
    this._view = "menu";
    this._addCollectionPanelOpen = false;
    this._collectionSearch = "";
    this._translations = null;

    if (this.#collectionsDirty) {
      this.#collectionsDirty = false;
      window.location.reload();
      return;
    }

    if (restoreFocus) {
      trigger?.focus();
    }
  }

  // --- Public API (for keyboard shortcuts) ---

  /**
   * Open the collection picker for the given post, positioning the menu
   * relative to the post's menu trigger button.
   */
  openCollectionsForPost(article: HTMLElement) {
    const menuData = readPostMenuData(article);
    if (!menuData || menuData.isReply) return;

    this._data = menuData;

    const trigger = article.querySelector<HTMLElement>(
      "[data-post-menu-trigger]",
    );
    if (trigger) {
      this._triggerEl = trigger;
      this.#restoreTriggerFocusOnClose = false;
      this.#syncPositionFromTrigger();
      trigger.setAttribute("aria-expanded", "true");
    }

    this._open = true;
    this.#openCollectionPicker();
  }

  // --- Actions ---

  async #edit() {
    if (!this._data) return;
    const postId = this._data.id;
    this.#close({ restoreFocus: false });

    const dialog = document.getElementById(
      "compose-dialog",
    ) as HTMLDialogElement | null;
    const composeEl = dialog?.querySelector("jant-compose-dialog") as
      | import("./jant-compose-dialog.js").JantComposeDialog
      | null;
    if (composeEl) {
      await composeEl.openEdit(postId);
    }
  }

  async #publish() {
    if (!this._data) return;
    const postId = this._data.id;
    const trigger = this._triggerEl;
    this.#close({ restoreFocus: false });

    const article = document.querySelector<HTMLElement>(
      `article[data-post-id="${postId}"]`,
    );

    try {
      const res = await fetch(`/api/posts/${postId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "published" }),
      });
      if (!res.ok) throw new Error();

      showToast("Draft published.");
      // The badge, the timestamp, and any drafts published alongside this one
      // all change at once — re-render the surface rather than patching it.
      if (!article || !(await refreshArticleView(article))) {
        globalThis.location.reload();
      }
    } catch {
      showToast("Could not publish the draft. Try again.", "error");
      trigger?.focus();
    }
  }

  #setVisibility(newVisibility: string) {
    if (!this._data) return;
    const postId = this._data.id;
    const oldVisibility = this._data.visibility;

    // Optimistic update
    const article = document.querySelector<HTMLElement>(
      `article[data-post-id="${postId}"]`,
    );
    if (article) article.dataset.postVisibility = newVisibility;
    this._data = { ...this._data, visibility: newVisibility };

    const messages: Record<string, string> = {
      public: "Post made public.",
      latest_hidden: "Hidden from Latest.",
      private: "Post made private.",
    };
    showToast(messages[newVisibility] ?? "Visibility updated.");
    this.#close();

    // Fire request in background, revert on failure
    fetch(`/api/posts/${postId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ visibility: newVisibility }),
    })
      .then((res) => {
        if (!res.ok) throw new Error();
      })
      .catch(() => {
        // Revert
        const el = document.querySelector<HTMLElement>(
          `article[data-post-id="${postId}"]`,
        );
        if (el) el.dataset.postVisibility = oldVisibility;
        showToast("Could not update visibility. Try again.", "error");
      });
  }

  #setFeatured(featured: boolean) {
    if (!this._data) return;
    const postId = this._data.id;

    // Optimistic update
    const article = document.querySelector<HTMLElement>(
      `article[data-post-id="${postId}"]`,
    );
    if (article) {
      if (featured) {
        article.setAttribute("data-post-featured", "");
      } else {
        article.removeAttribute("data-post-featured");
      }
    }
    this._data = { ...this._data, featured };

    showToast(featured ? "Added to Featured." : "Removed from Featured.");
    this.#close();

    // Fire request in background, revert on failure
    fetch(`/api/posts/${postId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ featured }),
    })
      .then((res) => {
        if (!res.ok) throw new Error();
      })
      .catch(() => {
        // Revert
        const el = document.querySelector<HTMLElement>(
          `article[data-post-id="${postId}"]`,
        );
        if (el) {
          if (featured) {
            el.removeAttribute("data-post-featured");
          } else {
            el.setAttribute("data-post-featured", "");
          }
        }
        showToast("Could not update post. Try again.", "error");
      });
  }

  #togglePin() {
    if (!this._data) return;
    const postId = this._data.id;
    const newPinned = !this._data.pinned;

    // Optimistic update
    const article = document.querySelector<HTMLElement>(
      `article[data-post-id="${postId}"]`,
    );
    if (article) {
      if (newPinned) {
        article.setAttribute("data-post-pinned", "");
      } else {
        article.removeAttribute("data-post-pinned");
      }
    }
    this._data = { ...this._data, pinned: newPinned };

    showToast(newPinned ? "Post pinned." : "Post unpinned.");
    this.#close();

    // Fire request in background, revert on failure
    fetch(`/api/posts/${postId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pinned: newPinned }),
    })
      .then((res) => {
        if (!res.ok) throw new Error();
      })
      .catch(() => {
        // Revert
        const el = document.querySelector<HTMLElement>(
          `article[data-post-id="${postId}"]`,
        );
        if (el) {
          if (newPinned) {
            el.removeAttribute("data-post-pinned");
          } else {
            el.setAttribute("data-post-pinned", "");
          }
        }
        showToast("Could not update post. Try again.", "error");
      });
  }

  #toggleCollectionPin() {
    if (!this._data) return;
    const threadId = this._data.threadId;
    const collectionId = document.querySelector<HTMLElement>(
      "[data-collection-id]",
    )?.dataset.collectionId;
    if (!collectionId) return;

    const newPinned = !this._data.pinnedInCollection;

    // Optimistic update
    const article = findThreadRootArticle(threadId);
    if (article) {
      if (newPinned) {
        article.setAttribute("data-post-pinned-in-collection", "");
      } else {
        article.removeAttribute("data-post-pinned-in-collection");
      }
    }
    this._data = { ...this._data, pinnedInCollection: newPinned };

    showToast(
      newPinned ? "Pinned in collection." : "Unpinned from collection.",
    );
    this.#close();

    const method = newPinned ? "PUT" : "DELETE";
    fetch(`/api/collections/${collectionId}/threads/${threadId}/pin`, {
      method,
    })
      .then((res) => {
        if (!res.ok) throw new Error();
      })
      .catch(() => {
        const el = findThreadRootArticle(threadId);
        if (el) {
          if (newPinned) {
            el.removeAttribute("data-post-pinned-in-collection");
          } else {
            el.setAttribute("data-post-pinned-in-collection", "");
          }
        }
        showToast("Could not update pin. Try again.", "error");
      });
  }

  async #delete() {
    if (!this._data) return;
    const trigger = this._triggerEl;
    this.#close({ restoreFocus: false });

    const confirmed = await showConfirmDialog({
      message: this._data.isDraft
        ? "Discard this draft permanently? This can't be undone."
        : "Delete this post permanently? This can't be undone.",
      confirmLabel: this._data.isDraft ? "Discard" : "Delete",
      cancelLabel: "Cancel",
      tone: "danger",
    });
    if (!confirmed) {
      trigger?.focus();
      return;
    }

    try {
      const res = await fetch(`/api/posts/${this._data.id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error();

      // Remove article from DOM
      const article = document.querySelector<HTMLElement>(
        `article[data-post-id="${this._data.id}"]`,
      );
      // If the post is inside a thread group, only remove its .thread-item
      // wrapper so sibling posts in the same thread stay visible. Fall back
      // to removing the .feed-item wrapper (or the article itself) only when
      // the post is standalone or the thread group is now empty.
      const threadItem = article?.closest<HTMLElement>(".thread-item");
      const threadGroup = threadItem?.closest<HTMLElement>(".thread-group");
      if (threadItem && threadGroup) {
        threadItem.remove();
        const remainingPosts = threadGroup.querySelectorAll(
          ".thread-item:not(.thread-item-gap)",
        );
        if (remainingPosts.length === 0) {
          const feedItem = threadGroup.closest<HTMLElement>(".feed-item");
          const feedContainer = feedItem?.parentElement ?? null;
          (feedItem ?? threadGroup).remove();
          removeLeadingFeedDivider(feedContainer);
        }
      } else {
        const feedItem = article?.closest<HTMLElement>(".feed-item");
        const feedContainer = feedItem?.parentElement ?? null;
        (feedItem ?? article)?.remove();
        removeLeadingFeedDivider(feedContainer);
      }

      showToast("Post deleted.");
    } catch {
      showToast("Could not delete post. Try again.", "error");
      trigger?.focus();
    }
  }

  async #openCollectionPicker() {
    if (!this._data || this._data.isReply) return;
    const postId = this._data.id;
    this._view = "collections";
    this._collectionSearch = "";
    this._collectionsLoading = true;
    this.#focusAfterUpdate(
      ".post-menu-picker-search input, .post-menu-picker-option, [data-post-menu-add-collection]",
    );

    try {
      const [collectionsRes, postRes] = await Promise.all([
        fetch("/api/collections?view=compose", {
          cache: "no-store",
          headers: { Accept: "application/json" },
        }),
        fetch(`/api/posts/${postId}`),
      ]);

      if (!collectionsRes.ok) throw new Error();
      const collectionsData =
        (await collectionsRes.json()) as CollectionsResponse;
      const collections = collectionsData.collections ?? [];
      let threadCollectionIds = this._threadCollectionIds;

      if (postRes.ok) {
        const postData = (await postRes.json()) as ThreadCollectionsResponse;
        threadCollectionIds = postData.collectionIds ?? [];
      }
      this.#collectionPickerOrder = getSelectedFirstOrder(
        collections,
        threadCollectionIds,
      );
      this._collections = collections;
      this._threadCollectionIds = threadCollectionIds;
    } catch {
      this._collections = this._collections ?? [];
      showToast("Could not load collections.", "error");
    }
    this._collectionsLoading = false;
    this.#focusAfterUpdate(
      ".post-menu-picker-search input, .post-menu-picker-option, [data-post-menu-add-collection]",
    );
  }

  #toggleCollection(collectionId: string) {
    if (!this._data) return;
    const threadId = this._data.threadId;
    const isSelected = this._threadCollectionIds.includes(collectionId);

    // Optimistic update
    if (isSelected) {
      this._threadCollectionIds = this._threadCollectionIds.filter(
        (id) => id !== collectionId,
      );
    } else {
      this._threadCollectionIds = [...this._threadCollectionIds, collectionId];
    }
    this.#collectionsDirty = true;
    showToast(isSelected ? "Removed from collection." : "Added to collection.");

    // Fire request in background, revert on failure
    if (isSelected) {
      fetch(`/api/collections/${collectionId}/threads/${threadId}`, {
        method: "DELETE",
      })
        .then((res) => {
          if (!res.ok) throw new Error();
          return this.#refreshComposeCollections();
        })
        .catch(() => {
          // Revert: re-add
          if (!this._threadCollectionIds.includes(collectionId)) {
            this._threadCollectionIds = [
              ...this._threadCollectionIds,
              collectionId,
            ];
          }
          showToast("Could not remove from collection. Try again.", "error");
        });
    } else {
      fetch(`/api/collections/${collectionId}/threads`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ threadId }),
      })
        .then((res) => {
          if (!res.ok) {
            // 409 means already added — not an error, keep optimistic state
            if (res.status === 409) return this.#refreshComposeCollections();
            throw new Error();
          }
          return this.#refreshComposeCollections();
        })
        .catch(() => {
          // Revert: remove
          this._threadCollectionIds = this._threadCollectionIds.filter(
            (id) => id !== collectionId,
          );
          showToast("Could not add to collection. Try again.", "error");
        });
    }
  }

  #openAddCollectionPanel() {
    this._addCollectionPanelOpen = true;
    this.updateComplete.then(() => {
      const titleInput = this.querySelector<HTMLInputElement>(
        "[data-collection-quick-dialog] [data-collection-title-input]",
      );
      titleInput?.focus();
      titleInput?.select();
    });
  }

  #closeAddCollectionPanel() {
    this._addCollectionPanelOpen = false;
    this.#syncPositionFromTrigger();
    this.updateComplete.then(() => {
      (
        this.querySelector<HTMLElement>("[data-post-menu-add-collection]") ??
        this._triggerEl
      )?.focus();
    });
  }

  async #handleAddCollectionSubmit(e: Event) {
    const event = e as CustomEvent<CollectionSubmitDetail>;
    event.stopPropagation();

    const detail = event.detail;
    if (!detail) return;

    const formEl = this.querySelector("jant-collection-form") as
      | (HTMLElement & { loading: boolean })
      | null;
    if (formEl) formEl.loading = true;

    try {
      const res = await fetch("/api/collections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(detail.data),
      });
      const created = (await res.json().catch(() => null)) as {
        id: string;
        title: string;
        slug: string;
        error?: string;
      } | null;

      if (!res.ok) {
        throw new Error(
          created?.error || "Could not create collection. Try again.",
        );
      }
      if (!created?.id || !created.title || !created.slug) {
        throw new Error("Could not create collection. Try again.");
      }
      const newItem: CollectionItem = {
        id: created.id,
        title: created.title,
        slug: created.slug,
      };

      this._collections = [...(this._collections ?? []), newItem];

      // Auto-add the thread to the newly created collection
      if (this._data) {
        await fetch(`/api/collections/${created.id}/threads`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ threadId: this._data.threadId }),
        });
        this._threadCollectionIds = [...this._threadCollectionIds, created.id];
      }

      await this.#refreshComposeCollections();
      this.#collectionsDirty = true;
      this.#closeAddCollectionPanel();
      showToast(
        this.#getCollectionFormLabels()?.createdLabel ?? "Collection created.",
      );
    } catch (error) {
      showToast(
        error instanceof Error
          ? error.message
          : "Could not create collection. Try again.",
        "error",
      );
    } finally {
      if (formEl) formEl.loading = false;
    }
  }

  /** Get collection form labels from the compose dialog (already on the page) */
  #getCollectionFormLabels() {
    const composeEl = document.querySelector("jant-compose-dialog") as
      | import("./jant-compose-dialog.js").JantComposeDialog
      | null;
    return composeEl?.labels?.collectionFormLabels ?? null;
  }

  #getAddCollectionLabel() {
    const composeEl = document.querySelector("jant-compose-dialog") as
      | import("./jant-compose-dialog.js").JantComposeDialog
      | null;
    return composeEl?.labels?.addCollection ?? "Add Collection";
  }

  async #refreshComposeCollections() {
    const composeEl = document.querySelector("jant-compose-dialog") as {
      refreshCollections?: () => Promise<boolean>;
    } | null;
    await composeEl?.refreshCollections?.();
  }

  #getVisibilityLabel(visibility: string) {
    switch (visibility) {
      case "private":
        return "Private";
      case "latest_hidden":
        return "Hidden from Latest";
      default:
        return "Public";
    }
  }

  // --- Icons (inline SVG) ---

  #iconPublish() {
    return html`<svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.75"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <path d="M12 19V5" />
      <path d="m5 12 7-7 7 7" />
    </svg>`;
  }

  #iconEdit() {
    return html`<svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.75"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 1 1 3 3L7 19l-4 1 1-4Z" />
    </svg>`;
  }

  // Shared featured sparkle icon / custom off variant
  #iconFeatured() {
    return html`<svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.75"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <path d=${FEATURED_SPARKLE_PATH} />
    </svg>`;
  }

  #iconFeaturedOff() {
    return html`<svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.75"
      style="--icon-stroke: 1.5"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <path d=${FEATURED_SPARKLE_PATH} />
      <path d=${FEATURED_SPARKLE_OFF_SLASH_PATH} />
    </svg>`;
  }

  // Lucide: pin / pin-off
  #iconPin() {
    return html`<svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.75"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <line x1="12" x2="12" y1="17" y2="22" />
      <path
        d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z"
      />
    </svg>`;
  }

  #iconPinOff() {
    return html`<svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.75"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <line x1="2" x2="22" y1="2" y2="22" />
      <line x1="12" x2="12" y1="17" y2="22" />
      <path d="M9 9v1.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V17h12" />
      <path d="M15 9.34V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0-1.4.6" />
    </svg>`;
  }

  #iconTrash() {
    return html`<svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.75"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <path d="M3 6h18" />
      <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
      <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
    </svg>`;
  }

  #iconChevronLeft() {
    return html`<svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.9"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <path d="m15 18-6-6 6-6" />
    </svg>`;
  }

  #iconChevronRight() {
    return html`<svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.9"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <path d="m9 18 6-6-6-6" />
    </svg>`;
  }

  #iconCheck() {
    return html`<svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2.3"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <path d="M20 6 9 17l-5-5" />
    </svg>`;
  }

  #iconExternal() {
    return html`<svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.9"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <path d="M14 4h6v6" />
      <path d="M20 4 11 13" />
      <path d="M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4" />
    </svg>`;
  }

  // --- Render ---

  #renderCollectionPicker() {
    const collections = this._collections ?? [];
    const orderedCollections = applyItemOrder(
      collections,
      this.#collectionPickerOrder,
    );
    const hasSearch = this._collectionSearch.trim().length > 0;
    const filtered = filterCollectionsBySearch(
      orderedCollections,
      this._collectionSearch,
    );

    return html`
      <div
        data-collection-picker
        class="post-menu-view post-menu-collection-picker"
      >
        <div class="post-menu-panel-header">
          <button
            type="button"
            class="post-menu-panel-back"
            aria-label="Back"
            @click=${() =>
              this.#showMainMenu("[data-post-menu-open-collections]")}
          >
            ${this.#iconChevronLeft()}
          </button>
          <div class="post-menu-panel-heading">
            <span>Collections</span>
          </div>
        </div>
        ${collections.length > 0
          ? html`<div class="post-menu-picker-search">
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <circle cx="11" cy="11" r="8" />
                <path d="m21 21-4.3-4.3" />
              </svg>
              <input
                type="text"
                placeholder="Search collections..."
                autocomplete="off"
                autocorrect="off"
                spellcheck="false"
                .value=${this._collectionSearch}
                @keydown=${this.#handleCollectionSearchKeydown}
                @input=${(e: Event) => {
                  this._collectionSearch = (e.target as HTMLInputElement).value;
                }}
              />
            </div>`
          : nothing}
        <div
          class="post-menu-picker-list"
          role="listbox"
          aria-multiselectable="true"
        >
          ${this._collectionsLoading
            ? html`<div class="post-menu-picker-empty">Loading...</div>`
            : filtered.length > 0
              ? filtered.map((c) => {
                  const selected = this._threadCollectionIds.includes(c.id);
                  return html`
                    <button
                      type="button"
                      role="option"
                      aria-selected=${selected ? "true" : "false"}
                      class=${`post-menu-picker-option${
                        selected ? " post-menu-picker-option-selected" : ""
                      }`}
                      @keydown=${(event: globalThis.KeyboardEvent) =>
                        this.#handleCollectionOptionKeydown(event, c.id)}
                      @click=${(event: globalThis.MouseEvent) =>
                        this.#handleCollectionOptionClick(event, c.id)}
                    >
                      <span class="post-menu-picker-title">${c.title}</span>
                      ${selected
                        ? html`<span
                            class="post-menu-picker-marker post-menu-picker-marker-selected"
                          >
                            <svg
                              xmlns="http://www.w3.org/2000/svg"
                              viewBox="0 0 24 24"
                              fill="none"
                              aria-hidden="true"
                            >
                              <circle
                                cx="12"
                                cy="12"
                                r="10"
                                fill="currentColor"
                              />
                              <path
                                d="M8 12.5 10.7 15.2 16.4 9.5"
                                stroke="var(--site-page-bg)"
                                stroke-width="2.3"
                                stroke-linecap="round"
                                stroke-linejoin="round"
                              />
                            </svg>
                          </span>`
                        : html`<span
                            class="post-menu-picker-marker post-menu-picker-marker-add"
                          >
                            <svg
                              xmlns="http://www.w3.org/2000/svg"
                              viewBox="0 0 24 24"
                              fill="none"
                              aria-hidden="true"
                            >
                              <circle
                                cx="12"
                                cy="12"
                                r="9"
                                stroke="currentColor"
                                stroke-width="1.8"
                              />
                              <path
                                d="M12 8v8M8 12h8"
                                stroke="currentColor"
                                stroke-width="1.9"
                                stroke-linecap="round"
                              />
                            </svg>
                          </span>`}
                    </button>
                  `;
                })
              : html`<div class="post-menu-picker-empty">
                  ${hasSearch
                    ? "No matching collections"
                    : "No collections yet"}
                </div>`}
        </div>
        <div class="post-menu-picker-footer">
          <button
            type="button"
            class="post-menu-picker-add"
            data-post-menu-add-collection
            @keydown=${this.#handleCollectionAddActionKeydown}
            @click=${() => this.#openAddCollectionPanel()}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              stroke-width="1.5"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="M8 3v10M3 8h10" />
            </svg>
            Add Collection
          </button>
        </div>
      </div>
    `;
  }

  /**
   * Everything about this Thread's language, in one place.
   *
   * The picker and the translation list belong together: a language is
   * unavailable here precisely because another post in the group already holds
   * it, and that reason is only legible next to the list of those posts. Two
   * top-level menu entries for one subject was one too many.
   *
   * Top to bottom, the panel answers three questions in the order they get
   * asked. *What language is this?* — the entry that opened this panel already
   * said "Language · 简体中文", so the panel opens by confirming it, and the
   * picker itself is one level down (see `#openLanguageSwitch`) because
   * changing it is a correction, made once if ever. *What can I do?* — writing
   * or linking a version, the recurring work, and self-describing enough to
   * need no section label over it. *What is already there?* — the other
   * versions, last, because they arrive with a fetch: any earlier and the
   * panel would shove itself downward under the author's cursor a moment
   * after opening.
   */
  #renderLanguagePanel() {
    if (!this._data || this._data.isReply) return nothing;

    const { current, linked, free } = this.#languageChoices();
    return html`
      <div class="post-menu-view post-menu-language-panel">
        <div class="post-menu-panel-header">
          <button
            type="button"
            class="post-menu-panel-back"
            aria-label="Back"
            @click=${() => this.#showMainMenu("[data-post-menu-open-language]")}
          >
            ${this.#iconChevronLeft()}
          </button>
          <div class="post-menu-panel-heading">
            <span>Language</span>
          </div>
        </div>
        <div role="menu" class="post-menu-list">
          <!-- Both sections stand or fall together: with every other language
               spoken for there is nothing to switch to and nothing to add. -->
          ${free.length > 0
            ? html`
                <div class="post-menu-section">
                  <button
                    type="button"
                    role="menuitem"
                    class="post-menu-item"
                    data-post-menu-open-language-switch
                    ?disabled=${this._translationBusy}
                    @click=${() => this.#openLanguageSwitch()}
                  >
                    <span class="post-menu-item-label">Change language</span>
                    <span class="post-menu-item-meta"
                      >${this.#languageLabel(current)}</span
                    >
                    <span class="post-menu-item-trailing post-menu-item-chevron"
                      >${this.#iconChevronRight()}</span
                    >
                  </button>
                </div>
                <div class="post-menu-section">
                  ${free.map(
                    (language, index) => html`
                      <button
                        type="button"
                        role="menuitem"
                        class="post-menu-item"
                        ?data-post-menu-translation-first=${index === 0}
                        @click=${() => this.#writeTranslation(language.tag)}
                      >
                        <span class="post-menu-item-label"
                          >Write the ${language.label} version</span
                        >
                        <span
                          class="post-menu-item-trailing post-menu-item-chevron"
                          >${this.#iconChevronRight()}</span
                        >
                      </button>
                    `,
                  )}
                  <button
                    type="button"
                    role="menuitem"
                    class="post-menu-item"
                    @click=${() => this.#openLinkPicker()}
                  >
                    <span class="post-menu-item-label"
                      >Link a version you already wrote</span
                    >
                    <span class="post-menu-item-trailing post-menu-item-chevron"
                      >${this.#iconChevronRight()}</span
                    >
                  </button>
                </div>
              `
            : nothing}
          ${linked.length > 0
            ? html`
                <div class="post-menu-section">
                  <p class="post-menu-section-label">Other versions</p>
                  ${linked.map((translation) => {
                    const languageLabel = this.#languageLabel(
                      translation.language,
                    );
                    return html`
                      <div class="post-menu-row" data-post-menu-translation>
                        <a
                          role="menuitem"
                          class="post-menu-item post-menu-row-main"
                          href=${publicPath(`/${translation.slug}`)}
                          target="_blank"
                          rel="noopener noreferrer"
                          title=${translation.label}
                          aria-label=${`Open the ${languageLabel} version, ${translation.label}, in a new tab`}
                        >
                          <span
                            class="post-menu-item-label"
                            lang=${translation.language ?? nothing}
                            >${languageLabel}</span
                          >
                          <span
                            class="post-menu-item-trailing post-menu-item-chevron"
                            >${this.#iconExternal()}</span
                          >
                        </a>
                        <button
                          type="button"
                          role="menuitem"
                          class="post-menu-row-action post-menu-row-action-danger"
                          data-post-menu-translation-unlink
                          ?disabled=${this._translationBusy}
                          aria-label=${`Unlink the ${languageLabel} version`}
                          @click=${() => this.#unlinkTranslation(translation)}
                        >
                          Unlink
                        </button>
                      </div>
                    `;
                  })}
                </div>
              `
            : nothing}
          ${this._translationsLoading
            ? html`<p class="post-menu-hint">Loading…</p>`
            : nothing}
        </div>
      </div>
    `;
  }

  /**
   * Which language this Thread is written in.
   *
   * A language another version already holds is left out entirely rather than
   * shown greyed out: the author cannot switch to it, and a dead row saying
   * "Taken" answers a question nobody asked. The version holding it is one
   * level up under *Other versions*, where reading it and unlinking it are one
   * click each.
   */
  #renderLanguageSwitchPanel() {
    if (!this._data || this._data.isReply) return nothing;

    const { current, selectable } = this.#languageChoices();
    return html`
      <div
        class="post-menu-view post-menu-language-panel post-menu-language-switch-panel"
      >
        <div class="post-menu-panel-header">
          <button
            type="button"
            class="post-menu-panel-back"
            aria-label="Back"
            @click=${() => this.#showLanguagePanel()}
          >
            ${this.#iconChevronLeft()}
          </button>
          <div class="post-menu-panel-heading">
            <span>Change language</span>
          </div>
        </div>
        <div role="menu" class="post-menu-list">
          <div
            class="post-menu-section"
            role="radiogroup"
            aria-label="Language"
          >
            ${selectable.map((language) => {
              const selected = language.tag === current;
              return html`
                <button
                  type="button"
                  role="menuitemradio"
                  lang=${language.tag}
                  aria-checked=${selected ? "true" : "false"}
                  ?disabled=${this._translationBusy}
                  data-post-menu-language-option
                  data-post-menu-language-current=${selected ? "true" : "false"}
                  class=${`post-menu-item${selected ? " post-menu-item-active" : ""}`}
                  @click=${() =>
                    selected
                      ? this.#showLanguagePanel()
                      : this.#setLanguage(language.tag)}
                >
                  <span class="post-menu-item-label">${language.label}</span>
                  ${selected
                    ? html`<span
                        class="post-menu-item-trailing post-menu-item-check"
                        >${this.#iconCheck()}</span
                      >`
                    : nothing}
                </button>
              `;
            })}
          </div>
        </div>
      </div>
    `;
  }

  #renderVisibilityPanel() {
    if (!this._data || this._data.isReply) return nothing;

    const visibility = this._data.visibility;
    return html`
      <div
        data-visibility-panel
        class="post-menu-view post-menu-visibility-panel"
      >
        <div class="post-menu-panel-header">
          <button
            type="button"
            class="post-menu-panel-back"
            aria-label="Back"
            @click=${() =>
              this.#showMainMenu("[data-post-menu-open-visibility]")}
          >
            ${this.#iconChevronLeft()}
          </button>
          <div class="post-menu-panel-heading">
            <span>Visibility</span>
          </div>
        </div>
        <div role="menu" class="post-menu-list">
          <div class="post-menu-section">
            <button
              type="button"
              role="menuitemradio"
              aria-checked=${visibility === "public" ? "true" : "false"}
              data-post-menu-visibility-option
              data-post-menu-visibility-current=${visibility === "public"
                ? "true"
                : "false"}
              class=${`post-menu-item${
                visibility === "public" ? " post-menu-item-active" : ""
              }`}
              @click=${() =>
                visibility === "public"
                  ? this.#showMainMenu("[data-post-menu-open-visibility]")
                  : this.#setVisibility("public")}
            >
              <span class="post-menu-item-label">Public</span>
              ${visibility === "public"
                ? html`<span
                    class="post-menu-item-trailing post-menu-item-check"
                    >${this.#iconCheck()}</span
                  >`
                : nothing}
            </button>

            <button
              type="button"
              role="menuitemradio"
              aria-checked=${visibility === "latest_hidden" ? "true" : "false"}
              data-post-menu-visibility-option
              data-post-menu-visibility-current=${visibility === "latest_hidden"
                ? "true"
                : "false"}
              class=${`post-menu-item${
                visibility === "latest_hidden" ? " post-menu-item-active" : ""
              }`}
              @click=${() =>
                visibility === "latest_hidden"
                  ? this.#showMainMenu("[data-post-menu-open-visibility]")
                  : this.#setVisibility("latest_hidden")}
            >
              <span class="post-menu-item-label">Hidden from Latest</span>
              ${visibility === "latest_hidden"
                ? html`<span
                    class="post-menu-item-trailing post-menu-item-check"
                    >${this.#iconCheck()}</span
                  >`
                : nothing}
            </button>

            <button
              type="button"
              role="menuitemradio"
              aria-checked=${visibility === "private" ? "true" : "false"}
              data-post-menu-visibility-option
              data-post-menu-visibility-current=${visibility === "private"
                ? "true"
                : "false"}
              class=${`post-menu-item${
                visibility === "private" ? " post-menu-item-active" : ""
              }`}
              @click=${() =>
                visibility === "private"
                  ? this.#showMainMenu("[data-post-menu-open-visibility]")
                  : this.#setVisibility("private")}
            >
              <span class="post-menu-item-label">Private</span>
              ${visibility === "private"
                ? html`<span
                    class="post-menu-item-trailing post-menu-item-check"
                    >${this.#iconCheck()}</span
                  >`
                : nothing}
            </button>
          </div>
        </div>
      </div>
    `;
  }

  #renderAddCollectionPanel() {
    const labels = this.#getCollectionFormLabels();
    if (!labels) return nothing;

    const initial = {
      title: "",
      slug: "",
      description: "",
      sortOrder: "newest",
      icon: "",
    };

    return html`
      <div
        class="collection-quick-dialog-backdrop"
        @click=${() => this.#closeAddCollectionPanel()}
      ></div>
      <div
        class="collection-quick-dialog"
        data-collection-quick-dialog
        role="dialog"
        aria-modal="true"
        aria-label=${this.#getAddCollectionLabel()}
        @click=${(event: Event) => event.stopPropagation()}
      >
        <div class="collection-quick-dialog-header">
          <div class="collection-quick-dialog-title-block">
            <h2 class="collection-quick-dialog-title">
              ${this.#getAddCollectionLabel()}
            </h2>
            <p class="collection-quick-dialog-note">${labels.quickHint}</p>
          </div>
          <button
            type="button"
            class="collection-quick-dialog-cancel"
            @click=${() => this.#closeAddCollectionPanel()}
          >
            ${labels.cancelLabel}
          </button>
        </div>
        <div class="collection-quick-dialog-body">
          <jant-collection-form
            variant="quick"
            .labels=${labels}
            .initial=${initial}
            action=${publicPath("/api/collections")}
            cancel-href="javascript:void(0)"
            @jant:collection-submit=${(e: Event) =>
              this.#handleAddCollectionSubmit(e)}
          ></jant-collection-form>
        </div>
        <div class="collection-quick-dialog-footer">
          <button
            type="button"
            class="compose-post-btn collection-quick-dialog-submit"
            @click=${() => {
              const form = this.querySelector<HTMLFormElement>(
                "[data-collection-quick-dialog] form",
              );
              form?.requestSubmit();
            }}
          >
            ${labels.quickSubmitLabel}
          </button>
        </div>
      </div>
    `;
  }

  #renderMenu() {
    if (!this._data) return nothing;
    const visibility = this._data.visibility;
    const isPinned = this._data.pinned;
    const isPinnedInCollection = this._data.pinnedInCollection;
    const collectionId = document.querySelector<HTMLElement>(
      "[data-collection-id]",
    )?.dataset.collectionId;
    const isFeatured = this._data.featured;

    return html`
      <div class="post-menu-view post-menu-main">
        <div role="menu" class="post-menu-list">
          <div class="post-menu-section">
            <button
              type="button"
              role="menuitem"
              class="post-menu-item"
              data-post-menu-item-primary
              @click=${() => this.#edit()}
            >
              <span class="post-menu-item-label">Edit</span>
              <span class="post-menu-item-trailing">${this.#iconEdit()}</span>
            </button>

            ${this._data.isDraft
              ? html`
                  <button
                    type="button"
                    role="menuitem"
                    class="post-menu-item"
                    @click=${() => this.#publish()}
                  >
                    <span class="post-menu-item-label">Publish</span>
                    <span class="post-menu-item-trailing"
                      >${this.#iconPublish()}</span
                    >
                  </button>
                `
              : nothing}
            ${this._data.isReply
              ? nothing
              : html`
                  <button
                    type="button"
                    role="menuitem"
                    class="post-menu-item"
                    data-post-menu-open-collections
                    @click=${() => this.#openCollectionPicker()}
                  >
                    <span class="post-menu-item-label">Add to collection</span>
                    <span class="post-menu-item-trailing post-menu-item-chevron"
                      >${this.#iconChevronRight()}</span
                    >
                  </button>
                `}
            ${this._data.isReply
              ? nothing
              : html`
                  <button
                    type="button"
                    role="menuitem"
                    class="post-menu-item"
                    data-post-menu-open-visibility
                    @click=${() => this.#openVisibilityPanel()}
                  >
                    <span class="post-menu-item-label">Visibility</span>
                    <span class="post-menu-item-meta"
                      >${this.#getVisibilityLabel(visibility)}</span
                    >
                    <span class="post-menu-item-trailing post-menu-item-chevron"
                      >${this.#iconChevronRight()}</span
                    >
                  </button>
                `}
            ${this._data.isReply || !this.#multilingual
              ? nothing
              : html`
                  <button
                    type="button"
                    role="menuitem"
                    class="post-menu-item"
                    data-post-menu-open-language
                    @click=${() => this.#openLanguagePanel()}
                  >
                    <span class="post-menu-item-label">Language</span>
                    <span class="post-menu-item-meta"
                      >${this.#languageLabel(this._data.language)}</span
                    >
                    <span class="post-menu-item-trailing post-menu-item-chevron"
                      >${this.#iconChevronRight()}</span
                    >
                  </button>
                `}
          </div>

          <div class="post-menu-section">
            ${this._data.isDraft
              ? nothing
              : html`
                  <button
                    type="button"
                    role="menuitem"
                    class="post-menu-item"
                    @click=${() => this.#setFeatured(!isFeatured)}
                  >
                    <span class="post-menu-item-label"
                      >${isFeatured
                        ? "Remove from Featured"
                        : "Add to Featured"}</span
                    >
                    <span class="post-menu-item-trailing"
                      >${isFeatured
                        ? this.#iconFeaturedOff()
                        : this.#iconFeatured()}</span
                    >
                  </button>
                `}
            ${this._data.isReply
              ? nothing
              : html`
                  <button
                    type="button"
                    role="menuitem"
                    class="post-menu-item"
                    @click=${() => this.#togglePin()}
                  >
                    <span class="post-menu-item-label"
                      >${isPinned ? "Unpin" : "Pin this post"}</span
                    >
                    <span class="post-menu-item-trailing"
                      >${isPinned ? this.#iconPinOff() : this.#iconPin()}</span
                    >
                  </button>
                `}
            ${collectionId && !this._data.isReply
              ? html`
                  <button
                    type="button"
                    role="menuitem"
                    class="post-menu-item"
                    @click=${() => this.#toggleCollectionPin()}
                  >
                    <span class="post-menu-item-label"
                      >${isPinnedInCollection
                        ? "Unpin from collection"
                        : "Pin in collection"}</span
                    >
                    <span class="post-menu-item-trailing"
                      >${isPinnedInCollection
                        ? this.#iconPinOff()
                        : this.#iconPin()}</span
                    >
                  </button>
                `
              : nothing}
          </div>

          <div class="post-menu-section post-menu-section-danger">
            <button
              type="button"
              role="menuitem"
              class="post-menu-item post-menu-item-danger"
              @click=${() => this.#delete()}
            >
              <span class="post-menu-item-label"
                >${this._data.isDraft ? "Discard" : "Delete"}</span
              >
              <span class="post-menu-item-trailing">${this.#iconTrash()}</span>
            </button>
          </div>
        </div>
      </div>
    `;
  }

  render() {
    if (!this._open || !this._data) return nothing;

    const transformStyle = this._openAbove
      ? "transform:translate(-100%, -100%);"
      : "transform:translateX(-100%);";
    const wrapperStyle = `position:absolute;z-index:100;left:${Math.round(this._x)}px;top:${Math.round(this._y)}px;${transformStyle}`;
    const showMenuSurface = !this._addCollectionPanelOpen;

    return html`
      ${showMenuSurface
        ? html`
            <div
              class="post-menu-backdrop"
              @click=${() => this.#close({ restoreFocus: false })}
            ></div>
            <div class="dropdown-menu" style=${wrapperStyle}>
              <div
                data-popover
                aria-hidden="false"
                class="!static post-menu-panel"
              >
                ${this._view === "collections"
                  ? this.#renderCollectionPicker()
                  : this._view === "visibility"
                    ? this.#renderVisibilityPanel()
                    : this._view === "language"
                      ? this.#renderLanguagePanel()
                      : this._view === "language-switch"
                        ? this.#renderLanguageSwitchPanel()
                        : this.#renderMenu()}
              </div>
            </div>
          `
        : nothing}
      ${this._addCollectionPanelOpen
        ? this.#renderAddCollectionPanel()
        : nothing}
    `;
  }
}

customElements.define("jant-post-menu", JantPostMenu);
