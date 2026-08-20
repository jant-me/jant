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

vi.mock("../../toast.js", () => ({
  showToast: vi.fn(),
  showToastWithAction: vi.fn(),
}));

const { confirmMock } = vi.hoisted(() => ({ confirmMock: vi.fn() }));
vi.mock("../../confirm.js", () => ({
  showConfirmDialog: confirmMock,
}));

import type {
  CollectionManagerItem,
  CollectionManagerLabels,
} from "../collection-manager-types.js";
import { queueCollectionCreatedNotice } from "../../collection-created-notice.js";
import "../jant-collection-directory.js";
import type { JantCollectionsManager } from "../jant-collection-directory.js";

const labels: CollectionManagerLabels = {
  collectionsTitle: "Collections",
  smartCollectionNoun: "Smart Collection",
  newSmartCollection: "New Smart Collection",
  editSmartCollection: "Edit Smart Collection",
  deleteSmartCollection: "Delete",
  confirmDeleteSmartCollection: "Delete this smart collection?",
  turnIntoSmartCollection: "Turn into a smart collection",
  smartCollectionDeleted: "Smart collection deleted.",
  organize: "Organize",
  done: "Done",
  organizeHint: "Drag to reorder.",
  newDivider: "New divider",
  newLink: "New link",
  addLink: "Add link",
  addLinkDescription: "Add a custom shortcut.",
  dividerLabel: "Divider label",
  dividerLabelPlaceholder: "Section",
  newCollection: "New collection",
  edit: "Edit",
  addToNavigation: "Add to Navigation",
  addingToNavigation: "Adding…",
  addedToNavigation: "Collection added to navigation.",
  editNavigation: "Edit Navigation",
  addToNavigationFailed: "Couldn't add this collection to navigation.",
  notNow: "Not now",
  label: "Label",
  url: "URL",
  linkLabelPlaceholder: "Quotes",
  linkUrlPlaceholder: "/archive?format=quote",
  linkDescriptionLabel: "Description (optional)",
  linkDescriptionPlaceholder: "Link",
  labelAndUrlRequired: "Add a label and URL.",
  deleteDivider: "Delete divider",
  moreActions: "More actions",
  deleteCollection: "Delete collection",
  confirmDelete: "Delete this collection permanently?",
  deleteLink: "Remove link",
  confirmDeleteLink: "Remove this link from Collections?",
  cancel: "Cancel",
  threadSingular: "thread",
  threadPlural: "threads",
  emptyState: "Create a collection to get started.",
  orderSaved: "Collection order updated.",
  saved: "Collection saved.",
  linkCreated: "Link added.",
  linkSaved: "Link updated.",
  saveFailed: "Save failed.",
  deleted: "Collection deleted.",
  linkDeleted: "Link removed.",
  formLabels: {
    titleLabel: "Title",
    titlePlaceholder: "My Collection",
    slugLabel: "Collection link",
    slugInvalidHelp: "Use lowercase letters, numbers, and hyphens only.",
    slugReservedHelp: "This link is reserved. Choose something else.",
    slugHelp: "This is the last part of the collection link.",
    editSlugLabel: "Edit link",
    resetSlugLabel: "Reset link",
    quickHint: "More options are available after you create it.",
    quickSubmitLabel: "Done",
    createdLabel: "Collection created.",
    descriptionLabel: "Description",
    descriptionPlaceholder: "What's this collection about?",
    sortOrderLabel: "Sort order",
    sortNewest: "Newest first",
    sortOldest: "Oldest first",
    sortRatingDesc: "Highest rated",
    submitLabel: "Save",
    cancelLabel: "Cancel",
  },
};

const items: CollectionManagerItem[] = [
  {
    id: "directory-1",
    type: "collection",
    collectionId: "collection-1",
    position: "a0",
    collection: {
      id: "collection-1",
      slug: "reading",
      title: "Reading",
      description: "Notes from books",
      sortOrder: "newest",
      threadCount: 4,
      recentActivityAt: 1_763_619_200,
    },
  },
  {
    id: "directory-2",
    type: "collection",
    collectionId: "collection-2",
    position: "a1",
    collection: {
      id: "collection-2",
      slug: "tools",
      title: "Tools",
      description: "Tools I keep around",
      sortOrder: "newest",
      threadCount: 2,
      recentActivityAt: 1_763_619_260,
    },
  },
];

