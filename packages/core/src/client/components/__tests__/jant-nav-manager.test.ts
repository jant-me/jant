// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from "vitest";

const { sortableCreateMock, sortableDestroyMock } = vi.hoisted(() => ({
  sortableCreateMock: vi.fn(),
  sortableDestroyMock: vi.fn(),
}));

vi.mock("sortablejs", () => ({
  default: {
    create: sortableCreateMock.mockImplementation(() => ({
      destroy: sortableDestroyMock,
    })),
  },
}));

vi.mock("../../lazy-slugify.js", () => ({
  slugify: (text: string) =>
    Promise.resolve(
      text
        .toLowerCase()
        .trim()
        .replace(/[^\w\s-]/g, "")
        .replace(/[\s_-]+/g, "-")
        .replace(/^-+|-+$/g, ""),
    ),
}));

import type {
  NavManagerItem,
  NavManagerLabels,
  NavManagerSuggestedLink,
} from "../nav-manager-types.js";
import type { CollectionFormLabels } from "../collection-types.js";
import "../jant-nav-manager.js";
import type { JantNavManager } from "../jant-nav-manager.js";

const collectionFormLabels: CollectionFormLabels = {
  titleLabel: "Title",
  titlePlaceholder: "My Collection",
  slugLabel: "Collection link",
  slugHelp: "This is the last part of the collection link.",
  slugInvalidHelp: "Use lowercase letters, numbers, and hyphens only.",
  slugReservedHelp: "This link is reserved. Choose something else.",
  slugTooLongHelp: "Keep this link under 200 characters.",
  editSlugLabel: "Edit link",
  resetSlugLabel: "Reset link",
  quickHint: "More options are available after you create it.",
  quickSubmitLabel: "Create Collection",
  createdLabel: "Collection created.",
  descriptionLabel: "Description",
  descriptionPlaceholder: "What's this collection about?",
  sortOrderLabel: "Sort Order",
  sortNewest: "Newest first",
  sortOldest: "Oldest first",
  sortRatingDesc: "Highest rated",
  submitLabel: "Save",
  cancelLabel: "Cancel",
};

