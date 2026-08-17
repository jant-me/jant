/**
 * Navigation Manager Component
 *
 * Manages nav item reordering with a live preview:
 * - Renders a preview bar that reflects current item order
 * - Sortable list with inline edit/delete panels
 * - SortableJS drag-and-drop reorder with immediate preview update
 * - Add link forms
 * - System nav item toggles with immediate list/preview update
 * - Applies server-rendered site header fragments after saved changes
 *
 * Light DOM only — BaseCoat and Tailwind classes apply directly.
 */

import { LitElement, html, nothing } from "lit";
import type { PropertyValueMap } from "lit";
import { repeat } from "lit/directives/repeat.js";
import Sortable from "sortablejs";
import type { SortableOptions } from "sortablejs";
import {
  captureSortableRevertNextSibling,
  getSortableMove,
  readSortableDataIds,
  responsiveSortableOptions,
  revertSortableDomMove,
} from "../sortable-list.js";
import { showConfirmDialog } from "../confirm.js";
import { showToast } from "../toast.js";
import { publicPath, sitePathPrefix } from "../runtime-paths.js";
import { applySiteHeaderHtml } from "../site-header-fragment.js";
import { NAVIGATION_SETTINGS_PATH } from "../../lib/settings-paths.js";
import {
  getCollectionEditPath,
  getCollectionPagePath,
} from "../../lib/collection-paths.js";
import { getSlugValidationIssue } from "../../lib/slug-format.js";
import {
  looksLikeAddress,
  normalizePath,
  toInternalPath,
} from "../../lib/url.js";
import type { CollectionSubmitDetail } from "./collection-types.js";
import "./jant-collection-form.js";
import type {
  NavAddressResolution,
  NavManagerCollection,
  NavManagerItem,
  NavManagerLabels,
  NavManagerPage,
  NavManagerSuggestedLink,
  SystemNavConfig,
} from "./nav-manager-types.js";

const SITE_HEADER_REQUEST_HEADER = "X-Jant-Site-Header";
const INCLUDE_SITE_HEADER_RESPONSE = "include";

type NavManagerMutationResponse<T extends object> = T & {
  headerHtml?: string;
};

type SortableEndEvent = Parameters<NonNullable<SortableOptions["onEnd"]>>[0];

type PageDialogView = "picker" | "create" | "created";
type CollectionDialogView = "create" | "created";

interface CreatedPage {
  id: string;
  title: string;
  slug: string;
}

interface CreatedCollection {
  id: string;
  title: string;
  slug: string;
}

export class JantNavManager extends LitElement {
  static properties = {
    items: { type: Array },
    labels: { type: Object },
    systemNavItems: { type: Array, attribute: "system-nav-items" },
    collections: { type: Array },
    suggestedLinks: { type: Array, attribute: "suggested-links" },
    siteName: { type: String, attribute: "site-name" },
    rssFeedsEnabled: { type: Boolean, attribute: "rss-feeds-enabled" },

    _items: { state: true },
    _editingId: { state: true },
    _editLabel: { state: true },
    _editUrl: { state: true },
    _togglingKeys: { state: true },
    _showLinkForm: { state: true },
    _newLinkLabel: { state: true },
    _newLinkUrl: { state: true },
    _addingLink: { state: true },
    _showPreviewMore: { state: true },
    _addingCollectionId: { state: true },
    _showCollectionPicker: { state: true },
    _collectionDialogOpen: { state: true },
    _collectionDialogView: { state: true },
    _creatingCollection: { state: true },
    _createCollectionError: { state: true },
    _createdCollection: { state: true },
    _addingSuggestedKey: { state: true },
    _pageDialogOpen: { state: true },
    _pageDialogView: { state: true },
    _pageQuery: { state: true },
    _pages: { state: true },
    _pageAddress: { state: true },
    _pageSearchLoading: { state: true },
    _pageSearchError: { state: true },
    _selectedPageIndex: { state: true },
    _addingPageId: { state: true },
    _newPageTitle: { state: true },
    _newPageSlug: { state: true },
    _slugEdited: { state: true },
    _slugCheckLoading: { state: true },
    _slugTaken: { state: true },
    _creatingPage: { state: true },
    _createPageError: { state: true },
    _createdPage: { state: true },
  };

  declare items: NavManagerItem[];
  declare labels: NavManagerLabels;
  declare systemNavItems: SystemNavConfig[];
  declare collections: NavManagerCollection[];
  declare suggestedLinks: NavManagerSuggestedLink[];
  declare siteName: string;
  declare rssFeedsEnabled: boolean;

  declare _items: NavManagerItem[];
  declare _editingId: string | null;
  declare _editLabel: string;
  declare _editUrl: string;
  /** Keys currently mid-request (to disable switch during toggle) */
  declare _togglingKeys: Set<SystemNavConfig["key"]>;
  declare _showLinkForm: boolean;
  declare _newLinkLabel: string;
  declare _newLinkUrl: string;
  declare _addingLink: boolean;
  declare _showPreviewMore: boolean;
  /** ID of the collection currently being added (for loading state) */
  declare _addingCollectionId: string | null;
  declare _showCollectionPicker: boolean;
  declare _collectionDialogOpen: boolean;
  declare _collectionDialogView: CollectionDialogView;
  declare _creatingCollection: boolean;
  declare _createCollectionError: string;
  declare _createdCollection: CreatedCollection | null;
  /** Key of the suggested link currently being added */
  declare _addingSuggestedKey: string | null;
  declare _pageDialogOpen: boolean;
  declare _pageDialogView: PageDialogView;
  declare _pageQuery: string;
  declare _pages: NavManagerPage[];
  /** What the last pasted address turned out to be, when one was pasted. */
  declare _pageAddress: NavAddressResolution | null;
  declare _pageSearchLoading: boolean;
  declare _pageSearchError: boolean;
  declare _selectedPageIndex: number;
  declare _addingPageId: string | null;
  declare _newPageTitle: string;
  declare _newPageSlug: string;
  declare _slugEdited: boolean;
  declare _slugCheckLoading: boolean;
  declare _slugTaken: boolean;
  declare _creatingPage: boolean;
  declare _createPageError: string;
  declare _createdPage: CreatedPage | null;

  #sortableHeader: { destroy(): void } | null = null;
  #sortableMore: { destroy(): void } | null = null;
  #initialized = false;
  #revertNextSibling: Node | null = null;
  #pageSearchTimer: ReturnType<typeof setTimeout> | null = null;
  #pageSearchRequestId = 0;
  #slugSuggestTimer: ReturnType<typeof setTimeout> | null = null;
  #slugSuggestRequestId = 0;
  #slugCheckTimer: ReturnType<typeof setTimeout> | null = null;
  #slugCheckRequestId = 0;
  #closeLinkForm = () => {
    this._showLinkForm = false;
    document.removeEventListener("click", this.#closeLinkForm);
  };
  #closeCollectionPicker = () => {
    this._showCollectionPicker = false;
    document.removeEventListener("click", this.#closeCollectionPicker);
  };
  #handlePreviewMoreDocumentClick = (event: Event) => {
    if (!(event.target instanceof Node)) return;

