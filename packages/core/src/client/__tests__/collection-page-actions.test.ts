// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../toast.js", () => ({
  showToast: vi.fn(),
}));

vi.mock("../confirm.js", () => ({
  showConfirmDialog: vi.fn(),
}));

function createMarkup() {
  document.body.innerHTML = `
    <div id="toast-container"></div>
    <div
      data-collection-page-actions
      data-collection-id="collection-1"
      data-collection-page-labels='{"edit":"Edit","moreActions":"More actions","deleteCollection":"Delete","confirmDelete":"Delete this collection permanently? Threads inside won\\u0027t be removed.","cancel":"Cancel","saveFailed":"Couldn\\u0027t save. Try again in a moment.","deleted":"Deleted"}'
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
        <a href="/collections/original-slug/edit?returnTo=%2Foriginal-slug" role="menuitem">
          Edit
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
});
