/**
 * Custom URL action menus on the settings page.
 *
 * Keeps row menus mutually exclusive and dismisses them on any click
 * outside the trigger and the menu — including the rest of their own row —
 * and on Escape.
 *
 * The row list rounds its corners with `overflow: hidden`, and no stacking
 * order escapes an ancestor's clip. So an open menu is promoted to the top
 * layer, which takes it out of the clip entirely and leaves it positioned
 * against the viewport — hence the anchoring done here in script. Browsers
 * without the popover API fall back to the absolutely positioned menu, which
 * is clipped but still usable.
 */

import { openSmartCollectionDialog } from "./smart-collection-dialog-host.js";

/** Space between the trigger and the menu, in pixels. */
const MENU_GAP = 6;
/** Closest the menu may sit to a viewport edge, in pixels. */
const VIEWPORT_MARGIN = 8;

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

      const topLayer =
        typeof menu.showPopover === "function" && menu.hasAttribute("popover");

      /** Anchor the top-layer menu under the trigger, flipping above it when
       *  the viewport bottom is closer than the menu is tall. */
      const anchorToTrigger = () => {
        const anchor = trigger.getBoundingClientRect();
        const { width, height } = menu.getBoundingClientRect();
        const below = anchor.bottom + MENU_GAP;
        const above = anchor.top - MENU_GAP - height;
        const top =
          below + height <= window.innerHeight - VIEWPORT_MARGIN ||
          above < VIEWPORT_MARGIN
            ? below
            : above;

        menu.style.top = `${top}px`;
        menu.style.left = `${Math.max(
          VIEWPORT_MARGIN,
          Math.min(
            anchor.right - width,
            window.innerWidth - VIEWPORT_MARGIN - width,
          ),
        )}px`;
      };

      const close = (focusTrigger = false) => {
        if (menu.hidden) return;
        if (topLayer) {
          window.removeEventListener("resize", anchorToTrigger);
          window.removeEventListener("scroll", anchorToTrigger, true);
          if (menu.matches(":popover-open")) menu.hidePopover();
        }
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
        if (topLayer) {
          if (!menu.matches(":popover-open")) menu.showPopover();
          anchorToTrigger();
          window.addEventListener("resize", anchorToTrigger);
          // Capture phase: the menu follows a scroll of any ancestor, not
          // only the document.
          window.addEventListener("scroll", anchorToTrigger, true);
        }
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

      // The row is the action root, but it is not the menu's dismiss region:
      // the rest of the row is blank space like any other, so only the
      // trigger and the menu itself count as a click inside.
      document.addEventListener("click", (event) => {
        if (!(event.target instanceof Node)) return;
        if (trigger.contains(event.target) || menu.contains(event.target)) {
          return;
        }
        close(false);
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