const groupedItems: CollectionManagerItem[] = [
  {
    id: "divider-1",
    type: "divider",
    label: "Reading group",
    position: "a0",
  },
  ...items,
  {
    id: "divider-2",
    type: "divider",
    label: "Solo group",
    position: "a9",
  },
  {
    id: "directory-3",
    type: "collection",
    collectionId: "collection-3",
    position: "b0",
    collection: {
      id: "collection-3",
      slug: "solo",
      title: "Solo",
      description: null,
      sortOrder: "newest",
      threadCount: 1,
      recentActivityAt: 1_763_619_300,
    },
  },
];

const itemsWithSmartCollection: CollectionManagerItem[] = [
  {
    id: "directory-smart",
    type: "smart_collection",
    smartCollectionId: "smc_1",
    position: "a0",
    smartCollection: {
      id: "smc_1",
      slug: "quotes",
      title: "Quotes",
      description: null,
      selection: { format: "quote" },
      sort: "newest",
      layout: null,
      threadCount: 4,
    },
  },
];

const itemsWithLink: CollectionManagerItem[] = [
  {
    id: "link-1",
    type: "link",
    label: "Quotes",
    url: "/archive?format=quote&visibility=public&view=list",
    position: "a0",
  },
];

async function createElement(): Promise<JantCollectionsManager> {
  const el = document.createElement(
    "jant-collections-manager",
  ) as JantCollectionsManager;
  el.labels = labels;
  el.items = items;
  el.navigationCollectionIds = [];
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}

async function createElementWithItems(
  customItems: CollectionManagerItem[],
): Promise<JantCollectionsManager> {
  const el = document.createElement(
    "jant-collections-manager",
  ) as JantCollectionsManager;
  el.labels = labels;
  el.items = customItems;
  el.navigationCollectionIds = [];
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}

async function createElementWithManagerRoot(): Promise<JantCollectionsManager> {
  const root = document.createElement("div");
  root.setAttribute("data-collections-manager-root", "");
  root.innerHTML = `
    <div data-collections-reorder-actions hidden>
      <button type="button" data-collections-action="divider">New divider</button>
      <button type="button" data-collections-action="done">Done</button>
    </div>
    <div data-collections-toolbar></div>
    <p data-collections-hint hidden></p>
    <div data-collections-more-menu hidden></div>
    <button type="button" data-collections-action="toggle-menu"></button>
  `;

  const el = document.createElement(
    "jant-collections-manager",
  ) as JantCollectionsManager;
  el.labels = labels;
  el.items = items;
  el.navigationCollectionIds = [];
  root.appendChild(el);
  document.body.appendChild(root);
  await el.updateComplete;
  return el;
}

