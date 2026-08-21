/**
 * Collections Page Manager
 *
 * Manages collections on the public /collections page for authenticated users:
 * - Renders collection rows and dividers in a single-column layout
 * - Dropdown menu for page actions (organize, new divider)
 * - SortableJS drag-and-drop organize mode
 * - Links out to full-page collection create/edit flows
 * - Divider CRUD
 *
 * Light DOM only so site styles apply directly.
 */

import { LitElement, html, nothing } from "lit";
import type { PropertyValueMap } from "lit";
import type { Editor } from "@tiptap/core";
import { classMap } from "lit/directives/class-map.js";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
import Sortable from "sortablejs";
import {
  captureSortableRevertNextSibling,
  getSortableMove,
  readSortableDataIds,
  responsiveSortableOptions,
  revertSortableDomMove,
  setSortableDraggingState,
} from "../sortable-list.js";
import { showConfirmDialog } from "../confirm.js";
import { publicPath, viewLang, viewPath } from "../runtime-paths.js";
import { showToast, showToastWithAction } from "../toast.js";
import {
  addCollectionToNavigation,
  addSmartCollectionToNavigation,
} from "../collection-navigation.js";
import { getDividerCollectionGroup } from "../../lib/collection-groups.js";
import {
  getCollectionPagePath,
  getCollectionSelectionPath,
} from "../../lib/collection-paths.js";
import { NAVIGATION_SETTINGS_PATH } from "../../lib/settings-paths.js";
import { render as renderMarkdown } from "../../lib/markdown.js";
import { formatRelativeAge, toISOString } from "../../lib/time.js";
import {
  createSettingsEditor,
  jsonToMarkdown,
} from "../tiptap/create-editor.js";
import type {
  CollectionManagerItem,
  CollectionManagerLabels,
  ManagedCollection,
  ManagedSmartCollection,
} from "./collection-manager-types.js";
import { getIconSvg } from "../../lib/icons.js";
import { openCollectionDialog } from "../collection-dialog-host.js";
import { openSmartCollectionDialog } from "../smart-collection-dialog-host.js";
import {
  collectionVocabulary,
  setCollectionVocabulary,
} from "./smart-collection-conditions.js";
import { parseArchiveUrlForUpgrade } from "../../lib/smart-collection-upgrade.js";

interface CollectionsResponse {
  collections?: Array<{
    id: string;
    slug: string;
    title: string;
    description: string | null;
    sortOrder: string;
    threadCount: number;
    recentActivityAt: number;
  }>;
  smartCollections?: Array<{
    id: string;
    slug: string;
    title: string;
    description: string | null;
    selection: Record<string, unknown>;
    sort: string;
    layout: string | null;
    threadCount: number;
    recentActivityAt: number;
  }>;
  directoryItems?: Array<{
    id: string;
    type: "collection" | "smart_collection" | "divider" | "link";
    collectionId: string | null;
    smartCollectionId: string | null;
    label: string | null;
    url: string | null;
    description: string | null;
    position: string;
  }>;
}

interface DirectoryItemUpdateResponse {
  label?: string | null;
  url?: string | null;
  description?: string | null;
}

export class JantCollectionsManager extends LitElement {
  static properties = {
    items: { type: Array },
    labels: { type: Object },
    navigationCollectionIds: {
      type: Array,
      attribute: "navigation-collection-ids",
    },

    _items: { state: true },
    _reorderMode: { state: true },
    _editingDividerId: { state: true },
    _editingLinkId: { state: true },
    _editLinkLabel: { state: true },
    _editLinkUrl: { state: true },
    _editLinkDescription: { state: true },
    _showMoreMenu: { state: true },
    _showLinkForm: { state: true },
    _newLinkLabel: { state: true },
    _newLinkUrl: { state: true },
    _newLinkDescription: { state: true },
    _addingLink: { state: true },
    _showItemMenuId: { state: true },
    _addingToNavigationId: { state: true },
    _createdCollectionId: { state: true },
  };

  declare items: CollectionManagerItem[];
  declare labels: CollectionManagerLabels;
  /** Collections and smart collections already in the site navigation. */
  declare navigationCollectionIds: string[];

  declare _items: CollectionManagerItem[];
  declare _reorderMode: boolean;
  declare _editingDividerId: string | null;
  declare _editingLinkId: string | null;
  declare _editLinkLabel: string;
  declare _editLinkUrl: string;
  declare _editLinkDescription: string;
  declare _showMoreMenu: boolean;
  declare _showLinkForm: boolean;
  declare _newLinkLabel: string;
  declare _newLinkUrl: string;
  declare _newLinkDescription: string;
  declare _addingLink: boolean;
  declare _showItemMenuId: string | null;
  declare _addingToNavigationId: string | null;
  declare _createdCollectionId: string | null;

  #sortable: { destroy(): void } | null = null;
  #initialized = false;
  #revertNextSibling: Node | null = null;
  #managerRoot: HTMLElement | null = null;
  #newLinkDescEditor: Editor | null = null;
  #editLinkDescEditor: Editor | null = null;

  #closeMoreMenu = () => {
    this._showMoreMenu = false;
    document.removeEventListener("click", this.#closeMoreMenu);
  };

  #closeItemMenu = () => {
    this._showItemMenuId = null;
    document.removeEventListener("click", this.#closeItemMenu);
  };

  #handleHeaderClick = (event: Event) => {
    const target = event.target as HTMLElement | null;
    if (!target) return;

    if (target.closest("[data-collections-more-menu]")) {
      event.stopPropagation();
    }