const labels: NavManagerLabels = {
  preview: "Preview",
  navigationItems: "Navigation items",
  emptyState: "Add a link to get started.",
  link: "Link",
  page: "Page",
  system: "System",
  toggleEdit: "Toggle edit",
  label: "Label",
  url: "URL",
  save: "Save",
  delete: "Delete",
  remove: "Remove",
  confirmDeleteLink: "Delete this navigation link?",
  confirmDeletePage:
    "Remove this page from navigation? The page itself won't be deleted.",
  orderSaved: "Navigation order updated.",
  labelRequired: "Add a label.",
  saveFailed: "Save failed.",
  deleteFailed: "Delete failed.",
  systemLinks: "System links",
  systemLinksDescription: "Built-in links.",
  addCustomLinkToNavigation: "Add a custom link",
  addLink: "Add link",
  addLinkDescription: "Add a custom nav link.",
  urlPlaceholder: "/about",
  labelAndUrlRequired: "Add a label and URL.",
  suggestedLinks: "Suggested links",
  suggestedLinksDescription: "Add common destinations.",
  addSuggestedLink: "Add",
  suggestedLinkAdded: "Link added to navigation.",
  addPageToNavigation: "Add page to navigation",
  addPageDescription:
    "Choose a titled note that isn't already in navigation, or create a new page.",
  addPage: "Add Page",
  searchPages: "Search pages",
  searchPagesHint: "Search pages, or paste an address",
  recentPages: "Recently updated",
  addressMatch: "At that address",
  addressAlreadyAdded:
    "Already in navigation. Drag it in the list above to move it.",
  addressNotFound: "Nothing at {address}. Check it, or search by title.",
  addressUnpublished: "That page is a draft. Publish it, then add it.",
  addressPrivate: "That page is private, so nobody could open it from a menu.",
  addressUntitled: "That page has no title yet, so a menu has nothing to show.",
  addressExternal:
    "That address is on another site. Navigation holds it as a link.",
  addressLinkOnly: "Navigation holds that address as a link.",
  addressAddAsLink: "Add as link",
  searchingPages: "Searching pages…",
  noMatchingPages: "No matching pages available to add.",
  noPages: "No pages available.",
  pageSearchFailed: "Couldn't load pages.",
  createNewPage: "Create new page",
  createPage: "Create Page",
  createPageDescription: "Create a public page that won't appear in Latest.",
  pageTitle: "Title",
  pageAddress: "Page address",
  pageVisibilityHint: "The page is public but stays out of Latest.",
  titleRequired: "Enter a page title.",
  slugInvalid: "Use lowercase letters, numbers, and hyphens.",
  slugReserved: "That address is reserved.",
  slugTooLong: "Keep the page address under 200 characters.",
  slugUnavailable: "That address is already in use.",
  checkingAddress: "Checking address…",
  creatingPage: "Creating page…",
  createPageFailed: "Couldn't create the page.",
  pageCreated: "Page created.",
  pageCreatedDescription: "Add it to navigation or open the editor.",
  addToNavigation: "Add to Navigation",
  editPage: "Edit Page",
  pageAdded: "Page added to navigation.",
  back: "Back",
  headerSection: "Header",
  moreSection: "More",
  moreEmptyHint: "Move links here to hide them under More.",
  placementSaved: "Navigation placement updated.",
  cancel: "Cancel",
  collection: "collection",
  addCollection: "Add Collection",
  addCollectionToNavigation: "Add collection to navigation",
  addCollectionDescription:
    "Pin a collection to your navigation bar. An asterisk (*) appears next to collections updated in the last 48 hours.",
  allCollectionsAdded: "All collections are already in your navigation.",
  noCollections: "No collections yet. Create one here to add it to navigation.",
  createNewCollection: "Create new collection",
  createCollection: "Create Collection",
  creatingCollection: "Creating collection…",
  createCollectionFailed: "Couldn't create the collection.",
  collectionCreatedDescription:
    "Add it to navigation now or open the editor to add details.",
  editCollection: "Edit Collection",
  collectionAdded: "Collection added to navigation.",
  collectionFormLabels,
  confirmDeleteCollection:
    "Remove this collection from navigation? The collection itself won't be deleted.",
};

const items: NavManagerItem[] = [
  {
    id: "nav-1",
    type: "link",
    label: "About",
    url: "/about",
    placement: "header",
  },
  {
    id: "nav-2",
    type: "link",
    label: "Links",
    url: "/links",
    placement: "header",
  },
  {
    id: "nav-3",
    type: "link",
    label: "Archive",
    url: "/archive",
    placement: "more",
  },
];

const suggestedLinks: NavManagerSuggestedLink[] = [
  {
    key: "now",
    label: "Now",
    url: "/now",
    targetType: "collection",
    targetLabel: "Collection",
    navItemType: "collection",
    collectionId: "col_now",
  },
];

function renderHeaderFragment(label: string): string {
  return `
    <header class="site-header" data-site-header-fragment="header">
      <div class="site-header-inner">
        <div class="site-header-top">
          <a href="/" class="site-logo">Test Site</a>
          <nav class="site-header-nav" aria-label="Primary">
            <a href="/now" class="site-header-link">${label}</a>
          </nav>
          <button
            type="button"
            class="site-header-hamburger"
            aria-controls="site-nav-drawer"
            aria-expanded="false"
          ></button>
        </div>
      </div>
    </header>
    <div
      class="site-nav-drawer-backdrop"
      data-site-header-fragment="drawer-backdrop"
      aria-hidden="true"
    ></div>
    <div
      id="site-nav-drawer"
      class="site-nav-drawer"
      data-site-header-fragment="drawer"
      aria-hidden="true"
      inert
    >
      <button class="site-nav-drawer-close" type="button"></button>
      <a href="/now" class="site-nav-drawer-link">${label}</a>
    </div>
  `;
}

function installCurrentHeaderFragment(label = "Old"): void {
  document.body.insertAdjacentHTML("afterbegin", renderHeaderFragment(label));
}

function requireElement<T>(value: T | null, message: string): T {
  if (!value) {
    throw new Error(message);
  }

  return value;
}

