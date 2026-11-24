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
  right: number;
  left?: number;
}

/** Input sizes for placing a desktop post menu against its trigger. */
export interface PostMenuPlacementOptions {
  /** Measured height of `.post-menu-panel`, or `0` before first layout. */
  panelHeight?: number;
  /** Measured width of `.post-menu-panel`, or `0` before first layout. */
  panelWidth?: number;
  /** Fallback menu height when `panelHeight` is `0`. */
  estimatedHeight: number;
}

/** Computed document-space coordinates and viewport height cap for a menu. */
export interface PostMenuPlacement {
  /** Document-space X for the menu's right edge (used with `translateX(-100%)`). */
  x: number;
  /** Document-space Y anchor (`top` when `anchorBottom` is false, `bottom` when true). */
  y: number;
  /** True when the menu anchors cleanly above the trigger (`translate(-100%, -100%)`). */
  anchorBottom: boolean;
  /** Maximum height in pixels that fits inside the current visual viewport margins. */
  maxHeight: number;
}

/** Matches the phone switch (`max-width: 699px`) in `styles/tokens.css`. */
const POST_MENU_SHEET_MAX_WIDTH = 699;
const MENU_VIEWPORT_MARGIN = 12;
const MENU_TRIGGER_GAP = 6;
const MENU_MIN_MAX_HEIGHT = 120;

/**
 * Whether the post menu should present as a bottom action sheet instead of an
 * anchored floating popover. Matches the phone breakpoint (`max-width: 699px`).
 *
 * @returns True on phone viewports
 *
 * @example
 * ```ts
 * const sheet = isPostMenuSheetViewport();
 * ```
 */
export function isPostMenuSheetViewport(): boolean {
  return window.innerWidth <= POST_MENU_SHEET_MAX_WIDTH;
}

/**
 * Compute document-space coordinates for a desktop post menu anchored to its
 * trigger, clamping within the visual viewport so top items can never overflow
 * above the screen or document edge.
 *
 * @param rect - The trigger's bounding client rect
 * @param options - Measured panel dimensions (when available) and fallback height
 * @returns Document-space placement and viewport-bounded max height
 *
 * @example
 * ```ts
 * computePostMenuPlacement(trigger.getBoundingClientRect(), {
 *   panelHeight: 520,
 *   panelWidth: 240,
 *   estimatedHeight: 460,
 * });
 * ```
 */
export function computePostMenuPlacement(
  rect: MenuTriggerRect,
  options: PostMenuPlacementOptions,
): PostMenuPlacement {
  const vv = globalThis.visualViewport;
  const viewportTop = vv?.offsetTop ?? 0;
  const viewportLeft = vv?.offsetLeft ?? 0;
  const viewportWidth = vv?.width ?? window.innerWidth;
  const viewportHeight = vv?.height ?? window.innerHeight;
  const viewportBottom = viewportTop + viewportHeight;
  const viewportRight = viewportLeft + viewportWidth;

  const minTop = viewportTop + MENU_VIEWPORT_MARGIN;
  const maxBottom = viewportBottom - MENU_VIEWPORT_MARGIN;
  const maxHeight = Math.max(
    MENU_MIN_MAX_HEIGHT,
    Math.floor(viewportHeight - MENU_VIEWPORT_MARGIN * 2),
  );

  const rawHeight =
    options.panelHeight && options.panelHeight > 0
      ? options.panelHeight
      : options.estimatedHeight;
  const height = Math.min(rawHeight, maxHeight);

  const spaceBelow = maxBottom - (rect.bottom + MENU_TRIGGER_GAP);
  const spaceAbove = rect.top - MENU_TRIGGER_GAP - minTop;

  let y: number;
  let anchorBottom = false;

  if (height <= spaceBelow) {
    y = window.scrollY + rect.bottom + MENU_TRIGGER_GAP;
  } else if (height <= spaceAbove) {
    y = window.scrollY + rect.top - MENU_TRIGGER_GAP;
    anchorBottom = true;
  } else {
    // Neither side fits the full panel on its own: keep the whole menu inside
    // the viewport margins, favoring the side with more room.
    const desiredTop =
      spaceAbove > spaceBelow
        ? rect.top - MENU_TRIGGER_GAP - height
        : rect.bottom + MENU_TRIGGER_GAP;
    const maxTop = Math.max(minTop, maxBottom - height);
    const clampedTop = Math.max(minTop, Math.min(desiredTop, maxTop));
    y = window.scrollY + clampedTop;
  }

  let rightInViewport = rect.right;
  const panelWidth = options.panelWidth ?? 0;
  if (panelWidth > 0) {
    const usableWidth = Math.max(0, viewportWidth - MENU_VIEWPORT_MARGIN * 2);
    const minRight =
      viewportLeft + MENU_VIEWPORT_MARGIN + Math.min(panelWidth, usableWidth);
    const maxRight = viewportRight - MENU_VIEWPORT_MARGIN;
    rightInViewport = Math.max(minRight, Math.min(rect.right, maxRight));
  }

  return {
    x: window.scrollX + rightInViewport,
    y,
    anchorBottom,
    maxHeight,
  };
}

