/**
 * What the author's post menu (`jant-post-menu`) and a reader's
 * (`jant-share-menu`) share: where the menu opens, the icons of the two items
 * both offer, and copying a post's link.
 */

import { html } from "lit";
import { showToast } from "./toast.js";

/** The trigger's box, as `getBoundingClientRect()` gives it. */
export interface MenuTriggerRect {
  top: number;
  bottom: number;
}

const MENU_VIEWPORT_MARGIN = 12;

/**
 * Whether a menu should open above its trigger: when it would not fit below
 * and there is more room above.
 *
 * @param rect - The trigger's box
 * @param menuHeight - The menu's height, estimated before it renders
 * @returns True to open above the trigger
 *
 * @example
 * ```ts
 * menuOpensAbove(trigger.getBoundingClientRect(), 360);
 * ```
 */
export function menuOpensAbove(
  rect: MenuTriggerRect,
  menuHeight: number,
): boolean {
  const spaceBelow = window.innerHeight - rect.bottom - MENU_VIEWPORT_MARGIN;
  const spaceAbove = rect.top - MENU_VIEWPORT_MARGIN;
  return spaceBelow < menuHeight && spaceAbove > spaceBelow;
}

/**
 * Copy a post's own address and say whether it worked. The address is the
 * article's `data-post-permalink`, where the post's date links to, made
 * absolute: the post's own wherever it is listed, never the page's.
 *
 * @param permalink - The post's permalink, as the article carries it
 *
 * @example
 * ```ts
 * await copyPostLink(article.dataset.postPermalink);
 * ```
 */
export async function copyPostLink(permalink: string): Promise<void> {
  const url = new URL(permalink, globalThis.location.href).href;
  try {
    // Absent on an insecure origin, and the browser may refuse it.
    if (!globalThis.navigator.clipboard?.writeText) {
      throw new Error("Clipboard unavailable");
    }
    await globalThis.navigator.clipboard.writeText(url);
    showToast("Link copied.");
  } catch {
    showToast(
      "Could not copy the link. Open the post and copy it from the address bar.",
      "error",
    );
  }
}

/** Lucide "link", for Copy link. */
export function iconLink() {
  return html`<svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.75"
    stroke-linecap="round"
    stroke-linejoin="round"
  >
    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
    <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
  </svg>`;
}

/** Lucide "image", for Share as image. */
export function iconImage() {
  return html`<svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.75"
    stroke-linecap="round"
    stroke-linejoin="round"
  >
    <rect width="18" height="18" x="3" y="3" rx="2" />
    <circle cx="9" cy="9" r="2" />
    <path d="m21 15-3.09-3.09a2 2 0 0 0-2.82 0L6 21" />
  </svg>`;
}
