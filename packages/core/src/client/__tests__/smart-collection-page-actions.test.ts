// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../toast.js", () => ({
  showToast: vi.fn(),
  showToastWithAction: vi.fn(),
}));

vi.mock("../confirm.js", () => ({
  showConfirmDialog: vi.fn(),
}));

vi.mock("../smart-collection-dialog-host.js", () => ({
  openSmartCollectionDialog: vi.fn(),
}));

function createMarkup() {
  document.body.innerHTML = `
    <div id="toast-container"></div>
    <div
      data-smart-collection-page-actions
      data-smart-collection-id="smc_1"
      data-collection-page-labels='{"addToNavigation":"Add to Navigation","addingToNavigation":"Adding…","addedToNavigation":"Collection added to navigation.","editNavigation":"Edit Navigation","addToNavigationFailed":"Couldn\\u0027t add this collection to navigation. Try again.","confirmDelete":"Delete this smart collection?","deleteCollection":"Delete","cancel":"Cancel","saveFailed":"Couldn\\u0027t save. Try again in a moment.","deleted":"Smart collection deleted."}'
      data-collection-in-navigation="false"
      data-collection-page-redirect-url="/collections"
    >
      <button
        type="button"
        data-collection-page-action="toggle-menu"
        aria-expanded="false"
      >
        More actions
      </button>
      <div data-collection-page-menu hidden>
        <button type="button" role="menuitem" data-collection-page-action="edit">
          Edit
        </button>
        <button
          type="button"
          role="menuitem"
          data-collection-page-action="add-to-navigation"
        >
          <span class="collections-page-menu-item-label">Add to Navigation</span>
        </button>
        <a
          href="/settings/navigation"
          role="menuitem"
          data-collection-page-edit-navigation
          hidden
        >
          Edit Navigation
        </a>
        <button
          type="button"
          role="menuitem"
          data-collection-page-action="delete"
        >
          Delete
        </button>
      </div>
    </div>
  `;
}

async function flushAsyncWork() {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("smart collection page actions", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    window.location.href = "http://localhost/reading";
  });

  // The same request a collection page sends, down to the placement and the
  // header-refresh hint — the two kinds are one thing to the reader, so the
  // action cannot quietly put them in different parts of the nav.
  it("adds the smart collection to navigation and reveals the settings action", async () => {
    createMarkup();
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: "nav-1" }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { showToastWithAction } = await import("../toast.js");
    await import("../smart-collection-page-actions.js");

    const addButton = document.querySelector<HTMLButtonElement>(
      "[data-collection-page-action='add-to-navigation']",
    );
    const editNavigationLink = document.querySelector<HTMLAnchorElement>(
      "[data-collection-page-edit-navigation]",
    );

    addButton?.click();
    await flushAsyncWork();

    expect(fetchMock).toHaveBeenCalledWith("/api/nav-items", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "X-Jant-Site-Header": "include",
      },
      body: JSON.stringify({
        type: "smart_collection",
        smartCollectionId: "smc_1",
        placement: "header",
      }),
    });
    expect(addButton?.hidden).toBe(true);
    expect(editNavigationLink?.hidden).toBe(false);
    expect(
      document.querySelector<HTMLElement>(
        "[data-smart-collection-page-actions]",
      )?.dataset.collectionInNavigation,
    ).toBe("true");
    expect(showToastWithAction).toHaveBeenCalledWith(
      "Collection added to navigation.",
      {
        label: "Edit Navigation",
        href: "/settings/navigation",
      },
    );
  });

  it("keeps the action available when the request fails", async () => {
    createMarkup();
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 500 }));
    vi.stubGlobal("fetch", fetchMock);

    const { showToast } = await import("../toast.js");
    await import("../smart-collection-page-actions.js");

    const addButton = document.querySelector<HTMLButtonElement>(
      "[data-collection-page-action='add-to-navigation']",
    );

    addButton?.click();
    await flushAsyncWork();

    expect(showToast).toHaveBeenCalledWith(
      "Couldn't add this collection to navigation. Try again.",
      "error",
    );
    expect(addButton?.hidden).toBe(false);
    expect(addButton?.disabled).toBe(false);
    expect(addButton?.textContent).toContain("Add to Navigation");
  });
});
