/**
 * Smart collection page owner menu.
 *
 * The same menu shape a collection page has, item for item — Edit, Add to
 * navigation, Edit navigation, Delete — with one difference: Edit opens the
 * dialog rather than navigating to an editor page, because a smart collection
 * has no editor page. There is no Edit button beside the title either; a
 * collection page has none, and the menu is where a page keeps its owner
 * actions.
 */

import { getCollectionsDirectoryPath } from "../lib/collection-paths.js";
import { NAVIGATION_SETTINGS_PATH } from "../lib/settings-paths.js";
import { showConfirmDialog } from "./confirm.js";
import { showToast, showToastWithAction } from "./toast.js";
import { openSmartCollectionDialog } from "./smart-collection-dialog-host.js";

interface PageActionLabels {
  addToNavigation: string;
  addingToNavigation: string;
  addedToNavigation: string;
  editNavigation: string;
  addToNavigationFailed: string;
  confirmDelete: string;
  deleteCollection: string;
  cancel: string;
  saveFailed: string;
  deleted: string;
}

const parseLabels = (value: string | undefined): PageActionLabels => {
  const empty: PageActionLabels = {
    addToNavigation: "",
    addingToNavigation: "",
    addedToNavigation: "",
    editNavigation: "",
    addToNavigationFailed: "",
    confirmDelete: "",
    deleteCollection: "",
    cancel: "",
    saveFailed: "",
    deleted: "",
  };
  if (!value) return empty;
  try {
    return { ...empty, ...(JSON.parse(value) as Partial<PageActionLabels>) };
  } catch {
    return empty;
  }
};

document
  .querySelectorAll<HTMLElement>("[data-smart-collection-page-actions]")
  .forEach((root) => {
    if (root.dataset.smartCollectionPageActionsInitialized === "true") return;

    const labels = parseLabels(root.dataset.collectionPageLabels);
    const smartCollectionId = root.dataset.smartCollectionId;
    const redirectUrl =
      root.dataset.collectionPageRedirectUrl || getCollectionsDirectoryPath();
    const trigger = root.querySelector<HTMLElement>(
      "[data-collection-page-action='toggle-menu']",
    );
    const menu = root.querySelector<HTMLElement>("[data-collection-page-menu]");
    const addToNavigationButton = root.querySelector<HTMLButtonElement>(
      "[data-collection-page-action='add-to-navigation']",
    );
    const editNavigationLink = root.querySelector<HTMLAnchorElement>(
      "[data-collection-page-edit-navigation]",
    );

    if (!smartCollectionId || !trigger || !menu) return;

    const closeMenu = (focusTrigger = false) => {
      if (menu.hidden) return;
      menu.hidden = true;
      trigger.setAttribute("aria-expanded", "false");
      if (focusTrigger) trigger.focus();
    };

    const openMenu = (focusFirstItem = false) => {
      menu.hidden = false;
      trigger.setAttribute("aria-expanded", "true");
      if (focusFirstItem) {
        menu.querySelector<HTMLElement>("[role='menuitem']")?.focus();
      }
    };

    const handleEdit = async () => {
      closeMenu(false);
      const changed = await openSmartCollectionDialog({ smartCollectionId });
      // The address, the title, the conditions, and the count can all have
      // moved, so the page is re-read rather than patched in place.
      if (changed) window.location.reload();
    };

    const handleDelete = async () => {
      closeMenu(false);
      const confirmed = await showConfirmDialog({
        message: labels.confirmDelete,
        confirmLabel: labels.deleteCollection,
        cancelLabel: labels.cancel,
        tone: "danger",
      });
      if (!confirmed) return;

      try {
        const res = await fetch(`/api/smart-collections/${smartCollectionId}`, {
          method: "DELETE",
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        showToast(labels.deleted);
        window.location.href = redirectUrl;
      } catch {
        showToast(labels.saveFailed, "error");
      }
    };

    const handleAddToNavigation = async () => {
      if (!addToNavigationButton || addToNavigationButton.disabled) return;

      closeMenu(false);
      const label = addToNavigationButton.querySelector<HTMLElement>(
        ".collections-page-menu-item-label",
      );
      addToNavigationButton.disabled = true;
      if (label) label.textContent = labels.addingToNavigation;

      try {
        const res = await fetch("/api/nav-items", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: "smart_collection",
            smartCollectionId,
            placement: "more",
          }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        addToNavigationButton.hidden = true;
        if (editNavigationLink) editNavigationLink.hidden = false;
        root.dataset.collectionInNavigation = "true";
        showToastWithAction(labels.addedToNavigation, {
          label: labels.editNavigation,
          href:
            editNavigationLink?.getAttribute("href") ??
            NAVIGATION_SETTINGS_PATH,
        });
      } catch {
        showToast(labels.addToNavigationFailed, "error");
      } finally {
        addToNavigationButton.disabled = false;
        if (label) label.textContent = labels.addToNavigation;
      }
    };

    trigger.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (menu.hidden) openMenu(false);
      else closeMenu(false);
    });

    trigger.addEventListener("keydown", (event) => {
      if (
        event.key === "Enter" ||
        event.key === " " ||
        event.key === "ArrowDown"
      ) {
        event.preventDefault();
        if (menu.hidden) openMenu(true);
        else closeMenu(false);
      }
      if (event.key === "Escape") {
        event.preventDefault();
        closeMenu(true);
      }
    });

    menu.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeMenu(true);
      }
    });

    root.addEventListener("click", (event) => {
      const target = event.target as HTMLElement | null;
      const actionEl = target?.closest<HTMLElement>(
        "[data-collection-page-action]",
      );
      if (!actionEl || !root.contains(actionEl)) return;

      const action = actionEl.dataset.collectionPageAction;
      if (action === "edit") {
        event.preventDefault();
        void handleEdit();
      }
      if (action === "delete") {
        event.preventDefault();
        void handleDelete();
      }
      if (action === "add-to-navigation") {
        event.preventDefault();
        void handleAddToNavigation();
      }
    });

    document.addEventListener("click", (event) => {
      if (!(event.target instanceof Node)) return;
      if (!root.contains(event.target)) closeMenu(false);
    });

    root.dataset.smartCollectionPageActionsInitialized = "true";
  });
