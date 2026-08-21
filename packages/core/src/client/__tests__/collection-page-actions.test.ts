// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../toast.js", () => ({
  showToast: vi.fn(),
  showToastWithAction: vi.fn(),
}));

vi.mock("../confirm.js", () => ({
  showConfirmDialog: vi.fn(),
}));

vi.mock("../collection-dialog-host.js", () => ({
  openCollectionDialog: vi.fn(),
}));

function createMarkup() {
  document.body.innerHTML = `
    <div id="toast-container"></div>
    <div
      data-collection-page-actions
      data-collection-id="collection-1"
      data-collection-page-labels='{"edit":"Edit","addToNavigation":"Add to Navigation","addingToNavigation":"Adding…","addedToNavigation":"Collection added to navigation.","editNavigation":"Edit Navigation","addToNavigationFailed":"Couldn\\u0027t add this collection to navigation. Try again.","moreActions":"More actions","deleteCollection":"Delete","confirmDelete":"Delete this collection permanently? Threads inside won\\u0027t be removed.","cancel":"Cancel","saveFailed":"Couldn\\u0027t save. Try again in a moment.","deleted":"Deleted"}'
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

describe("collection detail page actions", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    window.location.href = "http://localhost/original-slug";
  });

  it("toggles the action menu from the trigger", async () => {
    createMarkup();
    await import("../collection-page-actions.js");

    const trigger = document.querySelector<HTMLElement>(
      "[data-collection-page-action='toggle-menu']",
    );
    const menu = document.querySelector<HTMLElement>(
      "[data-collection-page-menu]",
    );

    expect(menu?.hidden).toBe(true);
    trigger?.click();
    expect(menu?.hidden).toBe(false);
    expect(trigger?.getAttribute("aria-expanded")).toBe("true");

    trigger?.click();
    expect(menu?.hidden).toBe(true);
    expect(trigger?.getAttribute("aria-expanded")).toBe("false");
  });

  it("deletes the collection and redirects back to the collections page", async () => {
    createMarkup();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
    });
    vi.stubGlobal("fetch", fetchMock);

    const { showConfirmDialog } = await import("../confirm.js");
    const { showToast } = await import("../toast.js");
    await import("../collection-page-actions.js");
    vi.mocked(showConfirmDialog).mockResolvedValue(true);

    const trigger = document.querySelector<HTMLElement>(
      "[data-collection-page-action='toggle-menu']",
    );
    const deleteButton = document.querySelector<HTMLElement>(
      "[data-collection-page-action='delete']",
    );

    trigger?.click();
    deleteButton?.click();

    await Promise.resolve();
    await Promise.resolve();

    expect(showConfirmDialog).toHaveBeenCalledWith({
      message:
        "Delete this collection permanently? Threads inside won't be removed.",
      confirmLabel: "Delete",
      cancelLabel: "Cancel",
      tone: "danger",
    });
    expect(fetchMock).toHaveBeenCalledWith("/api/collections/collection-1", {
      method: "DELETE",
    });
    expect(showToast).toHaveBeenCalledWith("Deleted");
    expect(window.location.pathname).toBe("/collections");
  });

  it("edits the collection in the dialog, and follows a moved address", async () => {
    createMarkup();
    const { openCollectionDialog } =
      await import("../collection-dialog-host.js");
    vi.mocked(openCollectionDialog).mockResolvedValue({
      changed: true,
      collection: { id: "collection-1", slug: "renamed", title: "Renamed" },
    });
    await import("../collection-page-actions.js");

    document
      .querySelector<HTMLElement>("[data-collection-page-action='toggle-menu']")
      ?.click();
    document
      .querySelector<HTMLElement>("[data-collection-page-action='edit']")
      ?.click();
    await flushAsyncWork();

    expect(openCollectionDialog).toHaveBeenCalledWith({
      collectionId: "collection-1",
    });
    expect(window.location.pathname).toBe("/renamed");
  });

  it("leaves the page where it is when the dialog is dismissed", async () => {
    createMarkup();
    const { openCollectionDialog } =
      await import("../collection-dialog-host.js");
    vi.mocked(openCollectionDialog).mockResolvedValue({ changed: false });
    const reload = vi.fn();
    vi.spyOn(window.location, "reload").mockImplementation(reload);
    await import("../collection-page-actions.js");

    document
      .querySelector<HTMLElement>("[data-collection-page-action='toggle-menu']")
      ?.click();
    document
      .querySelector<HTMLElement>("[data-collection-page-action='edit']")
      ?.click();
    await flushAsyncWork();

    expect(reload).not.toHaveBeenCalled();
    expect(window.location.pathname).toBe("/original-slug");
  });

  it("adds the collection to navigation and reveals the settings action", async () => {
    createMarkup();
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: "nav-1" }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { showToastWithAction } = await import("../toast.js");
    await import("../collection-page-actions.js");

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
        type: "collection",
        collectionId: "collection-1",
        placement: "header",
      }),
    });
    expect(addButton?.hidden).toBe(true);
    expect(editNavigationLink?.hidden).toBe(false);
    expect(showToastWithAction).toHaveBeenCalledWith(
      "Collection added to navigation.",
      {
        label: "Edit Navigation",
        href: "/settings/navigation",
      },
    );
  });
});