    const actionEl = target.closest<HTMLElement>("[data-collections-action]");
    if (!actionEl || !this.#managerRoot?.contains(actionEl)) return;

    const action = actionEl.dataset.collectionsAction;
    if (!action) return;

    event.preventDefault();
    event.stopPropagation();

    if (action !== "toggle-menu" && this._showMoreMenu) {
      this._showMoreMenu = false;
      document.removeEventListener("click", this.#closeMoreMenu);
    }

    switch (action) {
      case "done":
        this.#exitReorderMode();
        break;
      case "toggle-menu":
        this._showMoreMenu = !this._showMoreMenu;
        if (this._showMoreMenu) {
          setTimeout(() => {
            document.addEventListener("click", this.#closeMoreMenu);
          });
        } else {
          document.removeEventListener("click", this.#closeMoreMenu);
        }
        break;
      case "organize":
        this.#enterReorderMode();
        break;
      case "divider":
        void this.#addDivider();
        break;
      case "link":
        this.#openLinkForm();
        break;
      case "collection":
        void this.#createCollection();
        break;
      case "smart-collection":
        // Beside Add link and Add divider rather than a second `+` button:
        // the `+` is where a collection is created, and two plus signs would
        // immediately raise "which plus".
        void openSmartCollectionDialog({}).then((changed) => {
          if (changed) void this.#refreshList();
        });
        break;
      default:
        break;
    }
  };

  createRenderRoot() {
    this.innerHTML = "";
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    this.#bindManagerRoot();
  }

  /**
   * Create a collection, then point at the row it became.
   *
   * The inline notice offering navigation is the reason the new collection's
   * id is carried back out of the dialog: without it the author would have to
   * find the row themselves to do the one thing they are most likely to want
   * next.
   */
  async #createCollection() {
    const result = await openCollectionDialog();
    if (!result.changed) return;
    await this.#refreshList();
    if (result.collection) {
      this._createdCollectionId = result.collection.id;
    }
  }

  /** Edit a collection from its directory row, then re-read the row. */
  async #editCollection(collectionId: string) {
    this._showItemMenuId = null;
    document.removeEventListener("click", this.#closeItemMenu);
    const { changed } = await openCollectionDialog({ collectionId });
    if (changed) await this.#refreshList();
  }

  constructor() {
    super();
    this.items = [];
    this.labels = {} as CollectionManagerLabels;
    this.navigationCollectionIds = [];

    this._items = [];
    this._reorderMode = false;
    this._editingDividerId = null;
    this._editingLinkId = null;
    this._editLinkLabel = "";
    this._editLinkUrl = "";
    this._editLinkDescription = "";
    this._showMoreMenu = false;
    this._showLinkForm = false;
    this._newLinkLabel = "";
    this._newLinkUrl = "";
    this._newLinkDescription = "";
    this._addingLink = false;
    this._showItemMenuId = null;
    this._addingToNavigationId = null;
    this._createdCollectionId = null;
  }

  protected update(
    changedProperties: PropertyValueMap<JantCollectionsManager>,
  ): void {
    if (!this.#initialized || changedProperties.has("items")) {
      this._items = [...(this.items ?? [])];
      this.#initialized = true;
    }
    super.update(changedProperties);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.#sortable?.destroy();
    this.#sortable = null;
    this.#managerRoot?.removeEventListener("click", this.#handleHeaderClick);
    this.#managerRoot = null;
    this.#newLinkDescEditor?.destroy();
    this.#newLinkDescEditor = null;
    this.#editLinkDescEditor?.destroy();
    this.#editLinkDescEditor = null;
    document.removeEventListener("click", this.#closeMoreMenu);
    document.removeEventListener("click", this.#closeItemMenu);
  }

  #hasDirectoryContent() {
    return this._items.some(
      (item) =>
        (item.type === "collection" && item.collection) ||
        (item.type === "smart_collection" && item.smartCollection) ||
        (item.type === "link" && item.label && item.url),
    );
  }

  #countLabel(count: number) {
    return `${count} ${
      count === 1 ? this.labels.threadSingular : this.labels.threadPlural
    }`;
  }

  #bindManagerRoot() {
    const root = this.closest<HTMLElement>("[data-collections-manager-root]");
    if (root === this.#managerRoot) return;

    this.#managerRoot?.removeEventListener("click", this.#handleHeaderClick);
    this.#managerRoot = root;
    this.#managerRoot?.addEventListener("click", this.#handleHeaderClick);
  }

  #queryHeaderElement<T extends HTMLElement>(selector: string) {
    return this.#managerRoot?.querySelector<T>(selector) ?? null;
  }

  #syncHeaderState() {
    const doneButton = this.#queryHeaderElement<HTMLButtonElement>(
      '[data-collections-action="done"]',
    );
    if (doneButton) {
      doneButton.hidden = !this._reorderMode;
    }