function findButton(
  root: {
    querySelectorAll<E extends globalThis.Element = globalThis.Element>(
      selectors: string,
    ): globalThis.NodeListOf<E>;
  },
  text: string,
): HTMLButtonElement {
  const button = Array.from(
    root.querySelectorAll<HTMLButtonElement>("button"),
  ).find((candidate) => candidate.textContent?.trim().includes(text));
  return requireElement(button ?? null, `expected button containing ${text}`);
}

function getListIds(list: HTMLElement): string[] {
  return Array.from(list.querySelectorAll<HTMLElement>("[data-nav-id]")).map(
    (item) => item.dataset.navId ?? "",
  );
}

function getPreviewHeaderLabels(el: HTMLElement): string[] {
  return Array.from(
    el.querySelectorAll<HTMLElement>(
      ".nav-preview .site-header-nav > .site-header-link",
    ),
  ).map((item) => item.textContent?.trim() ?? "");
}

function getPreviewMoreLabels(el: HTMLElement): string[] {
  return Array.from(
    el.querySelectorAll<HTMLElement>(
      ".nav-preview .site-header-more-popover .site-header-more-link",
    ),
  ).map((item) => item.textContent?.trim() ?? "");
}

function getSortableOptions(
  listId: string,
): Record<string, ((event: unknown) => void) | undefined> {
  const call = sortableCreateMock.mock.calls.find(
    ([el]) => (el as HTMLElement).id === listId,
  );
  if (!call) {
    throw new Error(`Expected Sortable to be created for ${listId}`);
  }

  const [, options] = call;
  return options as Record<string, ((event: unknown) => void) | undefined>;
}