/**
 * Format the inline `style` attribute for a desktop anchored post menu surface.
 *
 * @param placement - Placement computed by `computePostMenuPlacement`
 * @returns CSS inline style string
 *
 * @example
 * ```ts
 * wrapper.setAttribute("style", postMenuSurfaceStyle(placement));
 * ```
 */
export function postMenuSurfaceStyle(placement: PostMenuPlacement): string {
  const transform = placement.anchorBottom
    ? "transform:translate(-100%, -100%);"
    : "transform:translateX(-100%);";
  return `position:absolute;z-index:100;left:${Math.round(placement.x)}px;top:${Math.round(placement.y)}px;${transform}--post-menu-max-height:${placement.maxHeight}px;`;
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

/**
 * Fetch a post's Markdown representation via `Accept: text/markdown` and copy
 * it to the clipboard. Uses a Promise-backed `ClipboardItem` when supported so
 * Safari preserves the user-gesture clipboard grant across the network fetch.
 *
 * @param permalink - The post's permalink, as the article carries it
 * @example
 * ```ts
 * await copyPostMarkdown(article.dataset.postPermalink);
 * ```
 */
export async function copyPostMarkdown(permalink: string): Promise<void> {
  const url = new URL(permalink, globalThis.location.href).href;
  const fetchMarkdown = async (): Promise<string> => {
    const res = await fetch(url, {
      headers: { Accept: "text/markdown" },
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    return res.text();
  };

  try {
    const clipboard = globalThis.navigator.clipboard;
    if (!clipboard) {
      throw new Error("Clipboard unavailable");
    }

    if (
      typeof globalThis.ClipboardItem === "function" &&
      typeof clipboard.write === "function"
    ) {
      const blobPromise = fetchMarkdown().then(
        (text) => new Blob([text], { type: "text/plain" }),
      );
      await clipboard.write([
        new globalThis.ClipboardItem({ "text/plain": blobPromise }),
      ]);
      showToast("Markdown copied.");
      return;
    }

    if (typeof clipboard.writeText !== "function") {
      throw new Error("Clipboard unavailable");
    }

    const markdown = await fetchMarkdown();
    await clipboard.writeText(markdown);
    showToast("Markdown copied.");
  } catch {
    showToast("Could not copy Markdown.", "error");
  }
}

/** Lucide "file-text", for Copy as Markdown. */
export function iconMarkdown() {
  return html`<svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.75"
    stroke-linecap="round"
    stroke-linejoin="round"
  >
    <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
    <path d="M14 2v4a2 2 0 0 0 2 2h4" />
    <path d="M10 9H8" />
    <path d="M16 13H8" />
    <path d="M16 17H8" />
  </svg>`;
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
