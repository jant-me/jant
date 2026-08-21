import { getCollectionsDirectoryPath } from "../lib/collection-paths.js";
import { NAVIGATION_SETTINGS_PATH } from "../lib/settings-paths.js";
import { openCollectionDialog } from "./collection-dialog-host.js";
import { addCollectionToNavigation } from "./collection-navigation.js";
import { showConfirmDialog } from "./confirm.js";
import { showToast, showToastWithAction } from "./toast.js";

interface CollectionPageActionLabels {
  edit: string;
  addToNavigation: string;
  addingToNavigation: string;
  addedToNavigation: string;
  editNavigation: string;
  addToNavigationFailed: string;
  moreActions: string;
  deleteCollection: string;
  confirmDelete: string;
  cancel: string;
  saveFailed: string;
  deleted: string;
}

const parseLabels = (value: string | undefined): CollectionPageActionLabels => {
  if (!value) {
    return {
      edit: "",
      addToNavigation: "",
      addingToNavigation: "",
      addedToNavigation: "",
      editNavigation: "",
      addToNavigationFailed: "",
      moreActions: "",
      deleteCollection: "",
      confirmDelete: "",
      cancel: "",
      saveFailed: "",
      deleted: "",
    };
  }

  try {
    return JSON.parse(value) as CollectionPageActionLabels;
  } catch {
    return {
      edit: "",
      addToNavigation: "",
      addingToNavigation: "",
      addedToNavigation: "",
      editNavigation: "",
      addToNavigationFailed: "",
      moreActions: "",
      deleteCollection: "",
      confirmDelete: "",
      cancel: "",
      saveFailed: "",
      deleted: "",
    };
  }
};

document
  .querySelectorAll<HTMLElement>("[data-collection-page-actions]")
  .forEach((root) => {
    if (root.dataset.collectionPageActionsInitialized === "true") return;

    const labels = parseLabels(root.dataset.collectionPageLabels);
    const collectionId = root.dataset.collectionId;
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

    if (!collectionId || !trigger || !menu) return;

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
        const firstItem = menu.querySelector<HTMLElement>("[role='menuitem']");
        firstItem?.focus();
      }
    };

    const handleEdit = async () => {
      closeMenu(false);
      const { changed, collection } = await openCollectionDialog({
        collectionId,
      });
      if (!changed) return;

      // The address can have moved, and the old one stops resolving the moment
      // it does — so the page follows it rather than reloading into a 404.
      // Only the last segment changes: whatever site or language prefix this
      // reader arrived under is theirs to keep.
      const nextPath = collection?.slug
        ? window.location.pathname.replace(/[^/]*$/, collection.slug)
        : null;
      if (nextPath && nextPath !== window.location.pathname) {
        window.location.href = `${nextPath}${window.location.search}`;
        return;
      }
      window.location.reload();
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
        const res = await fetch(`/api/collections/${collectionId}`, {
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
        await addCollectionToNavigation(collectionId);
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

      if (menu.hidden) {
        openMenu(false);
        return;
      }

      closeMenu(false);
    });

    trigger.addEventListener("keydown", (event) => {
      if (
        event.key === "Enter" ||
        event.key === " " ||
        event.key === "ArrowDown"
      ) {
        event.preventDefault();
        if (menu.hidden) {
          openMenu(true);
        } else {
          closeMenu(false);
        }
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
      if (!target) return;

      const actionEl = target.closest<HTMLElement>(
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
      if (!root.contains(event.target)) {
        closeMenu(false);
      }
    });

    root.dataset.collectionPageActionsInitialized = "true";
  });