async function flushAsyncWork(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

async function createElement(): Promise<JantNavManager> {
  const el = document.createElement("jant-nav-manager") as JantNavManager;
  el.labels = labels;
  el.items = items;
  el.systemNavItems = [];
  el.suggestedLinks = [];
  el.siteName = "Test Site";
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}

describe("JantNavManager", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    sortableCreateMock.mockClear();
    sortableDestroyMock.mockClear();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ ...items[1] }),
      }),
    );
  });

  it("shows collection actions before custom link actions", async () => {
    const el = await createElement();
    const headings = Array.from(el.querySelectorAll("section > h2")).map(
      (heading) => heading.textContent?.trim(),
    );

    expect(headings.indexOf(labels.addCollectionToNavigation)).toBeLessThan(
      headings.indexOf(labels.addCustomLinkToNavigation),
    );
  });

  it("offers quick collection creation at the bottom of the picker", async () => {
    const el = await createElement();
    el.collections = [
      { id: "col-reading", title: "Reading", slug: "reading", group: null },
    ];
    await el.updateComplete;

    findButton(el, "Add Collection").click();
    await el.updateComplete;
    const picker = requireElement(
      el.querySelector<HTMLElement>(".collection-picker"),
      "expected collection picker",
    );
    picker.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
        cancelable: true,
      }),
    );
    await el.updateComplete;
    expect(el.querySelector(".collection-picker")).toBeNull();

    findButton(el, "Add Collection").click();
    await el.updateComplete;
    const createCollectionButton = findButton(
      requireElement(
        el.querySelector<HTMLElement>(".collection-picker"),
        "expected reopened collection picker",
      ),
      "Create new collection",
    );
    expect(
      createCollectionButton.querySelectorAll('[aria-hidden="true"]'),
    ).toHaveLength(1);
    expect(
      createCollectionButton.querySelector('[aria-hidden="true"]')?.textContent,
    ).toBe("+");
    createCollectionButton.click();
    await flushAsyncWork();
    await el.updateComplete;

    const dialog = requireElement(
      el.querySelector<HTMLDialogElement>("#nav-collection-dialog"),
      "expected collection dialog",
    );
    expect(dialog.open).toBe(true);

    dialog.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
        cancelable: true,
      }),
    );
    await el.updateComplete;
    expect(el.querySelector("#nav-collection-dialog")).toBeNull();
  });

  it("quick-creates a collection and adds it to navigation", async () => {
    const el = await createElement();
    const fetchMock = vi
      .fn()
      .mockImplementation((input: string, init?: globalThis.RequestInit) => {
        if (input === "/api/collections" && init?.method === "POST") {
          return Promise.resolve({
            ok: true,
            status: 201,
            json: async () => ({
              id: "col-books",
              title: "Books",
              slug: "books",
            }),
          });
        }
        if (input === "/api/nav-items" && init?.method === "POST") {
          return Promise.resolve({
            ok: true,
            status: 201,
            json: async () => ({
              id: "nav-books",
              type: "collection",
              collectionId: "col-books",
              label: "Books",
              url: "/books",
              placement: "header",
            }),
          });
        }
        throw new Error(`Unexpected fetch: ${input}`);
      });
    vi.stubGlobal("fetch", fetchMock);

    findButton(el, "Create Collection").click();
    await flushAsyncWork();
    await el.updateComplete;

    const dialog = requireElement(
      el.querySelector<HTMLDialogElement>("#nav-collection-dialog"),
      "expected collection dialog",
    );
    const titleInput = requireElement(
      dialog.querySelector<HTMLInputElement>("[data-collection-title-input]"),
      "expected collection title input",
    );
    titleInput.value = "Books";
    titleInput.dispatchEvent(new Event("input", { bubbles: true }));
    await flushAsyncWork();
    await el.updateComplete;

    const createButton = requireElement(
      dialog.querySelector<HTMLButtonElement>("footer .btn"),
      "expected create collection button",
    );
    createButton.click();
    await flushAsyncWork();
    await el.updateComplete;

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/collections",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ title: "Books", slug: "books" }),
      }),
    );
    const editLink = requireElement(
      el.querySelector<HTMLAnchorElement>(
        'a[href="/collections/books/edit?returnTo=%2Fsettings%2Fnavigation"]',
      ),
      "expected collection edit link",
    );
    expect(editLink.target).toBe("_blank");
    expect(editLink.rel).toContain("noopener");
    expect(el.collections).toContainEqual({
      id: "col-books",
      title: "Books",
      slug: "books",
      group: null,
    });

    findButton(dialog, "Add to Navigation").click();
    await flushAsyncWork();
    await el.updateComplete;

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/nav-items",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          type: "collection",
          collectionId: "col-books",
          placement: "header",
        }),
      }),
    );
    expect(el.querySelector("#nav-collection-dialog")).toBeNull();
    expect(
      getListIds(
        requireElement(el.querySelector("#nav-items-header"), "header list"),
      ),
    ).toEqual(["nav-1", "nav-2", "nav-books"]);
  });

  it("reconciles a cross-list drag after Sortable mutates the DOM", async () => {
    const el = await createElement();
    const headerList = requireElement(
      el.querySelector<HTMLElement>("#nav-items-header"),
      "expected header nav list",
    );
    const moreList = requireElement(
      el.querySelector<HTMLElement>("#nav-items-more"),
      "expected more nav list",
    );
    const movedItem = requireElement(
      headerList.querySelector<HTMLElement>('[data-nav-id="nav-2"]'),
      "expected moved nav item",
    );
    const headerSortable = getSortableOptions("nav-items-header");

    headerSortable.onStart?.({
      from: headerList,
      to: headerList,
      item: movedItem,
      oldIndex: 1,
      newIndex: 1,
    });

    moreList.insertBefore(movedItem, moreList.firstChild);

    headerSortable.onEnd?.({
      from: headerList,
      to: moreList,
      item: movedItem,
      oldIndex: 1,
      newIndex: 0,
    });

    await el.updateComplete;
    await flushAsyncWork();

    expect(getListIds(headerList)).toEqual(["nav-1"]);
    expect(getListIds(moreList)).toEqual(["nav-2", "nav-3"]);
    expect(getPreviewHeaderLabels(el)).toEqual(["About"]);
    expect(getPreviewMoreLabels(el)).toEqual(["Links", "Archive"]);
    expect(
      Array.from(el.querySelectorAll<HTMLElement>("[data-nav-id]")).map(
        (item) => item.dataset.navId,
      ),
    ).toEqual(["nav-1", "nav-2", "nav-3"]);
    expect(fetch).toHaveBeenNthCalledWith(
      1,
      "/api/nav-items/nav-2",
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({ placement: "more" }),
      }),
    );
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      "/api/nav-items/nav-2/move",
      expect.objectContaining({
        method: "PUT",
        headers: expect.objectContaining({
          "X-Jant-Site-Header": "include",
        }),
        body: JSON.stringify({
          after: null,
          before: "nav-3",
        }),
      }),
    );
  });

  it("opens and dismisses the preview More popover", async () => {
    const el = await createElement();
    const trigger = requireElement(
      el.querySelector<HTMLElement>("[data-preview-more-trigger]"),
      "expected preview more trigger",
    );
    const popover = requireElement(
      el.querySelector<HTMLElement>(".nav-preview .site-header-more-popover"),
      "expected preview more popover",
    );

    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(popover.getAttribute("aria-hidden")).toBe("true");

    trigger.click();
    await el.updateComplete;

    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(popover.getAttribute("aria-hidden")).toBe("false");
    expect(getPreviewMoreLabels(el)).toEqual(["Archive"]);

    const escapeEvent = new Event("keydown");
    Object.defineProperty(escapeEvent, "key", { value: "Escape" });
    document.dispatchEvent(escapeEvent);
    await el.updateComplete;

    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(popover.getAttribute("aria-hidden")).toBe("true");
  });

  it("hides a saved RSS item from the preview without removing its editor", async () => {
    const el = await createElement();
    el.items = [
      ...items,
      {
        id: "nav-rss",
        type: "system",
        systemKey: "rss",
        label: "Feed",
        displayLabel: "Feed",
        url: "/feed",
        placement: "header",
      },
    ];
    el.rssFeedsEnabled = false;
    await el.updateComplete;

    expect(getPreviewHeaderLabels(el)).not.toContain("Feed");
    expect(el.querySelector('[data-nav-id="nav-rss"]')).not.toBeNull();

    el.rssFeedsEnabled = true;
    await el.updateComplete;
    expect(getPreviewHeaderLabels(el)).toContain("Feed");
  });

  it("adds a suggested collection link through the nav items API", async () => {
    const el = await createElement();
    el.suggestedLinks = suggestedLinks;
    el.requestUpdate();
    await el.updateComplete;

    const addButton = requireElement(
      el.querySelector<HTMLButtonElement>(".nav-suggestion-item button"),
      "expected suggested link add button",
    );
    expect(el.textContent).toContain("Now");
    expect(el.textContent).toContain("/now · Collection");

    const created: NavManagerItem = {
      id: "nav-now",
      type: "collection",
      collectionId: "col_now",
      label: "Now",
      url: "/now",
      placement: "header",
    };
    installCurrentHeaderFragment("Old");
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({
        ...created,
        headerHtml: renderHeaderFragment("Now"),
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    addButton.click();
    await flushAsyncWork();
    await el.updateComplete;

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/nav-items",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "X-Jant-Site-Header": "include",
        }),
        body: JSON.stringify({
          type: "collection",
          collectionId: "col_now",
          placement: "header",
        }),
      }),
    );
    expect(
      getListIds(
        requireElement(
          el.querySelector<HTMLElement>("#nav-items-header"),
          "expected header nav list",
        ),
      ),
    ).toContain("nav-now");
    expect(el.querySelector(".nav-suggestion-item")).toBeNull();
    expect(
      document
        .querySelector<HTMLElement>('[data-site-header-fragment="header"]')
        ?.textContent?.trim(),
    ).toContain("Now");
  });

  it("confirms before deleting a navigation item", async () => {
    const el = await createElement();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        headerHtml: renderHeaderFragment("Links"),
      }),
    });
    vi.stubGlobal("fetch", fetchMock);
    installCurrentHeaderFragment("About");

    (
      el as unknown as { _editingId: string | null; requestUpdate: () => void }
    )._editingId = "nav-1";
    el.requestUpdate();
    await el.updateComplete;

    const deleteButton = requireElement(
      el.querySelector<HTMLButtonElement>(".nav-item-edit .btn-sm-ghost"),
      "expected nav delete button",
    );
    deleteButton.click();
    await flushAsyncWork();

    const host = requireElement(
      document.querySelector<HTMLElement>("jant-confirm-dialog"),
      "expected shared confirm dialog host",
    );
    const confirmButton = requireElement(
      host.querySelector<HTMLButtonElement>(
        ".confirm-dialog-actions .btn-destructive",
      ),
      "expected confirm button",
    );
    confirmButton.click();
    await flushAsyncWork();
    await el.updateComplete;

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/nav-items/nav-1",
      expect.objectContaining({
        method: "DELETE",
        headers: expect.objectContaining({
          "X-Jant-Site-Header": "include",
        }),
      }),
    );
    expect(
      getListIds(
        requireElement(
          el.querySelector<HTMLElement>("#nav-items-header"),
          "expected header nav list",
        ),
      ),
    ).toEqual(["nav-2"]);
    expect(
      document
        .querySelector<HTMLElement>('[data-site-header-fragment="header"]')
        ?.textContent?.trim(),
    ).toContain("Links");
  });

  it("does not delete when confirmation is canceled", async () => {
    const el = await createElement();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    (
      el as unknown as { _editingId: string | null; requestUpdate: () => void }
    )._editingId = "nav-1";
    el.requestUpdate();
    await el.updateComplete;

    const deleteButton = requireElement(
      el.querySelector<HTMLButtonElement>(".nav-item-edit .btn-sm-ghost"),
      "expected nav delete button",
    );
    deleteButton.click();
    await flushAsyncWork();

    const host = requireElement(
      document.querySelector<HTMLElement>("jant-confirm-dialog"),
      "expected shared confirm dialog host",
    );
    const cancelButton = requireElement(
      host.querySelector<HTMLButtonElement>(
        ".confirm-dialog-actions .btn-outline",
      ),
      "expected cancel button",
    );
    cancelButton.click();
    await flushAsyncWork();

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("searches for an existing page and adds it by post ID", async () => {
    const el = await createElement();
    const page = {
      id: "pst_about",
      title: "About me",
      slug: "about-me",
      updatedAt: 123,
    };
    const fetchMock = vi
      .fn()
      .mockImplementation((input: string, init?: globalThis.RequestInit) => {
        if (input.startsWith("/api/nav-items/pages?")) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({ pages: [page] }),
          });
        }
        if (input === "/api/nav-items" && init?.method === "POST") {
          return Promise.resolve({
            ok: true,
            status: 201,
            json: async () => ({
              id: "nav-page",
              type: "page",
              postId: page.id,
              label: page.title,
              url: `/${page.slug}`,
              placement: "header",
            }),
          });
        }
        throw new Error(`Unexpected fetch: ${input}`);
      });
    vi.stubGlobal("fetch", fetchMock);

    findButton(el, "Add Page").click();
    await flushAsyncWork();
    await el.updateComplete;
    findButton(el, "About me").click();
    await flushAsyncWork();
    await el.updateComplete;

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/nav-items",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          type: "page",
          postId: page.id,
          placement: "header",
        }),
      }),
    );
    expect(
      getListIds(
        requireElement(el.querySelector("#nav-items-header"), "header list"),
      ),
    ).toEqual(["nav-1", "nav-2", "nav-page"]);
    expect(el.querySelector("#nav-page-dialog")).toBeNull();
  });

  it("keeps page-list keyboard shortcuts scoped to the search field", async () => {
    const el = await createElement();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        pages: [
          {
            id: "pst_about",
            title: "About me",
            slug: "about-me",
            updatedAt: 123,
          },
        ],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    findButton(el, "Add Page").click();
    await flushAsyncWork();
    await el.updateComplete;

    const createButton = findButton(el, "Create new page");
    createButton.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
        cancelable: true,
      }),
    );
    await flushAsyncWork();

    expect(
      fetchMock.mock.calls.some(
        ([, init]) =>
          (init as globalThis.RequestInit | undefined)?.method === "POST",
      ),
    ).toBe(false);

    createButton.click();
    await el.updateComplete;
    expect(el.querySelector("#nav-new-page-title")).not.toBeNull();
  });

  it("quick-creates a hidden-from-Latest page and offers edit or add", async () => {
    vi.useFakeTimers();
    try {
      const el = await createElement();
      const fetchMock = vi
        .fn()
        .mockImplementation((input: string, init?: globalThis.RequestInit) => {
          if (input.startsWith("/api/nav-items/pages?")) {
            return Promise.resolve({
              ok: true,
              status: 200,
              json: async () => ({ pages: [] }),
            });
          }
          if (input.startsWith("/api/posts/slug?mode=suggest")) {
            return Promise.resolve({
              ok: true,
              status: 200,
              json: async () => ({ slug: "about-me" }),
            });
          }
          if (input === "/api/posts" && init?.method === "POST") {
            return Promise.resolve({
              ok: true,
              status: 201,
              json: async () => ({
                id: "pst_created",
                title: "About me",
                slug: "about-me",
              }),
            });
          }
          if (input === "/api/nav-items" && init?.method === "POST") {
            return Promise.resolve({
              ok: true,
              status: 201,
              json: async () => ({
                id: "nav-created",
                type: "page",
                postId: "pst_created",
                label: "About me",
                url: "/about-me",
                placement: "header",
              }),
            });
          }
          throw new Error(`Unexpected fetch: ${input}`);
        });
      vi.stubGlobal("fetch", fetchMock);

      findButton(el, "Add Page").click();
      await flushAsyncWork();
      await el.updateComplete;
      findButton(el, "Create new page").click();
      await el.updateComplete;

      const titleInput = requireElement(
        el.querySelector<HTMLInputElement>("#nav-new-page-title"),
        "title input",
      );
      titleInput.value = "About me";
      titleInput.dispatchEvent(new Event("input", { bubbles: true }));
      await vi.advanceTimersByTimeAsync(250);
      await flushAsyncWork();
      await el.updateComplete;
      expect(
        requireElement(
          el.querySelector<HTMLInputElement>("#nav-new-page-slug"),
          "slug input",
        ).value,
      ).toBe("about-me");

      findButton(el, "Create Page").click();
      await flushAsyncWork();
      await el.updateComplete;

      expect(fetchMock).toHaveBeenCalledWith(
        "/api/posts",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            format: "note",
            title: "About me",
            slug: "about-me",
            status: "published",
            visibility: "latest_hidden",
          }),
        }),
      );
      expect(
        el.querySelector<HTMLAnchorElement>('a[href="/about-me?edit=1"]')?.rel,
      ).toContain("noopener");

      findButton(el, "Add to Navigation").click();
      await flushAsyncWork();
      await el.updateComplete;
      expect(el.querySelector("#nav-page-dialog")).toBeNull();
      expect(
        getListIds(
          requireElement(el.querySelector("#nav-items-header"), "header list"),
        ),
      ).toEqual(["nav-1", "nav-2", "nav-created"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("renders page items with label and page editing", async () => {
    const el = await createElement();
    el.items = [
      {
        id: "nav-page",
        type: "page",
        postId: "pst_page",
        label: "About",
        url: "/about",
        placement: "header",
      },
    ];
    await el.updateComplete;

    requireElement(
      el.querySelector<HTMLElement>(".nav-item-info"),
      "page row",
    ).click();
    await el.updateComplete;

    expect(el.querySelector(".badge-secondary")?.textContent).toContain("Page");
    expect(el.querySelectorAll(".nav-item-edit input")).toHaveLength(1);
    expect(
      el.querySelector(".nav-item-edit input")?.getAttribute("maxlength"),
    ).toBe("100");
    const editPageLink = requireElement(
      el.querySelector<HTMLAnchorElement>('a[href="/about?edit=1"]'),
      "edit page link",
    );
    expect(editPageLink.target).toBe("_blank");
    expect(editPageLink.rel).toContain("noopener");
  });

  describe("pasting an address into the page picker", () => {
    /** Type into the picker and wait out the debounce. */
    async function search(el: JantNavManager, value: string) {
      const input = requireElement(
        el.querySelector<HTMLInputElement>("#nav-page-search"),
        "page search input",
      );
      input.value = value;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 250));
      await flushAsyncWork();
      await el.updateComplete;
    }

    async function openPicker(
      resolution: unknown,
    ): Promise<{ el: JantNavManager; fetchMock: ReturnType<typeof vi.fn> }> {
      const el = await createElement();
      const fetchMock = vi
        .fn()
        .mockImplementation((input: string, init?: globalThis.RequestInit) => {
          if (input.startsWith("/api/nav-items/pages?")) {
            return Promise.resolve({
              ok: true,
              status: 200,
              json: async () => ({ pages: [] }),
            });
          }
          if (input.startsWith("/api/nav-items/resolve?")) {
            return Promise.resolve({
              ok: true,
              status: 200,
              json: async () => ({ resolution }),
            });
          }
          if (input === "/api/nav-items" && init?.method === "POST") {
            return Promise.resolve({
              ok: true,
              status: 201,
              json: async () => ({
                id: "nav-added",
                type: "page",
                postId: "pst_about",
                label: "About me",
                url: "/about-me",
                placement: "header",
              }),
            });
          }
          throw new Error(`Unexpected fetch: ${input}`);
        });
      vi.stubGlobal("fetch", fetchMock);

      findButton(el, "Add Page").click();
      await flushAsyncWork();
      await el.updateComplete;
      return { el, fetchMock };
    }

    it("looks the address up instead of searching titles", async () => {
      const { el, fetchMock } = await openPicker({
        kind: "page",
        address: "/about-me",
        page: {
          id: "pst_about",
          title: "About me",
          slug: "about-me",
          updatedAt: 123,
        },
      });

      await search(el, "https://example.com/about-me");

      expect(fetchMock).toHaveBeenCalledWith(
        `/api/nav-items/resolve?url=${encodeURIComponent("https://example.com/about-me")}`,
        expect.objectContaining({
          headers: expect.objectContaining({ Accept: "application/json" }),
        }),
      );
      expect(el.textContent).toContain("At that address");

      findButton(el, "About me").click();
      await flushAsyncWork();
      await el.updateComplete;

      expect(fetchMock).toHaveBeenCalledWith(
        "/api/nav-items",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            type: "page",
            postId: "pst_about",
            placement: "header",
          }),
        }),
      );
    });

    it("says why a page cannot be added, rather than showing nothing", async () => {
      const { el } = await openPicker({
        kind: "unpublished",
        address: "/draft-page",
      });

      await search(el, "/draft-page");

      expect(el.textContent).toContain("That page is a draft");
      expect(el.textContent).not.toContain("No matching pages");
    });

    it("names the address it could not find", async () => {
      const { el } = await openPicker({
        kind: "not_found",
        address: "/typo",
      });

      await search(el, "/typo");

      expect(el.textContent).toContain("Nothing at /typo.");
    });

    it("hands an off-site address to the link form, filled in", async () => {
      const { el } = await openPicker({
        kind: "external",
        address: "https://example.org/hello",
      });

      await search(el, "https://example.org/hello");
      expect(el.textContent).toContain("That address is on another site");

      findButton(el, "Add as link").click();
      await el.updateComplete;

      // The picker is out of the way and the URL is already in the form, so
      // the only thing left to type is the label.
      expect(el.querySelector("#nav-page-dialog")).toBeNull();
      expect(
        requireElement(
          el.querySelector<HTMLInputElement>("#nav-link-url"),
          "link url input",
        ).value,
      ).toBe("https://example.org/hello");
    });

    it("does not offer a page that is already in navigation", async () => {
      const { el } = await openPicker({
        kind: "page",
        address: "/about",
        page: {
          id: "pst_nav_1",
          title: "About",
          slug: "about",
          updatedAt: 123,
        },
      });
      el.items = [
        {
          id: "nav-1",
          type: "page",
          postId: "pst_nav_1",
          label: "About",
          url: "/about",
          placement: "header",
        },
      ];
      await el.updateComplete;

      await search(el, "/about");

      expect(el.textContent).toContain("Already in navigation");
      expect(el.querySelector(".nav-page-result")).toBeNull();
    });
  });
});
