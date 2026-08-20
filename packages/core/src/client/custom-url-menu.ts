/**
 * Custom URL action menus on the settings page.
 *
 * Keeps row menus mutually exclusive and dismisses them on outside click
 * and Escape.
 */

import { openSmartCollectionDialog } from "./smart-collection-dialog-host.js";

/**
 * Initialize custom URL action menus within a root.
 *
 * @param root - DOM subtree to scan for custom URL action menus.
 * @returns Nothing.
 * @example
 * initCustomUrlMenus();
 */
export function initCustomUrlMenus(
  root: globalThis.ParentNode = document,
): void {
  root
    .querySelectorAll<HTMLElement>("[data-custom-url-actions]")
    .forEach((menuRoot) => {
      if (menuRoot.dataset.customUrlActionsInitialized === "true") return;

      const trigger = menuRoot.querySelector<HTMLButtonElement>(
        "[data-custom-url-action='toggle-menu']",
      );
      const menu = menuRoot.querySelector<HTMLElement>(
        "[data-custom-url-menu]",
      );

      if (!(trigger instanceof HTMLButtonElement) || !menu) return;

      const close = (focusTrigger = false) => {
        if (menu.hidden) return;
        menu.hidden = true;
        trigger.setAttribute("aria-expanded", "false");
        if (focusTrigger) trigger.focus();
      };

      const open = (focusFirstItem = false) => {
        document.dispatchEvent(
          new CustomEvent("jant:custom-url-menu", {
            detail: { source: menuRoot },
          }),
        );
        menu.hidden = false;
        trigger.setAttribute("aria-expanded", "true");
        if (focusFirstItem) {
          const firstItem =
            menu.querySelector<HTMLElement>("[role='menuitem']");
          firstItem?.focus();
        }
      };

      trigger.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();

        if (menu.hidden) {
          open(false);
          return;
        }

        close(false);
      });

      trigger.addEventListener("keydown", (event) => {
        if (
          event.key === "Enter" ||
          event.key === " " ||
          event.key === "ArrowDown"
        ) {
          event.preventDefault();
          if (menu.hidden) {
            open(true);
          } else {
            close(false);
          }
          return;
        }

        if (event.key === "Escape") {
          event.preventDefault();
          close(true);
        }
      });

      menu.addEventListener("keydown", (event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          close(true);
        }
      });

      menuRoot.addEventListener("click", (event) => {
        const target = event.target as HTMLElement | null;
        if (!target) return;

        const actionEl = target.closest<HTMLElement>(
          "[data-custom-url-action]",
        );
        if (!actionEl || !menuRoot.contains(actionEl)) return;
        if (actionEl.dataset.customUrlAction === "delete") {
          close(false);
        }
        if (actionEl.dataset.customUrlAction === "upgrade") {
          event.preventDefault();
          close(false);
          // Prefilled and shown, never saved on the author's behalf. The
          // stored path becomes the starting title, which is the one thing an
          // automatic conversion could not have supplied honestly.
          const raw = actionEl.dataset.customUrlUpgrade;
          if (!raw) return;
          try {
            void openSmartCollectionDialog({
              prefill: JSON.parse(raw) as Parameters<
                typeof openSmartCollectionDialog
              >[0]["prefill"],
            }).then((changed) => {
              if (changed) window.location.reload();
            });
          } catch {
            // A malformed payload is not worth an error toast: the menu item
            // simply does nothing, and the stored path keeps working.
          }
        }
      });

      document.addEventListener("click", (event) => {
        if (!(event.target instanceof Node)) return;
        if (!menuRoot.contains(event.target)) {
          close(false);
        }
      });

      document.addEventListener("jant:custom-url-menu", (event) => {
        const customEvent = event as CustomEvent<{
          source?: globalThis.EventTarget | null;
        }>;
        if (customEvent.detail?.source !== menuRoot) {
          close(false);
        }
      });

      menuRoot.dataset.customUrlActionsInitialized = "true";
    });
}

initCustomUrlMenus();