    const reorderActions = this.#queryHeaderElement<HTMLElement>(
      "[data-collections-reorder-actions]",
    );
    if (reorderActions) {
      reorderActions.hidden = !this._reorderMode;
    }

    const toolbar = this.#queryHeaderElement<HTMLElement>(
      "[data-collections-toolbar]",
    );
    if (toolbar) {
      toolbar.hidden = this._reorderMode;
    }

    const hint = this.#queryHeaderElement<HTMLElement>(
      "[data-collections-hint]",
    );
    if (hint) {
      hint.hidden = !this._reorderMode;
    }

    const menu = this.#queryHeaderElement<HTMLElement>(
      "[data-collections-more-menu]",
    );
    if (menu) {
      menu.hidden = !this._showMoreMenu || this._reorderMode;
    }

    const toggleButton = this.#queryHeaderElement<HTMLButtonElement>(
      '[data-collections-action="toggle-menu"]',
    );
    if (toggleButton) {
      toggleButton.setAttribute(
        "aria-expanded",
        String(this._showMoreMenu && !this._reorderMode),
      );
    }
  }

  /**
   * Keep the shared collection vocabulary current.
   *
   * The upgrade check on a `/archive?collection=…` link has to resolve that
   * slug, and this component already holds every collection on the site, so
   * doing it here costs nothing — and means the menu item never disappears
   * merely because a lookup had not happened yet.
   */
  #syncCollectionVocabulary() {
    setCollectionVocabulary(
      this._items.flatMap((item) =>
        item.collection
          ? [
              {
                id: item.collection.id,
                slug: item.collection.slug,
                title: item.collection.title,
              },
            ]
          : [],
      ),
    );
  }

  #toItems(json: CollectionsResponse): CollectionManagerItem[] {
    const collections = json.collections ?? [];
    const directoryItems = json.directoryItems ?? [];
    const collectionMap = new Map<string, ManagedCollection>();

    for (const collection of collections) {
      collectionMap.set(collection.id, {
        id: collection.id,
        slug: collection.slug,
        title: collection.title,
        description: collection.description,
        sortOrder: collection.sortOrder,
        threadCount: collection.threadCount ?? 0,
        recentActivityAt: collection.recentActivityAt,
      });
    }

    const smartCollections = json.smartCollections ?? [];
    const smartCollectionMap = new Map<string, ManagedSmartCollection>();
    for (const smartCollection of smartCollections) {
      smartCollectionMap.set(smartCollection.id, {
        id: smartCollection.id,
        slug: smartCollection.slug,
        title: smartCollection.title,
        description: smartCollection.description,
        selection: smartCollection.selection ?? {},
        sort: smartCollection.sort,
        layout: smartCollection.layout,
        threadCount: smartCollection.threadCount ?? 0,
        recentActivityAt: smartCollection.recentActivityAt,
      });
    }

    const seenCollections = new Set<string>();
    const seenSmartCollections = new Set<string>();
    const orderedItems: CollectionManagerItem[] = [];

    for (const item of directoryItems) {
      const collection =
        item.collectionId != null
          ? collectionMap.get(item.collectionId)
          : undefined;
      const smartCollection =
        item.smartCollectionId != null
          ? smartCollectionMap.get(item.smartCollectionId)
          : undefined;

      if (item.type === "collection" && !collection) {
        continue;
      }
      if (item.type === "smart_collection" && !smartCollection) {
        continue;
      }

      if (collection) {
        seenCollections.add(collection.id);
      }
      if (smartCollection) {
        seenSmartCollections.add(smartCollection.id);
      }

      orderedItems.push({
        id: item.id,
        type: item.type,
        collectionId: item.collectionId,
        smartCollectionId: item.smartCollectionId,
        label: item.label,
        url: item.url,
        description: item.description,
        position: item.position,
        collection,
        smartCollection,
      });
    }

    // Anything with no directory row is appended, both kinds alike. That is
    // what makes "a collection missing from /collections" an impossible state.
    // Such a row carries its own id, exactly as the server renders it, because
    // there is no row id to carry — the move endpoint reads that as "place this
    // first, then move it".
    for (const collection of collections) {
      if (seenCollections.has(collection.id)) continue;
      orderedItems.push({
        id: collection.id,
        type: "collection",
        collectionId: collection.id,
        label: null,
        url: null,
        position: "",
        collection: collectionMap.get(collection.id),
      });
    }

    for (const smartCollection of smartCollections) {
      if (seenSmartCollections.has(smartCollection.id)) continue;
      orderedItems.push({
        id: smartCollection.id,
        type: "smart_collection",
        smartCollectionId: smartCollection.id,
        label: null,
        url: null,
        position: "",
        smartCollection: smartCollectionMap.get(smartCollection.id),
      });
    }

    return orderedItems;
  }

  async #refreshList() {
    try {
      // The counts are narrowed to this view's language, exactly as the
      // server rendered them — without this a reorder would make every number
      // jump to its site-wide value.
      const lang = viewLang();
      const res = await fetch(
        lang
          ? `/api/collections?lang=${encodeURIComponent(lang)}`
          : "/api/collections",
      );
      if (!res.ok) return;
      const json = (await res.json()) as CollectionsResponse;
      this._items = this.#toItems(json);
    } catch {
      // stale UI is acceptable
    }
  }

  #initSortable() {
    const list = this.querySelector<HTMLElement>("#collections-manager-list");
    if (!list || this.#sortable) return;

    this.#sortable = Sortable.create(list, {
      ...responsiveSortableOptions,
      chosenClass: "collection-directory-chosen",
      dragClass: "collection-directory-drag",
      ghostClass: "collection-directory-ghost",
      handle: "[data-drag-handle]",
      scroll: true,
      onChoose: () => {
        setSortableDraggingState(list, true);
      },
      onStart: (evt) => {
        this.#revertNextSibling = captureSortableRevertNextSibling(evt);
      },
      onUnchoose: () => {
        setSortableDraggingState(list, false);
      },
      onEnd: (evt) => {
        const orderedIds = readSortableDataIds(
          list,
          "[data-directory-item]",
          "directoryItem",
        );
        revertSortableDomMove(list, evt, this.#revertNextSibling);
        this.#revertNextSibling = null;
        setSortableDraggingState(list, false);

        this.#sortable?.destroy();
        this.#sortable = null;

        const { movedId, afterId, beforeId } = getSortableMove(
          orderedIds,
          evt.newIndex,
        );
        if (!movedId) return;

        const itemMap = new Map(this._items.map((entry) => [entry.id, entry]));
        this._items = orderedIds
          .map((id) => itemMap.get(id))
          .filter(
            (entry): entry is CollectionManagerItem => entry !== undefined,
          );

        fetch(`/api/collections/directory-items/${movedId}/move`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            after: afterId ?? null,
            before: beforeId ?? null,
          }),
        }).then((res) => {
          if (res.ok) showToast(this.labels.orderSaved);
          else showToast(this.labels.saveFailed, "error");
        });
      },
    });
  }

  #enterReorderMode() {
    this._reorderMode = true;
    this._showLinkForm = false;
    this._editingLinkId = null;
    this._showMoreMenu = false;
    document.removeEventListener("click", this.#closeMoreMenu);
  }

  #exitReorderMode() {
    this._reorderMode = false;
    this._editingDividerId = null;
    this.#sortable?.destroy();
    this.#sortable = null;
  }

  protected updated(
    changedProperties: PropertyValueMap<JantCollectionsManager>,
  ): void {
    this.#bindManagerRoot();
    this.#syncHeaderState();
    this.#syncCollectionVocabulary();

    if (this._reorderMode) {
      this.#initSortable();
    }

    if (this._editingDividerId) {
      const input = this.querySelector<HTMLInputElement>(
        `[data-divider-input-for="${this._editingDividerId}"]`,
      );
      if (input) {
        input.focus();
        input.select();
        input.scrollIntoView({ block: "nearest" });
        this._editingDividerId = null;
      }
    }

    if (changedProperties.has("_showLinkForm") && this._showLinkForm) {
      const input = this.querySelector<HTMLInputElement>(
        '[data-link-form-input="label"]',
      );
      if (input && this.ownerDocument.activeElement !== input) {
        input.focus();
      }
      this.#initNewLinkDescEditor();
    }

    if (changedProperties.has("_editingLinkId") && this._editingLinkId) {
      this.#initEditLinkDescEditor();
    }
  }

  #initNewLinkDescEditor() {
    const container = this.querySelector<HTMLElement>(
      "[data-new-link-desc-editor]",
    );
    if (!container || this.#newLinkDescEditor) return;

    this.#newLinkDescEditor = createSettingsEditor({
      element: container,
      placeholder: this.labels.linkDescriptionPlaceholder,
      content: this._newLinkDescription || undefined,
      onUpdate: (markdown) => {
        this._newLinkDescription = markdown;
      },
    });

    this._newLinkDescription = jsonToMarkdown(
      this.#newLinkDescEditor.getJSON(),
    );
  }

  #initEditLinkDescEditor() {
    const container = this.querySelector<HTMLElement>(
      "[data-edit-link-desc-editor]",
    );
    if (!container || this.#editLinkDescEditor) return;

    this.#editLinkDescEditor = createSettingsEditor({
      element: container,
      placeholder: this.labels.linkDescriptionPlaceholder,
      content: this._editLinkDescription || undefined,
      onUpdate: (markdown) => {
        this._editLinkDescription = markdown;
      },
    });

    this._editLinkDescription = jsonToMarkdown(
      this.#editLinkDescEditor.getJSON(),
    );
  }

  async #addDivider() {
    this._showMoreMenu = false;
    document.removeEventListener("click", this.#closeMoreMenu);
    try {
      const res = await fetch("/api/collections/directory-items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "divider" }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const item = (await res.json()) as { id: string };
      this._reorderMode = true;
      await this.#refreshList();
      this._editingDividerId = item.id;
    } catch {
      showToast(this.labels.saveFailed, "error");
    }
  }

  #openLinkForm() {
    this._showMoreMenu = false;
    this._showLinkForm = true;
    this._newLinkLabel = "";
    this._newLinkUrl = "";
    this._newLinkDescription = "";
    this.#newLinkDescEditor?.destroy();
    this.#newLinkDescEditor = null;
    document.removeEventListener("click", this.#closeMoreMenu);
  }

  async #createLink() {
    const label = this._newLinkLabel.trim();
    const url = this._newLinkUrl.trim();
    if (!label || !url) {
      showToast(this.labels.labelAndUrlRequired, "error");
      return;
    }

    this._addingLink = true;
    try {
      const description = this._newLinkDescription.trim() || null;
      const res = await fetch("/api/collections/directory-items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "link",
          label,
          url,
          description,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      this._showLinkForm = false;
      this._newLinkLabel = "";
      this._newLinkUrl = "";
      this._newLinkDescription = "";
      this.#newLinkDescEditor?.destroy();
      this.#newLinkDescEditor = null;
      showToast(this.labels.linkCreated);
      await this.#refreshList();
    } catch {
      showToast(this.labels.saveFailed, "error");
    } finally {
      this._addingLink = false;
    }
  }

  async #deleteDivider(id: string) {
    try {
      const res = await fetch(`/api/collections/directory-items/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      this._items = this._items.filter((item) => item.id !== id);
    } catch {
      showToast(this.labels.saveFailed, "error");
    }
  }

  async #saveDividerLabel(id: string, label: string) {
    const normalized = label.trim();
    const current = this._items.find((item) => item.id === id)?.label ?? "";
    if (normalized === current) return;

    try {
      const res = await fetch(`/api/collections/directory-items/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          label: normalized || null,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const updated = (await res.json()) as DirectoryItemUpdateResponse;
      this._items = this._items.map((item) =>
        item.id === id ? { ...item, label: updated.label ?? null } : item,
      );
    } catch {
      showToast(this.labels.saveFailed, "error");
      await this.#refreshList();
    }
  }

  async #deleteCollection(collection: ManagedCollection) {
    const confirmed = await showConfirmDialog({
      message: this.labels.confirmDelete,
      confirmLabel: this.labels.deleteCollection,
      cancelLabel: this.labels.cancel,
      tone: "danger",
    });
    if (!confirmed) return;

    this._showItemMenuId = null;
    document.removeEventListener("click", this.#closeItemMenu);

    try {
      const res = await fetch(`/api/collections/${collection.id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      showToast(this.labels.deleted);
      await this.#refreshList();
    } catch {
      showToast(this.labels.saveFailed, "error");
    }
  }

  /**
   * Put a directory entry in the site navigation. Collections and smart
   * collections differ only in which endpoint payload they send, so they share
   * the pending state, the id list and the confirmation.
   *
   * @param targetId - TypeID of the collection or smart collection
   * @param add - Helper that creates the navigation item for that kind
   */
  async #addToNavigation(
    targetId: string,
    add: (id: string) => Promise<string | undefined>,
  ) {
    if (!targetId || this._addingToNavigationId) return;

    const usesInlineNotice = this._createdCollectionId === targetId;
    this._showItemMenuId = null;
    this._addingToNavigationId = targetId;
    document.removeEventListener("click", this.#closeItemMenu);

    try {
      await add(targetId);
      this.navigationCollectionIds = [
        ...new Set([...this.navigationCollectionIds, targetId]),
      ];
      if (!usesInlineNotice) {
        showToastWithAction(this.labels.addedToNavigation, {
          label: this.labels.editNavigation,
          href: publicPath(NAVIGATION_SETTINGS_PATH),
        });
      }
    } catch {
      showToast(this.labels.addToNavigationFailed, "error");
    } finally {
      this._addingToNavigationId = null;
    }
  }

  #toggleLinkEdit(item: CollectionManagerItem) {
    if (item.type !== "link") return;

    if (this._editingLinkId === item.id) {
      this._editingLinkId = null;
      this._editLinkLabel = "";
      this._editLinkUrl = "";
      this._editLinkDescription = "";
      this.#editLinkDescEditor?.destroy();
      this.#editLinkDescEditor = null;
      return;
    }

    this._editingLinkId = item.id;
    this._editLinkLabel = item.label ?? "";
    this._editLinkUrl = item.url ?? "";
    this._editLinkDescription = item.description ?? "";
    this.#editLinkDescEditor?.destroy();
    this.#editLinkDescEditor = null;
  }

  async #saveLink(item: CollectionManagerItem) {
    const label = this._editLinkLabel.trim();
    const url = this._editLinkUrl.trim();
    if (!label || !url) {
      showToast(this.labels.labelAndUrlRequired, "error");
      return;
    }

    try {
      const description = this._editLinkDescription.trim() || null;
      const res = await fetch(`/api/collections/directory-items/${item.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label, url, description }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const updated = (await res.json()) as DirectoryItemUpdateResponse;
      this._items = this._items.map((entry) =>
        entry.id === item.id
          ? {
              ...entry,
              label: updated.label ?? label,
              url: updated.url ?? url,
              description: updated.description ?? null,
            }
          : entry,
      );
      this._editingLinkId = null;
      this._editLinkLabel = "";
      this._editLinkUrl = "";
      this._editLinkDescription = "";
      this.#editLinkDescEditor?.destroy();
      this.#editLinkDescEditor = null;
      showToast(this.labels.linkSaved);
    } catch {
      showToast(this.labels.saveFailed, "error");
      await this.#refreshList();
    }
  }

  async #deleteLink(item: CollectionManagerItem) {
    const confirmed = await showConfirmDialog({
      message: this.labels.confirmDeleteLink,
      confirmLabel: this.labels.deleteLink,
      cancelLabel: this.labels.cancel,
      tone: "danger",
    });
    if (!confirmed) return;

    this._showItemMenuId = null;
    document.removeEventListener("click", this.#closeItemMenu);

    try {
      const res = await fetch(`/api/collections/directory-items/${item.id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      this._editingLinkId = null;
      this._editLinkLabel = "";
      this._editLinkUrl = "";
      this._editLinkDescription = "";
      this.#editLinkDescEditor?.destroy();
      this.#editLinkDescEditor = null;
      showToast(this.labels.linkDeleted);
      this._items = this._items.filter((entry) => entry.id !== item.id);
    } catch {
      showToast(this.labels.saveFailed, "error");
    }
  }

  #computeSequenceLabels(): string[] {
    const isContentItem = (item: CollectionManagerItem) =>
      (item.type === "collection" && item.collection) ||
      (item.type === "smart_collection" && item.smartCollection) ||
      (item.type === "link" && item.label && item.url);

    const groupSizes: number[] = [];
    let seenDivider = false;
    let ungroupedCount = 0;
    for (const item of this._items) {
      if (item.type === "divider") {
        seenDivider = true;
        groupSizes.push(0);
      } else if (isContentItem(item)) {
        if (seenDivider) {
          groupSizes[groupSizes.length - 1] += 1;
        } else {
          ungroupedCount += 1;
        }
      }
    }

    const hasGroups = groupSizes.length > 0;
    const maxGroupIndex = Math.max(0, groupSizes.length - 1);
    const groupWidth = hasGroups
      ? Math.max(1, maxGroupIndex.toString(36).length)
      : 0;
    const ungroupedItemWidth = Math.max(
      2,
      String(Math.max(0, ungroupedCount - 1)).length,
    );

    const labels: string[] = [];
    let groupIndex = -1;
    let itemIndex = 0;

    for (const item of this._items) {
      if (item.type === "divider") {
        groupIndex += 1;
        itemIndex = 0;
        labels.push("");
      } else if (isContentItem(item)) {
        if (hasGroups) {
          const g = Math.max(0, groupIndex)
            .toString(36)
            .padStart(groupWidth, "0");
          const i = itemIndex.toString(36);
          labels.push(g + i);
        } else {
          labels.push(String(itemIndex).padStart(ungroupedItemWidth, "0"));
        }
        itemIndex += 1;
      } else {
        labels.push("");
      }
    }

    return labels;
  }

  #renderCollectionItem(item: CollectionManagerItem, sequence: string) {
    const collection = item.collection;
    if (!collection) return nothing;

    // A collection page is served once per language, so this link has to stay
    // in the view the reader is already in.
    const collectionHref = viewPath(
      getCollectionSelectionPath(collection.slug),
    );

    const body = html`
      <div class="collection-directory-main">
        <span class="collection-directory-sequence" aria-hidden="true">
          ${sequence}
        </span>
        <div class="collection-directory-title-row">
          <a href=${collectionHref} class="collection-directory-title-link">
            <span class="collection-directory-title">${collection.title}</span>
          </a>
        </div>
        ${collection.description
          ? html`
              <div class="collection-directory-description prose">
                ${unsafeHTML(
                  renderMarkdown(collection.description, {
                    namespace: collection.id,
                  }),
                )}
              </div>
            `
          : nothing}
        <p class="collection-directory-summary">
          <span class="collection-directory-meta"
            >${this.#countLabel(collection.threadCount)}</span
          >
          <span class="collection-directory-meta-separator" aria-hidden="true"
            >/</span
          >
          <time
            class="collection-directory-updated"
            datetime=${toISOString(collection.recentActivityAt)}
          >
            ${formatRelativeAge(collection.recentActivityAt)}
          </time>
        </p>
      </div>
    `;

    if (this._reorderMode) {
      return html`
        <div
          data-directory-item=${item.id}
          class="collection-directory-item collection-directory-item-reorder"
        >
          <div class="collection-directory-handle" data-drag-handle>
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <circle cx="9" cy="12" r="1" />
              <circle cx="9" cy="5" r="1" />
              <circle cx="9" cy="19" r="1" />
              <circle cx="15" cy="12" r="1" />
              <circle cx="15" cy="5" r="1" />
              <circle cx="15" cy="19" r="1" />
            </svg>
          </div>
          <div class="collection-directory-reorder-main">${body}</div>
        </div>
      `;
    }

    return html`
      <div
        class=${classMap({
          "group relative": true,
          "collection-directory-managed-row": true,
          "z-50":
            this._showItemMenuId === item.id || this._editingLinkId === item.id,
        })}
      >
        <div
          class="collection-directory-item collection-directory-item-manageable"
        >
          ${body}
        </div>
        ${this.#renderItemMenu(item)}
      </div>
    `;
  }

  /**
   * One smart collection row.
   *
   * The same row shape as a collection — count, then last activity — with the
   * `funnel` marker in the slot the link rows already use. Only the marker
   * says the membership came from conditions; the two measures beside it are
   * the same two, and are meant to be read against the rows above and below.
   */
  #renderSmartCollectionItem(item: CollectionManagerItem, sequence: string) {
    const smartCollection = item.smartCollection;
    if (!smartCollection) return nothing;

    const href = viewPath(getCollectionPagePath(smartCollection.slug));
    const body = html`
      <div class="collection-directory-main">
        <span class="collection-directory-sequence" aria-hidden="true"
          >${sequence}</span
        >
        <div class="collection-directory-title-row">
          <a href=${publicPath(href)} class="collection-directory-title-link">
            <span class="collection-directory-title"
              >${smartCollection.title}
              <span
                class="collection-directory-smart-icon"
                role="img"
                aria-label=${this.labels.smartCollectionNoun}
                title=${this.labels.smartCollectionNoun}
                >${unsafeHTML(getIconSvg("funnel", "icon-fine") ?? "")}</span
              ></span
            >
          </a>
        </div>
        ${smartCollection.description
          ? html`
              <div class="collection-directory-description prose">
                ${unsafeHTML(
                  renderMarkdown(smartCollection.description, {
                    namespace: smartCollection.id,
                  }),
                )}
              </div>
            `
          : nothing}
        <p class="collection-directory-summary">
          <span class="collection-directory-meta"
            >${this.#countLabel(smartCollection.threadCount)}</span
          >
          <span class="collection-directory-meta-separator" aria-hidden="true"
            >/</span
          >
          <time
            class="collection-directory-updated"
            datetime=${toISOString(smartCollection.recentActivityAt)}
          >
            ${formatRelativeAge(smartCollection.recentActivityAt)}
          </time>
        </p>
      </div>
    `;

    if (this._reorderMode) {
      return html`
        <div
          data-directory-item=${item.id}
          class="collection-directory-item collection-directory-item-reorder"
        >
          <div class="collection-directory-handle" data-drag-handle>
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <circle cx="9" cy="12" r="1" />
              <circle cx="9" cy="5" r="1" />
              <circle cx="9" cy="19" r="1" />
              <circle cx="15" cy="12" r="1" />
              <circle cx="15" cy="5" r="1" />
              <circle cx="15" cy="19" r="1" />
            </svg>
          </div>
          <div class="collection-directory-reorder-main">${body}</div>
        </div>
      `;
    }

    return html`
      <div
        class=${classMap({
          "group relative": true,
          "collection-directory-managed-row": true,
          "z-50": this._showItemMenuId === item.id,
        })}
      >
        <div
          class="collection-directory-item collection-directory-item-manageable"
        >
          ${body}
        </div>
        ${this.#renderItemMenu(item)}
      </div>
    `;
  }

  /**
   * "Turn into a smart collection", for a link naming an archive URL this site
   * can honor exactly.
   *
   * Hidden rather than shown-and-failing when the URL carries a parameter
   * nobody declared, a value nobody can read, a collection that no longer
   * exists, or `visibility=private`. Offering it there would be promising to
   * keep answering a question that cannot be asked.
   */
  #renderUpgradeMenuItem(item: CollectionManagerItem) {
    if (!item.url) return nothing;
    const upgrade = parseArchiveUrlForUpgrade(item.url, {
      collections: collectionVocabulary(),
    });
    if (!upgrade) return nothing;

    return html`
      <button
        type="button"
        class="collections-page-menu-item"
        @click=${() => {
          this._showItemMenuId = null;
          document.removeEventListener("click", this.#closeItemMenu);
          // Prefilled, never saved on the author's behalf: the title and
          // description come from the link, the conditions from its query, and
          // the author sees all of it before anything is written.
          void openSmartCollectionDialog({
            prefill: {
              title: item.label ?? "",
              description: item.description ?? "",
              selection: upgrade.selection as Record<string, unknown>,
              sort: upgrade.sort,
              layout: upgrade.layout,
            },
          }).then((changed) => {
            if (changed) void this.#refreshList();
          });
        }}
      >
        ${this.labels.turnIntoSmartCollection}
      </button>
    `;
  }

  async #deleteSmartCollection(smartCollection: ManagedSmartCollection) {
    this._showItemMenuId = null;
    document.removeEventListener("click", this.#closeItemMenu);

    const confirmed = await showConfirmDialog({
      message: this.labels.confirmDeleteSmartCollection,
      confirmLabel: this.labels.deleteSmartCollection,
      cancelLabel: this.labels.cancel,
      tone: "danger",
    });
    if (!confirmed) return;

    try {
      const res = await fetch(`/api/smart-collections/${smartCollection.id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      showToast(this.labels.smartCollectionDeleted);
      await this.#refreshList();
    } catch {
      showToast(this.labels.saveFailed, "error");
    }
  }

  #renderLinkEditPanel(item: CollectionManagerItem) {
    if (this._editingLinkId !== item.id) return nothing;

    return html`
      <div
        class="collections-link-edit card"
        @click=${(e: Event) => e.stopPropagation()}
      >
        <form
          class="grid gap-4"
          @submit=${(e: Event) => {
            e.preventDefault();
            void this.#saveLink(item);
          }}
        >
          <div class="field">
            <label class="label" for=${`collections-link-label-${item.id}`}>
              ${this.labels.label}
            </label>
            <input
              id=${`collections-link-label-${item.id}`}
              type="text"
              class="input"
              .value=${this._editLinkLabel}
              @input=${(e: Event) => {
                this._editLinkLabel = (
                  e.currentTarget as HTMLInputElement
                ).value;
              }}
            />
          </div>
          <div class="field">
            <label class="label" for=${`collections-link-url-${item.id}`}>
              ${this.labels.url}
            </label>
            <input
              id=${`collections-link-url-${item.id}`}
              type="text"
              class="input"
              .value=${this._editLinkUrl}
              @input=${(e: Event) => {
                this._editLinkUrl = (e.currentTarget as HTMLInputElement).value;
              }}
            />
          </div>
          <div class="field">
            <label class="label"> ${this.labels.linkDescriptionLabel} </label>
            <div
              class="settings-tiptap-editor"
              data-edit-link-desc-editor
            ></div>
          </div>
          <div class="collections-link-edit-actions">
            <button
              type="button"
              class="btn-outline"
              @click=${() => this.#toggleLinkEdit(item)}
            >
              ${this.labels.cancel}
            </button>
            <button type="submit" class="btn-sm">${this.labels.save}</button>
          </div>
        </form>
      </div>
    `;
  }

  #renderLinkItem(item: CollectionManagerItem, sequence: string) {
    if (!item.label || !item.url) return nothing;

    const linkHref = publicPath(item.url);
    const isExternal =
      item.url.startsWith("http://") || item.url.startsWith("https://");

    const body = html`
      <div class="collection-directory-main">
        <span class="collection-directory-sequence" aria-hidden="true">
          ${sequence}
        </span>
        <div class="collection-directory-title-row">
          <a
            href=${linkHref}
            class="collection-directory-title-link"
            target=${isExternal ? "_blank" : nothing}
            rel=${isExternal ? "noopener noreferrer" : nothing}
          >
            <span class="collection-directory-title">
              ${item.label}
              <span
                class="collection-directory-title-marker"
                aria-hidden="true"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <path
                    d="M10 13a5 5 0 0 0 7.54.54l2.92-2.92a5 5 0 0 0-7.07-7.08L11.7 5.24"
                  />
                  <path
                    d="M14 11a5 5 0 0 0-7.54-.54l-2.92 2.92a5 5 0 0 0 7.07 7.08l1.69-1.7"
                  />
                </svg>
              </span>
            </span>
          </a>
        </div>
        ${item.description
          ? html`
              <div class="collection-directory-description prose">
                ${unsafeHTML(
                  renderMarkdown(item.description, { namespace: item.id }),
                )}
              </div>
            `
          : html`
              <p class="collection-directory-summary">
                <span class="collection-directory-meta"
                  >${this.labels.linkDescriptionPlaceholder}</span
                >
              </p>
            `}
      </div>
    `;

    if (this._reorderMode) {
      return html`
        <div
          data-directory-item=${item.id}
          class="collection-directory-item collection-directory-item-reorder"
        >
          <div class="collection-directory-handle" data-drag-handle>
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <circle cx="9" cy="12" r="1" />
              <circle cx="9" cy="5" r="1" />
              <circle cx="9" cy="19" r="1" />
              <circle cx="15" cy="12" r="1" />
              <circle cx="15" cy="5" r="1" />
              <circle cx="15" cy="19" r="1" />
            </svg>
          </div>
          <div class="collection-directory-reorder-main">${body}</div>
        </div>
      `;
    }

    return html`
      <div
        class=${classMap({
          "group relative": true,
          "collection-directory-managed-row": true,
          "z-50":
            this._showItemMenuId === item.id || this._editingLinkId === item.id,
        })}
      >
        <div
          class="collection-directory-item collection-directory-item-link collection-directory-item-manageable"
        >
          ${body}
        </div>
        ${this.#renderItemMenu(item)} ${this.#renderLinkEditPanel(item)}
      </div>
    `;
  }

  #renderItemMenu(item: CollectionManagerItem) {
    const collection = item.collection;
    const smartCollection = item.smartCollection;
    const isLink = item.type === "link" && !!item.label && !!item.url;
    if (!collection && !smartCollection && !isLink) return nothing;

    const isOpen = this._showItemMenuId === item.id;

    return html`
      <div class="collection-directory-item-menu">
        <button
          type="button"
          class="collections-page-icon-button"
          aria-label=${this.labels.moreActions}
          @click=${(e: Event) => {
            e.preventDefault();
            e.stopPropagation();
            if (isOpen) {
              this._showItemMenuId = null;
              document.removeEventListener("click", this.#closeItemMenu);
            } else {
              this._showItemMenuId = item.id;
              setTimeout(() => {
                document.addEventListener("click", this.#closeItemMenu);
              });
            }
          }}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="currentColor"
          >
            <circle cx="5" cy="12" r="2" />
            <circle cx="12" cy="12" r="2" />
            <circle cx="19" cy="12" r="2" />
          </svg>
        </button>
        ${isOpen
          ? html`
              <div
                class="collections-page-menu"
                @click=${(e: Event) => e.stopPropagation()}
              >
                ${smartCollection
                  ? html`
                      <!-- Opens the dialog, not an editor page: creating and
                           editing a smart collection are one surface. There is
                           deliberately no "Remove from Collections" — a
                           directory row is only a position, and deleting it
                           would move the entry to the end rather than hide it,
                           so the menu item would not do what it says. -->
                      <button
                        type="button"
                        class="collections-page-menu-item"
                        @click=${() => {
                          this._showItemMenuId = null;
                          document.removeEventListener(
                            "click",
                            this.#closeItemMenu,
                          );
                          void openSmartCollectionDialog({
                            smartCollectionId: smartCollection.id,
                          }).then((changed) => {
                            if (changed) void this.#refreshList();
                          });
                        }}
                      >
                        ${this.labels.edit}
                      </button>
                      ${this.navigationCollectionIds.includes(
                        smartCollection.id,
                      )
                        ? html`
                            <a
                              href=${publicPath(NAVIGATION_SETTINGS_PATH)}
                              class="collections-page-menu-item"
                            >
                              ${this.labels.editNavigation}
                            </a>
                          `
                        : html`
                            <button
                              type="button"
                              class="collections-page-menu-item"
                              ?disabled=${this._addingToNavigationId ===
                              smartCollection.id}
                              @click=${() =>
                                void this.#addToNavigation(
                                  smartCollection.id,
                                  addSmartCollectionToNavigation,
                                )}
                            >
                              ${this._addingToNavigationId ===
                              smartCollection.id
                                ? this.labels.addingToNavigation
                                : this.labels.addToNavigation}
                            </button>
                          `}
                      <button
                        type="button"
                        class="collections-page-menu-item collections-page-menu-item-danger"
                        @click=${() =>
                          void this.#deleteSmartCollection(smartCollection)}
                      >
                        ${this.labels.deleteSmartCollection}
                      </button>
                    `
                  : collection
                    ? html`
                        <button
                          type="button"
                          class="collections-page-menu-item"
                          @click=${() =>
                            void this.#editCollection(collection.id)}
                        >
                          ${this.labels.edit}
                        </button>
                        ${this.navigationCollectionIds.includes(collection.id)
                          ? html`
                              <a
                                href=${publicPath(NAVIGATION_SETTINGS_PATH)}
                                class="collections-page-menu-item"
                              >
                                ${this.labels.editNavigation}
                              </a>
                            `
                          : html`
                              <button
                                type="button"
                                class="collections-page-menu-item"
                                ?disabled=${this._addingToNavigationId ===
                                collection.id}
                                @click=${() =>
                                  void this.#addToNavigation(
                                    collection.id,
                                    addCollectionToNavigation,
                                  )}
                              >
                                ${this._addingToNavigationId === collection.id
                                  ? this.labels.addingToNavigation
                                  : this.labels.addToNavigation}
                              </button>
                            `}
                        <button
                          type="button"
                          class="collections-page-menu-item collections-page-menu-item-danger"
                          @click=${() => this.#deleteCollection(collection)}
                        >
                          ${this.labels.deleteCollection}
                        </button>
                      `
                    : html`
                        <button
                          type="button"
                          class="collections-page-menu-item"
                          @click=${() => {
                            this._showItemMenuId = null;
                            document.removeEventListener(
                              "click",
                              this.#closeItemMenu,
                            );
                            this.#toggleLinkEdit(item);
                          }}
                        >
                          ${this.labels.edit}
                        </button>
                        ${this.#renderUpgradeMenuItem(item)}
                        <button
                          type="button"
                          class="collections-page-menu-item collections-page-menu-item-danger"
                          @click=${() => this.#deleteLink(item)}
                        >
                          ${this.labels.deleteLink}
                        </button>
                      `}
              </div>
            `
          : nothing}
      </div>
    `;
  }

  #renderDividerItem(item: CollectionManagerItem, index: number) {
    if (this._reorderMode) {
      return html`
        <div
          data-directory-item=${item.id}
          class="collection-directory-divider-row"
        >
          <div class="collection-directory-handle" data-drag-handle>
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <circle cx="9" cy="12" r="1" />
              <circle cx="9" cy="5" r="1" />
              <circle cx="9" cy="19" r="1" />
              <circle cx="15" cy="12" r="1" />
              <circle cx="15" cy="5" r="1" />
              <circle cx="15" cy="19" r="1" />
            </svg>
          </div>
          <div class="collection-directory-divider-body">
            <input
              type="text"
              class="collection-directory-divider-input"
              data-divider-input-for=${item.id}
              placeholder=${this.labels.dividerLabelPlaceholder}
              .value=${item.label ?? ""}
              aria-label=${this.labels.dividerLabelPlaceholder}
              @blur=${(e: Event) =>
                this.#saveDividerLabel(
                  item.id,
                  (e.currentTarget as HTMLInputElement).value,
                )}
              @keydown=${(e: globalThis.KeyboardEvent) => {
                if (e.isComposing || e.keyCode === 229) return;
                const target = e.currentTarget as HTMLInputElement;
                if (e.key === "Enter") {
                  e.preventDefault();
                  target.blur();
                }
                if (e.key === "Escape") {
                  target.value = item.label ?? "";
                  target.blur();
                }
              }}
            />
            <hr class="collection-directory-divider-line" />
          </div>
          <button
            type="button"
            class="collections-page-icon-button"
            title=${this.labels.deleteDivider}
            aria-label=${this.labels.deleteDivider}
            @click=${() => this.#deleteDivider(item.id)}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </svg>
          </button>
        </div>
      `;
    }

    const hasLabel = !!item.label;
    const group = getDividerCollectionGroup(this._items, index);
    return html`
      <div class="collection-directory-divider">
        <div
          class="collection-directory-divider-row"
          aria-hidden=${hasLabel ? nothing : "true"}
        >
          ${hasLabel
            ? html`
                ${group
                  ? html`
                      <a
                        href=${viewPath(
                          getCollectionSelectionPath(group.slugExpression),
                        )}
                        class="collection-directory-divider-link collection-directory-divider-text"
                      >
                        ${item.label}
                      </a>
                    `
                  : html`
                      <span class="collection-directory-divider-text">
                        ${item.label}
                      </span>
                    `}
                <hr class="collection-directory-divider-line" />
              `
            : html`<hr class="collection-directory-divider-line" />`}
        </div>
      </div>
    `;
  }

  #renderCreateLinkForm() {
    if (!this._showLinkForm) return nothing;

    return html`
      <div class="collections-link-create card">
        <form
          class="grid gap-4"
          @submit=${(e: Event) => {
            e.preventDefault();
            void this.#createLink();
          }}
        >
          <header class="grid gap-1">
            <h2 class="text-base font-semibold">${this.labels.newLink}</h2>
            <p class="text-sm text-muted-foreground">
              ${this.labels.addLinkDescription}
            </p>
          </header>
          <div class="field">
            <label class="label" for="collections-new-link-label">
              ${this.labels.label}
            </label>
            <input
              id="collections-new-link-label"
              type="text"
              class="input"
              data-link-form-input="label"
              placeholder=${this.labels.linkLabelPlaceholder}
              .value=${this._newLinkLabel}
              @input=${(e: Event) => {
                this._newLinkLabel = (
                  e.currentTarget as HTMLInputElement
                ).value;
              }}
            />
          </div>
          <div class="field">
            <label class="label" for="collections-new-link-url">
              ${this.labels.url}
            </label>
            <input
              id="collections-new-link-url"
              type="text"
              class="input"
              placeholder=${this.labels.linkUrlPlaceholder}
              .value=${this._newLinkUrl}
              @input=${(e: Event) => {
                this._newLinkUrl = (e.currentTarget as HTMLInputElement).value;
              }}
            />
          </div>
          <div class="field">
            <label class="label"> ${this.labels.linkDescriptionLabel} </label>
            <div class="settings-tiptap-editor" data-new-link-desc-editor></div>
          </div>
          <div class="collections-link-edit-actions">
            <button
              type="button"
              class="btn-outline"
              @click=${() => {
                this._showLinkForm = false;
                this._newLinkLabel = "";
                this._newLinkUrl = "";
                this._newLinkDescription = "";
                this.#newLinkDescEditor?.destroy();
                this.#newLinkDescEditor = null;
              }}
            >
              ${this.labels.cancel}
            </button>
            <button type="submit" class="btn-sm" ?disabled=${this._addingLink}>
              ${this.labels.addLink}
            </button>
          </div>
        </form>
      </div>
    `;
  }

  #renderCreatedCollectionNotice() {
    if (!this._createdCollectionId) return nothing;

    const collection = this._items.find(
      (item) => item.collection?.id === this._createdCollectionId,
    )?.collection;
    if (!collection) return nothing;

    const isInNavigation = this.navigationCollectionIds.includes(collection.id);

    return html`
      <section
        class="collection-created-notice"
        role="status"
        aria-labelledby="collection-created-notice-title"
      >
        <p
          id="collection-created-notice-title"
          class="collection-created-notice-message"
        >
          ${isInNavigation
            ? this.labels.addedToNavigation
            : this.labels.formLabels.createdLabel}
        </p>
        <div class="collection-created-notice-actions">
          ${isInNavigation
            ? html`
                <a
                  href=${publicPath(NAVIGATION_SETTINGS_PATH)}
                  class="collection-created-notice-action collection-created-notice-action-primary"
                >
                  ${this.labels.editNavigation}
                </a>
              `
            : html`
                <button
                  type="button"
                  class="collection-created-notice-action collection-created-notice-action-primary"
                  ?disabled=${this._addingToNavigationId === collection.id}
                  @click=${() =>
                    void this.#addToNavigation(
                      collection.id,
                      addCollectionToNavigation,
                    )}
                >
                  ${this._addingToNavigationId === collection.id
                    ? this.labels.addingToNavigation
                    : this.labels.addToNavigation}
                </button>
              `}
          <button
            type="button"
            class="collection-created-notice-dismiss"
            aria-label=${this.labels.notNow}
            title=${this.labels.notNow}
            @click=${() => {
              this._createdCollectionId = null;
            }}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="14"
              height="14"
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
            </svg>
          </button>
        </div>
      </section>
    `;
  }

  render() {
    return html`
      ${this.#renderCreatedCollectionNotice()} ${this.#renderCreateLinkForm()}
      ${this.#hasDirectoryContent()
        ? html`
            <div id="collections-manager-list" class="collection-directory">
              ${(() => {
                const labels = this.#computeSequenceLabels();
                return this._items.map((item, index) => {
                  if (item.type === "collection") {
                    return this.#renderCollectionItem(item, labels[index]);
                  }
                  if (item.type === "smart_collection") {
                    return this.#renderSmartCollectionItem(item, labels[index]);
                  }
                  if (item.type === "link") {
                    return this.#renderLinkItem(item, labels[index]);
                  }
                  return this.#renderDividerItem(item, index);
                });
              })()}
            </div>
          `
        : html`<p class="text-muted-foreground">${this.labels.emptyState}</p>`}
    `;
  }
}

customElements.define("jant-collections-manager", JantCollectionsManager);