async function flushAsyncWork() {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("JantCollectionsManager", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    globalThis.sessionStorage.clear();
    vi.restoreAllMocks();
    vi.clearAllMocks();
    sortableCreateMock.mockClear();
    sortableDestroyMock.mockClear();
    confirmMock.mockReset().mockResolvedValue(true);
  });

  // The edit dialog deliberately has no delete of its own — this menu is where
  // a smart collection is destroyed, so this is where it has to be covered.
  it("deletes a smart collection from its item menu, after confirming", async () => {
    const el = await createElementWithItems(itemsWithSmartCollection);
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 204 }));
    const { showToast } = await import("../../toast.js");

    el._showItemMenuId = "directory-smart";
    await el.updateComplete;

    const remove = Array.from(
      el.querySelectorAll<HTMLButtonElement>(".collections-page-menu-item"),
    ).find((button) => button.textContent?.trim() === "Delete");
    expect(remove).toBeDefined();

    remove?.click();
    await flushAsyncWork();
    await el.updateComplete;

    expect(confirmMock).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "Delete this smart collection?",
        tone: "danger",
      }),
    );
    expect(fetchMock).toHaveBeenCalledWith("/api/smart-collections/smc_1", {
      method: "DELETE",
    });
    expect(showToast).toHaveBeenCalledWith("Smart collection deleted.");
  });

  // A refreshed list has to name rows the way the server-rendered one does: a
  // smart collection with no directory row of its own carries its own id, and
  // that is the id the move endpoint places before moving.
  it("names a smart collection with no directory row by its own id", async () => {
    const el = await createElementWithItems(itemsWithSmartCollection);
    vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
      if (String(input).startsWith("/api/collections")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              collections: [],
              smartCollections: [
                {
                  id: "smc_9",
                  slug: "quotes",
                  title: "Quotes",
                  description: null,
                  selection: { format: "quote" },
                  sort: "newest",
                  layout: null,
                  threadCount: 4,
                },
              ],
              directoryItems: [],
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
        );
      }
      return Promise.resolve(new Response(null, { status: 204 }));
    });

    el._showItemMenuId = "directory-smart";
    await el.updateComplete;

    Array.from(
      el.querySelectorAll<HTMLButtonElement>(".collections-page-menu-item"),
    )
      .find((button) => button.textContent?.trim() === "Delete")
      ?.click();
    await flushAsyncWork();
    el._reorderMode = true;
    await el.updateComplete;

    const rows = Array.from(
      el.querySelectorAll<HTMLElement>("[data-directory-item]"),
    );
    expect(rows.map((row) => row.dataset.directoryItem)).toEqual(["smc_9"]);
  });

  it("leaves a smart collection alone when the confirmation is declined", async () => {
    confirmMock.mockResolvedValue(false);
    const el = await createElementWithItems(itemsWithSmartCollection);
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 204 }));

    el._showItemMenuId = "directory-smart";
    await el.updateComplete;

    Array.from(
      el.querySelectorAll<HTMLButtonElement>(".collections-page-menu-item"),
    )
      .find((button) => button.textContent?.trim() === "Delete")
      ?.click();
    await flushAsyncWork();

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("uses responsive sortable settings in reorder mode", async () => {
    const el = await createElement();

    el._reorderMode = true;
    await el.updateComplete;

    expect(sortableCreateMock).toHaveBeenCalledTimes(1);
    const [, options] = sortableCreateMock.mock.calls[0] ?? [];
    expect(options).toMatchObject({
      animation: 180,
      bubbleScroll: false,
      chosenClass: "collection-directory-chosen",
      dragClass: "collection-directory-drag",
      fallbackTolerance: 4,
      forceAutoScrollFallback: true,
      ghostClass: "collection-directory-ghost",
      handle: "[data-drag-handle]",
      scroll: true,
      scrollSensitivity: 56,
      scrollSpeed: 18,
    });
  });

  it("restricts drag initiation to the handle icon only", async () => {
    const el = await createElement();

    el._reorderMode = true;
    await el.updateComplete;

    const handle = el.querySelector(
      ".collection-directory-handle[data-drag-handle]",
    );
    expect(handle).not.toBeNull();

    const mainArea = el.querySelector(".collection-directory-reorder-main");
    expect(mainArea).not.toBeNull();
    expect(mainArea?.hasAttribute("data-drag-handle")).toBe(false);
  });

  it("shows the reorder actions with new divider while organizing", async () => {
    const el = await createElementWithManagerRoot();
    const root = el.closest<HTMLElement>("[data-collections-manager-root]");

    expect(root).not.toBeNull();
    if (!root) throw new Error("Expected collections manager root");

    const reorderActions = root.querySelector<HTMLElement>(
      "[data-collections-reorder-actions]",
    );
    const toolbar = root.querySelector<HTMLElement>(
      "[data-collections-toolbar]",
    );
    const dividerButton = root.querySelector<HTMLButtonElement>(
      '[data-collections-reorder-actions] [data-collections-action="divider"]',
    );

    expect(reorderActions?.hidden).toBe(true);
    expect(toolbar?.hidden).toBe(false);
    expect(dividerButton?.textContent).toContain(labels.newDivider);

    el._reorderMode = true;
    await el.updateComplete;

    expect(reorderActions?.hidden).toBe(false);
    expect(toolbar?.hidden).toBe(true);
  });

  it("renders divider labels as aggregate links when followed by a grouped section", async () => {
    const el = await createElementWithItems(groupedItems);

    const links = el.querySelectorAll<HTMLAnchorElement>(
      ".collection-directory-divider-link",
    );

    expect(links).toHaveLength(1);
    expect(links[0]?.textContent?.trim()).toBe("Reading group");
    expect(links[0]?.getAttribute("href")).toBe("/collections/reading+tools");
  });

  it("renders collection descriptions between the title and metadata", async () => {
    const el = await createElement();

    const descriptions = Array.from(
      el.querySelectorAll<HTMLElement>(".collection-directory-description"),
    ).map((node) => node.textContent?.trim());

    expect(descriptions).toEqual(["Notes from books", "Tools I keep around"]);

    const firstRow = el.querySelector<HTMLElement>(
      ".collection-directory-item",
    );
    expect(firstRow?.textContent).toContain("Reading");
    expect(firstRow?.textContent).toContain("Notes from books");
    expect(firstRow?.textContent).toContain("4 threads");
  });

  it("keeps every Collection action trigger in the keyboard tab order", async () => {
    const el = await createElement();

    expect(
      el.querySelectorAll(".collection-directory-item-menu > button"),
    ).toHaveLength(2);
  });

  it("keeps focus on the URL field while typing in the new link form", async () => {
    const el = await createElement();

    el._showLinkForm = true;
    await el.updateComplete;

    const urlInput = el.querySelector<HTMLInputElement>(
      "#collections-new-link-url",
    );
    expect(urlInput).not.toBeNull();
    if (!urlInput) throw new Error("Expected new link URL input");

    urlInput.focus();
    urlInput.value = "/archive?format=quote";
    urlInput.dispatchEvent(new Event("input", { bubbles: true }));
    await el.updateComplete;

    expect(document.activeElement).toBe(urlInput);
  });

  it("does not show the raw URL in link rows", async () => {
    const el = await createElementWithItems(itemsWithLink);

    const linkRow = el.querySelector<HTMLElement>(
      ".collection-directory-item-link",
    );

    expect(linkRow).not.toBeNull();
    expect(linkRow?.textContent).toContain("Quotes");
    expect(linkRow?.textContent).toContain("Link");
    expect(linkRow?.textContent).not.toContain(
      "/archive?format=quote&visibility=public&view=list",
    );
  });

  it("shows a one-time post-create notice in the Collections content", async () => {
    queueCollectionCreatedNotice("collection-1");
    const el = await createElement();

    const notice = el.querySelector<HTMLElement>(".collection-created-notice");
    expect(notice?.textContent).toContain("Collection created.");
    expect(notice?.textContent).not.toContain("Reading");
    expect(notice?.textContent).toContain("Add to Navigation");

    const dismissButton = notice?.querySelector<HTMLButtonElement>(
      'button[aria-label="Not now"]',
    );
    dismissButton?.click();
    await el.updateComplete;

    expect(el.querySelector(".collection-created-notice")).toBeNull();
  });

  it("adds a Collection to navigation from its item menu", async () => {
    const el = await createElement();
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: "nav-1" }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const { showToastWithAction } = await import("../../toast.js");

    el._showItemMenuId = items[0]?.id ?? null;
    await el.updateComplete;

    const addButton = Array.from(
      el.querySelectorAll<HTMLButtonElement>(".collections-page-menu-item"),
    ).find((button) => button.textContent?.includes("Add to Navigation"));
    expect(addButton).toBeDefined();

    addButton?.click();
    await flushAsyncWork();
    await el.updateComplete;

    expect(fetchMock).toHaveBeenCalledWith("/api/nav-items", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "X-Jant-Site-Header": "include",
      },
      body: JSON.stringify({
        type: "collection",
        collectionId: "collection-1",
        placement: "header",
      }),
    });
    expect(el.navigationCollectionIds).toContain("collection-1");
    expect(showToastWithAction).toHaveBeenCalledWith(
      "Collection added to navigation.",
      {
        label: "Edit Navigation",
        href: "/settings/navigation",
      },
    );

    el._showItemMenuId = items[0]?.id ?? null;
    await el.updateComplete;
    const editNavigationLink = Array.from(
      el.querySelectorAll<HTMLAnchorElement>(".collections-page-menu-item"),
    ).find((link) => link.textContent?.includes("Edit Navigation"));
    expect(editNavigationLink?.getAttribute("href")).toBe(
      "/settings/navigation",
    );
  });

  it("adds the newly created Collection from the inline notice", async () => {
    queueCollectionCreatedNotice("collection-1");
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: "nav-1" }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const { showToastWithAction } = await import("../../toast.js");
    const el = await createElement();
    const notice = el.querySelector<HTMLElement>(".collection-created-notice");
    const addButton = Array.from(
      notice?.querySelectorAll<HTMLButtonElement>("button") ?? [],
    ).find((button) => button.textContent?.includes("Add to Navigation"));

    expect(addButton).toBeDefined();
    addButton?.click();
    await flushAsyncWork();
    await el.updateComplete;

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/nav-items",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          type: "collection",
          collectionId: "collection-1",
          placement: "header",
        }),
      }),
    );
    expect(el.navigationCollectionIds).toContain("collection-1");
    const updatedNotice = el.querySelector<HTMLElement>(
      ".collection-created-notice",
    );
    expect(updatedNotice?.textContent).toContain(
      "Collection added to navigation.",
    );
    expect(
      updatedNotice
        ?.querySelector<HTMLAnchorElement>("a")
        ?.getAttribute("href"),
    ).toBe("/settings/navigation");
    expect(showToastWithAction).not.toHaveBeenCalled();
  });
});