    const previewMore = this.querySelector<HTMLElement>("[data-preview-more]");
    if (!previewMore?.contains(event.target)) {
      this.#closePreviewMore();
    }
  };
  #handlePreviewMoreKeydown = (event: Event) => {
    if (!("key" in event) || event.key !== "Escape" || !this._showPreviewMore) {
      return;
    }
    // Defensive: nav editor has many text inputs; let IME swallow Escape
    // when the user is dismissing a CJK candidate popup.
    const ke = event as globalThis.KeyboardEvent;
    if (ke.isComposing || ke.keyCode === 229) return;

    event.preventDefault();
    this.#closePreviewMore();
    this.querySelector<HTMLElement>("[data-preview-more-trigger]")?.focus();
  };
  #handleCollectionPickerKeydown = (event: globalThis.KeyboardEvent) => {
    if (
      event.key !== "Escape" ||
      event.isComposing ||
      event.keyCode === 229 ||
      !this._showCollectionPicker
    ) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    this.#closeCollectionPicker();
    this.querySelector<HTMLElement>("[data-add-collection-trigger]")?.focus();
  };

  createRenderRoot() {
    this.innerHTML = "";
    return this;
  }

  constructor() {
    super();
    this.items = [];
    this.labels = {} as NavManagerLabels;
    this.systemNavItems = [];
    this.collections = [];
    this.suggestedLinks = [];
    this.siteName = "";
    this.rssFeedsEnabled = false;

    this._items = [];
    this._editingId = null;
    this._editLabel = "";
    this._editUrl = "";
    this._togglingKeys = new Set();
    this._showLinkForm = false;
    this._newLinkLabel = "";
    this._newLinkUrl = "";
    this._addingLink = false;
    this._showPreviewMore = false;
    this._addingCollectionId = null;
    this._showCollectionPicker = false;
    this._collectionDialogOpen = false;
    this._collectionDialogView = "create";
    this._creatingCollection = false;
    this._createCollectionError = "";
    this._createdCollection = null;
    this._addingSuggestedKey = null;
    this._pageDialogOpen = false;
    this._pageDialogView = "picker";
    this._pageQuery = "";
    this._pages = [];
    this._pageAddress = null;
    this._pageSearchLoading = false;
    this._pageSearchError = false;
    this._selectedPageIndex = 0;
    this._addingPageId = null;
    this._newPageTitle = "";
    this._newPageSlug = "";
    this._slugEdited = false;
    this._slugCheckLoading = false;
    this._slugTaken = false;
    this._creatingPage = false;
    this._createPageError = "";
    this._createdPage = null;
  }

  protected update(changedProperties: PropertyValueMap<JantNavManager>): void {
    if (!this.#initialized || changedProperties.has("items")) {
      this._items = [...(this.items ?? [])];
      this.#initialized = true;
    }
    super.update(changedProperties);
  }

  protected updated(): void {
    if (this._showPreviewMore && this.#previewMoreItems.length === 0) {
      this.#closePreviewMore();
    }
    this.#initSortable();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.#sortableHeader?.destroy();
    this.#sortableHeader = null;
    this.#sortableMore?.destroy();
    this.#sortableMore = null;
    document.removeEventListener("click", this.#closeLinkForm);
    document.removeEventListener("click", this.#closeCollectionPicker);
    this.#closePreviewMore();
    this.#cancelPageDialogRequests();
  }

  #jsonMutationHeaders(): Record<string, string> {
    return {
      "Content-Type": "application/json",
      Accept: "application/json",
      [SITE_HEADER_REQUEST_HEADER]: INCLUDE_SITE_HEADER_RESPONSE,
    };
  }

  #deleteMutationHeaders(): Record<string, string> {
    return {
      Accept: "application/json",
      [SITE_HEADER_REQUEST_HEADER]: INCLUDE_SITE_HEADER_RESPONSE,
    };
  }

  #stripHeaderHtml<T extends object>(
    response: NavManagerMutationResponse<T>,
  ): T {
    const body = { ...response };
    delete (body as { headerHtml?: string }).headerHtml;
    return body as T;
  }

  #normalizeItem(item: NavManagerItem): NavManagerItem {
    const systemLabel =
      item.type === "system"
        ? this.systemNavItems.find((config) => config.key === item.systemKey)
            ?.label
        : undefined;
    // `targetTitle` comes back on mutation responses, which carry the raw nav
    // item rather than the server-rendered `displayLabel` — without it a page
    // or collection added with no label of its own would render blank until
    // the next full load.
    const displayLabel =
      item.label.trim() ||
      systemLabel ||
      item.displayLabel ||
      item.targetTitle?.trim() ||
      item.label;

    return { ...item, displayLabel };
  }

  // ===========================================================================
  // Page picker and quick-create dialog
  // ===========================================================================

  #cancelPageDialogRequests() {
    if (this.#pageSearchTimer !== null) {
      clearTimeout(this.#pageSearchTimer);
      this.#pageSearchTimer = null;
    }
    if (this.#slugSuggestTimer !== null) {
      clearTimeout(this.#slugSuggestTimer);
      this.#slugSuggestTimer = null;
    }
    if (this.#slugCheckTimer !== null) {
      clearTimeout(this.#slugCheckTimer);
      this.#slugCheckTimer = null;
    }
    this.#pageSearchRequestId += 1;
    this.#slugSuggestRequestId += 1;
    this.#slugCheckRequestId += 1;
  }

  async #openPageDialog() {
    if (this._pageDialogOpen) return;

    this.#cancelPageDialogRequests();
    this._pageDialogOpen = true;
    this._pageDialogView = "picker";
    this._pageQuery = "";
    this._pages = [];
    this._pageAddress = null;
    this._pageSearchError = false;
    this._selectedPageIndex = 0;
    this._addingPageId = null;
    this._newPageTitle = "";
    this._newPageSlug = "";
    this._slugEdited = false;
    this._slugCheckLoading = false;
    this._slugTaken = false;
    this._creatingPage = false;
    this._createPageError = "";
    this._createdPage = null;

    await this.updateComplete;
    const dialog = this.querySelector<HTMLDialogElement>("#nav-page-dialog");
    if (dialog && !dialog.open) dialog.showModal();
    this.querySelector<HTMLInputElement>("#nav-page-search")?.focus();
    void this.#loadPageCandidates();
  }

  #closePageDialog() {
    const trigger = this.querySelector<HTMLElement>("[data-add-page-trigger]");
    const dialog = this.querySelector<HTMLDialogElement>("#nav-page-dialog");
    if (dialog?.open) dialog.close();
    this.#cancelPageDialogRequests();
    this._pageDialogOpen = false;
    void this.updateComplete.then(() => trigger?.focus());
  }

  /**
   * Look up the page at an address the author pasted.
   *
   * Searching titles cannot answer someone holding a URL, and the answer is
   * often a reason rather than a result — a draft, a private page, a page that
   * is already in the menu.
   */
  async #lookUpPageAddress(address: string) {
    const requestId = ++this.#pageSearchRequestId;
    const params = new URLSearchParams({ url: address });

    this._pageSearchLoading = true;
    this._pageSearchError = false;
    try {
      const res = await fetch(`/api/nav-items/resolve?${params.toString()}`, {
        headers: { Accept: "application/json" },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as {
        resolution?: NavAddressResolution;
      };
      if (requestId !== this.#pageSearchRequestId) return;

      this._pages = [];
      this._pageAddress = json.resolution ?? null;
      this._selectedPageIndex = 0;
    } catch {
      if (requestId === this.#pageSearchRequestId) {
        this._pages = [];
        this._pageAddress = null;
        this._pageSearchError = true;
      }
    } finally {
      if (requestId === this.#pageSearchRequestId) {
        this._pageSearchLoading = false;
      }
    }
  }

  async #loadPageCandidates() {
    const requestId = ++this.#pageSearchRequestId;
    const params = new URLSearchParams({ limit: "20" });
    const query = this._pageQuery.trim();
    if (query) params.set("q", query);

    this._pageSearchLoading = true;
    this._pageSearchError = false;
    this._pageAddress = null;
    try {
      const res = await fetch(`/api/nav-items/pages?${params.toString()}`, {
        headers: { Accept: "application/json" },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as { pages?: NavManagerPage[] };
      if (requestId !== this.#pageSearchRequestId) return;

      const addedPostIds = new Set(
        this._items.flatMap((item) =>
          item.type === "page" && item.postId ? [item.postId] : [],
        ),
      );
      this._pages = (json.pages ?? []).filter(
        (page) => !addedPostIds.has(page.id),
      );
      this._selectedPageIndex = 0;
    } catch {
      if (requestId === this.#pageSearchRequestId) {
        this._pages = [];
        this._pageSearchError = true;
      }
    } finally {
      if (requestId === this.#pageSearchRequestId) {
        this._pageSearchLoading = false;
      }
    }
  }

  #schedulePageSearch() {
    if (this.#pageSearchTimer !== null) {
      clearTimeout(this.#pageSearchTimer);
    }
    this.#pageSearchTimer = setTimeout(() => {
      this.#pageSearchTimer = null;
      const query = this._pageQuery.trim();
      void (looksLikeAddress(query)
        ? this.#lookUpPageAddress(query)
        : this.#loadPageCandidates());
    }, 200);
  }

  async #addPageToNavigation(page: CreatedPage) {
    if (this._addingPageId) return;

    this._addingPageId = page.id;
    try {
      const res = await fetch("/api/nav-items", {
        method: "POST",
        headers: this.#jsonMutationHeaders(),
        body: JSON.stringify({
          type: "page",
          postId: page.id,
          placement: "header",
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const response =
        (await res.json()) as NavManagerMutationResponse<NavManagerItem>;
      const created = this.#normalizeItem(this.#stripHeaderHtml(response));
      this.#destroySortables();
      this._items = [...this._items, created];
      this._pages = this._pages.filter((candidate) => candidate.id !== page.id);
      applySiteHeaderHtml(response.headerHtml);
      showToast(this.labels.pageAdded);

      this.#closePageDialog();
    } catch {
      showToast(this.labels.saveFailed, "error");
    } finally {
      this._addingPageId = null;
    }
  }

  #showCreatePage() {
    this.#pageSearchRequestId += 1;
    this._pageDialogView = "create";
    this._newPageTitle = "";
    this._newPageSlug = "";
    this._slugEdited = false;
    this._slugCheckLoading = false;
    this._slugTaken = false;
    this._createPageError = "";
    void this.updateComplete.then(() => {
      this.querySelector<HTMLInputElement>("#nav-new-page-title")?.focus();
    });
  }

  #showPagePicker() {
    this.#slugSuggestRequestId += 1;
    this.#slugCheckRequestId += 1;
    this._pageDialogView = "picker";
    this._createPageError = "";
    void this.updateComplete.then(() => {
      this.querySelector<HTMLInputElement>("#nav-page-search")?.focus();
    });
  }

  #scheduleSlugSuggestion() {
    if (this._slugEdited) return;
    if (this.#slugSuggestTimer !== null) {
      clearTimeout(this.#slugSuggestTimer);
    }
    const title = this._newPageTitle.trim();
    if (!title) {
      this._newPageSlug = "";
      return;
    }
    this.#slugSuggestTimer = setTimeout(() => {
      this.#slugSuggestTimer = null;
      void this.#suggestPageSlug(title);
    }, 250);
  }

  async #suggestPageSlug(title: string) {
    const requestId = ++this.#slugSuggestRequestId;
    const params = new URLSearchParams({ mode: "suggest", title });
    try {
      const res = await fetch(`/api/posts/slug?${params.toString()}`, {
        headers: { Accept: "application/json" },
      });
      if (!res.ok) return;
      const json = (await res.json()) as { slug?: string };
      if (
        requestId !== this.#slugSuggestRequestId ||
        this._slugEdited ||
        this._pageDialogView !== "create"
      ) {
        return;
      }
      this._newPageSlug = json.slug?.trim() ?? "";
      this._slugTaken = false;
    } catch {
      // Slug suggestion is optional; the create endpoint can generate one.
    }
  }

  #scheduleSlugCheck() {
    if (this.#slugCheckTimer !== null) {
      clearTimeout(this.#slugCheckTimer);
    }
    this._slugTaken = false;
    const slug = this._newPageSlug.trim();
    if (!slug || getSlugValidationIssue(slug, { maxLength: 200 })) {
      this._slugCheckLoading = false;
      return;
    }

    this._slugCheckLoading = true;
    this.#slugCheckTimer = setTimeout(() => {
      this.#slugCheckTimer = null;
      void this.#checkPageSlug(slug);
    }, 250);
  }

  async #checkPageSlug(slug: string) {
    const requestId = ++this.#slugCheckRequestId;
    const params = new URLSearchParams({ mode: "check", slug });
    try {
      const res = await fetch(`/api/posts/slug?${params.toString()}`, {
        headers: { Accept: "application/json" },
      });
      if (!res.ok) return;
      const json = (await res.json()) as { available?: boolean };
      if (
        requestId !== this.#slugCheckRequestId ||
        this._newPageSlug.trim() !== slug
      ) {
        return;
      }
      this._slugTaken = json.available === false;
    } catch {
      // The create endpoint remains the final authority for slug conflicts.
    } finally {
      if (requestId === this.#slugCheckRequestId) {
        this._slugCheckLoading = false;
      }
    }
  }

  #pageSlugError(): string {
    const issue = getSlugValidationIssue(this._newPageSlug, { maxLength: 200 });
    if (issue === "invalid") return this.labels.slugInvalid;
    if (issue === "reserved") return this.labels.slugReserved;
    if (issue === "too_long") return this.labels.slugTooLong;
    if (this._slugTaken) return this.labels.slugUnavailable;
    return "";
  }

  async #createPage() {
    const title = this._newPageTitle.trim();
    const slug = this._newPageSlug.trim();
    if (!title) {
      this._createPageError = this.labels.titleRequired;
      return;
    }
    const slugError = this.#pageSlugError();
    if (slugError) {
      this._createPageError = slugError;
      return;
    }
    if (this._slugCheckLoading) return;

    this._creatingPage = true;
    this._createPageError = "";
    try {
      const res = await fetch("/api/posts", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          format: "note",
          title,
          ...(slug && { slug }),
          status: "published",
          visibility: "latest_hidden",
        }),
      });
      if (!res.ok) {
        if (res.status === 409) {
          this._slugTaken = true;
          this._createPageError = this.labels.slugUnavailable;
          return;
        }
        throw new Error(`HTTP ${res.status}`);
      }

      const created = (await res.json()) as CreatedPage;
      this._createdPage = {
        id: created.id,
        title: created.title || title,
        slug: created.slug,
      };
      this._pageDialogView = "created";
    } catch {
      this._createPageError = this.labels.createPageFailed;
    } finally {
      this._creatingPage = false;
    }
  }

  #handlePageDialogKeydown(event: globalThis.KeyboardEvent) {
    if (event.isComposing || event.keyCode === 229) return;

    if (event.key === "Escape") {
      event.preventDefault();
      this.#closePageDialog();
      return;
    }

    if (this._pageDialogView !== "picker") return;
    if (event.target !== this.querySelector("#nav-page-search")) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      this._selectedPageIndex =
        this._pages.length > 0
          ? (this._selectedPageIndex + 1) % this._pages.length
          : 0;
      this.#scrollSelectedPageIntoView();
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      this._selectedPageIndex =
        this._pages.length > 0
          ? (this._selectedPageIndex - 1 + this._pages.length) %
            this._pages.length
          : 0;
      this.#scrollSelectedPageIntoView();
    } else if (event.key === "Enter" && this._pages.length > 0) {
      event.preventDefault();
      const page = this._pages[this._selectedPageIndex];
      if (page) void this.#addPageToNavigation(page);
    }
  }

  #scrollSelectedPageIntoView() {
    requestAnimationFrame(() => {
      this.querySelector(".nav-page-result-selected")?.scrollIntoView({
        block: "nearest",
      });
    });
  }

  // ===========================================================================
  // Collection quick-create dialog
  // ===========================================================================

  async #openCollectionDialog() {
    if (this._collectionDialogOpen) return;

    this.#closeCollectionPicker();
    this._collectionDialogOpen = true;
    this._collectionDialogView = "create";
    this._creatingCollection = false;
    this._createCollectionError = "";
    this._createdCollection = null;

    await this.updateComplete;
    const dialog = this.querySelector<HTMLDialogElement>(
      "#nav-collection-dialog",
    );
    if (dialog && !dialog.open) dialog.showModal();
    const titleInput = this.querySelector<HTMLInputElement>(
      "#nav-collection-dialog [data-collection-title-input]",
    );
    titleInput?.focus();
    titleInput?.select();
  }

  #closeCollectionDialog() {
    const trigger = this.querySelector<HTMLElement>(
      "[data-add-collection-trigger]",
    );
    const dialog = this.querySelector<HTMLDialogElement>(
      "#nav-collection-dialog",
    );
    if (dialog?.open) dialog.close();
    this._collectionDialogOpen = false;
    this._creatingCollection = false;
    this._createCollectionError = "";
    void this.updateComplete.then(() => trigger?.focus());
  }

  #handleCollectionDialogKeydown(event: globalThis.KeyboardEvent) {
    if (event.isComposing || event.keyCode === 229) return;
    if (event.key !== "Escape") return;

    event.preventDefault();
    this.#closeCollectionDialog();
  }

  #submitCollectionForm() {
    this.querySelector<HTMLFormElement>(
      "#nav-collection-dialog jant-collection-form form",
    )?.requestSubmit();
  }

  async #handleCreateCollectionSubmit(event: Event) {
    const submitEvent = event as CustomEvent<CollectionSubmitDetail>;
    submitEvent.stopPropagation();
    if (!submitEvent.detail || this._creatingCollection) return;

    const form = this.querySelector(
      "#nav-collection-dialog jant-collection-form",
    ) as (HTMLElement & { loading: boolean }) | null;
    this._creatingCollection = true;
    this._createCollectionError = "";
    if (form) form.loading = true;

    try {
      const res = await fetch("/api/collections", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(submitEvent.detail.data),
      });
      const created = (await res.json().catch(() => null)) as
        (CreatedCollection & { error?: string }) | null;
      if (!res.ok || !created?.id || !created.title || !created.slug) {
        throw new Error("Invalid collection response");
      }

      const newCollection: NavManagerCollection = {
        id: created.id,
        title: created.title,
        slug: created.slug,
        group: null,
      };
      if (
        !this.collections.some((collection) => collection.id === created.id)
      ) {
        this.collections = [...this.collections, newCollection];
      }
      this._createdCollection = created;
      this._collectionDialogView = "created";
    } catch {
      this._createCollectionError = this.labels.createCollectionFailed;
    } finally {
      this._creatingCollection = false;
      if (form) form.loading = false;
    }
  }

  // ===========================================================================
  // SortableJS
  // ===========================================================================

  #destroySortables() {
    this.#sortableHeader?.destroy();
    this.#sortableHeader = null;
    this.#sortableMore?.destroy();
    this.#sortableMore = null;
  }

  #initSortable() {
    const headerList = this.querySelector<HTMLElement>("#nav-items-header");
    const moreList = this.querySelector<HTMLElement>("#nav-items-more");

    if (headerList && !this.#sortableHeader) {
      this.#sortableHeader = Sortable.create(
        headerList,
        this.#sortableOptions(),
      );
    }
    if (moreList && !this.#sortableMore) {
      this.#sortableMore = Sortable.create(moreList, this.#sortableOptions());
    }
  }

  #sortableOptions(): SortableOptions {
    return {
      ...responsiveSortableOptions,
      animation: 150,
      handle: "[data-drag-handle]",
      draggable: "[data-nav-id]",
      group: "nav-items",
      onStart: (evt) => {
        this.#revertNextSibling = captureSortableRevertNextSibling(evt);
      },
      onEnd: (evt) => {
        void this.#handleSortableEnd(evt);
      },
    };
  }

  async #handleSortableEnd(evt: SortableEndEvent) {
    const targetList = evt.to;
    const sourceList = evt.from;
    const crossList = sourceList !== targetList;
    const targetPlacement: "header" | "more" =
      targetList.id === "nav-items-header" ? "header" : "more";
    const headerList = this.querySelector<HTMLElement>("#nav-items-header");
    const moreList = this.querySelector<HTMLElement>("#nav-items-more");
    const previousItems = this._items.map((item) => ({ ...item }));

    const movedId = evt.item?.dataset?.navId;
    if (!movedId || !headerList || !moreList) {
      this.#revertNextSibling = null;
      return;
    }

    const headerIds = readSortableDataIds(headerList, "[data-nav-id]", "navId");
    const moreIds = readSortableDataIds(moreList, "[data-nav-id]", "navId");

    if (crossList) {
      evt.item.parentNode?.removeChild(evt.item);
      if (this.#revertNextSibling) {
        sourceList.insertBefore(evt.item, this.#revertNextSibling);
      } else if (
        evt.oldIndex != null &&
        evt.oldIndex < sourceList.children.length
      ) {
        sourceList.insertBefore(
          evt.item,
          sourceList.children[evt.oldIndex] ?? null,
        );
      } else {
        sourceList.appendChild(evt.item);
      }
    } else {
      revertSortableDomMove(targetList, evt, this.#revertNextSibling);
    }

    this.#revertNextSibling = null;
    this.#destroySortables();

    const orderedIds = [...new Set([...headerIds, ...moreIds])];
    const itemMap = new Map(
      this._items.map((item) => [
        item.id,
        item.id === movedId
          ? { ...item, placement: targetPlacement }
          : { ...item },
      ]),
    );
    const reorderedItems = orderedIds
      .map((id) => itemMap.get(id))
      .filter((item): item is NavManagerItem => item !== undefined);
    const remainingItems = this._items
      .filter((item) => !orderedIds.includes(item.id))
      .map((item) =>
        item.id === movedId
          ? { ...item, placement: targetPlacement }
          : { ...item },
      );
    this._items = [...reorderedItems, ...remainingItems];

    const targetIds = targetPlacement === "header" ? headerIds : moreIds;
    const {
      movedId: persistedId,
      afterId,
      beforeId,
    } = getSortableMove(targetIds, evt.newIndex);
    if (!persistedId) return;

    try {
      if (crossList) {
        const placementRes = await fetch(`/api/nav-items/${movedId}`, {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({ placement: targetPlacement }),
        });
        if (!placementRes.ok) throw new Error(`HTTP ${placementRes.status}`);
      }

      const moveRes = await fetch(`/api/nav-items/${persistedId}/move`, {
        method: "PUT",
        headers: this.#jsonMutationHeaders(),
        body: JSON.stringify({
          after: afterId ?? null,
          before: beforeId ?? null,
        }),
      });
      if (!moveRes.ok) throw new Error(`HTTP ${moveRes.status}`);

      const moved =
        (await moveRes.json()) as NavManagerMutationResponse<NavManagerItem>;
      applySiteHeaderHtml(moved.headerHtml);
      showToast(
        crossList ? this.labels.placementSaved : this.labels.orderSaved,
      );
    } catch {
      this.#destroySortables();
      this._items = previousItems;
      showToast(this.labels.saveFailed, "error");
    }
  }

  // ===========================================================================
  // Inline edit handlers
  // ===========================================================================

  #toggleEdit(item: NavManagerItem) {
    if (this._editingId === item.id) {
      this._editingId = null;
    } else {
      this._editingId = item.id;
      this._editLabel = item.label;
      this._editUrl = item.url;
    }
  }

  async #handleUpdate(item: NavManagerItem) {
    const label = this._editLabel.trim();
    // Clearing the field hands the item back to its target's title, so only a
    // free-form link — which points at nothing that has one — still needs one.
    if (!label && item.type === "link") {
      showToast(this.labels.labelRequired, "error");
      return;
    }

    try {
      const res = await fetch(`/api/nav-items/${item.id}`, {
        method: "PUT",
        headers: this.#jsonMutationHeaders(),
        body: JSON.stringify({
          label,
          ...(item.type === "link" && { url: this._editUrl.trim() }),
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const response =
        (await res.json()) as NavManagerMutationResponse<NavManagerItem>;
      const updated = this.#normalizeItem(this.#stripHeaderHtml(response));
      this.#destroySortables();
      this._items = this._items.map((current) =>
        current.id === updated.id ? updated : current,
      );
      this._editingId = null;
      applySiteHeaderHtml(response.headerHtml);
    } catch {
      showToast(this.labels.saveFailed, "error");
    }
  }

  async #handleDelete(item: NavManagerItem) {
    const message =
      item.type === "collection"
        ? this.labels.confirmDeleteCollection
        : item.type === "page"
          ? this.labels.confirmDeletePage
          : this.labels.confirmDeleteLink;
    const confirmLabel =
      item.type === "collection" || item.type === "page"
        ? this.labels.remove
        : this.labels.delete;
    const confirmed = await showConfirmDialog({
      message,
      confirmLabel,
      cancelLabel: this.labels.cancel,
      tone: "danger",
    });
    if (!confirmed) return;

    try {
      const res = await fetch(`/api/nav-items/${item.id}`, {
        method: "DELETE",
        headers: this.#deleteMutationHeaders(),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const response = (await res.json()) as NavManagerMutationResponse<{
        success: true;
      }>;
      this.#destroySortables();
      this._items = this._items.filter((current) => current.id !== item.id);
      this._editingId = null;
      applySiteHeaderHtml(response.headerHtml);
    } catch {
      showToast(this.labels.deleteFailed, "error");
    }
  }

  // ===========================================================================
  // Add link handler
  // ===========================================================================

  async #handleAddLink() {
    const label = this._newLinkLabel.trim();
    const url = this._newLinkUrl.trim();
    if (!label || !url) {
      showToast(this.labels.labelAndUrlRequired, "error");
      return;
    }

    this._addingLink = true;
    try {
      const res = await fetch("/api/nav-items", {
        method: "POST",
        headers: this.#jsonMutationHeaders(),
        body: JSON.stringify({ type: "link", label, url, placement: "header" }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const response =
        (await res.json()) as NavManagerMutationResponse<NavManagerItem>;
      const created = this.#normalizeItem(this.#stripHeaderHtml(response));
      this.#destroySortables();
      this._items = [...this._items, created];
      this._newLinkLabel = "";
      this._newLinkUrl = "";
      this._showLinkForm = false;
      document.removeEventListener("click", this.#closeLinkForm);
      applySiteHeaderHtml(response.headerHtml);
    } catch {
      showToast(this.labels.saveFailed, "error");
    } finally {
      this._addingLink = false;
    }
  }

  // ===========================================================================
  // Add collection handler
  // ===========================================================================

  async #handleAddCollection(collectionId: string) {
    if (!collectionId || this._addingCollectionId) return;

    this._addingCollectionId = collectionId;
    try {
      const res = await fetch("/api/nav-items", {
        method: "POST",
        headers: this.#jsonMutationHeaders(),
        body: JSON.stringify({
          type: "collection",
          collectionId,
          placement: "header",
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const response =
        (await res.json()) as NavManagerMutationResponse<NavManagerItem>;
      const created = this.#normalizeItem(this.#stripHeaderHtml(response));
      this.#destroySortables();
      this._items = [...this._items, created];
      this.#closeCollectionPicker();
      applySiteHeaderHtml(response.headerHtml);
      showToast(this.labels.collectionAdded);
      if (this._collectionDialogOpen) {
        this.#closeCollectionDialog();
      }
    } catch {
      showToast(this.labels.saveFailed, "error");
    } finally {
      this._addingCollectionId = null;
    }
  }

  // ===========================================================================
  // Suggested link handlers
  // ===========================================================================

  /**
   * The internal path two nav URLs have to share to be the same destination.
   *
   * The same comparison the server makes when it decides which suggested links
   * are already in the menu, so both sides agree that `/about`, `/blog/about`
   * on a prefixed deployment, and this site's own absolute URL are one page.
   */
  #getComparableInternalPath(url: string): string | null {
    const path = toInternalPath(url, {
      siteOrigins: [window.location.origin],
      sitePathPrefix: sitePathPrefix(),
    });
    if (path === null) return null;

    const normalized = normalizePath(path);
    return normalized ? `/${normalized}` : "/";
  }

  #isSuggestedLinkAdded(link: NavManagerSuggestedLink): boolean {
    const path = this.#getComparableInternalPath(link.url);
    const hasMatchingPath =
      path !== null &&
      this._items.some(
        (item) => this.#getComparableInternalPath(item.url) === path,
      );
    if (hasMatchingPath) return true;

    return Boolean(
      (link.collectionId &&
        this._items.some(
          (item) =>
            item.type === "collection" &&
            item.collectionId === link.collectionId,
        )) ||
      (link.postId &&
        this._items.some(
          (item) => item.type === "page" && item.postId === link.postId,
        )),
    );
  }

  get #availableSuggestedLinks(): NavManagerSuggestedLink[] {
    return (this.suggestedLinks ?? []).filter(
      (link) => !this.#isSuggestedLinkAdded(link),
    );
  }

  async #handleAddSuggestedLink(link: NavManagerSuggestedLink) {
    if (this._addingSuggestedKey) return;

    this._addingSuggestedKey = link.key;
    try {
      const body =
        link.navItemType === "page" && link.postId
          ? {
              type: "page",
              postId: link.postId,
              placement: "header",
            }
          : link.navItemType === "collection" && link.collectionId
            ? {
                type: "collection",
                collectionId: link.collectionId,
                placement: "header",
              }
            : {
                type: "link",
                label: link.label,
                url: link.url,
                placement: "header",
              };

      const res = await fetch("/api/nav-items", {
        method: "POST",
        headers: this.#jsonMutationHeaders(),
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const response =
        (await res.json()) as NavManagerMutationResponse<NavManagerItem>;
      const created = this.#normalizeItem(this.#stripHeaderHtml(response));
      this.#destroySortables();
      this._items = [...this._items, created];
      applySiteHeaderHtml(response.headerHtml);
      showToast(this.labels.suggestedLinkAdded);
    } catch {
      showToast(this.labels.saveFailed, "error");
    } finally {
      this._addingSuggestedKey = null;
    }
  }

  // ===========================================================================
  // System toggle handlers
  // ===========================================================================

  #isSystemEnabled(config: SystemNavConfig): boolean {
    return this._items.some(
      (item) => item.type === "system" && item.systemKey === config.key,
    );
  }

  async #handleSystemToggle(config: SystemNavConfig, enabled: boolean) {
    this._togglingKeys = new Set([...this._togglingKeys, config.key]);

    try {
      if (enabled) {
        const res = await fetch("/api/nav-items", {
          method: "POST",
          headers: this.#jsonMutationHeaders(),
          body: JSON.stringify({
            type: "system",
            systemKey: config.key,
          }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        const response =
          (await res.json()) as NavManagerMutationResponse<NavManagerItem>;
        const created = this.#normalizeItem(this.#stripHeaderHtml(response));
        this.#destroySortables();
        this._items = [...this._items, created];
        applySiteHeaderHtml(response.headerHtml);
      } else {
        const existing = this._items.find(
          (item) => item.type === "system" && item.systemKey === config.key,
        );
        if (existing) {
          const res = await fetch(`/api/nav-items/${existing.id}`, {
            method: "DELETE",
            headers: this.#deleteMutationHeaders(),
          });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);

          const response = (await res.json()) as NavManagerMutationResponse<{
            success: true;
          }>;
          this.#destroySortables();
          this._items = this._items.filter((item) => item.id !== existing.id);
          applySiteHeaderHtml(response.headerHtml);
        }
      }
    } catch {
      showToast(this.labels.saveFailed, "error");
      this.requestUpdate();
    } finally {
      const next = new Set(this._togglingKeys);
      next.delete(config.key);
      this._togglingKeys = next;
    }
  }

  // ===========================================================================
  // Render helpers
  // ===========================================================================

  get #headerItems(): NavManagerItem[] {
    return this._items.filter((i) => (i.placement ?? "header") === "header");
  }

  get #moreItems(): NavManagerItem[] {
    return this._items.filter((i) => i.placement === "more");
  }

  #isVisibleInPreview(item: NavManagerItem): boolean {
    return (
      this.rssFeedsEnabled || item.type !== "system" || item.systemKey !== "rss"
    );
  }

  get #previewHeaderItems(): NavManagerItem[] {
    return this.#headerItems.filter((item) => this.#isVisibleInPreview(item));
  }

  get #previewMoreItems(): NavManagerItem[] {
    return this.#moreItems.filter((item) => this.#isVisibleInPreview(item));
  }

  #closePreviewMore() {
    this._showPreviewMore = false;
    document.removeEventListener("click", this.#handlePreviewMoreDocumentClick);
    document.removeEventListener("keydown", this.#handlePreviewMoreKeydown);
  }

  #togglePreviewMore(event: Event) {
    event.preventDefault();
    event.stopPropagation();

    if (this._showPreviewMore) {
      this.#closePreviewMore();
      return;
    }

    this._showPreviewMore = true;
    document.addEventListener("keydown", this.#handlePreviewMoreKeydown);
    setTimeout(() => {
      document.addEventListener("click", this.#handlePreviewMoreDocumentClick);
    });
  }

  #renderPreview() {
    const headerItems = this.#previewHeaderItems;
    const moreItems = this.#previewMoreItems;

    return html`
      <div class="nav-preview">
        <div class="nav-preview-chrome">
          <div class="nav-preview-dots">
            <span></span><span></span><span></span>
          </div>
          <span class="nav-preview-label">${this.labels.preview}</span>
        </div>
        <div class="nav-preview-content">
          <div class="site-header-top">
            <a href=${publicPath("/")} class="site-logo">${this.siteName}</a>
            <nav class="site-header-nav">
              ${repeat(
                headerItems,
                (item) => item.id,
                (item, index) =>
                  html`<a
                    class=${
                      index === 0
                        ? "site-header-link site-header-link-active"
                        : "site-header-link"
                    }
                  >
                    ${item.displayLabel ?? item.label}
                  </a>`,
              )}
              ${
                moreItems.length > 0
                  ? html`
                      <div class="site-header-more" data-preview-more>
                        <button
                          type="button"
                          class="site-header-more-btn"
                          data-preview-more-trigger
                          aria-haspopup="menu"
                          aria-expanded=${
                            this._showPreviewMore ? "true" : "false"
                          }
                          @click=${this.#togglePreviewMore}
                        >
                          ${this.labels.moreSection}
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            width="12"
                            height="12"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="2.5"
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            aria-hidden="true"
                          >
                            <path d="m6 9 6 6 6-6" />
                          </svg>
                        </button>
                        <div
                          class="site-header-more-popover"
                          aria-hidden=${this._showPreviewMore ? "false" : "true"}
                          @click=${(event: Event) => event.stopPropagation()}
                        >
                          ${repeat(
                            moreItems,
                            (item) => item.id,
                            (item) => html`
                              <span class="site-header-more-link">
                                ${item.displayLabel ?? item.label}
                              </span>
                            `,
                          )}
                        </div>
                      </div>
                    `
                  : nothing
              }
            </nav>
          </div>
        </div>
      </div>
    `;
  }

  #renderTypeBadge(type: string) {
    const label =
      type === "system"
        ? this.labels.system
        : type === "collection"
          ? this.labels.collection
          : type === "page"
            ? this.labels.page
            : this.labels.link;
    return html`<span class="badge-secondary">${label}</span>`;
  }

  #renderEditPanel(item: NavManagerItem) {
    if (this._editingId !== item.id) return nothing;

    if (item.type === "system") {
      return html`
        <div class="nav-item-edit">
          <div class="field">
            <label class="label">${this.labels.label}</label>
            <input
              type="text"
              class="input"
              placeholder=${item.displayLabel ?? ""}
              .value=${this._editLabel}
              @input=${(e: Event) => {
                this._editLabel = (e.target as HTMLInputElement).value;
              }}
            />
          </div>
          <div class="flex items-center justify-between">
            <button
              type="button"
              class="btn-sm-ghost text-destructive"
              @click=${() => {
                const config = this.systemNavItems.find(
                  (c) => c.key === item.systemKey,
                );
                if (config) {
                  this._editingId = null;
                  this.#handleSystemToggle(config, false);
                }
              }}
            >
              ${this.labels.remove}
            </button>
            <button
              type="button"
              class="btn-sm"
              @click=${() => this.#handleUpdate(item)}
            >
              ${this.labels.save}
            </button>
          </div>
        </div>
      `;
    }

    if (item.type === "collection") {
      return html`
        <div class="nav-item-edit">
          <div class="field">
            <label class="label">${this.labels.label}</label>
            <input
              type="text"
              class="input"
              maxlength="100"
              placeholder=${item.displayLabel ?? ""}
              .value=${this._editLabel}
              @input=${(e: Event) => {
                this._editLabel = (e.target as HTMLInputElement).value;
              }}
            />
          </div>
          <div class="flex items-center justify-between">
            <button
              type="button"
              class="btn-sm-ghost text-destructive"
              @click=${() => void this.#handleDelete(item)}
            >
              ${this.labels.remove}
            </button>
            <button
              type="button"
              class="btn-sm"
              @click=${() => this.#handleUpdate(item)}
            >
              ${this.labels.save}
            </button>
          </div>
        </div>
      `;
    }

    if (item.type === "page") {
      const editHref = `${publicPath(item.url)}?edit=1`;
      return html`
        <div class="nav-item-edit">
          <div class="field">
            <label class="label">${this.labels.label}</label>
            <input
              type="text"
              class="input"
              maxlength="100"
              placeholder=${item.displayLabel ?? ""}
              .value=${this._editLabel}
              @input=${(e: Event) => {
                this._editLabel = (e.target as HTMLInputElement).value;
              }}
            />
          </div>
          <div class="flex items-center justify-between gap-3">
            <button
              type="button"
              class="btn-sm-ghost text-destructive"
              @click=${() => void this.#handleDelete(item)}
            >
              ${this.labels.remove}
            </button>
            <div class="flex items-center gap-2">
              <a
                class="btn-sm-outline"
                href=${editHref}
                target="_blank"
                rel="noopener noreferrer"
              >
                ${this.labels.editPage}
                <span aria-hidden="true">↗</span>
              </a>
              <button
                type="button"
                class="btn-sm"
                @click=${() => this.#handleUpdate(item)}
              >
                ${this.labels.save}
              </button>
            </div>
          </div>
        </div>
      `;
    }

    if (item.type === "link") {
      return html`
        <div class="nav-item-edit">
          <div class="field">
            <label class="label">${this.labels.label}</label>
            <input
              type="text"
              class="input"
              required
              .value=${this._editLabel}
              @input=${(e: Event) => {
                this._editLabel = (e.target as HTMLInputElement).value;
              }}
            />
          </div>
          <div class="field">
            <label class="label">${this.labels.url}</label>
            <input
              type="text"
              class="input"
              required
              .value=${this._editUrl}
              @input=${(e: Event) => {
                this._editUrl = (e.target as HTMLInputElement).value;
              }}
            />
          </div>
          <div class="flex items-center justify-between">
            <button
              type="button"
              class="btn-sm-ghost text-destructive"
              @click=${() => void this.#handleDelete(item)}
            >
              ${this.labels.delete}
            </button>
            <button
              type="button"
              class="btn-sm"
              @click=${() => this.#handleUpdate(item)}
            >
              ${this.labels.save}
            </button>
          </div>
        </div>
      `;
    }

    return nothing;
  }

  #renderItem(item: NavManagerItem) {
    const isEditing = this._editingId === item.id;

    return html`
      <div
        data-nav-id=${item.id}
        class="nav-item${isEditing ? " nav-item-editing" : ""}"
      >
        <div class="nav-item-row">
          <div class="nav-item-handle" data-drag-handle>
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
              class="text-muted-foreground shrink-0"
            >
              <circle cx="9" cy="12" r="1" />
              <circle cx="9" cy="5" r="1" />
              <circle cx="9" cy="19" r="1" />
              <circle cx="15" cy="12" r="1" />
              <circle cx="15" cy="5" r="1" />
              <circle cx="15" cy="19" r="1" />
            </svg>
          </div>
          <div class="nav-item-info" @click=${() => this.#toggleEdit(item)}>
            <div class="flex items-center gap-2 min-w-0">
              <span class="text-sm font-medium truncate"
                >${item.displayLabel ?? item.label}</span
              >
              ${this.#renderTypeBadge(item.type)}
            </div>
            <span class="text-xs text-muted-foreground truncate"
              >${item.url}</span
            >
          </div>
          <button
            type="button"
            class="nav-item-toggle"
            @click=${() => this.#toggleEdit(item)}
            aria-label=${this.labels.toggleEdit}
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
              style="transition: transform 0.15s; ${
                isEditing ? "transform: rotate(180deg);" : ""
              }"
            >
              <path d="m6 9 6 6 6-6" />
            </svg>
          </button>
        </div>
        ${this.#renderEditPanel(item)}
      </div>
    `;
  }

  #renderSuggestedLinksSection() {
    const available = this.#availableSuggestedLinks;
    if (available.length === 0) return nothing;

    return html`
      <section class="mt-8">
        <h2 class="text-lg font-semibold mb-1">
          ${this.labels.suggestedLinks}
        </h2>
        <p class="text-sm text-muted-foreground mb-3">
          ${this.labels.suggestedLinksDescription}
        </p>
        <div class="nav-suggestions-list">
          ${available.map((link) => {
            const adding = this._addingSuggestedKey === link.key;
            return html`
              <div class="nav-suggestion-item">
                <div class="nav-suggestion-info">
                  <span class="nav-suggestion-title">${link.label}</span>
                  <span class="nav-suggestion-meta">
                    ${link.url} · ${link.targetLabel}
                  </span>
                </div>
                <button
                  type="button"
                  class="btn-sm"
                  ?disabled=${adding || this._addingSuggestedKey !== null}
                  @click=${() => this.#handleAddSuggestedLink(link)}
                >
                  ${this.labels.addSuggestedLink}
                </button>
              </div>
            `;
          })}
        </div>
      </section>
    `;
  }

  #renderAddPageSection() {
    return html`
      <section class="mt-8">
        <h2 class="text-lg font-semibold mb-1">
          ${this.labels.addPageToNavigation}
        </h2>
        <p class="text-sm text-muted-foreground mb-3">
          ${this.labels.addPageDescription}
        </p>
        <button
          type="button"
          class="btn-outline"
          data-add-page-trigger
          @click=${() => void this.#openPageDialog()}
        >
          ${this.labels.addPage}
        </button>
      </section>
    `;
  }

  /** Whether navigation already points at what an address resolved to. */
  #isAddressAlreadyAdded(resolution: NavAddressResolution): boolean {
    if (resolution.kind === "page") {
      return this._items.some((item) => item.postId === resolution.page.id);
    }
    if (resolution.kind === "collection") {
      return this._items.some(
        (item) => item.collectionId === resolution.collection.id,
      );
    }
    return false;
  }

  /** The line to show when a pasted address cannot become a page item. */
  #addressStatus(resolution: NavAddressResolution): string {
    if (this.#isAddressAlreadyAdded(resolution)) {
      return this.labels.addressAlreadyAdded;
    }

    switch (resolution.kind) {
      case "not_found":
        return this.labels.addressNotFound.replace(
          "{address}",
          resolution.address,
        );
      case "unpublished":
        return this.labels.addressUnpublished;
      case "private":
        return this.labels.addressPrivate;
      case "untitled":
        return this.labels.addressUntitled;
      case "external":
        return this.labels.addressExternal;
      case "link_only":
        return this.labels.addressLinkOnly;
      default:
        return "";
    }
  }

  /**
   * Hand an address the picker cannot use over to the link form, filled in.
   *
   * Off-site addresses are a normal thing to want in navigation; they just
   * belong in the other kind of item, and retyping the URL is a poor way to
   * find that out.
   */
  #startLinkFromAddress(address: string) {
    this._newLinkUrl = address;
    this.#closePageDialog();
    this._showLinkForm = true;
    setTimeout(() => {
      document.addEventListener("click", this.#closeLinkForm);
    });
    void this.updateComplete.then(() => {
      this.querySelector<HTMLInputElement>("#nav-link-label")?.focus();
    });
  }

  #renderPageAddress(resolution: NavAddressResolution) {
    const alreadyAdded = this.#isAddressAlreadyAdded(resolution);

    if (resolution.kind === "page" && !alreadyAdded) {
      const page = resolution.page;
      return this.#renderPageAddressResult(
        page.title,
        publicPath(`/${page.slug}`),
        this._addingPageId === page.id,
        () => void this.#addPageToNavigation(page),
      );
    }

    if (resolution.kind === "collection" && !alreadyAdded) {
      const collection = resolution.collection;
      return this.#renderPageAddressResult(
        collection.title,
        publicPath(getCollectionPagePath(collection.slug)),
        this._addingCollectionId === collection.id,
        () => {
          void this.#handleAddCollection(collection.id).then(() => {
            this.#closePageDialog();
          });
        },
      );
    }

    const status = this.#addressStatus(resolution);
    const offerLink =
      resolution.kind === "external" || resolution.kind === "link_only";

    return html`
      <p class="nav-page-status" role="status">${status}</p>
      ${
        offerLink
          ? html`
              <button
                type="button"
                class="btn-outline nav-page-address-link"
                @click=${() => this.#startLinkFromAddress(resolution.address)}
              >
                ${this.labels.addressAddAsLink}
              </button>
            `
          : nothing
      }
    `;
  }

  #renderPageAddressResult(
    title: string,
    path: string,
    busy: boolean,
    add: () => void,
  ) {
    return html`
      <p class="nav-page-results-label">${this.labels.addressMatch}</p>
      <div class="nav-page-results" role="listbox">
        <button
          type="button"
          role="option"
          aria-selected="true"
          class="nav-page-result nav-page-result-selected"
          ?disabled=${busy}
          @click=${add}
        >
          <span class="nav-page-result-copy">
            <span class="nav-page-result-title">${title}</span>
            <span class="nav-page-result-path">${path}</span>
          </span>
          ${
            busy
              ? html`<span class="nav-page-spinner" aria-hidden="true"></span>`
              : html`
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
                    aria-hidden="true"
                  >
                    <path d="M12 5v14" />
                    <path d="M5 12h14" />
                  </svg>
                `
          }
        </button>
      </div>
    `;
  }

  #renderPagePicker() {
    const status = this._pageSearchLoading
      ? this.labels.searchingPages
      : this._pageSearchError
        ? this.labels.pageSearchFailed
        : this._pages.length === 0
          ? this._pageQuery.trim()
            ? this.labels.noMatchingPages
            : this.labels.noPages
          : "";

    return html`
      <header>
        <h2 id="nav-page-dialog-title">${this.labels.addPage}</h2>
        <p>${this.labels.addPageDescription}</p>
      </header>
      <section class="nav-page-picker-section">
        <div class="nav-page-search-wrap">
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
            aria-hidden="true"
          >
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.3-4.3" />
          </svg>
          <input
            id="nav-page-search"
            type="search"
            class="input nav-page-search-input"
            placeholder=${this.labels.searchPagesHint}
            autocomplete="off"
            role="combobox"
            aria-expanded="true"
            aria-controls="nav-page-results"
            aria-activedescendant=${
              this._pages.length > 0
                ? `nav-page-result-${this._selectedPageIndex}`
                : ""
            }
            .value=${this._pageQuery}
            @input=${(event: Event) => {
              this._pageQuery = (event.target as HTMLInputElement).value;
              this._selectedPageIndex = 0;
              this.#schedulePageSearch();
            }}
          />
        </div>

        ${
          this._pageSearchLoading || this._pageSearchError
            ? html`<p class="nav-page-status" role="status">${status}</p>`
            : this._pageAddress
              ? this.#renderPageAddress(this._pageAddress)
              : this._pages.length > 0
                ? html`
                    <p class="nav-page-results-label">
                      ${
                        this._pageQuery.trim()
                          ? this.labels.searchPages
                          : this.labels.recentPages
                      }
                    </p>
                    <div
                      id="nav-page-results"
                      class="nav-page-results"
                      role="listbox"
                    >
                      ${this._pages.map((page, index) => {
                        const selected = index === this._selectedPageIndex;
                        const adding = this._addingPageId === page.id;
                        return html`
                          <button
                            id=${`nav-page-result-${index}`}
                            type="button"
                            role="option"
                            aria-selected=${selected ? "true" : "false"}
                            class=${`nav-page-result${
                              selected ? " nav-page-result-selected" : ""
                            }`}
                            ?disabled=${this._addingPageId !== null}
                            @mouseenter=${() => {
                              this._selectedPageIndex = index;
                            }}
                            @click=${() => void this.#addPageToNavigation(page)}
                          >
                            <span class="nav-page-result-copy">
                              <span class="nav-page-result-title"
                                >${page.title}</span
                              >
                              <span class="nav-page-result-path"
                                >${publicPath(`/${page.slug}`)}</span
                              >
                            </span>
                            ${
                              adding
                                ? html`<span
                                    class="nav-page-spinner"
                                    aria-hidden="true"
                                  ></span>`
                                : html`
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
                                      aria-hidden="true"
                                    >
                                      <path d="M12 5v14" />
                                      <path d="M5 12h14" />
                                    </svg>
                                  `
                            }
                          </button>
                        `;
                      })}
                    </div>
                  `
                : html`<p class="nav-page-status" role="status">${status}</p>`
        }
      </section>
      <footer class="nav-page-dialog-footer">
        <button
          type="button"
          class="btn-outline nav-page-create-link"
          @click=${this.#showCreatePage}
        >
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
            aria-hidden="true"
          >
            <path d="M12 5v14" />
            <path d="M5 12h14" />
          </svg>
          ${this.labels.createNewPage}
        </button>
        <button type="button" class="btn-ghost" @click=${this.#closePageDialog}>
          ${this.labels.cancel}
        </button>
      </footer>
    `;
  }

  #renderCreatePage() {
    const slugError = this.#pageSlugError();
    const pagePath = this._newPageSlug.trim()
      ? publicPath(`/${this._newPageSlug.trim()}`)
      : publicPath("/");

    return html`
      <header>
        <h2 id="nav-page-dialog-title">${this.labels.createPage}</h2>
        <p>${this.labels.createPageDescription}</p>
      </header>
      <section>
        <form
          id="nav-create-page-form"
          class="form grid gap-4"
          @submit=${(event: Event) => {
            event.preventDefault();
            void this.#createPage();
          }}
        >
          <div class="field">
            <label class="label" for="nav-new-page-title"
              >${this.labels.pageTitle}</label
            >
            <input
              id="nav-new-page-title"
              type="text"
              class="input"
              required
              maxlength="300"
              autocomplete="off"
              .value=${this._newPageTitle}
              @input=${(event: Event) => {
                this._newPageTitle = (event.target as HTMLInputElement).value;
                this._createPageError = "";
                this.#scheduleSlugSuggestion();
              }}
            />
          </div>
          <div class="field">
            <label class="label" for="nav-new-page-slug"
              >${this.labels.pageAddress}</label
            >
            <div class="nav-page-slug-field">
              <span class="nav-page-slug-prefix" aria-hidden="true"
                >${publicPath("/")}</span
              >
              <input
                id="nav-new-page-slug"
                type="text"
                class="input nav-page-slug-input"
                maxlength="200"
                autocomplete="off"
                spellcheck="false"
                .value=${this._newPageSlug}
                @input=${(event: Event) => {
                  this._newPageSlug = (
                    event.target as HTMLInputElement
                  ).value.toLowerCase();
                  this._slugEdited = true;
                  this._createPageError = "";
                  this.#scheduleSlugCheck();
                }}
                aria-invalid=${slugError ? "true" : "false"}
                aria-describedby="nav-new-page-slug-help"
              />
            </div>
            <p
              id="nav-new-page-slug-help"
              class=${
                slugError
                  ? "text-xs text-destructive"
                  : "text-xs text-muted-foreground"
              }
            >
              ${
                slugError
                  ? slugError
                  : this._slugCheckLoading
                    ? this.labels.checkingAddress
                    : pagePath
              }
            </p>
          </div>
          <p class="nav-page-visibility-note">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <circle cx="12" cy="12" r="10" />
              <path d="M12 16v-4" />
              <path d="M12 8h.01" />
            </svg>
            ${this.labels.pageVisibilityHint}
          </p>
          ${
            this._createPageError
              ? html`<p class="text-sm text-destructive" role="alert">
                  ${this._createPageError}
                </p>`
              : nothing
          }
        </form>
      </section>
      <footer>
        <button
          type="button"
          class="btn-ghost"
          ?disabled=${this._creatingPage}
          @click=${this.#showPagePicker}
        >
          ${this.labels.back}
        </button>
        <button
          type="submit"
          class="btn"
          form="nav-create-page-form"
          ?disabled=${
            this._creatingPage || this._slugCheckLoading || Boolean(slugError)
          }
        >
          ${
            this._creatingPage
              ? this.labels.creatingPage
              : this.labels.createPage
          }
        </button>
      </footer>
    `;
  }

  #renderCreatedPage() {
    const page = this._createdPage;
    if (!page) return nothing;
    const editHref = `${publicPath(`/${page.slug}`)}?edit=1`;

    return html`
      <header class="nav-create-success-header">
        <span class="nav-create-success-icon" aria-hidden="true">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="22"
            height="22"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path d="M20 6 9 17l-5-5" />
          </svg>
        </span>
        <h2 id="nav-page-dialog-title">${this.labels.pageCreated}</h2>
        <p>${this.labels.pageCreatedDescription}</p>
      </header>
      <section>
        <div class="nav-create-success-card">
          <span class="nav-page-result-title">${page.title}</span>
          <span class="nav-page-result-path"
            >${publicPath(`/${page.slug}`)}</span
          >
        </div>
      </section>
      <footer>
        <a
          class="btn-outline"
          href=${editHref}
          target="_blank"
          rel="noopener noreferrer"
        >
          ${this.labels.editPage}
          <span aria-hidden="true">↗</span>
        </a>
        <button
          type="button"
          class="btn"
          ?disabled=${this._addingPageId !== null}
          @click=${() => void this.#addPageToNavigation(page)}
        >
          ${this.labels.addToNavigation}
        </button>
      </footer>
    `;
  }

  #renderPageDialog() {
    if (!this._pageDialogOpen) return nothing;

    return html`
      <dialog
        id="nav-page-dialog"
        class="dialog nav-page-dialog"
        aria-labelledby="nav-page-dialog-title"
        @cancel=${(event: Event) => {
          event.preventDefault();
          this.#closePageDialog();
        }}
        @click=${(event: Event) => {
          if (event.target === event.currentTarget) this.#closePageDialog();
        }}
        @keydown=${this.#handlePageDialogKeydown}
      >
        <div
          class="nav-page-dialog-panel"
          @click=${(event: Event) => event.stopPropagation()}
        >
          <button
            type="button"
            aria-label=${this.labels.cancel}
            @click=${this.#closePageDialog}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="18"
              height="18"
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
          ${
            this._pageDialogView === "picker"
              ? this.#renderPagePicker()
              : this._pageDialogView === "create"
                ? this.#renderCreatePage()
                : this.#renderCreatedPage()
          }
        </div>
      </dialog>
    `;
  }

  #renderAddLinkSection() {
    return html`
      <section class="mt-8">
        <h2 class="text-lg font-semibold mb-3">
          ${this.labels.addCustomLinkToNavigation}
        </h2>
        <div id="nav-link-popover" class="popover">
          <button
            id="nav-link-popover-trigger"
            type="button"
            aria-expanded=${this._showLinkForm}
            aria-controls="nav-link-popover-content"
            class="btn-outline"
            @click=${(e: Event) => {
              e.stopPropagation();
              this._showLinkForm = !this._showLinkForm;
              if (this._showLinkForm) {
                setTimeout(() => {
                  document.addEventListener("click", this.#closeLinkForm);
                });
              } else {
                document.removeEventListener("click", this.#closeLinkForm);
              }
            }}
          >
            ${this.labels.addLink}
          </button>
          ${
            this._showLinkForm
              ? html`
                  <div
                    id="nav-link-popover-content"
                    data-popover
                    data-side="top"
                    aria-hidden="false"
                    class="w-80"
                    style="bottom: 100%; margin-bottom: 0.5rem;"
                    @click=${(e: Event) => e.stopPropagation()}
                  >
                    <div class="grid gap-4">
                      <header class="grid gap-1.5">
                        <h4 class="leading-none font-medium">
                          ${this.labels.addLink}
                        </h4>
                        <p class="text-muted-foreground text-sm">
                          ${this.labels.addLinkDescription}
                        </p>
                      </header>
                      <form
                        class="form grid gap-2"
                        @submit=${(e: Event) => {
                          e.preventDefault();
                          this.#handleAddLink();
                        }}
                      >
                        <div class="grid grid-cols-3 items-center gap-4">
                          <label for="nav-link-label"
                            >${this.labels.label}</label
                          >
                          <input
                            type="text"
                            id="nav-link-label"
                            class="col-span-2 h-8"
                            placeholder="Home"
                            required
                            .value=${this._newLinkLabel}
                            @input=${(e: Event) => {
                              this._newLinkLabel = (
                                e.target as HTMLInputElement
                              ).value;
                            }}
                            autofocus
                          />
                        </div>
                        <div class="grid grid-cols-3 items-center gap-4">
                          <label for="nav-link-url">${this.labels.url}</label>
                          <input
                            type="text"
                            id="nav-link-url"
                            class="col-span-2 h-8"
                            placeholder=${this.labels.urlPlaceholder}
                            required
                            .value=${this._newLinkUrl}
                            @input=${(e: Event) => {
                              this._newLinkUrl = (
                                e.target as HTMLInputElement
                              ).value;
                            }}
                          />
                        </div>
                        <button
                          type="submit"
                          class="btn-sm mt-2"
                          ?disabled=${this._addingLink}
                        >
                          ${this.labels.addLink}
                        </button>
                      </form>
                    </div>
                  </div>
                `
              : nothing
          }
        </div>
      </section>
    `;
  }

  #renderAddCollectionSection() {
    if (!this.collections?.length) {
      return html`
        <section class="mt-8">
          <h2 class="text-lg font-semibold mb-1">
            ${this.labels.addCollectionToNavigation}
          </h2>
          <p class="text-sm text-muted-foreground mb-3">
            ${this.labels.noCollections}
          </p>
          <button
            type="button"
            class="btn-outline"
            data-add-collection-trigger
            @click=${() => void this.#openCollectionDialog()}
          >
            ${this.labels.createCollection}
          </button>
        </section>
      `;
    }

    const addedCollectionIds = new Set(
      this._items
        .filter((i) => i.type === "collection" && i.collectionId)
        .map((i) => i.collectionId),
    );
    const available = this.collections.filter(
      (c) => !addedCollectionIds.has(c.id),
    );

    if (available.length === 0) {
      return html`
        <section class="mt-8">
          <h2 class="text-lg font-semibold mb-1">
            ${this.labels.addCollectionToNavigation}
          </h2>
          <p class="text-sm text-muted-foreground mb-3">
            ${this.labels.allCollectionsAdded}
          </p>
          <button
            type="button"
            class="btn-outline"
            data-add-collection-trigger
            @click=${() => void this.#openCollectionDialog()}
          >
            ${this.labels.createCollection}
          </button>
        </section>
      `;
    }

    // Group available collections by their directory group label
    const groups: { label: string | null; items: typeof available }[] = [];
    let currentGroup: { label: string | null; items: typeof available } | null =
      null;

    for (const c of available) {
      const groupLabel = c.group ?? null;
      if (!currentGroup || currentGroup.label !== groupLabel) {
        currentGroup = { label: groupLabel, items: [] };
        groups.push(currentGroup);
      }
      currentGroup.items.push(c);
    }

    return html`
      <section class="mt-8">
        <h2 class="text-lg font-semibold mb-1">
          ${this.labels.addCollectionToNavigation}
        </h2>
        <p class="text-sm text-muted-foreground mb-3">
          ${this.labels.addCollectionDescription}
        </p>
        <div
          class="relative inline-block"
          @keydown=${this.#handleCollectionPickerKeydown}
        >
          <button
            type="button"
            aria-expanded=${this._showCollectionPicker}
            aria-haspopup="menu"
            class="btn-outline"
            data-add-collection-trigger
            @click=${(e: Event) => {
              e.stopPropagation();
              const opening = !this._showCollectionPicker;
              if (opening) this.#closeLinkForm();
              this._showCollectionPicker = opening;
              if (this._showCollectionPicker) {
                setTimeout(() => {
                  document.addEventListener(
                    "click",
                    this.#closeCollectionPicker,
                  );
                });
              } else {
                document.removeEventListener(
                  "click",
                  this.#closeCollectionPicker,
                );
              }
            }}
          >
            ${this.labels.addCollection}
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
              class="ml-1.5 -mr-0.5"
              aria-hidden="true"
              style="transition: transform 0.15s; ${
                this._showCollectionPicker ? "transform: rotate(180deg);" : ""
              }"
            >
              <path d="m6 9 6 6 6-6" />
            </svg>
          </button>
          ${
            this._showCollectionPicker
              ? html`
                  <div
                    class="collection-picker"
                    role="menu"
                    @click=${(e: Event) => e.stopPropagation()}
                  >
                    ${groups.map(
                      (group) => html`
                        ${
                          group.label
                            ? html`<div class="collection-picker-group">
                                ${group.label}
                              </div>`
                            : nothing
                        }
                        ${group.items.map((c) => {
                          const adding = this._addingCollectionId === c.id;
                          return html`
                            <button
                              type="button"
                              role="menuitem"
                              class="collection-picker-item"
                              ?disabled=${
                              adding || this._addingCollectionId !== null
                            }
                              @click=${() => this.#handleAddCollection(c.id)}
                            >
                              <span class="collection-picker-title">
                                ${c.title}
                              </span>
                              ${
                              adding
                                ? html`<svg
                                    xmlns="http://www.w3.org/2000/svg"
                                    width="14"
                                    height="14"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    stroke-width="2"
                                    stroke-linecap="round"
                                    stroke-linejoin="round"
                                    class="animate-spin shrink-0 text-muted-foreground"
                                  >
                                    <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                                  </svg>`
                                : nothing
                            }
                            </button>
                          `;
                        })}
                      `,
                    )}
                    <div class="collection-picker-footer">
                      <button
                        type="button"
                        role="menuitem"
                        class="collection-picker-create"
                        data-create-collection-trigger
                        @click=${() => void this.#openCollectionDialog()}
                      >
                        ${this.labels.createNewCollection}
                        <span aria-hidden="true">+</span>
                      </button>
                    </div>
                  </div>
                `
              : nothing
          }
        </div>
      </section>
    `;
  }

  #renderCreateCollection() {
    const initial = {
      title: "",
      slug: "",
      description: "",
      sortOrder: "newest" as const,
    };

    return html`
      <header>
        <h2 id="nav-collection-dialog-title">
          ${this.labels.createCollection}
        </h2>
        <p>${this.labels.collectionFormLabels.quickHint}</p>
      </header>
      <section>
        <jant-collection-form
          variant="quick"
          .labels=${this.labels.collectionFormLabels}
          .initial=${initial}
          action=${publicPath("/api/collections")}
          cancel-href=${publicPath(NAVIGATION_SETTINGS_PATH)}
          @jant:collection-submit=${(event: Event) =>
            void this.#handleCreateCollectionSubmit(event)}
        ></jant-collection-form>
        ${
          this._createCollectionError
            ? html`<p class="mt-3 text-sm text-destructive" role="alert">
                ${this._createCollectionError}
              </p>`
            : nothing
        }
      </section>
      <footer>
        <button
          type="button"
          class="btn-ghost"
          ?disabled=${this._creatingCollection}
          @click=${this.#closeCollectionDialog}
        >
          ${this.labels.cancel}
        </button>
        <button
          type="button"
          class="btn"
          ?disabled=${this._creatingCollection}
          @click=${this.#submitCollectionForm}
        >
          ${
            this._creatingCollection
              ? this.labels.creatingCollection
              : this.labels.createCollection
          }
        </button>
      </footer>
    `;
  }

  #renderCreatedCollection() {
    const collection = this._createdCollection;
    if (!collection) return nothing;

    const returnTo = publicPath(NAVIGATION_SETTINGS_PATH);
    const editHref = `${publicPath(
      getCollectionEditPath(collection.slug),
    )}?returnTo=${encodeURIComponent(returnTo)}`;

    return html`
      <header class="nav-create-success-header">
        <span class="nav-create-success-icon" aria-hidden="true">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="22"
            height="22"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path d="M20 6 9 17l-5-5" />
          </svg>
        </span>
        <h2 id="nav-collection-dialog-title">
          ${this.labels.collectionFormLabels.createdLabel}
        </h2>
        <p>${this.labels.collectionCreatedDescription}</p>
      </header>
      <section>
        <div class="nav-create-success-card">
          <span class="nav-page-result-title">${collection.title}</span>
          <span class="nav-page-result-path">
            ${publicPath(getCollectionPagePath(collection.slug))}
          </span>
        </div>
      </section>
      <footer>
        <a
          class="btn-outline"
          href=${editHref}
          target="_blank"
          rel="noopener noreferrer"
        >
          ${this.labels.editCollection}
          <span aria-hidden="true">↗</span>
        </a>
        <button
          type="button"
          class="btn"
          ?disabled=${this._addingCollectionId !== null}
          @click=${() => void this.#handleAddCollection(collection.id)}
        >
          ${this.labels.addToNavigation}
        </button>
      </footer>
    `;
  }

  #renderCollectionDialog() {
    if (!this._collectionDialogOpen) return nothing;

    return html`
      <dialog
        id="nav-collection-dialog"
        class="dialog nav-collection-dialog"
        aria-labelledby="nav-collection-dialog-title"
        @cancel=${(event: Event) => {
          event.preventDefault();
          this.#closeCollectionDialog();
        }}
        @click=${(event: Event) => {
          if (event.target === event.currentTarget) {
            this.#closeCollectionDialog();
          }
        }}
        @keydown=${this.#handleCollectionDialogKeydown}
      >
        <div
          class="nav-collection-dialog-panel"
          @click=${(event: Event) => event.stopPropagation()}
        >
          <button
            type="button"
            aria-label=${this.labels.cancel}
            @click=${this.#closeCollectionDialog}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="18"
              height="18"
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
          ${
            this._collectionDialogView === "create"
              ? this.#renderCreateCollection()
              : this.#renderCreatedCollection()
          }
        </div>
      </dialog>
    `;
  }

  #renderSystemToggles() {
    if (!this.systemNavItems?.length) return nothing;

    return html`
      <section class="mt-8">
        <h2 class="text-lg font-semibold mb-1">${this.labels.systemLinks}</h2>
        <p class="text-sm text-muted-foreground mb-3">
          ${this.labels.systemLinksDescription}
        </p>
        <div class="flex flex-col divide-y">
          ${this.systemNavItems.map((config) => {
            const enabled = this.#isSystemEnabled(config);
            const toggling = this._togglingKeys.has(config.key);
            const rowClass = toggling
              ? "flex items-center justify-between gap-4 py-3 opacity-60 cursor-not-allowed"
              : "flex items-center justify-between gap-4 py-3 cursor-pointer";
            return html`
              <label class=${rowClass}>
                <div>
                  <p class="font-medium">${config.label}</p>
                  <p class="text-sm text-muted-foreground">
                    ${config.description}
                  </p>
                </div>
                <input
                  type="checkbox"
                  role="switch"
                  class="input"
                  .checked=${enabled}
                  ?disabled=${toggling}
                  @change=${(e: Event) => {
                    const checked = (e.target as HTMLInputElement).checked;
                    this.#handleSystemToggle(config, checked);
                  }}
                />
              </label>
            `;
          })}
        </div>
      </section>
    `;
  }

  render() {
    return html`
      ${this.#renderPreview()}

      <section class="mt-8">
        <h2 class="text-lg font-semibold mb-3">${this.labels.headerSection}</h2>
        ${
          this.#headerItems.length === 0
            ? html`<p class="text-sm text-muted-foreground py-4">
                ${this.labels.emptyState}
              </p>`
            : nothing
        }
        <div id="nav-items-header" class="nav-items-list">
          ${repeat(
            this.#headerItems,
            (item) => item.id,
            (item) => this.#renderItem(item),
          )}
        </div>
      </section>

      <section class="mt-8">
        <h2 class="text-lg font-semibold mb-3">${this.labels.moreSection}</h2>
        <div id="nav-items-more" class="nav-items-list nav-items-list-drop">
          ${
            this.#moreItems.length > 0
              ? repeat(
                  this.#moreItems,
                  (item) => item.id,
                  (item) => this.#renderItem(item),
                )
              : html`<p class="nav-items-empty-hint">
                  ${this.labels.moreEmptyHint}
                </p>`
          }
        </div>
      </section>

      ${this.#renderSuggestedLinksSection()} ${this.#renderAddPageSection()}
      ${this.#renderAddCollectionSection()} ${this.#renderAddLinkSection()}
      ${this.#renderSystemToggles()} ${this.#renderPageDialog()}
      ${this.#renderCollectionDialog()}
    `;
  }
}

customElements.define("jant-nav-manager", JantNavManager);
